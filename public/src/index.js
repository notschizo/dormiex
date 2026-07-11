export async function fetchStreamStatus() {
	var response = await fetch('/api/status');
	return response.json();
}

export async function getOfflineDate() {
	var status = await fetchStreamStatus();
	if (!status.offlineTimestamp) return null;
	let offlineTime = new Date(status.offlineTimestamp * 1000);
	return offlineTime;
}

function getTimeStampOffset(date) {
	let nowTimeStamp = new Date().getTime();
	let offset = Math.abs(nowTimeStamp - date.getTime());
	return offset;
}

function getOfflineTime(offlineTimeStamp) {
	return formatMilliseconds(getTimeStampOffset(offlineTimeStamp));
}

function getBirthdayCountdown() {
	return formatMilliseconds(getTimeStampOffset(getBirthDate()));
}

function getBirthDate() {
	let currentTimeStamp = new Date();
	let currentYear = currentTimeStamp.getFullYear();
	let birthDate = new Date(`July 18, ${currentYear} 00:00:00 GMT-06:00`);
	let birthdayPassed = currentTimeStamp >= birthDate;
	if (birthdayPassed) {
		birthDate.setFullYear(currentYear + 1);
	}
	return birthDate;
}

function getTimeIntervals(milliseconds) {
	let days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
	let hours = Math.floor((milliseconds % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	let minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
	let seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
	return [days, hours, minutes, seconds];
}

// formatMilliseconds
function formatMilliseconds(milliseconds) {
	let formattedTime;
	let timeIntervals = getTimeIntervals(milliseconds);
	for (let i = 0; i < timeIntervals.length; i++) {
		let interval = String(timeIntervals[i]).padStart(2, "0");
		if (interval !== "00" || formattedTime !== undefined) {
			if (formattedTime === undefined) {
				formattedTime = interval;
			} else {
				formattedTime += `:${interval}`;
			}
		}
	}
	return formattedTime;
}
