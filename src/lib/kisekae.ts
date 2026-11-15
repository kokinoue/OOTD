import type { Outfit } from '../types'

// きせかえ: 顔は固定のまま、トップス・ボトムス・靴の3レーンを横に流し、
// スロットのように1つずつ止めてコーデを作るゲームの純粋ロジック。
//
// ・パーツは出勤服のくり抜きスプライトを横の帯に切ったもの（絵本の「きせかえ」と同じ作り）
// ・できたコーデは「着そう度」で採点する。お手本は本人のアーカイブ:
//     実績 … その上下・その靴を、ほんとうに同じ日に着たことがあるか
//     季節感 … 3つのパーツを着ていた日の最高気温がどれだけ近いか
//   3つとも同じ日のパーツで揃えたら「完全再現」で満点
// 描画と入力は components/KisekaeGameView.tsx。

export type LaneId = 'top' | 'bottom' | 'shoes'
export const LANES: readonly LaneId[] = ['top', 'bottom', 'shoes']

/** スプライトを切る帯（高さに対する割合）。写真がほぼ定点なので固定の割合で足りる */
export const BANDS = {
  head: [0, 0.16],
  top: [0.16, 0.5],
  bottom: [0.5, 0.89],
  shoes: [0.89, 1],
} as const

export const ROUNDS = 5
export const LANE_SIZE = 9 // 1レーンに流すパーツ数
export const SEED_DAYS = 3 // 3レーンすべてにパーツが入っている日（＝完全再現できる日）の数
/** 1ラウンドのレーンを組むのに要るコーデ数 */
export const NEEDED = SEED_DAYS + (LANE_SIZE - SEED_DAYS) * LANES.length

// ----------------------------------------------------------------------------
// パーツの元になるコーデ
// ----------------------------------------------------------------------------

const SHOES_CATS = new Set(['shoes', 'boots', 'sandals', 'sneakers'])
const BOTTOM_CATS = new Set(['pants', 'shorts', 'skirt'])
/** 上下ひとつづきの服。ボトムスが別に無い日は、これが下半身の主役にもなる */
const ONE_PIECE_CATS = new Set(['setup', 'suit', 'jumpsuit', 'all in one'])
/** トップスの重なり順（大きいほど外側）。いちばん外側の1着を上半身の主役にする */
const TOP_RANK: Record<string, number> = {
  coat: 5,
  outer: 5,
  jacket: 4,
  blouson: 4,
  setup: 4,
  suit: 4,
  jumpsuit: 4,
  'all in one': 4,
  knit: 3,
  sweat: 3,
  hoodie: 3,
  vest: 3,
  cardigan: 3,
  'down vest': 3,
  smock: 3,
  shirt: 2,
  biaude: 2,
  't-shirt': 1,
  tops: 1,
  inner: 1,
  tanktop: 1,
}

export type Source = {
  key: string // outfit.key（＝スプライトのファイル名）
  no: number | null
  date: string
  /** その日の東京の最高気温。記録が無ければ null */
  tmax: number | null
  /** レーンごとの主役アイテム（解決済みID） */
  main: Record<LaneId, string>
}

/** 細すぎ（人物がうまく抜けていない）・広すぎ（自転車や傘、二人写り）のスプライトは使わない */
export const MIN_SPRITE_W = 60
export const MAX_SPRITE_W = 125

type SpriteSize = { w: number; h: number }

/**
 * パーツにできるコーデを集める（新しい順）。
 * トップス・ボトムス・靴の3つとも記録があり、くり抜きの横幅が一人ぶんに収まっているものだけ。
 */
export function buildSources(
  outfits: readonly Outfit[],
  outfitItemIds: ReadonlyMap<string, ReadonlySet<string>>,
  categoryOf: (itemId: string) => string | undefined,
  tmaxOf: (date: string) => number | null | undefined,
  sprites: Readonly<Record<string, SpriteSize>>,
  spriteHeight: number,
): Source[] {
  const out: Source[] = []
  for (const o of outfits) {
    const sp = sprites[o.key]
    if (!sp || sp.h !== spriteHeight || sp.w < MIN_SPRITE_W || sp.w > MAX_SPRITE_W) continue
    let top: string | null = null
    let topRank = 0
    let bottom: string | null = null
    let onePiece: string | null = null
    let shoes: string | null = null
    for (const id of outfitItemIds.get(o.key) ?? []) {
      const cat = categoryOf(id)
      if (!cat) continue
      if (SHOES_CATS.has(cat)) shoes ??= id
      else if (BOTTOM_CATS.has(cat)) bottom ??= id
      if (ONE_PIECE_CATS.has(cat)) onePiece ??= id
      const rank = TOP_RANK[cat] ?? 0
      if (rank > topRank) {
        top = id
        topRank = rank
      }
    }
    bottom ??= onePiece
    if (!top || !bottom || !shoes) continue
    out.push({
      key: o.key,
      no: o.no,
      date: o.date,
      tmax: tmaxOf(o.date) ?? null,
      main: { top, bottom, shoes },
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// スプライトの解析（どこを軸に重ねるか）
// ----------------------------------------------------------------------------

export type Anchors = {
  /** 首・腰・足首の高さでの体の中心（スプライト左端からのpx）。帯の継ぎ目をここで合わせる */
  neckX: number
  waistX: number
  ankleX: number
  /** 一人がまっすぐ立っている絵として使えるか（傘や枝で頭の位置が取れないものは false） */
  ok: boolean
}

const OPAQUE = 128

/**
 * くり抜きスプライト（RGBA）から、帯を重ねるときの軸を求める。
 * 頭は必ず体の真上にあり荷物も重ならないので、まず頭の重心を取り、
 * そこから左右 0.2h の窓の中だけで首・腰・足首の重心を取る（手に持ったバッグに引っ張られない）。
 */
export function analyzeSprite(rgba: ArrayLike<number>, w: number, h: number): Anchors {
  const centroid = (y0: number, y1: number, x0 = 0, x1 = w) => {
    let sum = 0
    let n = 0
    const xa = Math.max(0, Math.round(x0))
    const xb = Math.min(w, Math.round(x1))
    for (let y = Math.round(y0 * h); y < Math.round(y1 * h); y++) {
      for (let x = xa; x < xb; x++) {
        if (rgba[(y * w + x) * 4 + 3] > OPAQUE) {
          sum += x
          n++
        }
      }
    }
    return { x: n ? sum / n : w / 2, n }
  }
  const headAll = centroid(0.03, 0.13)
  const head = centroid(0.03, 0.13, headAll.x - 0.14 * h, headAll.x + 0.14 * h)
  const win = 0.2 * h
  const neck = centroid(0.145, 0.175, head.x - win, head.x + win)
  const waist = centroid(0.47, 0.53, head.x - win, head.x + win)
  const ankle = centroid(0.87, 0.91, head.x - win, head.x + win)
  // 頭の高さにある不透明画素の大半が、頭ひとつぶんの幅に収まっていること
  const single = headAll.n > 0 && head.n / headAll.n >= 0.85
  return {
    neckX: neck.n ? neck.x : head.x,
    waistX: waist.x,
    ankleX: ankle.x,
    ok: single && waist.n > 0 && ankle.n > 0,
  }
}

/** そのレーンでパーツを置くときの軸 */
export const anchorOf = (a: Anchors, lane: LaneId | 'head'): number =>
  lane === 'bottom' ? a.waistX : lane === 'shoes' ? a.ankleX : a.neckX

// ----------------------------------------------------------------------------
// レーンを組む
// ----------------------------------------------------------------------------

export type Lanes = Record<LaneId, Source[]>

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** レーンの候補を重複なしで n 件ひく（解析で落ちるぶんを見込んで多めにひく） */
export function pickCandidates(sources: readonly Source[], rng: () => number, n: number): Source[] {
  return shuffled(sources, rng).slice(0, n)
}

/**
 * 候補から3レーンを組む。先頭 SEED_DAYS 件は3レーンすべてに入れる（＝完全再現できる日）。
 * 残りは1レーンに1回だけ出す。候補が NEEDED 件に満たなければ null。
 */
export function buildLanes(cands: readonly Source[], rng: () => number): Lanes | null {
  if (cands.length < NEEDED) return null
  const seeds = cands.slice(0, SEED_DAYS)
  const per = LANE_SIZE - SEED_DAYS
  const lanes = {} as Lanes
  LANES.forEach((lane, i) => {
    const fillers = cands.slice(SEED_DAYS + i * per, SEED_DAYS + (i + 1) * per)
    lanes[lane] = shuffled([...seeds, ...fillers], rng)
  })
  return lanes
}

// ----------------------------------------------------------------------------
// レーンの動き
// ----------------------------------------------------------------------------

/** レーンの向き。+1 は右から左へ流れる。隣のレーンと逆向きにして見分けやすくする */
export const LANE_DIR: Record<LaneId, 1 | -1> = { top: 1, bottom: -1, shoes: 1 }

const BASE_SPEED = [1.2, 1.5, 1.85, 2.25, 2.7] // ラウンドごとの速さ（コマ/秒）
const LANE_FACTOR: Record<LaneId, number> = { top: 1, bottom: 1.12, shoes: 1.25 }

/** レーンの速さ（コマ/秒）。ラウンドが進むほど、下のレーンほど速い */
export function laneSpeed(round: number, lane: LaneId): number {
  const base = BASE_SPEED[Math.min(Math.max(round, 0), BASE_SPEED.length - 1)]
  return base * LANE_FACTOR[lane]
}

/** ストップを押したときに止まるコマ。押した瞬間、体の位置にいちばん近いパーツで止まる */
export const stopTarget = (pos: number): number => Math.round(pos)

export const wrapIndex = (i: number, n: number): number => ((i % n) + n) % n

/** コマ i が中央から何コマぶん離れて見えるか。輪になっているので (-n/2, n/2] に折り返す */
export function cellOffset(i: number, pos: number, n: number): number {
  let d = (i - pos) % n
  if (d > n / 2) d -= n
  if (d <= -n / 2) d += n
  return d
}

// ----------------------------------------------------------------------------
// 採点: 着そう度
// ----------------------------------------------------------------------------

export type Pick = Record<LaneId, Source>

export type PairId = 'topBottom' | 'bottomShoes' | 'topShoes'
export const PAIR_POINTS: Record<PairId, number> = { topBottom: 30, bottomShoes: 15, topShoes: 15 }
export const SEASON_POINTS = 40
const SPREAD_FULL = 4 // 最高気温の開きがこれ以下なら季節感は満点
const SPREAD_ZERO = 18 // これ以上開いたら 0点

export type Judgement = {
  score: number // 0〜100
  /** 3つとも同じ日のパーツ */
  perfect: boolean
  /** その2つを同じ日に着ていた回数 */
  pairs: Record<PairId, number>
  record: number // 実績の点
  season: number // 季節感の点
  /** 3つのパーツを着ていた日の最高気温の開き（℃）。気温の記録が2日ぶん無ければ null */
  spread: number | null
}

/** a と b を同じ日に着ていた日数 */
export function wornTogether(
  itemSets: Iterable<ReadonlySet<string>>,
  a: string,
  b: string,
): number {
  let n = 0
  for (const set of itemSets) if (set.has(a) && set.has(b)) n++
  return n
}

export function seasonPoints(spread: number | null): number {
  if (spread == null) return SEASON_POINTS / 2
  const k = 1 - (spread - SPREAD_FULL) / (SPREAD_ZERO - SPREAD_FULL)
  return Math.round(SEASON_POINTS * Math.min(1, Math.max(0, k)))
}

export function judge(pick: Pick, itemSets: Iterable<ReadonlySet<string>>): Judgement {
  const sets = [...itemSets]
  const { top, bottom, shoes } = pick
  const pairs: Record<PairId, number> = {
    topBottom: wornTogether(sets, top.main.top, bottom.main.bottom),
    bottomShoes: wornTogether(sets, bottom.main.bottom, shoes.main.shoes),
    topShoes: wornTogether(sets, top.main.top, shoes.main.shoes),
  }
  const temps = [top.tmax, bottom.tmax, shoes.tmax].filter((t): t is number => t != null)
  const spread = temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null
  const perfect = top.key === bottom.key && bottom.key === shoes.key
  let record = 0
  for (const id of Object.keys(pairs) as PairId[]) if (pairs[id] > 0) record += PAIR_POINTS[id]
  const season = seasonPoints(spread)
  return { score: perfect ? 100 : record + season, perfect, pairs, record, season, spread }
}

// ----------------------------------------------------------------------------
// 総合ランク
// ----------------------------------------------------------------------------

export type Rank = { min: number; name: string; note: string }

/** 5コーデの合計（500点満点）でつく称号 */
export const RANKS: readonly Rank[] = [
  { min: 400, name: '本人', note: 'クローゼットの中身を、本人なみに把握している。' },
  { min: 300, name: '専属スタイリスト', note: '明日の出勤服、まかせてもよさそう。' },
  { min: 200, name: '常連読者', note: 'だいたいの好みはつかめている。' },
  { min: 100, name: '通りすがり', note: '服は着ている。それは確か。' },
  { min: 0, name: 'コーデ事故', note: '季節も実績も置いてきた。それはそれで新しい。' },
]

export function rankOf(total: number): Rank {
  return RANKS.find((r) => total >= r.min) ?? RANKS[RANKS.length - 1]
}

// ----------------------------------------------------------------------------
// ベストスコア
// ----------------------------------------------------------------------------

export const BEST_KEY = 'kisekae.best'

export function loadBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY))
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

export function saveBest(total: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(total))
  } catch {
    // 保存できない環境ではベストを持ち越さないだけ
  }
}
