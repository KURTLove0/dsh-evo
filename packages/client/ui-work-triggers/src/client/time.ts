/** Explicit offset input avoids implicit browser time zones and daylight-saving normalization. */
/**
 * Parse an ISO target with a real calendar date and explicit UTC offset.
 * @param input - ISO date-time including Z or ±HH:MM.
 * @returns UTC epoch milliseconds, or undefined for invalid or ambiguous input.
 */
export function parseTriggerTime(input: string): number | undefined {
  const match = /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(input)
  if (match === null) return undefined
  const [, year, month, day, hour, minute, second] = match
  const y = Number(year), m = Number(month), d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()
    || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? '0') > 59) return undefined
  const at = Date.parse(input)
  return Number.isFinite(at) ? at : undefined
}
