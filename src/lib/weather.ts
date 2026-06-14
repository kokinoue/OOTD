import weatherJson from '../data/weather.json'
import { outfits } from './useData'
import type { Data } from './useData'

export type DayTemp = { max: number | null; min: number | null; mean: number | null }
export const weather = weatherJson as Record<string, DayTemp>

/** 直近の気温（weather.json の最終日） */
export function latestWeatherDate(): string {
  let last = ''
  for (const d of Object.keys(weather)) if (d > last) last = d
  return last
}

const doy = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000)
}

// ロジスティック回帰（1変数）。着用=1 / 非着用=0 を気温で説明する
// P(着る | T) = 1 / (1 + exp(-(a + b*T)))
function fitLogistic(samples: { temp: number; worn: number }[]) {
  let a = 0
  let b = 0
  const lr = 0.01
  // 標準化で安定させる
  const temps = samples.map((s) => s.temp)
  const mean = temps.reduce((s, t) => s + t, 0) / temps.length
  const sd =
    Math.sqrt(temps.reduce((s, t) => s + (t - mean) ** 2, 0) / temps.length) || 1
  for (let iter = 0; iter < 4000; iter++) {
    let ga = 0
    let gb = 0
    for (const s of samples) {
      const z = (s.temp - mean) / sd
      const p = 1 / (1 + Math.exp(-(a + b * z)))
      ga += p - s.worn
      gb += (p - s.worn) * z
    }
    a -= (lr * ga) / samples.length
    b -= (lr * gb) / samples.length
  }
  // 標準化を戻して T の係数に変換
  const bT = b / sd
  const aT = a - (b * mean) / sd
  return {
    prob: (t: number) => 1 / (1 + Math.exp(-(aT + bT * t))),
    // P=0.5 となる気温（閾値）。b≈0 のときは null
    threshold: Math.abs(bT) > 1e-4 ? -aT / bT : null,
    slope: bT,
  }
}

export type SeasonalAnalysis = {
  category: string
  direction: 'cold' | 'warm' // cold=寒いと着る(コート), warm=暑いと着る(Tシャツ)
  threshold: number | null // P=0.5 の気温
  thresholdReliable: boolean // 閾値が観測気温域内に収まっているか
  tempRange: { min: number; max: number } // 観測された最高気温の範囲
  prob: (t: number) => number // 着用確率（フィット済みロジスティック）
  wornAvg: number
  notWornAvg: number
  wornCount: number
  // 着用日の気温散布（プロット用）: 各年の打点
  points: { date: string; doy: number; year: number; temp: number; worn: boolean }[]
}

// レイヤー順位（数字が大きいほど外側）。トップス系のみ。
// 「対象より外側のトップスが共存していたらインナー使い」と判定するのに使う
const LAYER_RANK: Record<string, number> = {
  coat: 5,
  outer: 5,
  jacket: 4,
  blouson: 4,
  'down vest': 4,
  setup: 4,
  knit: 3,
  cardigan: 3,
  hoodie: 3,
  sweat: 3,
  vest: 3,
  shirt: 2,
  't-shirt': 1,
  tanktop: 1,
  tops: 1,
  inner: 0,
}

// レイヤー判定の対象（一枚で着たときだけ数えたいカテゴリ）
const LAYERED = new Set(Object.keys(LAYER_RANK))

/**
 * そのコーデで category を「最も外側のトップスとして着た（＝主役）」か。
 * 例: t-shirt の上に jacket や shirt があればインナー使いとして false。
 * レイヤー対象外のカテゴリ（boots/shorts 等）は常に true（存在＝着用）。
 */
function wornAsPrimary(category: string, cats: Set<string>): boolean {
  if (!cats.has(category)) return false
  const rank = LAYER_RANK[category]
  if (rank == null) return true
  for (const c of cats) {
    const r = LAYER_RANK[c]
    if (r != null && r > rank) return false // より外側のトップスがある → インナー
  }
  return true
}

export const isLayeredCategory = (c: string) => LAYERED.has(c)

// 衣替え判定に使うカテゴリ（季節性が強いもの）
export const SEASONAL_CATEGORIES = [
  'coat',
  'outer',
  'boots',
  'knit',
  'sweat',
  'hoodie',
  'cardigan',
  'vest',
  't-shirt',
  'shirt',
  'shorts',
]

/** カテゴリごとに、その日の最高気温で着用確率をモデル化する */
export function analyzeCategory(category: string): SeasonalAnalysis | null {
  const samples: { temp: number; worn: number }[] = []
  const points: SeasonalAnalysis['points'] = []
  let wornSum = 0
  let wornN = 0
  let notSum = 0
  let notN = 0

  for (const o of outfits) {
    const t = weather[o.date]?.max
    if (t == null) continue
    const cats = new Set(o.itemIds.map((id) => id.split('|')[0]))
    // レイヤー対象カテゴリは「一枚で着た（最外）」日だけを着用とみなす
    const worn = wornAsPrimary(category, cats)
    samples.push({ temp: t, worn: worn ? 1 : 0 })
    if (worn) {
      wornSum += t
      wornN++
      points.push({
        date: o.date,
        doy: doy(o.date),
        year: Number(o.date.slice(0, 4)),
        temp: t,
        worn: true,
      })
    } else {
      notSum += t
      notN++
    }
  }
  if (wornN < 6) return null

  const fit = fitLogistic(samples)
  const direction = wornSum / wornN < notSum / notN ? 'cold' : 'warm'
  const temps = samples.map((s) => s.temp)
  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  // 閾値が観測気温域内（少しのマージン込み）にあるときだけ信頼する。
  // 着用が少なく傾きが浅いカテゴリは50%交点が域外に外挿されるため
  const thresholdReliable =
    fit.threshold != null && fit.threshold >= tMin - 1 && fit.threshold <= tMax + 1
  return {
    category,
    direction,
    threshold: fit.threshold,
    thresholdReliable,
    tempRange: { min: Math.round(tMin * 10) / 10, max: Math.round(tMax * 10) / 10 },
    prob: fit.prob,
    wornAvg: Math.round((wornSum / wornN) * 10) / 10,
    notWornAvg: Math.round((notSum / Math.max(1, notN)) * 10) / 10,
    wornCount: wornN,
    points,
  }
}

export type SeasonForecast = {
  category: string
  label: string // 「コート」「半袖」など
  direction: 'cold' | 'warm'
  // 各年の節目の日付（cold: 初着用=シーズンイン / warm: 最終着用=シーズンアウト など）
  // ここでは「シーズン開始日」を年ごとに抽出する
  perYear: { year: number; firstDate: string | null; doy: number | null }[]
  avgDoy: number | null // 平年の開始 day-of-year
  // 今シーズンの予測開始日（平年doy基準）と残り日数
  predictedDoy: number | null
}

const CATEGORY_LABELS: Record<string, string> = {
  coat: 'コート',
  outer: 'アウター',
  boots: 'ブーツ',
  knit: 'ニット',
  sweat: 'スウェット',
  hoodie: 'フーディー',
  cardigan: 'カーディガン',
  vest: 'ベスト',
  't-shirt': '半袖（Tシャツ）',
  shirt: 'シャツ',
  shorts: 'ショーツ',
}
export const labelOf = (c: string) => CATEGORY_LABELS[c] ?? c

/**
 * シーズン開始日の年次抽出。
 * cold系: その年の秋〜冬に「初めて着た日」（夏を挟んだ後の復帰）
 * warm系: その年の春〜夏に「初めて着た日」
 */
export function seasonForecast(a: SeasonalAnalysis): SeasonForecast {
  const byYear = new Map<number, string[]>()
  for (const p of a.points) {
    const list = byYear.get(p.year) ?? []
    list.push(p.date)
    byYear.set(p.year, list)
  }

  // cold: 8月以降の初着用を「冬入り」、warm: 3月以降の初着用を「夏入り」とみなす
  const seasonStartMonth = a.direction === 'cold' ? 8 : 3
  const perYear: SeasonForecast['perYear'] = []
  for (const [year, dates] of [...byYear.entries()].sort((x, y) => x[0] - y[0])) {
    const inSeason = dates.filter((d) => Number(d.slice(5, 7)) >= seasonStartMonth).sort()
    const firstDate = inSeason[0] ?? null
    perYear.push({ year, firstDate, doy: firstDate ? doy(firstDate) : null })
  }

  const doys = perYear.map((p) => p.doy).filter((d): d is number => d != null)
  const avgDoy = doys.length ? Math.round(doys.reduce((s, d) => s + d, 0) / doys.length) : null

  return {
    category: a.category,
    label: labelOf(a.category),
    direction: a.direction,
    perYear,
    avgDoy,
    predictedDoy: avgDoy,
  }
}

/** day-of-year を MM/DD 文字列に（非閏年基準の概算でOK） */
export function doyToMMDD(d: number): string {
  const base = new Date(Date.UTC(2025, 0, 1))
  base.setUTCDate(d)
  return `${base.getUTCMonth() + 1}/${base.getUTCDate()}`
}

export const todayDoy = () => doy(latestWeatherDate())

export type { Data }
