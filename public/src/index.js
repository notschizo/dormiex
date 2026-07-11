export async function fetchStreamStatus() {
	var response = await fetch('/api/status');
	return response.json();
}

export async function getOfflineDate() {
	var status = await fetchStreamStatus();
	if (!status.offlineTimestamp) return null;
	var offlineTime = new Date();
	offlineTime.setTime(status.offlineTimestamp * 1000);
	return offlineTime;
}

export function getOfflineTime(offlineTime) {
	var now = new Date().getTime();
	var distance = Math.abs(offlineTime - now);

	var days = ('0' + Math.floor(distance / (1000 * 60 * 60 * 24))).slice(-2);
	var hours = ('0' + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).slice(-2);
	var minutes = ('0' + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))).slice(-2);
	var seconds = ('0' + Math.floor((distance % (1000 * 60)) / 1000)).slice(-2);

	var formattedTime = days + ":" + hours + ":" + minutes + ":" + seconds;
	while(formattedTime.charAt(0) === '0' || formattedTime.charAt(0) === ':') {
		formattedTime = formattedTime.substring(1);
	}
	return formattedTime;
}
