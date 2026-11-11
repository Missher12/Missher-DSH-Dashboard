// Keep whole counts exact until the locale has a useful compact unit (万 or K).
function createFormat(locale: string, compactFrom: number) {
  const full = new Intl.NumberFormat(locale)
  const short = new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const choose = (value: number) => Math.abs(value) < compactFrom ? full : short
  return {
    exact: full.format,
    compact: (value: number) => choose(value).format(value),
    percent: percent.format,
    parts(value: number) {
      const parts = choose(value).formatToParts(value)
      return {
        number: parts.filter(part => part.type !== 'compact').map(part => part.value).join('').trim(),
        scale: parts.find(part => part.type === 'compact')?.value ?? ''
      }
    }
  }
}

const zh = createFormat('zh-CN', 10_000)
const en = createFormat('en-US', 1_000)
export const numberFormat = (locale: string) => locale === 'en-US' ? en : zh

/** Three integer ticks with readable steps; the plotted values use this same maximum. */
export function axisMaximum(peak: number): number {
  const half = Math.max(1, peak / 2)
  const magnitude = 10 ** Math.floor(Math.log10(half))
  const step = [1, 2, 2.5, 4, 5, 8, 10].find(value => value * magnitude >= half) ?? 10
  return 2 * Math.ceil(step * magnitude)
}
