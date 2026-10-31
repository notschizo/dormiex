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

function getRealDate(month, day) {
	let currentTimeStamp = new Date();
	let timezoneOffset = getOffset();

	let currentYear = currentTimeStamp.getFullYear();

	let dateMilliseconds = Date.UTC(currentYear, month, day, 0 - timezoneOffset, 0, 0);
	return new Date(dateMilliseconds);
}

export async function fetchStreamStatus() {
	var response = await fetch('/api/status');
	return response.json();
}

export async function getDate(offlineTimestamp) {
	let offlineTime = new Date(offlineTimestamp * 1000);
	return offlineTime;
}

export function getOfflineTime(offlineDate) {
	return formatTimeStamp(getTheAmountOfTimeBetweenTheThingAndTheNextThing(offlineDate));
}

export function getNextStreamTime(streamDate) {
	return formatTimeStamp(getActualTimeDifference(streamDate));
}


export function getCountdown(month, day) {
	let currentTimeStamp = new Date();
	let thisTarget = getRealDate(month, day)
	let timeToTarget = thisTarget - currentTimeStamp

	if (timeToTarget > -86400000 && timeToTarget < 0) {
		return "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉"
	} else {
		let actualTarget = checkPassedDate(thisTarget)
		return formatTimeStamp(getTheAmountOfTimeBetweenTheThingAndTheNextThing(actualTarget));
	}

}

export function getActualTimeDifference(date) {
	let nowTimeStamp = new Date().getTime();
	let offset = date.getTime() - nowTimeStamp;
	return offset;
}

function getTheAmountOfTimeBetweenTheThingAndTheNextThing(date) {
	let nowTimeStamp = new Date().getTime();
	let offset = Math.abs(nowTimeStamp - date.getTime());
	return offset;
}

function checkPassedTarget(targetDate) {
	let currentTimeStamp = new Date();
	let currentYear = currentTimeStamp.getFullYear();
	let targetPassed = currentTimeStamp >= targetDate;
	if (targetPassed) {
		targetDate.setFullYear(currentYear + 1);
	}
	return targetDate;
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

function getRandomInt(min, max) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}

function getRandomItem(array) {
	let arrayIndex = getRandomInt(0, array.length);
	return array[arrayIndex];
}

export function getPlaylistItem(array) {
	let videoId = getRandomItem(array);
	return `https://www.youtube.com/embed/${videoId}`;
}
