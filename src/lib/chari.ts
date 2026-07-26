// チャリ通（エンドレスラン）のコアロジック。
// コース生成・物理・スコアだけを扱い、描画と入力は ChariGameView 側に置く。
// 生成間隔は距離固定ではなく、その地点の速度 × 時間で決める。

export const ROAD_Y = 384
export const ROAD_MIN_Y = 252
export const ROAD_MAX_Y = 428
export const STEP_H = 44
export const SLOPE_MAX_H = 84
export const PLAYER_W = 30
export const PLAYER_H = 52
export const WALL_TOL = 22
export const COIN_RADIUS = 30
export const GRAV = 2100
export const JUMP_V = 720
export const AIR_JUMP_V = 640
export const JUMP_CUT_V = 250
export const MAX_FALL = 1150
export const DIVE_V = 1480
export const RAMP_V = 1020
export const JUMP_AIRTIME = (2 * JUMP_V) / GRAV
export const PX_PER_M = 30
export const GENERATE_AHEAD = 1800
export const PRUNE_BEHIND = 700

export type EventKind =
  | 'jump'
  | 'airjump'
  | 'land'
  | 'coin'
  | 'ramp'
  | 'airbonus'
  | 'crash'
  | 'fall'

export type GameEvent = { kind: EventKind; x: number; y: number; value?: number }
export type Input = { jumpPressed: boolean; jumpHeld: boolean; diveHeld: boolean }
export type Segment = {
  id: number
  x: number
  w: number
  y: number
  endY?: number
  gapBefore: number
  airGap?: boolean
  entryClear: number
  exitClear: number
}
export type ObstacleKind = 'pylon' | 'fence' | 'truck' | 'bird' | 'ramp'
export type Obstacle = {
  id: number
  kind: ObstacleKind
  x: number
  y: number
  w: number
  h: number
  cluster: number
  used: boolean
}
export type Coin = { id: number; x: number; y: number; taken: boolean }
export type Player = {
  x: number
  y: number
  vy: number
  grounded: boolean
  airJumpUsed: boolean
  airTime: number
}
export type Run = {
  seed: number
  rng: () => number
  status: 'playing' | 'over'
  overReason: 'crash' | 'fall' | null
  player: Player
  startX: number
  distance: number
  speed: number
  elapsed: number
  coinsTaken: number
  airBonuses: number
  events: GameEvent[]
  segments: Segment[]
  obstacles: Obstacle[]
  coins: Coin[]
  nextX: number
  nextY: number
  serial: number
}

export const BEST_KEY = 'chari.best'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function speedAt(dist: number): number {
  // 初速から忙しく、約500mで最高速へ。穴幅や安全帯も速度基準で伸びるため
  // 到達不能にはせず、判断と入力の猶予だけを強く削る。
  return Math.min(1050, 460 + Math.max(0, dist) * 0.04)
}

export function difficultyAt(dist: number): number {
  return clamp(dist / 26000, 0, 1)
}

export function maxGapFor(speed: number): number {
  return Math.max(64, Math.min(300, speed * JUMP_AIRTIME * 0.52))
}

/** 単発ジャンプでは届かず、空中ジャンプなら越えられる大穴の上限 */
export function maxAirGapFor(speed: number): number {
  return Math.min(900, speed * JUMP_AIRTIME * 1.16)
}

export function minObstacleSpacing(speed: number): number {
  return Math.max(220, speed * 0.62)
}

export function surfaceAt(run: Run, x: number): number | null {
  for (const s of run.segments) {
    if (x >= s.x && x <= s.x + s.w) {
      const t = clamp((x - s.x) / s.w, 0, 1)
      return s.y + ((s.endY ?? s.y) - s.y) * t
    }
  }
  return null
}

function addCoin(run: Run, x: number, y: number) {
  run.coins.push({ id: run.serial++, x, y, taken: false })
}

function addCoinArc(run: Run, x0: number, x1: number, roadY: number, lift: number) {
  const count = Math.max(3, Math.round((x1 - x0) / 42))
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    addCoin(run, x0 + (x1 - x0) * t, roadY - 54 - Math.sin(t * Math.PI) * lift)
  }
}

function addObstacle(run: Run, kind: ObstacleKind, x: number, roadY: number, cluster: number) {
  const dims =
    kind === 'pylon'
      ? { w: 24, h: 32 }
      : kind === 'fence'
        ? { w: 42, h: 48 }
        : kind === 'truck'
          ? { w: 118, h: 128 }
          : kind === 'bird'
            ? { w: 42, h: 22 }
            : { w: 58, h: 18 }
  // 描画上の人物は物理ヒットボックスより背が高いため、地上走行時に
  // スプライトとも重ならない高さへ置く。ジャンプ中だけ届く位置は維持する。
  const y = kind === 'bird' ? roadY - 160 : roadY - dims.h
  run.obstacles.push({
    id: run.serial++,
    kind,
    x,
    y,
    w: dims.w,
    h: dims.h,
    cluster,
    used: false,
  })
}

function generateSegment(run: Run) {
  const dist = Math.max(0, run.nextX - run.startX)
  const speed = speedAt(dist)
  const difficulty = difficultyAt(dist)
  const rng = run.rng

  // 穴を伴う区間遷移だけ高さを変える。地続きの段差は作らない。
  // 後半ほど穴が続く。幅もジャンプ限界へ寄せるが、物理上の上限は必ず守る。
  const hasGap = run.segments.length > 0 && rng() < 0.8 + difficulty * 0.14
  // 穴幅と同じ乱数から大穴かを決め、追加要素によって後続コースの乱数列を
  // ずらさない。既存の障害物配置のプレイ可能性を保ったまま大穴を混ぜられる。
  const gapRoll = hasGap ? rng() : 0
  const airGap = hasGap && difficulty > 0.12 && gapRoll < 0.2 + difficulty * 0.2
  const gap = hasGap
    ? airGap
      ? speed * JUMP_AIRTIME * (1.06 + gapRoll * 0.07)
      : Math.max(64, maxGapFor(speed) * (0.9 + gapRoll * (0.09 + difficulty * 0.01)))
    : 0
  let y = run.nextY
  if (hasGap && rng() < 0.38) {
    const direction = rng() < 0.48 ? -1 : 1
    y = clamp(run.nextY + direction * STEP_H, ROAD_MIN_Y, ROAD_MAX_Y)
  }

  const x = run.nextX + gap
  const w = Math.max(360, speed * (1.65 + rng() * 0.35))
  // 長い道路区間は緩やかな上り／下りにする。区間末端を次区間の始点へ
  // 引き継ぐので、穴がない場所では路面が滑らかにつながる。
  const slopeRoll = rng()
  const slopeDelta =
    slopeRoll < 0.64
      ? (rng() < 0.5 ? -1 : 1) * (36 + rng() * (SLOPE_MAX_H - 36))
      : 0
  const endY = clamp(y + slopeDelta, ROAD_MIN_Y, ROAD_MAX_Y)
  // 二段ジャンプの大穴は着地が通常より奥になるため、着地側の安全帯を広げる。
  const entryClear = Math.max(90, speed * (airGap ? 1.15 : 0.72))
  // 規定の0.32秒を下限に、障害物ジャンプが着地してから次の穴へ
  // 踏み切れる余白まで確保する（二段ジャンプを使っても穴へ直結しない）。
  const exitClear = Math.max(90, speed * 0.72)
  const segment: Segment = {
    id: run.serial++,
    x,
    w,
    y,
    endY,
    gapBefore: gap,
    airGap,
    entryClear,
    exitClear,
  }
  run.segments.push(segment)

  const safeStart = x + entryClear
  const safeEnd = x + w - exitClear
  const room = safeEnd - safeStart
  const roadAt = (px: number) => y + (endY - y) * clamp((px - x) / w, 0, 1)
  const roll = rng()
  if (room > 120 && roll < 1) {
    const cluster = run.serial++
    const center = safeStart + room * (0.25 + rng() * 0.5)
    const kindRoll = rng()
    if (kindRoll < 0.35) {
      // 最初から2連、少し走ればほぼ3連。ひと跳びで越せるクラスタ幅に収める。
      const count = difficulty > 0.2 ? (rng() < 0.88 ? 3 : 2) : 2
      const spread = 40
      const first = clamp(center - ((count - 1) * spread) / 2, safeStart, safeEnd - (count - 1) * spread)
      for (let i = 0; i < count; i++) {
        const px = first + i * spread
        addObstacle(run, 'pylon', px, roadAt(px + 12), cluster)
      }
      const arcEnd = first + Math.max(75, (count - 1) * spread + 30)
      addCoinArc(run, first - 5, arcEnd, roadAt((first + arcEnd) / 2), 48)
    } else if (kindRoll < 0.65 && difficulty > 0.04) {
      addObstacle(run, 'fence', center, roadAt(center + 21), cluster)
      addCoinArc(run, center - 28, center + 72, roadAt(center + 22), 62)
    } else if (kindRoll < 0.78 && difficulty > 0.3) {
      // 通常ジャンプの最高点より高い配送トラック。手前から跳び、
      // 空中ジャンプを重ねないと車体上端を越えられない。
      const truckX = clamp(center, safeStart, safeEnd - 118)
      addObstacle(run, 'truck', truckX, roadAt(truckX + 59), cluster)
      addCoinArc(run, truckX - 45, truckX + 165, roadAt(truckX + 59), 155)
    } else if (kindRoll < 0.94 && difficulty > 0.16) {
      // 鳥は地上なら頭上を抜けられる。ジャンプ中だけ衝突する逆転障害物。
      addObstacle(run, 'bird', center, roadAt(center + 21), cluster)
      for (let px = center - 35; px <= center + 75; px += 42) {
        addCoin(run, px, roadAt(px) - 44)
      }
    } else {
      addObstacle(run, 'ramp', center, roadAt(center + 29), cluster)
      const arcEnd = Math.min(safeEnd, center + 250)
      addCoinArc(run, center + 38, arcEnd, roadAt((center + 38 + arcEnd) / 2), 115)
    }
  } else if (room > 180) {
    const start = safeStart + 35
    const end = Math.min(safeEnd - 20, start + 150)
    for (let px = start; px <= end; px += 42) addCoin(run, px, roadAt(px) - 48)
  }

  if (gap > 0) {
    const prev = run.segments[run.segments.length - 2]
    const left = prev.x + prev.w + 12
    addCoinArc(run, left, x - 12, Math.min(prev.endY ?? prev.y, y), airGap ? 92 : 46)
  }
  run.nextX = x + w
  run.nextY = endY
}

export function ensureAhead(run: Run, untilX: number): void {
  while (run.nextX < untilX) generateSegment(run)
}

export function createRun(seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0): Run {
  const rng = mulberry32(seed)
  const startX = 120
  const first: Segment = {
    id: 0,
    x: -500,
    w: 1200,
    y: ROAD_Y,
    endY: ROAD_Y,
    gapBefore: 0,
    airGap: false,
    entryClear: 0,
    exitClear: 120,
  }
  const run: Run = {
    seed,
    rng,
    status: 'playing',
    overReason: null,
    player: {
      x: startX,
      y: ROAD_Y,
      vy: 0,
      grounded: true,
      airJumpUsed: false,
      airTime: 0,
    },
    startX,
    distance: 0,
    speed: speedAt(0),
    elapsed: 0,
    coinsTaken: 0,
    airBonuses: 0,
    events: [],
    segments: [first],
    obstacles: [],
    coins: [],
    nextX: first.x + first.w,
    nextY: ROAD_Y,
    serial: 1,
  }
  ensureAhead(run, startX + GENERATE_AHEAD)
  return run
}

const event = (run: Run, kind: EventKind, value?: number) => {
  run.events.push({ kind, x: run.player.x, y: run.player.y, value })
}

function finish(run: Run, reason: 'crash' | 'fall') {
  if (run.status === 'over') return
  run.status = 'over'
  run.overReason = reason
  event(run, reason)
}

function overlapsObstacle(run: Run, obstacle: Obstacle): boolean {
  if (obstacle.kind === 'ramp') return false
  const p = run.player
  const left = p.x - PLAYER_W / 2
  const right = p.x + PLAYER_W / 2
  const top = p.y - PLAYER_H
  return (
    right > obstacle.x &&
    left < obstacle.x + obstacle.w &&
    p.y > obstacle.y + 3 &&
    top < obstacle.y + obstacle.h
  )
}

function prune(run: Run) {
  const cutoff = run.player.x - PRUNE_BEHIND
  // surfaceAt が現在地の直後まで参照できるよう、終端が cutoff より後のものを残す。
  run.segments = run.segments.filter((s) => s.x + s.w >= cutoff)
  run.obstacles = run.obstacles.filter((o) => o.x + o.w >= cutoff)
  run.coins = run.coins.filter((c) => c.x >= cutoff)
}

export function step(run: Run, input: Input, dt: number): void {
  run.events.length = 0
  if (run.status !== 'playing' || dt <= 0) return
  // 大きい dt でも薄い障害物や路面を飛び越えないよう内部サブステップに分ける。
  let left = Math.min(dt, 0.1)
  let first = true
  while (left > 0 && run.status === 'playing') {
    const h = Math.min(1 / 120, left)
    const p = run.player
    const wasGrounded = p.grounded
    const oldX = p.x
    const oldSurface = surfaceAt(run, oldX)

    if (first && input.jumpPressed) {
      if (p.grounded) {
        p.vy = -JUMP_V
        p.grounded = false
        p.airTime = 0
        event(run, 'jump')
      } else if (!p.airJumpUsed) {
        p.vy = -AIR_JUMP_V
        p.airJumpUsed = true
        event(run, 'airjump')
      }
    }
    if (!p.grounded && !input.jumpHeld && p.vy < -JUMP_CUT_V) p.vy = -JUMP_CUT_V
    if (!p.grounded && input.diveHeld && p.vy < DIVE_V) p.vy = DIVE_V

    p.x += run.speed * h
    run.distance = Math.max(0, p.x - run.startX)
    run.speed = speedAt(run.distance)
    run.elapsed += h
    ensureAhead(run, p.x + GENERATE_AHEAD)

    const newSurface = surfaceAt(run, p.x)
    if (p.grounded) {
      if (newSurface == null) {
        p.grounded = false
        p.airTime = 0
      } else if (oldSurface != null && newSurface < oldSurface - WALL_TOL) {
        finish(run, 'crash')
      } else {
        p.y = newSurface
        p.vy = 0
      }
    }

    if (!p.grounded) {
      const prevY = p.y
      p.vy = Math.min(MAX_FALL, p.vy + GRAV * h)
      p.y += p.vy * h
      p.airTime += h
      // 上り坂では路面もフレーム間で上へ動くため、直前位置は直前の路面と
      // 比較する。現在路面だけとの比較では交差瞬間を取り逃がすことがある。
      const wasAboveSurface =
        newSurface != null && (oldSurface == null ? prevY <= newSurface : prevY <= oldSurface)
      if (newSurface != null && p.vy >= 0 && wasAboveSurface && p.y >= newSurface) {
        p.y = newSurface
        p.vy = 0
        p.grounded = true
        p.airJumpUsed = false
        event(run, 'land')
        if (p.airTime >= 0.85) {
          run.airBonuses++
          event(run, 'airbonus', 30)
        }
        p.airTime = 0
      }
    }

    // ジャンプ台は上面を下向きに横切ったときだけ、一度だけ作動する。
    for (const o of run.obstacles) {
      if (o.kind !== 'ramp' || o.used) continue
      const overX = p.x + PLAYER_W / 2 > o.x && p.x - PLAYER_W / 2 < o.x + o.w
      if (overX && p.y >= o.y && p.y <= o.y + o.h + 8 && p.vy >= 0) {
        o.used = true
        p.y = o.y
        p.vy = -RAMP_V
        p.grounded = false
        p.airTime = 0
        event(run, 'ramp')
      }
    }

    for (const o of run.obstacles) {
      if (overlapsObstacle(run, o)) {
        finish(run, 'crash')
        break
      }
    }

    for (const coin of run.coins) {
      if (coin.taken) continue
      if (Math.hypot(p.x - coin.x, p.y - PLAYER_H * 0.55 - coin.y) <= COIN_RADIUS) {
        coin.taken = true
        run.coinsTaken++
        event(run, 'coin', 10)
      }
    }

    if (p.y - PLAYER_H > ROAD_MAX_Y + 190) finish(run, 'fall')
    if (wasGrounded && !p.grounded && oldSurface == null) p.airTime = 0
    first = false
    left -= h
  }
  prune(run)
}

export function metersOf(run: Run): number {
  return Math.max(0, Math.floor(run.distance / PX_PER_M))
}

export function scoreOf(run: Run): number {
  return metersOf(run) + run.coinsTaken * 10 + run.airBonuses * 30
}

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
