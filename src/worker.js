const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const ALARM_INTERVAL_MS = 10 * 60 * 1000;

export class TwitchEventSub {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.ws = null;
		this.sessionId = null;
		console.log("we're alive probably");
	}

	async getAccessToken() {
		const token = await this.state.storage.get('access_token') || this.env.TWITCH_ACCESS_TOKEN;
		return (token || '').trim();
	}

	async refreshTwitchToken() {
		console.log('trying to refresh auth token');

		const refreshToken = await this.state.storage.get('refresh_token') || this.env.TWITCH_REFRESH_TOKEN;
		const clientSecret = this.env.TWITCH_CLIENT_SECRET;

		if (!refreshToken || !clientSecret) {
			throw new Error('cant refresh, missing something');
		}

		const params = new URLSearchParams({
			client_id: this.env.TWITCH_CLIENT_ID.trim(),
										   client_secret: clientSecret.trim(),
										   grant_type: 'refresh_token',
										   refresh_token: refreshToken.trim()
		});

		const response = await fetch('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString()
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`cant refresh: ${response.status} - ${errorText}`);
		}

		const data = await response.json();

		await this.state.storage.put('access_token', data.access_token);
		await this.state.storage.put('refresh_token', data.refresh_token);

		console.log('we have a token');
		return data.access_token;
	}

	async fetch(request) {
		const url = new URL(request.url);
		console.log(`fetch request: ${url.pathname}`);

		if (url.pathname === '/connect') {
			await this.ensureConnected();
			return new Response('ok');
		}
		return new Response('not found', { status: 404 });
	}

	async ensureConnected() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			console.log('socket is open(?)');
			return;
		}
		if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
			console.log('connecting');
			return;
		}

		console.log('no active socket, opening new one');
		await this.openConnection(EVENTSUB_WS_URL);
	}

	async openConnection(url) {
		console.log(`connecting to ${url}`);
		const ws = new WebSocket(url);
		this.ws = ws;

		ws.addEventListener('open', () => {
			console.log('socket opened');
		});

		ws.addEventListener('message', async (e) => {
			if (ws !== this.ws) return;

			try {
				const msg = JSON.parse(e.data);
				console.log(`new message: ${msg.metadata?.message_type}`);
				await this.handleMessage(msg);
			} catch (err) {
				console.error(`cant parse: ${e.data}`, err);
			}
		});

		ws.addEventListener('error', (e) => {
			if (ws !== this.ws) return;
			console.error('socket error:', e.message || 'i have no clue lmao');
		});

		ws.addEventListener('close', async (e) => {
			if (ws !== this.ws) return;
			console.log(`socket closed, code: ${e.code}, reason: ${e.reason}`);
			this.sessionId = null;
			await this.state.storage.setAlarm(Date.now() + 5000);
		});

		await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
	}

	async syncInitialState() {
		console.log('getting current state');
		try {
			const currentToken = await this.getAccessToken();
			const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${this.env.TWITCH_CHANNEL_ID}`, {
				method: 'GET',
				headers: {
					'Client-ID': this.env.TWITCH_CLIENT_ID.trim(),
										 'Authorization': `Bearer ${currentToken}`
				}
			});

			if (!response.ok) {
				console.error('failed to get state', await response.text());
				return;
			}

			const data = await response.json();

			if (data.data && data.data.length > 0) {
				await this.env.STREAM_DATA.put('is_live', 'true');
				console.log('state fetched, stream is going');
			} else {
				await this.env.STREAM_DATA.put('is_live', 'false');
				console.log('state fetched, no stream running');
			}
		} catch (err) {
			console.error('error getting state:', err);
		}
	}

	async handleMessage(msg) {
		const type = msg.metadata?.message_type;

		if (type === 'session_welcome') {
			this.sessionId = msg.payload.session.id;
			console.log(`got welcome with id ${this.sessionId}`);
			await this.subscribe(this.sessionId);
			await this.syncInitialState();
		} else if (type === 'session_reconnect') {
			console.log('reconnect requested');
			const oldWs = this.ws;
			await this.openConnection(msg.payload.session.reconnect_url);
			oldWs.close();
		} else if (type === 'notification') {
			const subType = msg.metadata?.subscription_type;
			console.log(`new notif: ${subType}`);

			if (subType === 'stream.offline') {
				await this.env.STREAM_DATA.put('offline_timestamp', Math.floor(Date.now() / 1000).toString());
				await this.env.STREAM_DATA.put('is_live', 'false');
				console.log('kv updated to offline');
			} else if (subType === 'stream.online') {
				await this.env.STREAM_DATA.put('is_live', 'true');
				console.log('kv updated to online');
			} else if (subType === 'channel.chat.message') {
				const event = msg.payload.event;

				if (event.chatter_user_id === '19264788') {
					const messageText = event.message.text;
					const match = messageText.match(/nemimi has apologized (\d+) times!/i);

					if (match) {
						const extractedNumber = parseInt(match[1], 10);
						console.log(`new sorry count: ${extractedNumber}`);
						await this.env.STREAM_DATA.put('sorry_count', extractedNumber.toString());
					}
				}
			}
		} else if (type === 'session_keepalive') {
		}
	}

	async subscribe(sessionId, isRetry = false) {
		console.log(`subscribing to ${this.env.TWITCH_CHANNEL_ID}...`);

		const currentToken = await this.getAccessToken();

		const headers = {
			'Client-ID': this.env.TWITCH_CLIENT_ID.trim(),
			'Authorization': `Bearer ${currentToken}`,
			'Content-Type': 'application/json',
		};

		const channelId = this.env.TWITCH_CHANNEL_ID;

		const subs = [
			{ type: 'stream.online', condition: { broadcaster_user_id: channelId } },
			{ type: 'stream.offline', condition: { broadcaster_user_id: channelId } },
			{ type: 'channel.chat.message', condition: { broadcaster_user_id: channelId, user_id: '648526618' } }
		];

		for (const sub of subs) {
			try {
				const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						type: sub.type,
						version: '1',
						condition: sub.condition,
						transport: { method: 'websocket', session_id: sessionId },
					}),
				});

				if (response.status === 401 && !isRetry) {
					console.warn(`401 for ${sub.type}, fetching new token`);
					await this.refreshTwitchToken();

					console.log(`trying ${sub.type} again with new token`);
					return await this.subscribe(sessionId, true);
				}

				if (!response.ok) {
					const text = await response.text();
					console.error(`sub failed for ${sub.type}, status: ${response.status}, response: ${text}`);
				} else {
					console.log(`subscribed to ${sub.type}`);
				}
			} catch (err) {
				console.error(`something died with ${sub.type}, `, err);
			}
		}
	}

	async alarm() {
		console.log('checking connection(alarm)');
		await this.ensureConnected();
		if (this.ws && this.ws.readyState <= 1) {
			await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
		}
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/api/status') {
			const [isLiveStr, offlineTimestamp, sorryCount] = await Promise.all([
				env.STREAM_DATA.get('is_live'),
				env.STREAM_DATA.get('offline_timestamp'),
				env.STREAM_DATA.get('sorry_count')
			]);
			return Response.json({
				isLive: isLiveStr === 'true',
				offlineTimestamp,
				sorryCount: sorryCount || "0"
			}, {
					headers: {
						'Cache-Control': 'public, max-age=25',
						'Access-Control-Allow-Origin': '*'
					}
				});
		}

		if (url.pathname === '/api/connect') {
			const id = env.TWITCH_EVENTSUB.idFromName('default');
			const stub = env.TWITCH_EVENTSUB.get(id);
			return stub.fetch(new Request('https://internal/connect'));
		}

		return env.ASSETS.fetch(request);
	},

	async scheduled(event, env, ctx) {
		console.log('[cron] scheduling connection check');
		const id = env.TWITCH_EVENTSUB.idFromName('default');
		const stub = env.TWITCH_EVENTSUB.get(id);
		ctx.waitUntil(stub.fetch(new Request('https://internal/connect')));
	},
};
