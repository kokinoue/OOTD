const SKY_PATTERNS = [
  { pattern: /快晴|晴/, sky: 'sunny' },
  { pattern: /霧雨|雷雨|しゅう雨|雨/, sky: 'rain' },
  { pattern: /みぞれ|あられ|雪/, sky: 'snow' },
  { pattern: /薄曇|曇|霧|もや/, sky: 'cloudy' },
]

const stripHtml = (value) =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')
    .trim()

/**
 * 気象庁の概況は「晴一時曇」のように、先頭へ主な天気が置かれる。
 * 文中で最初に現れる天気語を、UI共通の4分類へ変換する。
 */
export function classifyJmaWeather(summary) {
  const normalized = String(summary ?? '').replace(/\s+/g, '')
  if (!normalized || normalized === '--') return null

  let first = null
  for (const candidate of SKY_PATTERNS) {
    const match = candidate.pattern.exec(normalized)
    if (match && (first == null || match.index < first.index)) {
      first = { index: match.index, sky: candidate.sky }
    }
  }
  return first?.sky ?? null
}

/** 気象庁「日ごとの値」HTMLから昼（06:00–18:00）の概況を抽出する。 */
export function parseJmaDailyWeather(html, year, month) {
  const result = {}
  const table = /<table\b[^>]*id=['"]tablefix1['"][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
  if (!table) return result

  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => stripHtml(match[1]),
    )
    if (cells.length < 3) continue

    const day = Number(cells[0])
    if (!Number.isInteger(day) || day < 1 || day > 31) continue

    // 主な要素テーブルの末尾2列は「昼」「夜」の天気概況。
    const summary = cells.at(-2) ?? ''
    const sky = classifyJmaWeather(summary)
    if (!sky) continue

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    result[date] = { summary, sky }
  }
  return result
}

export function jmaDailyUrl(year, month) {
  const query = new URLSearchParams({
    prec_no: '44',
    block_no: '47662',
    year: String(year),
    month: String(month).padStart(2, '0'),
    day: '',
    view: 'p1s',
  })
  return `https://www.data.jma.go.jp/stats/etrn/view/daily_s1.php?${query}`
}
