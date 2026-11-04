/** Every IANA timezone the browser knows, for timezone pickers. The server validates the same names. */
export const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()

/** "Asia/Kolkata (GMT+5:30)". */
export function timezoneLabel(tz: string) {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value
    return `${tz.replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`
  } catch {
    return tz
  }
}
