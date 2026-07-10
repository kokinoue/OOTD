// 洗濯物フリック — 下から出てくる出勤服をフリックで投げ、上のハンガーラックに掛ける
// スコアアタック。このファイルは純粋ロジックのみ（vitest対象）。描画・入力・ゲームループ
// （rAF・pointer events）は LaundryGameView 側に置き、TowerGameView と同じ流儀で
// 「毎フレームの可変状態はローカル変数、ロジックはここの純粋関数」に分離する。
//
// 座標系メモ:
// ・trajectory() は数学寄りの慣習（y上方向が正、重力は減算）で位置を返す。
// ・View 側では画面（y下方向が正）に変換して使う: screenY = launchY - trajectory(...).y
// ・computeLaunchVelocity() はドラッグベクトル（画面座標のdx/dy）を受け取り、
//   trajectory() にそのまま渡せる vy を返す（上へのフリック = dy<0 → vy>0 になるよう符号反転済み）。

export type Point = { x: number; y: number }
export type Velocity = { vx: number; vy: number }
export type Rect = { x: number; y: number; w: number; h: number }

// ----------------------------------------------------------------------------
// 放物線運動
// ----------------------------------------------------------------------------
/** 発射からの経過時間 t での位置（発射点からの相対座標、y上方向が正）。x = vx·t, y = vy·t − ½g·t² */
export function trajectory(v0: Velocity, g: number, t: number): Point {
  return { x: v0.vx * t, y: v0.vy * t - 0.5 * g * t * t }
}

// ----------------------------------------------------------------------------
// ドラッグ → 初速変換
// ----------------------------------------------------------------------------
// 「フリック」なので、パチンコ（引っ張った逆方向へ飛ぶ）ではなく、指を動かした方向へ
// そのまま飛ぶ直感的な方式を採用（Flick Golf / Flick Kick Football と同じ操作感）。
// 画面座標は下方向が正なので、上に投げるにはvy成分の符号を反転する。
export const LAUNCH_SCALE = 4.2 // ドラッグ距離(px) → 初速(px/s) の変換係数
export const MAX_LAUNCH_SPEED = 1500 // 初速の最大値(px/s)。強く振り切っても暴投にならないようclamp

export function computeLaunchVelocity(dragVector: Point): Velocity {
  const rawVx = dragVector.x * LAUNCH_SCALE
  const rawVy = -dragVector.y * LAUNCH_SCALE
  const speed = Math.hypot(rawVx, rawVy)
  if (speed === 0) return { vx: 0, vy: 0 }
  if (speed <= MAX_LAUNCH_SPEED) return { vx: rawVx, vy: rawVy }
  const k = MAX_LAUNCH_SPEED / speed
  return { vx: rawVx * k, vy: rawVy * k }
}

// ドラッグ距離がこれ未満なら「フリックではなくタップ」とみなし、投げない（View側の判定用の目安値）
export const MIN_DRAG_PX = 8

// ----------------------------------------------------------------------------
// ラック当たり判定（フレーム間の線分判定でのすり抜け防止）
// ----------------------------------------------------------------------------
/**
 * prevPos → pos の線分が rack（当たり判定帯の矩形）を通過したか。
 * 高速移動で1フレームの間に矩形を跨いでしまう「すり抜け」を防ぐため、
 * 現在位置の点だけでなく前フレームからの軌跡（線分）を矩形と交差判定する（スラブ法）。
 */
export function checkRackHit(pos: Point, prevPos: Point, rack: Rect): boolean {
  const dx = pos.x - prevPos.x
  const dy = pos.y - prevPos.y
  let tMin = 0
  let tMax = 1

  if (dx === 0) {
    if (prevPos.x < rack.x || prevPos.x > rack.x + rack.w) return false
  } else {
    let t1 = (rack.x - prevPos.x) / dx
    let t2 = (rack.x + rack.w - prevPos.x) / dx
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  }

  if (dy === 0) {
    if (prevPos.y < rack.y || prevPos.y > rack.y + rack.h) return false
  } else {
    let t1 = (rack.y - prevPos.y) / dy
    let t2 = (rack.y + rack.h - prevPos.y) / dy
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  }

  return tMax >= tMin
}

// ----------------------------------------------------------------------------
// コンボ・スコア
// ----------------------------------------------------------------------------
// 連続成功数（streak）に応じた倍率。×1 → ×1.2 → ×1.5 → ×2（上限）
export const COMBO_STEPS: readonly { streak: number; mult: number }[] = [
  { streak: 0, mult: 1 },
  { streak: 3, mult: 1.2 },
  { streak: 6, mult: 1.5 },
  { streak: 10, mult: 2 },
]

export function comboMultiplier(streak: number): number {
  let mult = COMBO_STEPS[0].mult
  for (const step of COMBO_STEPS) {
    if (streak >= step.streak) mult = step.mult
  }
  return mult
}

// ラック段位ごとの基礎点（低い/中間/高い）
export const RACK_SCORES = [100, 200, 300] as const

/** 基礎点にコンボ倍率をかけたスコア（四捨五入） */
export function scoreForCatch(baseScore: number, streak: number): number {
  return Math.round(baseScore * comboMultiplier(streak))
}

// ----------------------------------------------------------------------------
// レベル進行（10着ごとにレベルアップ。ラックの移動本数・速度が漸増）
// ----------------------------------------------------------------------------
export const CATCHES_PER_LEVEL = 10

export function levelForCatches(totalCatches: number): number {
  return Math.floor(Math.max(0, totalCatches) / CATCHES_PER_LEVEL) + 1
}

/** そのレベルで左右に往復移動するラックの本数（0〜2）。レベル2以降1本、レベル4以降2本 */
export function movingRackCount(level: number): number {
  if (level >= 4) return 2
  if (level >= 2) return 1
  return 0
}

/** 往復移動の角速度(rad/s)。レベルが上がるほど速くなる */
export function rackSpeedForLevel(level: number): number {
  const extra = Math.max(0, level - 2)
  return 0.6 + extra * 0.15
}

/** 往復移動するラックの現在のx座標（正弦波） */
export function rackOscillateX(baseX: number, amplitude: number, speed: number, t: number): number {
  return baseX + Math.sin(t * speed) * amplitude
}

// ----------------------------------------------------------------------------
// その他の定数・localStorage（他ゲームと同じ命名 "<game>.best"）
// ----------------------------------------------------------------------------
export const LIVES_START = 3
export const RACK_CAPACITY = 8 // ラック1本あたりの最大着数。超えたら古い方からフェードアウト
export const PREVIEW_THROWS = 3 // 最初の何投まで予測軌道を表示するか

export const BEST_KEY = 'laundry.best'

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
    const prev = loadBest()
    if (score > prev) localStorage.setItem(BEST_KEY, String(score))
  } catch {
    // localStorage が使えない環境では何もしない
  }
}
