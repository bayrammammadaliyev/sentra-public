// Start of "today" in Baku (Asia/Baku), as a Date. The daily grading limit
// resets at local midnight there. Azerbaijan has been UTC+4 all year since
// 2016, but the offset is read from the time-zone data rather than hardcoded.
const TZ = "Asia/Baku";

function offsetMinutes(date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName").value; // "GMT+04:00"
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

function startOfBakuDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const midnightAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(midnightAsUtc - offsetMinutes(now) * 60000);
}

module.exports = { startOfBakuDay };
