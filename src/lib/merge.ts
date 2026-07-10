import type { Outfit } from '../types'

// クローゼット・マージ: 同じ出勤服どうしをぶつけて人気の一着へ育てるマージ落としものパズル（スイカゲーム風）。
// このファイルは純粋ロジック（ランク定義・進化チェーン選定・合体判定・スコア）。物理と描画は View 側。

/** ランク数（進化チェーンの長さ）。ランクが上がるほど玉が大きく、人気（いいね数）も上がる */
export const RANK_COUNT = 11

/** ランクごとの玉の半径（表示px）。スイカゲーム同様、約1.25倍ずつ大きくなる */
export const RANK_RADII = [16, 21, 27, 34, 43, 54, 68, 85, 106, 132, 164] as const

/** プレイヤーが落とせるのはこのランクまで（それ以上は合体でしか作れない） */
export const SPAWN_MAX_RANK = 4

/** 落下玉ランクの重み（rank 0 が最も出やすい） */
export const SPAWN_WEIGHTS = [5, 4, 3, 2, 1] as const

/** rank の玉どうしを合体させたときの得点 */
export function mergeScore(rank: number): number {
  return ((rank + 1) * (rank + 2)) / 2
}

/** 最大ランクどうしを合体させると両方消えて大量得点（スイカの2玉消滅と同じ） */
export const FINAL_BONUS = 100

/** 重み付きで次に落とす玉のランクを決める。rand は [0,1) を返す関数（テストで注入可能） */
export function spawnRank(rand: () => number): number {
  const total = SPAWN_WEIGHTS.reduce((a, b) => a + b, 0)
  let t = rand() * total
  for (let i = 0; i < SPAWN_WEIGHTS.length; i++) {
    t -= SPAWN_WEIGHTS[i]
    if (t < 0) return i
  }
  return SPAWN_WEIGHTS.length - 1
}

/**
 * 進化チェーンに使う11着を決定的に選ぶ。
 * いいね数の上位11着（同数なら no が新しい方を上位）を、ランク0=11位 … ランク10=1位の昇順で返す。
 * 「合体するほど人気の服に近づく」という進化の意味づけをデータそのもので作る。
 */
export function pickRankOutfits(outfits: Outfit[]): Outfit[] {
  const ranked = outfits
    .filter((o) => o.images[0]?.url)
    .sort((a, b) => (b.like !== a.like ? b.like - a.like : (b.no ?? 0) - (a.no ?? 0)))
    .slice(0, RANK_COUNT)
  return ranked.reverse()
}

export type BallSnapshot = {
  id: number
  rank: number
  x: number // 表示px座標
  y: number
}

/** 同フレームで同じ玉が2回合体しないよう、id は各ペアで一度だけ使う */
const MERGE_TOUCH_RATIO = 1.02 // 半径和の2%まで食い込み前でも「接触」とみなす（安定判定）

/**
 * 同ランクで接触している玉のペアを列挙する（貪欲・id昇順で決定的）。
 * 物理エンジンの contact listener に頼らず、毎フレームのスナップショットから判定することで
 * ロジックを純粋関数としてテスト可能にしている。玉数は高々数十なので O(n^2) で十分。
 */
export function findMergePairs(balls: BallSnapshot[]): Array<[number, number]> {
  const sorted = [...balls].sort((a, b) => a.id - b.id)
  const used = new Set<number>()
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (used.has(a.id)) continue
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      if (used.has(b.id) || a.rank !== b.rank) continue
      const rSum = RANK_RADII[a.rank] + RANK_RADII[b.rank]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (dist <= rSum * MERGE_TOUCH_RATIO) {
        used.add(a.id)
        used.add(b.id)
        pairs.push([a.id, b.id])
        break
      }
    }
  }
  return pairs
}

// ----------------------------------------------------------------------------
// 物理の定数（planck は m 単位。tower と同じ PPM 換算）
// ----------------------------------------------------------------------------
export const PPM = 60
export const GRAVITY = 14 // タワーより少し強め。玉がキビキビ落ちるスイカの手触りに寄せる
export const FRICTION = 0.35
export const DENSITY = 1.0
export const RESTITUTION = 0.12 // わずかに跳ねる（詰まりにくくする）

/** ベストスコアの localStorage キー */
export const BEST_KEY = 'merge.best'

export function loadBest(): number {
  try {
    const n = Number(localStorage.getItem(BEST_KEY) ?? '0')
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function saveBest(score: number): void {
  try {
    if (score > loadBest()) localStorage.setItem(BEST_KEY, String(score))
  } catch {
    // localStorage が使えない環境では何もしない
  }
}
