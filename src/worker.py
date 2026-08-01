from workers import DurableObject, WorkerEntrypoint, fetch
from urllib.parse import urlencode
from js import WebSocket, Object, Request
from datetime import datetime
import json
import time
import re

class TwitchEventSub(DurableObject):
	def __init__(self, state, env):
		super().__init__(state, env)
		self.state = state
		self.env = env
		self.storage = self.state.storage
		self.ws = None
		self.sessionId = None
		self.alarm_ms = 60 * 60 * 1000
		print("we're alive probably")

	async def getAccessToken(self):
		token = await self.storage.get("access_token") or self.env.TWITCH_ACCESS_TOKEN
		return token

	async def refreshAccessToken(self):
		print("trying to refresh token")
		refresh_token = await self.storage.get("refresh_token") or self.env.TWITCH_REFRESH_TOKEN
		client_secret = self.env.TWITCH_CLIENT_SECRET

		if not (refresh_token and client_secret):
			raise Exception("somethings missing")

		params = urlencode({
			"client_id": self.env.TWITCH_CLIENT_ID.strip(),
			"client_secret": client_secret.strip(),
			"grant_type": "refresh_token",
			"refresh_token": refresh_token.strip()
		})

		response = await fetch(
			"https://id.twitch.tv/oauth2/token",
			method="POST",
			headers={"Content-Type": "application/x-www-form-urlencoded"},
			body=params
		)

		if not response.ok:
			error_msg = await response.text()
			raise Exception("couldnt refresh: " + error_msg)

		data = await response.json()

		await self.storage.put('access_token', data['access_token'])
		await self.storage.put('refresh_token', data['refresh_token'])

		print("got new token")
		return data['access_token']

	async def ensureConnected(self):
		current_alarm = await self.storage.getAlarm()
		if not current_alarm:
			print("scheduling new alarm")
			await self.storage.setAlarm(int(time.time() * 1000) + self.alarm_ms)
		else:
			print("alarm is hopefully fine")

		if self.ws and getattr(self.ws, "readyState", None) == 1:
			print("socket is open(?)")
			return

		if self.ws and getattr(self.ws, "readyState", None) == 0:
			print("connecting")
			return

		print("no active socket, opening new one")
		await self.openConnection()

	async def openConnection(self):
		twitch_ws_url = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30"
		print('connecting to ' + twitch_ws_url)
		ws = WebSocket.new(twitch_ws_url)
		self.ws = ws

		def on_open(event):
			print("socket opened")

		async def on_message(event):
			if ws != self.ws:
				return
			try:
				data = json.loads(event.data)
				message_type = data.get("metadata", {}).get("message_type")
				print(f"new message: {message_type}")

				await self.parse_message(data)
			except Exception as err:
				print(f"cant parse: {event.data}, error: {err}")

		async def on_close(event):
			print(f"socket closed, code: {getattr(event, 'code', 'unknown')}, reason: {getattr(event, 'reason', 'unknown')}")
			self.sessionId = None
			await self.storage.setAlarm(int(time.time() * 1000) + 5000)

		def on_error(event):
			if ws != self.ws:
				return
			error_message = getattr(event, "message", None) or "????"
			print(f"error: {error_message}")

		self.ws.onopen = on_open
		self.ws.onmessage = on_message
		self.ws.onclose = on_close
		self.ws.onerror = on_error
		await self.storage.setAlarm(int(time.time() * 1000) + self.alarm_ms)

	async def parse_message(self, message):
		message_type = message["metadata"]["message_type"]

		if message_type == "session_welcome":
			self.sessionId = message["payload"]["session"]["id"]
			await self.subscribe(self.sessionId)
			await self.getInitialInfo()
		elif message_type == "session_reconnect":
			print("reconnect requested")
			old_ws = self.ws
			await self.openConnection()
			old_ws.close()
		elif message_type == "notification":
			sub_type = message["metadata"]["subscription_type"]
			print(f"new notification: {sub_type}")

			if sub_type == "stream.online":
				await self.env.STREAM_DATA.put("is_live", "true")
				print("stream online")
			elif sub_type == "stream.offline":
				offline_timestamp = int(time.time() * 1000)
				await self.env.STREAM_DATA.put("offline_timestamp", str(offline_timestamp))
				await self.env.STREAM_DATA.put("is_live", "false")
				print(f"stream offline at {offline_timestamp}")
			elif sub_type == "channel.chat.message":
				event = message["payload"]["event"]

				if event["chatter_user_id"] == "19264788":
					message_text = event["message"]["text"]

					match = re.search(r"nemimi has apologized (\d+) times!", message_text)

					if match:
						sorry_count = match.group(1)
						print(f"new sorry count: {sorry_count}")
						await self.env.STREAM_DATA.put("sorry_count", sorry_count)
			elif sub_type == "session_keepalive":
				pass

	async def subscribe(self, session_id, is_retry=False):
		channel_id = self.env.TWITCH_CHANNEL_ID
		print(f"subscribing to {channel_id}")
		access_token = await self.getAccessToken()
		client_id = self.env.TWITCH_CLIENT_ID.strip()

		subs = [
			{
				"type": "stream.online",
				"condition": {"broadcaster_user_id": channel_id}
			},
			{
				"type": "stream.offline",
				"condition": {"broadcaster_user_id": channel_id}
			},
			{
				"type": "channel.chat.message",
				"condition": {
					"broadcaster_user_id": channel_id,
					"user_id": "648526618"
				}
			}
		]

		for sub in subs:
			try:
				response = await fetch(
					'https://api.twitch.tv/helix/eventsub/subscriptions',
					method="POST",
					headers={
						'Client-ID': client_id,
						'Authorization': f"Bearer {access_token}",
						'Content-Type': 'application/json',
					},
					body=json.dumps({
						"type": sub["type"],
						"version": "1",
						"condition": sub["condition"],
						"transport": {
							"method": "websocket",
							"session_id": session_id
						},
					}),
				)

				if response.status == 401 and not is_retry:
					print(f"401 for {sub['type']}, refreshing token")
					await self.refreshAccessToken()

					print(f"retrying subscription for {sub['type']} with new token")
					return await self.subscribe(session_id, True)

				if not response.ok:
					error_text = await response.text()
					print(f"sub failed for {sub['type']}, status: {response.status}, response: {error_text}")
				else:
					print(f"subscribed to {sub['type']}")
			except Exception as err:
				print(f"failed to subscribe to {sub['type']}: {err}")

	async def getInitialInfo(self):
		print("getting current state")
		try:
			await self.getPlaylist()
			await self.getNextStream()
			access_token = await self.getAccessToken()
			client_id = self.env.TWITCH_CLIENT_ID
			response = await fetch(
				f"https://api.twitch.tv/helix/streams?user_id={self.env.TWITCH_CHANNEL_ID}",
				method="GET",
				headers={
					'Client-Id': client_id.strip(),
					'Authorization': f"Bearer {access_token}"
				}
			)

			if not response.ok:
				error_text = await response.text()
				print(f"failed to get state: {error_text}")
				return

			data = await response.json()

			if data['data'] and len(data['data']) > 0:
				await self.env.STREAM_DATA.put("is_live", "true")
			else:
				await self.env.STREAM_DATA.put("is_live", "false")
		except Exception as err:
			print(f"error getting state: {err}")

	async def getNextStream(self):
		if not (self.env.YOUTUBE_API_KEY and self.env.YOUTUBE_CHANNEL_ID):
			return

		try:
			response = await fetch(f"https://www.googleapis.com/youtube/v3/search?part=snippet&channelId={self.env.YOUTUBE_CHANNEL_ID}&type=video&eventType=upcoming&key={self.env.YOUTUBE_API_KEY}")
			data = await response.json()

			if data.get('items') and len(data['items']) > 0:
				stream_ids = ",".join([item['id']['videoId'] for item in data['items']])

				video_details = await fetch(f"https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id={stream_ids}&key={self.env.YOUTUBE_API_KEY}")
				video_data = await video_details.json()

				upcoming_streams = sorted(
					[
						item for item in video_data.get("items", [])
						if item.get("liveStreamingDetails", {}).get("scheduledStartTime")
					],
					key=lambda x: datetime.fromisoformat(
						x["liveStreamingDetails"]["scheduledStartTime"].replace("Z", "+00:00")
					)
				)

				if len(upcoming_streams) > 0:
					earliest = upcoming_streams[0]
					start_time = earliest["liveStreamingDetails"]["scheduledStartTime"]

					dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
					unix_timestamp = int(dt.timestamp())

					await self.env.STREAM_DATA.put("next_stream", str(unix_timestamp))
					print(f"got stream time: {start_time}")
		except Exception as err:
			print(f"error getting next stream: {err}")

	async def getPlaylist(self):
		next_page = None
		page_arg = None
		new_pages = True
		video_list = []
		try:
			while new_pages:
				if next_page:
					page_arg = f"&pageToken={next_page}"
				else:
					page_arg = ''

				response = await fetch(f"https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId={self.env.YOUTUBE_PLAYLIST_ID}&key={self.env.YOUTUBE_API_KEY}{page_arg}")
				data = await response.json()

				if data.get('items') and len(data['items']) > 0:
					for item in data['items']:
						if item.get('contentDetails') and len(item['contentDetails']) > 0:
							video_list.append(item['contentDetails']['videoId'])

				if data.get('nextPageToken'):
					next_page = data.get('nextPageToken')
				else:
					next_page = None
					new_pages = False
			await self.env.STREAM_DATA.put("playlist_items", json.dumps(video_list))
		except Exception as err:
			print(f"error fetching playlist: {err}")

	async def alarm(self):
		print("checking connections(alarm)")
		await self.ensureConnected()
		await self.getNextStream()
		await self.getPlaylist()
		await self.storage.setAlarm(int(time.time() * 1000) + self.alarm_ms)

	async def fetch(self, request):
		from js import URL, Response

		url = URL.new(request.url)
		print(f"fetch request: {url.pathname}")

		if url.pathname == "/connect":
			await self.ensureConnected()
			return Response.new("ok")
		return Response.new("not found", Object.fromEntries([("status", 404)]))

class Default(WorkerEntrypoint):
	async def fetch(self, request, env):
		from js import URL, Response

		url = URL.new(request.url)

		if url.pathname == "/api/status":
			import asyncio
			is_live, offline_timestamp, sorry_count, next_stream, playlist_items_raw = await asyncio.gather(
				self.env.STREAM_DATA.get('is_live'),
				self.env.STREAM_DATA.get('offline_timestamp'),
				self.env.STREAM_DATA.get('sorry_count'),
				self.env.STREAM_DATA.get('next_stream'),
				self.env.STREAM_DATA.get('playlist_items')
			)

			response_data = {
				"isLive": is_live,
				"offlineTimestamp": offline_timestamp,
				"sorryCount": sorry_count,
				"nextStream": next_stream,
				"playlist": json.loads(playlist_items_raw) if playlist_items_raw else []
			}

			return Response.new(
				json.dumps(response_data),
				headers=Object.fromEntries([
					('Content-Type', 'application/json'),
					('Cache-Control', 'no-store, max-age=0, must-revalidate'),
					('Access-Control-Allow-Origin', '*')
				])
			)

		if url.pathname == "/api/connect":
			secret = request.headers.get("X-Connect-Secret")
			if not secret or secret != self.env.CONNECT_SECRET:
				return Response.new("unauthorized", Object.fromEntries([("status", 401)]))
			do_id = self.env.TWITCH_EVENTSUB.idFromName('default')
			stub = self.env.TWITCH_EVENTSUB.get(do_id)
			return await stub.fetch(Request.new('https://internal/connect'))

		return await self.env.ASSETS.fetch(request)

	async def scheduled(self, controller, env, ctx):
		print("[cron] scheduling connection check")

		durable_id = self.env.TWITCH_EVENTSUB.idFromName("default")
		stub = self.env.TWITCH_EVENTSUB.get(durable_id)

		await stub.fetch(Request.new("https://internal/connect"))

