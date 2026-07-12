function getOffset() {
	let currentTimeStamp = new Date();

	let formattingInfo = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Chicago',
		hour: 'numeric',
		hour12: false
	});

	let timezoneHour = parseInt(formattingInfo.format(currentTimeStamp));
	let utcHour = currentTimeStamp.getUTCHours();

	let timeDifference = (timezoneHour - utcHour + 24) % 24;

	if (timeDifference > 12) {
		timeDifference -= 24;
	}
	return timeDifference;
}

function getBirthDate() {
	let currentTimeStamp = new Date();
	let timezoneOffset = getOffset();

	let currentYear = currentTimeStamp.getFullYear();
	let birthMonth = 6;
	let birthDay = 18;

	let birthdayMilliseconds = Date.UTC(currentYear, birthMonth, birthDay, 0 - timezoneOffset, 0, 0);
	return new Date(birthdayMilliseconds);
}

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

export function getOfflineTime(offlineDate) {
	return formatTimeStamp(getTheAmountOfTimeBetweenTheThingAndTheNextThing(offlineDate));
}

export function getBirthdayCountdown() {
	let currentTimeStamp = new Date();
	let thisBirthday = getBirthDate()
	let timeToBirthday = thisBirthday - currentTimeStamp

	if (timeToBirthday < 86400000 && timeToBirthday > 0) {
		return "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉"
	} else {
		let actualBirthday = checkPassedBirthday(thisBirthday)
		return formatTimeStamp(getTheAmountOfTimeBetweenTheThingAndTheNextThing(actualBirthday));
	}

}

function getTheAmountOfTimeBetweenTheThingAndTheNextThing(date) {
	let nowTimeStamp = new Date().getTime();
	let offset = Math.abs(nowTimeStamp - date.getTime());
	return offset;
}

function checkPassedBirthday(birthDate) {
	let currentTimeStamp = new Date();
	let currentYear = currentTimeStamp.getFullYear();
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

function formatTimeStamp(milliseconds) {
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
