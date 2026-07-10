// 通勤ランナー（Count Masters 型・群衆増殖ラン）のコアロジック。
// ・プレイヤー = kokiの「群れ」。開始1人。ゲートで増減し、障害物で減り、0人で終了。
// ・コースはシード付き擬似乱数で決定的に生成する（同 seed 同 index なら常に同じ結果）。
// ・描画・入力・リアルタイム進行は RunnerGameView 側。ここは純粋ロジックのみ（vitest対象）。

// ----------------------------------------------------------------------------
// 群れ人数の下限・上限
// ----------------------------------------------------------------------------
export const CROWD_MIN = 0
export const CROWD_MAX = 9999

// レーン: 0 = 上、1 = 下
export type Lane = 0 | 1

// ----------------------------------------------------------------------------
// ゲート
// ----------------------------------------------------------------------------
// add: +value / mul: ×value / sub: -value / div: ÷value
export type GateOp = 'add' | 'mul' | 'sub' | 'div'
export type Gate = { op: GateOp; value: number }

/** ゲートが「群れを減らさない（増えるか同数）」ゲートか。add(≥0) と mul(≥1) が該当 */
export function isGainGate(gate: Gate): boolean {
  return (gate.op === 'add' && gate.value >= 0) || (gate.op === 'mul' && gate.value >= 1)
}

/** ゲート効果を人数へ適用する（floor と clamp を含む） */
export function applyGate(count: number, gate: Gate): number {
  let next: number
  switch (gate.op) {
    case 'add':
      next = count + gate.value
      break
    case 'sub':
      next = count - gate.value
      break
    case 'mul':
      next = Math.floor(count * gate.value)
      break
    case 'div':
      next = Math.floor(count / gate.value)
      break
  }
  return Math.max(CROWD_MIN, Math.min(CROWD_MAX, next))
}

/** ゲート対のうち、その人数で結果人数が多くなる方（=期待値が高い方）のレーンを返す */
export function betterLane(top: Gate, bottom: Gate, count: number): Lane {
  return applyGate(count, top) >= applyGate(count, bottom) ? 0 : 1
}

/** ゲート対に「即死しない（結果が1人以上残る）選択肢」が存在するか */
export function hasSurvivableChoice(top: Gate, bottom: Gate, count: number): boolean {
  return applyGate(count, top) >= 1 || applyGate(count, bottom) >= 1
}

// ----------------------------------------------------------------------------
// 障害物
// ----------------------------------------------------------------------------
// train = 満員電車のドア（30%減）/ puddle = 水たまり（10%減）
export type ObstacleKind = 'train' | 'puddle'

export const OBSTACLE_FACTOR: Record<ObstacleKind, number> = {
  train: 0.7,
  puddle: 0.9,
}

/** 障害物に接触したときの人数（割合で減らす・floor・clamp） */
export function applyObstacle(count: number, kind: ObstacleKind): number {
  const next = Math.floor(count * OBSTACLE_FACTOR[kind])
  return Math.max(CROWD_MIN, Math.min(CROWD_MAX, next))
}

// ----------------------------------------------------------------------------
// 決定的擬似乱数（mulberry32）
// ----------------------------------------------------------------------------
/** 32bit シードから [0,1) を返す関数を作る（mulberry32・自前実装） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** seed と segment index を混ぜて、セグメントごとに独立な 32bit シードを作る */
function mixSeed(seed: number, index: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ index, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

// ----------------------------------------------------------------------------
// コース生成（決定的）
// ----------------------------------------------------------------------------
export const SEGMENT_M = 100 // 1セグメントの距離（m）
const GATE_LOCAL_M = 62 // セグメント内のゲート位置（m）
// 障害物の候補スロット（セグメント内 m）。ゲート(62m)から十分離してゲートと重ならないようにする
const OBSTACLE_SLOTS = [16, 38, 88]

export type Obstacle = { lane: Lane; kind: ObstacleKind; local: number }
export type Segment = {
  index: number
  gateLocal: number
  top: Gate
  bottom: Gate
  obstacles: Obstacle[]
}

// --- 難易度曲線（index が進むほどマイナス・障害物が増える。いずれも単調非減少） ---

/** そのセグメントで各レーンのゲートがマイナスになる確率 */
export function lossChance(index: number): number {
  if (index < 3) return 0
  return Math.min(0.12 + (index - 3) * 0.025, 0.45)
}

/** 障害物が満員電車（30%減）になる確率。残りは水たまり（10%減） */
export function trainChance(index: number): number {
  return Math.min(0.15 + index * 0.025, 0.5)
}

/** そのセグメントに2つ目の障害物が出る確率 */
function secondObstacleChance(index: number): number {
  return Math.min(0.15 + index * 0.03, 0.5)
}

function gainGate(rng: () => number): Gate {
  // 40% で ×2、残りは +（5〜20）
  if (rng() < 0.4) return { op: 'mul', value: 2 }
  return { op: 'add', value: 5 + Math.floor(rng() * 16) }
}

function lossGate(rng: () => number): Gate {
  // 55% で ÷2、残りは −（3〜12）
  if (rng() < 0.55) return { op: 'div', value: 2 }
  return { op: 'sub', value: 3 + Math.floor(rng() * 10) }
}

/** シードと index からコースセグメント（ゲート対・障害物配置）を決定的に生成する */
export function generateSegment(seed: number, index: number): Segment {
  const rng = mulberry32(mixSeed(seed, index))
  const p = lossChance(index)

  let top = rng() < p ? lossGate(rng) : gainGate(rng)
  let bottom = rng() < p ? lossGate(rng) : gainGate(rng)

  // 「即死しない選択肢が常に存在する」保証:
  // 両方マイナスは index が十分進んでから、かつ必ず片方を ÷2（マシな選択肢）にする。
  // ÷2 は 2人以上なら1人以上を残せるので、群れが2人以上なら常に助かる。
  if (!isGainGate(top) && !isGainGate(bottom)) {
    if (index < 8) {
      // まだ序盤: 片方をプラスに戻す（両方マイナスにしない）
      if (rng() < 0.5) top = gainGate(rng)
      else bottom = gainGate(rng)
    } else {
      // 両方マイナスにする場合は、必ず一方を ÷2 にしてマシな選択肢を残す
      if (top.op !== 'div' && bottom.op !== 'div') {
        if (rng() < 0.5) top = { op: 'div', value: 2 }
        else bottom = { op: 'div', value: 2 }
      }
    }
  }

  // 障害物: index 0,1 は無し。以降は1個、確率で2個。スロットとレーンは決定的にランダム。
  const obstacles: Obstacle[] = []
  if (index >= 2) {
    const n = 1 + (rng() < secondObstacleChance(index) ? 1 : 0)
    const slots = [...OBSTACLE_SLOTS]
    for (let i = 0; i < n && slots.length > 0; i++) {
      const si = Math.floor(rng() * slots.length)
      const local = slots.splice(si, 1)[0]
      const kind: ObstacleKind = rng() < trainChance(index) ? 'train' : 'puddle'
      const lane: Lane = rng() < 0.5 ? 0 : 1
      obstacles.push({ lane, kind, local })
    }
    obstacles.sort((a, b) => a.local - b.local)
  }

  return { index, gateLocal: GATE_LOCAL_M, top, bottom, obstacles }
}

// ----------------------------------------------------------------------------
// コースイベント（グローバル距離つき。View と sim の両方で使う）
// ----------------------------------------------------------------------------
export type CourseEvent =
  | { kind: 'gate'; dist: number; segIndex: number; top: Gate; bottom: Gate }
  | { kind: 'obstacle'; dist: number; segIndex: number; lane: Lane; obstacle: ObstacleKind }

/** セグメント index のイベントを、グローバル距離（m）付き・距離昇順で返す */
export function segmentEvents(seed: number, index: number): CourseEvent[] {
  const seg = generateSegment(seed, index)
  const base = index * SEGMENT_M
  const events: CourseEvent[] = [
    { kind: 'gate', dist: base + seg.gateLocal, segIndex: index, top: seg.top, bottom: seg.bottom },
    ...seg.obstacles.map(
      (o): CourseEvent => ({
        kind: 'obstacle',
        dist: base + o.local,
        segIndex: index,
        lane: o.lane,
        obstacle: o.kind,
      }),
    ),
  ]
  events.sort((a, b) => a.dist - b.dist)
  return events
}

// ----------------------------------------------------------------------------
// スコア・速度
// ----------------------------------------------------------------------------
/** 到達距離（m）→ スコア（m 単位の整数） */
export function distanceToScore(distanceM: number): number {
  return Math.max(0, Math.floor(distanceM))
}

const BASE_SPEED = 8.5 // m/s
const SPEED_RAMP = 700 // この距離で最大加速に近づく
const MAX_EXTRA = 7.5 // 追加される最高速度（m/s）

/** 距離に応じて緩やかに加速するスクロール速度（m/s） */
export function speedAt(distanceM: number): number {
  return BASE_SPEED + MAX_EXTRA * (1 - Math.exp(-distanceM / SPEED_RAMP))
}

// ----------------------------------------------------------------------------
// プレイアビリティ検証用の純粋シミュレーション（Canvas 不要）
// ----------------------------------------------------------------------------
export type BotResult = { distance: number; survived: boolean; finalCount: number }

/**
 * 「常に期待値の高い方のゲートを選ぶ」bot でコースを踏破シミュレーションする。
 * ゲートでは結果人数が多い方のレーンへ移り、そのレーンのままなので障害物には当たりうる
 * （＝ゲートだけ最適化する素朴なプレイヤー）。targetDist まで生存できたかを返す。
 */
export function simulateGreedyBot(seed: number, targetDist: number): BotResult {
  let count = 1
  let lane: Lane = 0
  for (let index = 0; index < 100000; index++) {
    if (index * SEGMENT_M > targetDist + SEGMENT_M) break
    for (const ev of segmentEvents(seed, index)) {
      if (ev.dist > targetDist) return { distance: targetDist, survived: count > 0, finalCount: count }
      if (ev.kind === 'obstacle') {
        if (ev.lane === lane) count = applyObstacle(count, ev.obstacle)
      } else {
        lane = betterLane(ev.top, ev.bottom, count)
        count = applyGate(count, lane === 0 ? ev.top : ev.bottom)
      }
      if (count <= 0) return { distance: ev.dist, survived: false, finalCount: 0 }
    }
  }
  return { distance: targetDist, survived: count > 0, finalCount: count }
}
