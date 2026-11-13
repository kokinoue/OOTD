// 四季通勤 — 実在の毎日を手持ちのラックで着回すストラテジー（Reactなし・純粋関数）
//
// ・1年 = 春夏秋冬の4章。各章は「実際に出勤服を投稿した連続6日」を、当時の東京の実気温で進む。
// ・章のはじめに候補14着から7着をラックに出す（衣替え）。毎朝ラックから1着を選んで出勤する。
// ・各コーデの「快適帯（何℃〜何℃なら快適か）」は、着用記録×気温から回帰で学習する（下の fitWarmth）。
//   朝の気温が帯より低ければ寒く、午後の最高気温が帯より高ければ暑い。外した分だけ体調が削られる。
// ・着たアイテムは休ませる（肌着系は2日、その他は1日）。同じアイテムを含む別コーデも巻き添えで選べない。
// ・夜に「本物のkokiがその日着た服」と答え合わせ（シンクロ）。体調が尽きたら風邪でその年は終了。
//
// 状態遷移はすべて (world, plan, state) → state の純関数。乱数は年とシードから決まるので、
// 同じ年・同じシードなら誰が遊んでも同じ展開になる（「今日のお題」の公平性と、botによる難易度検証のため）。

import type { DayTemp, Sky } from './weather'

// ----------------------------------------------------------------------------
// 定数
// ----------------------------------------------------------------------------
export const DAYS_PER_SEASON = 6
export const POOL_SIZE = 14
export const RACK_SIZE = 7
export const START_HP = 100
export const SEASON_REST_HP = 20
/** どれだけ外しても1日で減る体調はここまで（満タンから一撃で倒れることはない） */
export const MAX_DAILY_DAMAGE = 50
export const SAVE_VERSION = 1

export type ShikiSeason = 'spring' | 'summer' | 'autumn' | 'winter'
export const SEASONS: ShikiSeason[] = ['spring', 'summer', 'autumn', 'winter']
export const SEASON_LABEL: Record<ShikiSeason, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
}

// 着たあとに休ませるターン数。2 = 洗濯（翌日・翌々日は着られない）、1 = 1日休ませる、未定義 = 連日OK。
// 靴を1日休ませるのは革靴の手入れの定石で、これがあるとコーデ同士の「かぶり」が増えて計画に歯ごたえが出る。
const REST_TURNS: Record<string, number> = {
  shirt: 2,
  't-shirt': 2,
  tanktop: 2,
  inner: 2,
  tops: 2,
  smock: 2,
  sweat: 2,
  hoodie: 2,
  jumpsuit: 2,
  'all in one': 2,
  biaude: 2,
  knit: 1,
  cardigan: 1,
  vest: 1,
  pants: 1,
  shorts: 1,
  setup: 1,
  suit: 1,
  jacket: 1,
  shoes: 1,
  boots: 1,
}

// 回帰の事前値（そのカテゴリを1点足すと適温が何℃動くか）。着用数の少ないカテゴリはこの値の近くに留まる。
const WARMTH_PRIOR: Record<string, number> = {
  coat: -9,
  outer: -7,
  'down vest': -6,
  jacket: -6,
  blouson: -6,
  setup: -5,
  suit: -5,
  cardigan: -5,
  hoodie: -5,
  sweat: -5,
  knit: -5,
  vest: -4,
  'knit cap': -3,
  beanie: -3,
  gloves: -3,
  scarf: -3,
  stole: -3,
  snood: -3,
  smock: -2,
  shirt: -1,
  inner: -1,
  boots: -1,
  't-shirt': 2,
  tanktop: 3,
  shorts: 3,
}

// トップスの重なり順（数字が大きいほど外側）。主役カテゴリと「脱いで調節できるか」の判定に使う。
const LAYER_RANK: Record<string, number> = {
  coat: 5,
  outer: 5,
  jacket: 4,
  blouson: 4,
  'down vest': 4,
  setup: 4,
  suit: 4,
  knit: 3,
  cardigan: 3,
  hoodie: 3,
  sweat: 3,
  vest: 3,
  shirt: 2,
  smock: 2,
  't-shirt': 1,
  tanktop: 1,
  tops: 1,
  inner: 0,
}
const REMOVABLE = new Set(['coat', 'outer', 'jacket', 'blouson', 'down vest', 'cardigan', 'vest', 'setup', 'suit'])
const COLD_ACCESSORY = new Set(['scarf', 'stole', 'snood', 'gloves', 'knit cap', 'beanie'])
const RAIN_PROOF = new Set(['coat', 'outer', 'blouson', 'down vest', 'hoodie', 'cap', 'hat'])

const COLD_TOL = 3.5
const HOT_TOL = 3.5
const REMOVABLE_BONUS = 1.5
const ACCESSORY_BONUS = 1

// ----------------------------------------------------------------------------
// 乱数（決定的）
// ----------------------------------------------------------------------------
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(...parts: (string | number)[]) {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (v: number) => Math.round(v * 10) / 10

// ----------------------------------------------------------------------------
// ワールド（データから一度だけ作る）
// ----------------------------------------------------------------------------
export type ShikiItem = { id: string; category: string; label: string; rest: number }

export type Card = {
  key: string
  no: number | null
  date: string
  like: number
  noteUrl: string
  image: string | null
  items: ShikiItem[]
  /** 学習した適温の中心（朝と午後の中間の体感） */
  ideal: number
  /** 快適帯。朝の気温が lo 以上、午後の最高気温が hi 以下なら快適 */
  lo: number
  hi: number
  /** 上着を脱いで暑さを逃がせる */
  removable: boolean
  /** 上着・フード・帽子があり、雨に濡れても平気 */
  rainProof: boolean
  /** スキ数から決まる見映え点 */
  style: number
  /** いちばん外側に着ているカテゴリ（「今日はコートの日」のヒントに使う） */
  primary: string
}

export type DayEvent = 'heatwave' | 'frost' | 'drop' | 'jump' | 'swing' | 'heavyRain' | 'snow'

export type DayWeather = {
  date: string
  min: number
  max: number
  /** 出勤時刻（朝8時ごろ）の気温。最低気温から日較差の3割ぶん上がった値で近似する */
  morning: number
  sky: Sky
  rain: boolean
  heavyRain: boolean
  snow: boolean
  events: DayEvent[]
}

export type World = {
  cards: Map<string, Card>
  /** 投稿日ごとに1着（同日に複数ある場合は番号の若いほう）。日付昇順 */
  postedDays: Card[]
  weatherOf: (date: string) => DayWeather | null
  /** カテゴリごとの学習済み係数（℃）。デバッグ・テスト・解説用 */
  warmth: Record<string, number>
}

export type WorldOutfit = {
  key: string
  no: number | null
  date: string
  like: number
  noteUrl: string
  images: { url: string }[]
}

export type WorldInput = {
  outfits: readonly WorldOutfit[]
  weather: Record<string, DayTemp>
  /** 個体分割・統合を解決済みの着用アイテム */
  itemsOf: (outfit: WorldOutfit) => { id: string; category: string; label: string }[]
  /** くり抜きスプライトがあるコーデだけを使う（省略時は全件） */
  hasSprite?: (key: string) => boolean
}

const skyFromCode = (code: number | null | undefined): Sky => {
  if (code == null) return 'cloudy'
  if (code <= 1) return 'sunny'
  if (code <= 3 || code === 45 || code === 48) return 'cloudy'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain'
  return 'cloudy'
}

const addDays = (date: string, delta: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

const daysBetween = (a: string, b: string) => {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((t(b) - t(a)) / 86400000)
}

function makeWeatherOf(weather: Record<string, DayTemp>) {
  const cache = new Map<string, DayWeather | null>()
  return (date: string): DayWeather | null => {
    const hit = cache.get(date)
    if (hit !== undefined) return hit
    const raw = weather[date]
    let out: DayWeather | null = null
    if (raw && raw.max != null && raw.min != null) {
      const sky = raw.sky ?? skyFromCode(raw.code)
      const code = raw.code ?? null
      const snowCode = code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)
      const snow = sky === 'snow' || (snowCode && raw.max <= 8)
      const rain = sky === 'rain' && !snow
      const heavyRain = rain && (code === 65 || code === 82 || (code ?? 0) >= 95)
      const prev = weather[addDays(date, -1)]
      const events: DayEvent[] = []
      if (raw.max >= 35) events.push('heatwave')
      if (raw.min < 0) events.push('frost')
      if (prev?.max != null && raw.max <= prev.max - 7) events.push('drop')
      if (prev?.max != null && raw.max >= prev.max + 7) events.push('jump')
      if (raw.max - raw.min >= 12) events.push('swing')
      if (heavyRain) events.push('heavyRain')
      if (snow) events.push('snow')
      out = {
        date,
        min: raw.min,
        max: raw.max,
        morning: round1(raw.min + 0.3 * (raw.max - raw.min)),
        sky: snow ? 'snow' : sky,
        rain,
        heavyRain,
        snow,
        events,
      }
    }
    cache.set(date, out)
    return out
  }
}

/** 連立一次方程式をガウスの消去法で解く（特徴量は40程度なので十分速い） */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = a.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c] || 1e-9
    for (let k = c; k <= n; k++) m[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c]
      if (f === 0) continue
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]
    }
  }
  return m.map((row) => row[n])
}

type Sample = { key: string; items: { id: string; category: string }[]; feel: number }

/**
 * 「どんな服を何℃の日に着たか」から、カテゴリごとの暖かさ（℃）とアイテムごとの補正を学習する。
 * 事前値つきのリッジ回帰 + アイテム残差の縮小平均。厚手のニットと夏ニット、ウールとリネンのパンツ
 * のような「同じカテゴリ内の差」は、アイテム補正が拾う。
 */
function fitWarmth(samples: Sample[]) {
  const cats = [...new Set(samples.flatMap((s) => s.items.map((it) => it.category)))].sort()
  const index = new Map(cats.map((c, i) => [c, i]))
  const n = cats.length + 1 // 最後の列は切片
  const rows = samples.map((s) => {
    const row = Array.from({ length: n }, () => 0)
    for (const it of s.items) row[index.get(it.category)!] += 1
    row[n - 1] = 1
    return row
  })
  const prior = cats.map((c) => WARMTH_PRIOR[c] ?? 0)
  // 事前値からのズレ δ だけをリッジで推定する（切片は罰則なし）
  const target = samples.map((s, r) => s.feel - prior.reduce((sum, p, i) => sum + p * rows[r][i], 0))
  const lambda = 4
  const ata = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let sum = i === j && i < n - 1 ? lambda : 0
      for (const row of rows) sum += row[i] * row[j]
      return sum
    }),
  )
  const atb = Array.from({ length: n }, (_, i) => rows.reduce((sum, row, r) => sum + row[i] * target[r], 0))
  const delta = samples.length > 0 ? solveLinear(ata, atb) : Array.from({ length: n }, () => 0)
  const coef: Record<string, number> = {}
  cats.forEach((c, i) => (coef[c] = prior[i] + delta[i]))
  const bias = delta[n - 1]

  const base = (items: { category: string }[]) =>
    bias + items.reduce((sum, it) => sum + (coef[it.category] ?? WARMTH_PRIOR[it.category] ?? 0), 0)

  // アイテムごとの残差（着た日が予測より暖かければプラス）。着用回数が少ないほど0へ縮める
  const resSum = new Map<string, number>()
  const resN = new Map<string, number>()
  for (const s of samples) {
    const res = s.feel - base(s.items)
    for (const it of s.items) {
      resSum.set(it.id, (resSum.get(it.id) ?? 0) + res)
      resN.set(it.id, (resN.get(it.id) ?? 0) + 1)
    }
  }
  const itemAdj = (id: string) => (resSum.get(id) ?? 0) / ((resN.get(id) ?? 0) + 4)

  return {
    coef,
    bias,
    predict: (items: { id: string; category: string }[]) =>
      base(items) + 0.6 * items.reduce((sum, it) => sum + itemAdj(it.id), 0),
  }
}

/** 朝と午後の中間の体感。コーデの「適温」はこの軸で学習する */
const feelOf = (w: DayWeather) => (w.morning + w.max) / 2

export function buildWorld(input: WorldInput): World {
  const weatherOf = makeWeatherOf(input.weather)
  type Draft = { outfit: WorldOutfit; items: ShikiItem[]; day: DayWeather }
  const drafts: Draft[] = []
  for (const outfit of input.outfits) {
    if (input.hasSprite && !input.hasSprite(outfit.key)) continue
    const day = weatherOf(outfit.date)
    if (!day) continue
    const seen = new Set<string>()
    const items: ShikiItem[] = []
    for (const it of input.itemsOf(outfit)) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      items.push({ ...it, rest: REST_TURNS[it.category] ?? 0 })
    }
    if (items.length === 0) continue
    drafts.push({ outfit, items, day })
  }

  const model = fitWarmth(drafts.map((d) => ({ key: d.outfit.key, items: d.items, feel: feelOf(d.day) })))

  const cards = new Map<string, Card>()
  for (const { outfit, items, day } of drafts) {
    // 学習した一般則と、本人が実際にその服で過ごした日の気温を半々で混ぜる。
    // これで「本人の選択はだいたい正しいが、たまに外している」という実感に合う帯になる。
    const ideal = 0.5 * model.predict(items) + 0.5 * feelOf(day)
    const cats = items.map((it) => it.category)
    let primary = cats[0]
    let topRank = -1
    for (const c of cats) {
      const r = LAYER_RANK[c]
      if (r != null && r > topRank) {
        topRank = r
        primary = c
      }
    }
    const removable = cats.some(
      (c) => REMOVABLE.has(c) && cats.some((o) => o !== c && LAYER_RANK[o] != null && LAYER_RANK[o] < LAYER_RANK[c]),
    )
    const accessory = cats.some((c) => COLD_ACCESSORY.has(c))
    cards.set(outfit.key, {
      key: outfit.key,
      no: outfit.no,
      date: outfit.date,
      like: outfit.like,
      noteUrl: outfit.noteUrl,
      image: outfit.images[0]?.url ?? null,
      items,
      ideal: round1(ideal),
      lo: Math.round(ideal - COLD_TOL - (accessory ? ACCESSORY_BONUS : 0)),
      hi: Math.round(ideal + HOT_TOL + (removable ? REMOVABLE_BONUS : 0)),
      removable,
      rainProof: cats.some((c) => RAIN_PROOF.has(c)),
      style: 8 + 4 * Math.min(outfit.like, 8),
      primary,
    })
  }

  const byDate = new Map<string, Card>()
  for (const card of cards.values()) {
    const cur = byDate.get(card.date)
    if (!cur || (card.no ?? Infinity) < (cur.no ?? Infinity)) byDate.set(card.date, card)
  }
  const postedDays = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))

  return { cards, postedDays, weatherOf, warmth: model.coef }
}

/** アプリの表示用データ（個体分割・統合・非表示を解決済み）からワールドを作る */
export function worldFromData(
  data: {
    outfitItemIds: Map<string, Set<string>>
    itemMap: Map<string, { category: string; label: string; hidden: boolean }>
  },
  outfits: readonly WorldOutfit[],
  weather: Record<string, DayTemp>,
  hasSprite?: (key: string) => boolean,
): World {
  return buildWorld({
    outfits,
    weather,
    hasSprite,
    itemsOf: (outfit) => {
      const out: { id: string; category: string; label: string }[] = []
      for (const id of data.outfitItemIds.get(outfit.key) ?? []) {
        const item = data.itemMap.get(id)
        if (item && !item.hidden) out.push({ id, category: item.category, label: item.label })
      }
      return out
    },
  })
}

// ----------------------------------------------------------------------------
// 1年ぶんの計画（年とシードから決定的に作る）
// ----------------------------------------------------------------------------
export type DayPlan = {
  date: string
  weather: DayWeather
  /** その日に本物のkokiが着た服 */
  kokiKey: string
  /** 予報のぶれ。添字は「何日前の予報か」（0 = 当日の朝） */
  noisePm: number[]
  noiseAm: number[]
  /** 予報が難しい時期ほど大きい（前日からの気温の動きで決まる） */
  volatility: number
  /** 降水確率の素（当日朝の値、%） */
  rainBase: number
}

export type SeasonPlan = {
  season: ShikiSeason
  days: DayPlan[]
  /** 衣替えの候補（本物のkokiがこの6日に着た服を含む） */
  pool: string[]
}

export type RunPlan = { year: number; seed: number; seasons: SeasonPlan[] }

const seasonRange = (year: number, season: ShikiSeason): [string, string] => {
  switch (season) {
    case 'spring':
      return [`${year}-03-01`, `${year}-05-31`]
    case 'summer':
      return [`${year}-06-01`, `${year}-08-31`]
    case 'autumn':
      return [`${year}-09-01`, `${year}-11-30`]
    case 'winter':
      return [`${year}-12-01`, `${year + 1}-02-29`]
  }
}

function seasonDays(world: World, year: number, season: ShikiSeason): Card[] {
  const [from, to] = seasonRange(year, season)
  return world.postedDays.filter((c) => c.date >= from && c.date <= to)
}

/** 4つの季節すべてに十分な投稿日がある年（春はじまり） */
export function availableYears(world: World): number[] {
  const years = new Set(world.postedDays.map((c) => Number(c.date.slice(0, 4))))
  return [...years]
    .filter((y) => SEASONS.every((s) => seasonDays(world, y, s).length >= DAYS_PER_SEASON))
    .sort((a, b) => a - b)
}

const MAX_WINDOW_SPAN = 16

function pickWindow(world: World, days: Card[], seed: number, rng: () => number): Card[] {
  const starts: number[] = []
  let tightest = 0
  let tightestSpan = Infinity
  for (let s = 0; s + DAYS_PER_SEASON <= days.length; s++) {
    const span = daysBetween(days[s].date, days[s + DAYS_PER_SEASON - 1].date)
    if (span <= MAX_WINDOW_SPAN) starts.push(s)
    if (span < tightestSpan) {
      tightestSpan = span
      tightest = s
    }
  }
  if (starts.length === 0) starts.push(tightest)
  if (seed !== 0) {
    const s = starts[Math.floor(rng() * starts.length)]
    return days.slice(s, s + DAYS_PER_SEASON)
  }
  // シード0は「名場面」: 気温の乱高下・雨・雪がいちばん詰まった6日を選ぶ
  let best = starts[0]
  let bestDrama = -Infinity
  for (const s of starts) {
    let drama = 0
    for (let i = 0; i < DAYS_PER_SEASON; i++) {
      const w = world.weatherOf(days[s + i].date)!
      if (i > 0) drama += Math.abs(w.max - world.weatherOf(days[s + i - 1].date)!.max)
      if (w.rain) drama += 3
      if (w.snow) drama += 6
      drama += 0.5 * Math.max(0, w.max - w.min - 9)
    }
    if (drama > bestDrama) {
      bestDrama = drama
      best = s
    }
  }
  return days.slice(best, best + DAYS_PER_SEASON)
}

function noisePath(rng: () => number): number[] {
  const out: number[] = []
  let z = rng() * 2 - 1
  for (let k = 0; k <= DAYS_PER_SEASON; k++) {
    out.push(z)
    z = clamp(z + (rng() - 0.5), -1, 1)
  }
  return out
}

export function createPlan(world: World, year: number, seed: number): RunPlan {
  const seasons: SeasonPlan[] = SEASONS.map((season) => {
    const rng = mulberry32(hashSeed('shiki', year, seed, season))
    const all = seasonDays(world, year, season)
    if (all.length < DAYS_PER_SEASON) throw new Error(`shiki: not enough days for ${year} ${season}`)
    const window = pickWindow(world, all, seed, rng)
    const days: DayPlan[] = window.map((card) => {
      const weather = world.weatherOf(card.date)!
      const prev = world.weatherOf(addDays(card.date, -1))
      const swing = prev ? Math.abs(weather.max - prev.max) : 0
      const base = weather.heavyRain
        ? 80 + 20 * rng()
        : weather.rain || weather.snow
          ? 60 + 30 * rng()
          : weather.sky === 'cloudy'
            ? 10 + 40 * rng()
            : 20 * rng()
      return {
        date: card.date,
        weather,
        kokiKey: card.key,
        noisePm: noisePath(rng),
        noiseAm: noisePath(rng),
        volatility: 0.8 + Math.min(0.5, swing / 12),
        rainBase: base,
      }
    })

    // 候補: 本物の6着 + 近い気温帯で着られていた別の日の服（年は問わない）
    const real = window.map((c) => c.key)
    const realSet = new Set(real)
    const feels = days.map((d) => feelOf(d.weather))
    const lo = Math.min(...feels) - 6
    const hi = Math.max(...feels) + 6
    const from = window[0].date
    const to = window[window.length - 1].date
    const others = [...world.cards.values()]
      .filter((c) => !realSet.has(c.key) && (c.date < from || c.date > to) && c.ideal >= lo && c.ideal <= hi)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[others[i], others[j]] = [others[j], others[i]]
    }
    const pool = [...real, ...others.slice(0, POOL_SIZE - real.length).map((c) => c.key)]
    // 並びから本物が割れないよう、候補はシャッフルして渡す
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return { season, days, pool }
  })
  return { year, seed, seasons }
}

// ----------------------------------------------------------------------------
// 習慣（季節の変わり目に1つ身につく）
// ----------------------------------------------------------------------------
export type PerkId =
  | 'layering'
  | 'sleeves'
  | 'umbrella'
  | 'quickdry'
  | 'app'
  | 'rack'
  | 'earlybird'
  | 'eye'
  | 'uniform'
  | 'adventurer'
  | 'telepathy'
  | 'iron'

export const PERKS: Record<PerkId, { name: string; text: string }> = {
  layering: { name: '重ね着上手', text: 'すべての服の快適帯が、寒い側に2℃広がる。' },
  sleeves: { name: '腕まくり', text: 'すべての服の快適帯が、暑い側に2℃広がる。' },
  umbrella: { name: '折りたたみ傘', text: '雨の日に濡れなくなる。' },
  quickdry: { name: '速乾コース', text: '着た服を休ませる日数が1日短くなる。' },
  app: { name: '天気アプリ有料版', text: '気温の予報の幅が半分になり、降水確率もはっきりする。' },
  rack: { name: 'ラック増設', text: 'ラックに出せる服が2着増える。' },
  earlybird: { name: '早起き', text: '快適に過ごせた日の体調回復が大きくなる。' },
  eye: { name: '目利き', text: '見映え点が1.3倍になる。' },
  uniform: { name: '定番主義', text: '同じコーデをもう一度着ても見映えが落ちず、さらに10点もらえる。' },
  adventurer: { name: '冒険心', text: 'この1年で初めて着るアイテムの点が2倍になる。' },
  telepathy: { name: '以心伝心', text: 'シンクロの点が2倍。朝に「本物の今日の主役」がわかる。' },
  iron: { name: '鉄の体', text: '体調へのダメージが3割減る。' },
}
export const PERK_IDS = Object.keys(PERKS) as PerkId[]

// ----------------------------------------------------------------------------
// 予報
// ----------------------------------------------------------------------------
export type Forecast = {
  /** 何日前の予報か（0 = 当日の朝） */
  lead: number
  /** 朝の気温。当日は実測なので amLo === amHi */
  amLo: number
  amHi: number
  /** 午後の最高気温の予報幅。実際の値は必ずこの中に入る */
  pmLo: number
  pmHi: number
  rainPct: number
}

export function forecastOf(day: DayPlan, lead: number, perks: readonly PerkId[]): Forecast {
  const k = clamp(Math.floor(lead), 0, DAYS_PER_SEASON)
  const premium = perks.includes('app')
  // 幅は先の日ほど広がるが、遠すぎて読めなくならないよう上限を置く
  const half = Math.min(4.5, 1.5 + 0.6 * k) * day.volatility * (premium ? 0.5 : 1)
  const pmCenter = day.weather.max + day.noisePm[k] * half * 0.8
  const amHalf = half * 0.7
  const amCenter = day.weather.morning + day.noiseAm[k] * amHalf * 0.8
  let rain = 50 + (day.rainBase - 50) * (1 - 0.1 * k)
  const wet = day.weather.rain || day.weather.snow
  if (premium) rain = wet ? Math.max(rain, 80) : Math.min(rain, 20)
  return {
    lead: k,
    amLo: k === 0 ? day.weather.morning : Math.floor(amCenter - amHalf),
    amHi: k === 0 ? day.weather.morning : Math.ceil(amCenter + amHalf),
    pmLo: Math.floor(pmCenter - half),
    pmHi: Math.ceil(pmCenter + half),
    rainPct: clamp(Math.round(rain / 10) * 10, 0, 100),
  }
}

// ----------------------------------------------------------------------------
// 状態
// ----------------------------------------------------------------------------
export type Phase = 'draft' | 'morning' | 'night' | 'perk' | 'report'

export type DayLog = {
  season: number
  day: number
  date: string
  cardKey: string
  kokiKey: string
  /** 休ませ中の服しかなく、無理に着た */
  forced: boolean
  rewear: boolean
  /** 朝の寒さ・午後の暑さで快適帯を外した量（℃） */
  cold: number
  hot: number
  wet: boolean
  comfortPts: number
  stylePts: number
  freshPts: number
  syncPts: number
  total: number
  hpDelta: number
  hpAfter: number
  /** 本物と共通していたアイテム数（完全一致のときは exact） */
  shared: number
  exact: boolean
}

export type RunState = {
  version: number
  season: number
  day: number
  phase: Phase
  hp: number
  score: number
  rack: string[]
  /** itemId → この日（章内の通し番号）から再び着られる */
  restUntil: Record<string, number>
  wornItems: string[]
  wornCards: Record<string, number>
  perks: PerkId[]
  perkOffer: PerkId[]
  log: DayLog[]
  failed: boolean
  finished: boolean
}

export function startRun(): RunState {
  return {
    version: SAVE_VERSION,
    season: 0,
    day: 0,
    phase: 'draft',
    hp: START_HP,
    score: 0,
    rack: [],
    restUntil: {},
    wornItems: [],
    wornCards: {},
    perks: [],
    perkOffer: [],
    log: [],
    failed: false,
    finished: false,
  }
}

export const rackSizeOf = (state: Pick<RunState, 'perks'>) => RACK_SIZE + (state.perks.includes('rack') ? 2 : 0)

/** 習慣を反映した快適帯 */
export function bandOf(card: Card, perks: readonly PerkId[]) {
  return {
    lo: card.lo - (perks.includes('layering') ? 2 : 0),
    hi: card.hi + (perks.includes('sleeves') ? 2 : 0),
  }
}

/** 朝 am℃・午後 pm℃ の日にこの服で過ごすと、快適帯をどれだけ外すか */
export function missOf(card: Card, am: number, pm: number, perks: readonly PerkId[]) {
  const band = bandOf(card, perks)
  return { cold: round1(Math.max(0, band.lo - am)), hot: round1(Math.max(0, pm - band.hi)) }
}

export function draftRack(plan: RunPlan, state: RunState, keys: readonly string[]): RunState {
  if (state.phase !== 'draft') return state
  const pool = new Set(plan.seasons[state.season].pool)
  const unique = [...new Set(keys)]
  if (unique.length !== Math.min(rackSizeOf(state), pool.size)) return state
  if (unique.some((k) => !pool.has(k))) return state
  return { ...state, rack: unique, phase: 'morning', day: 0, restUntil: {} }
}

export type LockInfo = { locked: boolean; turns: number; items: ShikiItem[] }

/** そのコーデが休ませ中か。turns は「あと何日で着られるか」、items は原因のアイテム */
export function lockOf(world: World, state: Pick<RunState, 'restUntil' | 'day'>, key: string): LockInfo {
  const card = world.cards.get(key)
  if (!card) return { locked: true, turns: 0, items: [] }
  let turns = 0
  const items: ShikiItem[] = []
  for (const it of card.items) {
    const until = state.restUntil[it.id] ?? 0
    if (until > state.day) {
      items.push(it)
      turns = Math.max(turns, until - state.day)
    }
  }
  return { locked: items.length > 0, turns, items }
}

export const availableKeys = (world: World, state: RunState) =>
  state.rack.filter((k) => !lockOf(world, state, k).locked)

const restAfterWear = (state: Pick<RunState, 'restUntil' | 'day' | 'perks'>, card: Card) => {
  const quick = state.perks.includes('quickdry') ? 1 : 0
  const rest = { ...state.restUntil }
  for (const it of card.items) {
    const turns = Math.max(0, it.rest - quick)
    if (turns > 0) rest[it.id] = Math.max(rest[it.id] ?? 0, state.day + turns + 1)
  }
  return rest
}

/** これを着たら、明日ラックのどの服が着られなくなるか（計画用のプレビュー） */
export function locksCausedBy(world: World, state: RunState, key: string): string[] {
  const card = world.cards.get(key)
  if (!card) return []
  const next = { restUntil: restAfterWear(state, card), day: state.day + 1 }
  return state.rack.filter((k) => k !== key && lockOf(world, next, k).locked)
}

/** 快適帯を外した量（℃）→ 快適点。ぴったり収まると60点、外すと1℃ごとに9点ずつ減る */
export const comfortPoints = (miss: number) => (miss <= 0 ? 60 : Math.max(0, Math.round(52 - 9 * miss)))

/** 朝に選んだ服で1日を過ごす。結果は state.log の末尾に入り、phase は night になる */
export function wear(world: World, plan: RunPlan, state: RunState, key: string): RunState {
  if (state.phase !== 'morning') return state
  const card = world.cards.get(key)
  if (!card || !state.rack.includes(key)) return state
  const locked = lockOf(world, state, key).locked
  // 休ませ中の服は、ほかに着られる服が1着もないときだけ無理に着られる
  if (locked && availableKeys(world, state).length > 0) return state

  const dayPlan = plan.seasons[state.season].days[state.day]
  const w = dayPlan.weather
  const has = (p: PerkId) => state.perks.includes(p)
  const { cold, hot } = missOf(card, w.morning, w.max, state.perks)
  const miss = cold + hot
  const wet = (w.rain || w.snow) && !card.rainProof && !has('umbrella')
  const comfortPts = Math.max(0, comfortPoints(miss) - (wet ? 12 : 0) - (locked ? 15 : 0))

  const rewear = (state.wornCards[key] ?? 0) > 0
  let stylePts = card.style * (has('eye') ? 1.3 : 1)
  if (rewear) stylePts = has('uniform') ? stylePts + 10 : stylePts * 0.5
  if (locked) stylePts = 0
  stylePts = Math.round(stylePts)

  const worn = new Set(state.wornItems)
  const freshCount = card.items.filter((it) => !worn.has(it.id)).length
  const freshPts = Math.min(12, freshCount * 2) * (has('adventurer') ? 2 : 1)

  const koki = world.cards.get(dayPlan.kokiKey)
  const exact = key === dayPlan.kokiKey
  const kokiItems = new Set(koki?.items.map((it) => it.id) ?? [])
  const shared = card.items.filter((it) => kokiItems.has(it.id)).length
  const syncPts = (exact ? 40 : Math.min(24, shared * 6)) * (has('telepathy') ? 2 : 1)

  let hpDelta: number
  if (miss <= 0 && !wet && !locked) hpDelta = 3 + (has('earlybird') ? 4 : 0)
  else {
    const dmg = Math.round(6 * Math.pow(miss, 1.3)) + (wet ? 6 : 0) + (locked ? 4 : 0)
    hpDelta = -Math.min(MAX_DAILY_DAMAGE, Math.round(dmg * (has('iron') ? 0.7 : 1)))
  }
  const hpAfter = clamp(state.hp + hpDelta, 0, START_HP)
  const total = comfortPts + stylePts + freshPts + syncPts

  const log: DayLog = {
    season: state.season,
    day: state.day,
    date: dayPlan.date,
    cardKey: key,
    kokiKey: dayPlan.kokiKey,
    forced: locked,
    rewear,
    cold,
    hot,
    wet,
    comfortPts,
    stylePts,
    freshPts,
    syncPts,
    total,
    hpDelta: hpAfter - state.hp,
    hpAfter,
    shared,
    exact,
  }
  for (const it of card.items) worn.add(it.id)
  return {
    ...state,
    phase: 'night',
    hp: hpAfter,
    score: state.score + total,
    restUntil: restAfterWear(state, card),
    wornItems: [...worn],
    wornCards: { ...state.wornCards, [key]: (state.wornCards[key] ?? 0) + 1 },
    log: [...state.log, log],
    failed: hpAfter <= 0,
  }
}

/** 夜の答え合わせから次へ進む（翌朝 / 季節の変わり目 / 年間レポート） */
export function nextPhase(plan: RunPlan, state: RunState): RunState {
  if (state.phase !== 'night') return state
  if (state.failed) return { ...state, phase: 'report', finished: true }
  if (state.day < DAYS_PER_SEASON - 1) return { ...state, phase: 'morning', day: state.day + 1 }
  if (state.season >= SEASONS.length - 1) return { ...state, phase: 'report', finished: true }
  const rng = mulberry32(hashSeed('perk', plan.year, plan.seed, state.season))
  const rest = PERK_IDS.filter((p) => !state.perks.includes(p))
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return { ...state, phase: 'perk', perkOffer: rest.slice(0, 3) }
}

export function pickPerk(state: RunState, perk: PerkId): RunState {
  if (state.phase !== 'perk' || !state.perkOffer.includes(perk)) return state
  return {
    ...state,
    perks: [...state.perks, perk],
    perkOffer: [],
    hp: Math.min(START_HP, state.hp + SEASON_REST_HP),
    season: state.season + 1,
    day: 0,
    rack: [],
    restUntil: {},
    phase: 'draft',
  }
}

/** 最終スコア。完走すると残った体調もスコアになる */
export function finalScore(state: RunState): number {
  return state.score + (state.finished && !state.failed ? 100 + state.hp * 2 : 0)
}

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D'

// botの成績分布から決めた境界（shiki.balance.test.ts が毎回検証する）
// S は「先読みするbotの上位1割」を超えた先（本物の服を読み当てないと届かない）、
// A・B はそのbotの上位〜中位、C は完走、D は途中で風邪。
export const RANK_BORDERS: { rank: Rank; min: number }[] = [
  { rank: 'S', min: 3000 },
  { rank: 'A', min: 2750 },
  { rank: 'B', min: 2500 },
  { rank: 'C', min: 0 },
]

export function rankOf(state: RunState): Rank {
  if (state.failed) return 'D'
  const score = finalScore(state)
  return RANK_BORDERS.find((b) => score >= b.min)?.rank ?? 'D'
}

export type RunSummary = {
  score: number
  rank: Rank
  days: number
  comfortDays: number
  exactSyncs: number
  partialSyncs: number
  wetDays: number
  coldest: DayLog | null
  hottest: DayLog | null
  best: DayLog | null
  bySeason: number[]
}

export function summarize(plan: RunPlan, state: RunState): RunSummary {
  const weatherOf = (l: DayLog) => plan.seasons[l.season].days[l.day].weather
  const pick = (cmp: (a: DayLog, b: DayLog) => boolean) =>
    state.log.reduce<DayLog | null>((best, l) => (!best || cmp(l, best) ? l : best), null)
  return {
    score: finalScore(state),
    rank: rankOf(state),
    days: state.log.length,
    comfortDays: state.log.filter((l) => l.cold + l.hot <= 0 && !l.wet).length,
    exactSyncs: state.log.filter((l) => l.exact).length,
    partialSyncs: state.log.filter((l) => !l.exact && l.shared > 0).length,
    wetDays: state.log.filter((l) => l.wet).length,
    coldest: pick((a, b) => weatherOf(a).morning < weatherOf(b).morning),
    hottest: pick((a, b) => weatherOf(a).max > weatherOf(b).max),
    best: pick((a, b) => a.total > b.total),
    bySeason: SEASONS.map((_, i) => state.log.filter((l) => l.season === i).reduce((s, l) => s + l.total, 0)),
  }
}

/** 「今日のお題」: 日付から年とシードを決める（全員が同じ展開になる） */
export function dailyChallenge(world: World, today: string): { year: number; seed: number } {
  const years = availableYears(world)
  const h = hashSeed('daily', today)
  return { year: years[h % years.length], seed: (h % 99991) + 1 }
}

// ----------------------------------------------------------------------------
// 保存（途中再開・自己ベスト）
// ----------------------------------------------------------------------------
export type SaveData = { year: number; seed: number; daily: string | null; state: RunState }

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
const SAVE_KEY = 'shiki.save.v1'
const BEST_KEY = 'shiki.best.v1'

export function loadSave(storage: Storage): SaveData | null {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveData
    if (data?.state?.version !== SAVE_VERSION || data.state.finished) return null
    return data
  } catch {
    return null
  }
}

export function writeSave(storage: Storage, data: SaveData | null) {
  try {
    if (data) storage.setItem(SAVE_KEY, JSON.stringify(data))
    else storage.removeItem(SAVE_KEY)
  } catch {
    // 保存できなくても遊べる
  }
}

export function loadBest(storage: Storage): Record<string, number> {
  try {
    const data = JSON.parse(storage.getItem(BEST_KEY) ?? '{}')
    return data && typeof data === 'object' ? (data as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** 自己ベストを更新したら true */
export function saveBest(storage: Storage, year: number, score: number): boolean {
  const best = loadBest(storage)
  if ((best[year] ?? 0) >= score) return false
  try {
    storage.setItem(BEST_KEY, JSON.stringify({ ...best, [year]: score }))
  } catch {
    // 保存できなくても遊べる
  }
  return true
}
