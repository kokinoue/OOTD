// チャリ通（エンドレスラン）のコアロジック。
// コース生成・物理・スコアだけを扱い、描画と入力は ChariGameView 側に置く。
// 生成間隔は距離固定ではなく、その地点の速度 × 時間で決める。

export const ROAD_Y = 384
export const ROAD_MIN_Y = 252
export const ROAD_MAX_Y = 428
export const STEP_H = 44
export const SLOPE_MAX_H = 140
export const PLAYER_W = 30
export const PLAYER_H = 52
export const WALL_TOL = 22
export const COIN_RADIUS = 30
export const GRAV = 2100
export const JUMP_V = 720
export const AIR_JUMP_V = 900
export const JUMP_CUT_V = 250
export const MAX_FALL = 1150
export const RAMP_V = 1450
export const JUMP_AIRTIME = (2 * JUMP_V) / GRAV
export const PX_PER_M = 30
export const GENERATE_AHEAD = 1800
export const PRUNE_BEHIND = 700
export const COMBO_TIMEOUT = 1.8
export const ZONE_LENGTH = 9000
// 1天候は約400m（基本速度で約15秒）続き、うち約3秒を遷移に使う。
export const WEATHER_LENGTH = 12000
export const WEATHER_TRANSITION_LENGTH = 2400
export const COMMUTE_MINUTE_SECONDS = 0.375
export const UNDERPASS_DEPTH = 96
export const UNDERPASS_STREET_LIFT = 100

export type EventKind =
  | 'jump'
  | 'airjump'
  | 'land'
  | 'coin'
  | 'ramp'
  | 'airbonus'
  | 'combo'
  | 'crash'
  | 'fall'

export type GameEvent = { kind: EventKind; x: number; y: number; value?: number }
export type Input = { jumpPressed: boolean; jumpHeld: boolean }
export type Segment = {
  id: number
  x: number
  w: number
  y: number
  endY?: number
  /** 0は直線、1に近いほど坂の始端と終端が丸くなる */
  curve?: number
  gapBefore: number
  airGap?: boolean
  route?: 'underpass'
  entryClear: number
  exitClear: number
}
export type ZoneKind = 'residential' | 'shopping' | 'construction' | 'station' | 'school'
export type ZoneProfile = {
  gapChance: number
  slopeChance: number
  coinMultiplier: number
  specialRouteChance: number
}
export type WeatherKind = 'clear' | 'rain' | 'wind' | 'fog'
export type WeatherTransition = { from: WeatherKind; to: WeatherKind; progress: number }
export type CommutePhase =
  | 'early'
  | 'morningRush'
  | 'daytime'
  | 'lunch'
  | 'afternoon'
  | 'eveningRush'
  | 'night'
export type RiderTraits = {
  speedMul: number
  jumpMul: number
  airJumpMul: number
  coinRadius: number
  windResist: number
  rainGrip: number
  fogVision: number
  comboBonus: number
  effects: string[]
}
export type PlatformKind = 'branch' | 'roof' | 'footbridge' | 'street'
export type Platform = {
  id: number
  kind: PlatformKind
  x: number
  w: number
  y: number
  requiresRamp?: boolean
  requiresRampLaunch?: boolean
}
export type ObstacleKind =
  | 'pylon'
  | 'fence'
  | 'truck'
  | 'bird'
  | 'ramp'
  | 'signal'
  | 'commuter'
  | 'crossing'
  | 'ball'
  | 'students'
export type Obstacle = {
  id: number
  kind: ObstacleKind
  x: number
  y: number
  w: number
  h: number
  cluster: number
  used: boolean
  phase?: number
  vx?: number
  originX?: number
}
export type Coin = { id: number; x: number; y: number; taken: boolean; magnetized?: boolean }
export type Player = {
  x: number
  y: number
  vy: number
  grounded: boolean
  platformId: number | null
  rampRoute: boolean
  rampLaunchActive: boolean
  airJumpUsed: boolean
  airTime: number
}
export type Run = {
  seed: number
  rng: () => number
  status: 'playing' | 'over'
  overReason: 'crash' | 'fall' | null
  player: Player
  traits: RiderTraits
  startX: number
  distance: number
  speed: number
  elapsed: number
  coinsTaken: number
  coinScore: number
  combo: number
  maxCombo: number
  comboTimer: number
  airBonuses: number
  events: GameEvent[]
  segments: Segment[]
  platforms: Platform[]
  obstacles: Obstacle[]
  coins: Coin[]
  nextX: number
  nextY: number
  serial: number
}

export const BEST_KEY = 'chari.best'

export const DEFAULT_RIDER_TRAITS: RiderTraits = {
  speedMul: 1,
  jumpMul: 1,
  airJumpMul: 1,
  coinRadius: COIN_RADIUS,
  windResist: 0,
  rainGrip: 0,
  fogVision: 0,
  comboBonus: 0,
  effects: ['標準'],
}

export type RiderItem = { category: string; label?: string; color?: string }

export function deriveRiderTraits(date: string, items: RiderItem[]): RiderTraits {
  const traits: RiderTraits = { ...DEFAULT_RIDER_TRAITS, effects: [] }
  const words = items.map((item) => `${item.category} ${item.label ?? ''}`.toLowerCase())
  const has = (pattern: RegExp) => words.some((word) => pattern.test(word))
  const hasShoes = has(/shoe|sneaker|boots|loafer|サンダル|靴/)
  const hasOuter = has(/coat|jacket|outer|blouson|parka|rain|コート|ジャケット/)
  const hasBag = has(/bag|バッグ|リュック/)
  const hasHat = has(/hat|cap|beanie|帽子|キャップ/)
  const hasShorts = has(/shorts|ショーツ|短パン/)

  if (hasBag) {
    traits.coinRadius = 120
    traits.effects.push('バッグ：コイン吸引')
  }
  if (hasHat) {
    traits.fogVision += 0.22
    traits.effects.push('帽子：霧視界+')
  }
  if (hasOuter) {
    traits.windResist += 0.22
    traits.rainGrip += 0.2
    traits.effects.push('アウター：悪天候耐性')
  }

  const month = Number(date.slice(5, 7))
  if (month >= 3 && month <= 5) traits.jumpMul += 0.035
  else if (month >= 6 && month <= 8) traits.speedMul += 0.03
  else if (month >= 9 && month <= 11) traits.coinRadius += 8
  else traits.windResist += 0.18

  const colors = items.map((item) => item.color).filter((color): color is string => Boolean(color))
  const colorCounts = new Map<string, number>()
  for (const color of colors) colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
  const dominant = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (dominant && dominant[1] >= 3) {
    traits.comboBonus += 0.5
    traits.effects.push(`${dominant[0]}統一：コンボ猶予+0.5秒`)
  }
  if (hasOuter && hasShoes) {
    traits.rainGrip += 0.55
    traits.effects.push('雨支度セット：雨でも安定')
  }
  if (hasShorts && !hasOuter) {
    traits.jumpMul += 0.07
    traits.airJumpMul += 0.04
    traits.effects.push('軽装セット：ジャンプ強化')
  }
  if (items.length >= 5 && hasOuter) {
    traits.windResist += 0.38
    traits.effects.push('重ね着セット：強風耐性')
  }
  traits.windResist = clamp(traits.windResist, 0, 0.85)
  traits.rainGrip = clamp(traits.rainGrip, 0, 0.9)
  traits.fogVision = clamp(traits.fogVision, 0, 0.65)
  if (traits.effects.length === 0) traits.effects.push('ベーシック：バランス型')
  return traits
}

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
  // 距離による加速は行わず、コース生成と基本走行速度を一定に保つ。
  void dist
  return 800
}

export function difficultyAt(dist: number): number {
  return clamp(dist / 26000, 0, 1)
}

function zoneIndexAt(block: number, seed: number): number {
  let value = Math.imul((block + 1) ^ (seed >>> 0), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}

export function zoneAt(dist: number, seed = 0): ZoneKind {
  const zones: ZoneKind[] = ['residential', 'shopping', 'construction', 'station', 'school']
  const block = Math.floor(Math.max(0, dist) / ZONE_LENGTH)
  return zones[zoneIndexAt(block, seed) % zones.length]
}

export function zoneProfileAt(zone: ZoneKind): ZoneProfile {
  return {
    residential: { gapChance: 0.46, slopeChance: 0.34, coinMultiplier: 1, specialRouteChance: 0.18 },
    shopping: { gapChance: 0.7, slopeChance: 0.46, coinMultiplier: 2, specialRouteChance: 0.92 },
    construction: { gapChance: 0.94, slopeChance: 0.88, coinMultiplier: 1, specialRouteChance: 0.26 },
    station: { gapChance: 0.66, slopeChance: 0.52, coinMultiplier: 1, specialRouteChance: 0.58 },
    school: { gapChance: 0.54, slopeChance: 0.4, coinMultiplier: 1, specialRouteChance: 0.88 },
  }[zone]
}

export function weatherAt(dist: number, seed = 0): WeatherKind {
  const weathers: WeatherKind[] = ['clear', 'rain', 'wind', 'fog']
  const block = Math.floor(Math.max(0, dist) / WEATHER_LENGTH)
  return weathers[(block + (seed >>> 0)) % weathers.length]
}

export function weatherTransitionAt(dist: number, seed = 0): WeatherTransition {
  const safeDist = Math.max(0, dist)
  const block = Math.floor(safeDist / WEATHER_LENGTH)
  const to = weatherAt(safeDist, seed)
  if (block === 0) return { from: to, to, progress: 1 }
  const from = weatherAt((block - 1) * WEATHER_LENGTH, seed)
  const rawProgress = clamp(
    (safeDist - block * WEATHER_LENGTH) / WEATHER_TRANSITION_LENGTH,
    0,
    1,
  )
  // 始端と終端で変化量を小さくし、天候が滑らかにつながるようにする。
  const progress = rawProgress * rawProgress * (3 - 2 * rawProgress)
  return { from, to, progress }
}

export function weatherStrength(
  transition: WeatherTransition,
  weather: WeatherKind,
): number {
  return (transition.from === weather ? 1 - transition.progress : 0) +
    (transition.to === weather ? transition.progress : 0)
}

function motionSpeedWithWeather(run: Run, weather: WeatherKind): number {
  const windPush =
    weather === 'wind'
      ? ((run.seed & 1) === 0 ? 145 : -145) * (1 - run.traits.windResist)
      : 0
  const wetRoadBoost = weather === 'rain' ? 1 + 0.11 * (1 - run.traits.rainGrip) : 1
  return Math.max(320, run.speed * run.traits.speedMul * wetRoadBoost + windPush)
}

function motionSpeedWithTransition(run: Run, transition: WeatherTransition): number {
  const fromSpeed = motionSpeedWithWeather(run, transition.from)
  const toSpeed = motionSpeedWithWeather(run, transition.to)
  return fromSpeed + (toSpeed - fromSpeed) * transition.progress
}

export function motionSpeedAt(run: Run, dist: number): number {
  return motionSpeedWithTransition(run, weatherTransitionAt(dist, run.seed))
}

export function minimumMotionSpeedAt(run: Run, dist: number): number {
  const baseSpeed = speedAt(dist) * run.traits.speedMul
  return Math.max(320, baseSpeed - 145 * (1 - run.traits.windResist))
}

export function motionSpeedFor(run: Run, x = run.player.x): number {
  return Math.max(
    320,
    motionSpeedWithTransition(run, effectiveWeatherTransitionFor(run)) *
      slopeSpeedMultiplierFor(run, x),
  )
}

export function isUnderpassAt(run: Run, x = run.player.x): boolean {
  if (run.player.platformId != null) return false
  const segment = run.segments.find(
    (item) => item.route === 'underpass' && x >= item.x && x <= item.x + item.w,
  )
  if (!segment) return false
  const t = clamp((x - segment.x) / segment.w, 0, 1)
  const groundLevel = segment.y + ((segment.endY ?? segment.y) - segment.y) * t
  return run.player.y > groundLevel + 18
}

export function effectiveWeatherFor(run: Run): WeatherKind {
  const transition = effectiveWeatherTransitionFor(run)
  return transition.progress < 0.5 ? transition.from : transition.to
}

export function effectiveWeatherTransitionFor(run: Run): WeatherTransition {
  if (isUnderpassAt(run)) return { from: 'clear', to: 'clear', progress: 1 }
  return weatherTransitionAt(run.distance, run.seed)
}

export function commuteStartMinute(seed = 0): number {
  // seed=0 は従来の表示との後方互換用。実際のプレイは毎回ランダムなseedを持つ。
  if (seed === 0) return 7 * 60 + 20
  let mixed = seed >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
  return ((mixed ^ (mixed >>> 16)) >>> 0) % (24 * 60)
}

export function commuteClockAt(elapsedSeconds: number, seed = 0): {
  hour: number
  minute: number
  label: string
  phase: CommutePhase
} {
  // 走行距離や坂・天候による速度差から切り離し、実時間0.375秒で1分進める。
  const total =
    commuteStartMinute(seed) +
    Math.floor(Math.max(0, elapsedSeconds) / COMMUTE_MINUTE_SECONDS)
  const minutesOfDay = total % (24 * 60)
  const hour = Math.floor(minutesOfDay / 60)
  const minute = minutesOfDay % 60
  const phase: CommutePhase =
    minutesOfDay < 5 * 60 || minutesOfDay >= 20 * 60
      ? 'night'
      : minutesOfDay < 8 * 60
        ? 'early'
        : minutesOfDay < 10 * 60
          ? 'morningRush'
          : minutesOfDay < 11 * 60 + 30
            ? 'daytime'
            : minutesOfDay < 13 * 60 + 30
              ? 'lunch'
              : minutesOfDay < 17 * 60
                ? 'afternoon'
                : 'eveningRush'
  return { hour, minute, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, phase }
}

export function isNightTimeAt(elapsedSeconds: number, seed = 0): boolean {
  const { hour } = commuteClockAt(elapsedSeconds, seed)
  return hour < 5 || hour >= 18
}

export function nextZoneInfo(dist: number, seed = 0): { zone: ZoneKind; distance: number } {
  const boundary = (Math.floor(Math.max(0, dist) / ZONE_LENGTH) + 1) * ZONE_LENGTH
  return { zone: zoneAt(boundary, seed), distance: boundary - Math.max(0, dist) }
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

export function segmentSurfaceAt(segment: Segment, x: number): number {
  const t = clamp((x - segment.x) / segment.w, 0, 1)
  const roundedT = (1 - Math.cos(t * Math.PI)) / 2
  const curve = clamp(segment.curve ?? 0, 0, 1)
  const heightT = t + (roundedT - t) * curve
  const baseline = segment.y + ((segment.endY ?? segment.y) - segment.y) * heightT
  if (segment.route !== 'underpass') return baseline

  // 短い谷ではなく、入口で降りたあと長く地下を走り、出口で戻る形にする。
  const transition = 0.17
  const depthT =
    t < transition
      ? (1 - Math.cos((t / transition) * Math.PI)) / 2
      : t > 1 - transition
        ? (1 - Math.cos(((1 - t) / transition) * Math.PI)) / 2
        : 1
  return baseline + depthT * UNDERPASS_DEPTH
}

/**
 * 現在地の局所勾配を速度へ反映する。画面座標ではYが増える向きが下り。
 * 急な上りは最大30%減速、急な下りは最大35%加速する。
 */
export function slopeSpeedMultiplierFor(run: Run, x = run.player.x): number {
  if (run.player.platformId != null) return 1
  const segment = run.segments.find((item) => x >= item.x && x <= item.x + item.w)
  if (!segment) return 1
  const sample = Math.min(4, segment.w / 8)
  const rise = segmentSurfaceAt(segment, x + sample) - segmentSurfaceAt(segment, x - sample)
  const grade = rise / (sample * 2)
  return 1 + clamp(grade * 3.5, -0.3, 0.35)
}

export function surfaceAt(run: Run, x: number): number | null {
  for (const s of run.segments) {
    if (x >= s.x && x <= s.x + s.w) {
      return segmentSurfaceAt(s, x)
    }
  }
  return null
}

function platformAt(run: Run, id: number | null, x: number): Platform | undefined {
  return id == null ? undefined : run.platforms.find((p) => p.id === id && x >= p.x && x <= p.x + p.w)
}

function landingSurfaceAt(
  run: Run,
  x: number,
  previousY: number,
  currentY: number,
  previousRoadY: number | null,
): { y: number; platformId: number | null } | null {
  const candidates: Array<{ y: number; platformId: number | null }> = []
  const road = surfaceAt(run, x)
  if (
    road != null &&
    previousY <= (previousRoadY ?? road) &&
    currentY >= road
  ) {
    candidates.push({ y: road, platformId: null })
  }
  for (const platform of run.platforms) {
    if (platform.requiresRamp && !run.player.rampRoute) continue
    if (platform.requiresRampLaunch && !run.player.rampLaunchActive) continue
    if (
      x >= platform.x &&
      x <= platform.x + platform.w &&
      previousY <= platform.y &&
      currentY >= platform.y
    ) {
      candidates.push({ y: platform.y, platformId: platform.id })
    }
  }
  return candidates.sort((a, b) => a.y - b.y)[0] ?? null
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

function addPlatform(
  run: Run,
  kind: PlatformKind,
  x: number,
  w: number,
  y: number,
  requiresRamp = false,
  requiresRampLaunch = false,
) {
  run.platforms.push({
    id: run.serial++,
    kind,
    x,
    w,
    y,
    requiresRamp,
    requiresRampLaunch,
  })
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
            : kind === 'ramp'
              ? { w: 58, h: 18 }
              : kind === 'signal'
                ? { w: 72, h: 58 }
      : kind === 'commuter'
        ? { w: 34, h: 64 }
        : kind === 'ball'
          ? { w: 28, h: 28 }
          : kind === 'students'
            ? { w: 58, h: 74 }
          : { w: 92, h: 12 }
  // 描画上の人物は物理ヒットボックスより背が高いため、地上走行時に
  // スプライトとも重ならない高さへ置く。ジャンプ中だけ届く位置は維持する。
  const y = kind === 'bird' ? roadY - 160 : kind === 'crossing' ? roadY - 32 : roadY - dims.h
  run.obstacles.push({
    id: run.serial++,
    kind,
    x,
    y,
    w: dims.w,
    h: dims.h,
    cluster,
    used: false,
    phase: kind === 'signal' || kind === 'crossing' ? run.rng() * 4 : undefined,
    vx:
      kind === 'bird'
        ? -260
        : kind === 'commuter'
        ? -55 - run.rng() * 55
        : kind === 'ball'
          ? -105 - run.rng() * 45
          : kind === 'students'
            ? -28 - run.rng() * 20
            : undefined,
    originX:
      kind === 'bird' || kind === 'commuter' || kind === 'ball' || kind === 'students'
        ? x
        : undefined,
  })
}

export function obstacleActive(run: Run, obstacle: Obstacle): boolean {
  if (obstacle.kind === 'signal') {
    return signalStateAt(run, obstacle).blockage >= 0.78
  }
  if (obstacle.kind === 'crossing') {
    return crossingStateAt(run, obstacle).closure >= 0.78
  }
  return true
}

export function signalStateAt(
  run: Run,
  obstacle: Pick<Obstacle, 'phase'>,
): {
  light: 'red' | 'yellow' | 'green'
  blockage: number
  warningPulse: number
} {
  const phase = commuteClockAt(run.elapsed, run.seed).phase
  const redTime =
    phase === 'eveningRush'
      ? 3.25
      : phase === 'morningRush'
        ? 3.05
        : phase === 'lunch'
          ? 2.15
          : 2.45
  const time = run.elapsed + (obstacle.phase ?? 0)
  const cycle = ((time % 4) + 4) % 4
  const transitionTime = 0.45
  const smooth = (value: number) => {
    const progress = clamp(value, 0, 1)
    return progress * progress * (3 - 2 * progress)
  }
  let blockage = 0
  if (cycle < transitionTime) {
    blockage = smooth(cycle / transitionTime)
  } else if (cycle < redTime - transitionTime) {
    blockage = 1
  } else if (cycle < redTime) {
    blockage = 1 - smooth((cycle - (redTime - transitionTime)) / transitionTime)
  }
  const light =
    cycle < redTime
      ? 'red'
      : cycle >= 3.4
        ? 'yellow'
        : 'green'
  return {
    light,
    blockage,
    warningPulse: light === 'yellow' ? 0.55 + Math.sin(time * 15) * 0.45 : 0,
  }
}

export function crossingStateAt(
  run: Run,
  obstacle: Pick<Obstacle, 'phase'>,
): { closure: number; warning: boolean; lightSide: 0 | 1 } {
  const time = run.elapsed + (obstacle.phase ?? 0)
  const cycle = ((time % 5) + 5) % 5
  const smooth = (value: number) => {
    const progress = clamp(value, 0, 1)
    return progress * progress * (3 - 2 * progress)
  }
  let closure = 0
  if (cycle < 2.6) {
    closure = 1
  } else if (cycle < 3.2) {
    closure = 1 - smooth((cycle - 2.6) / 0.6)
  } else if (cycle >= 4.15) {
    closure = smooth((cycle - 4.15) / 0.85)
  }
  return {
    closure,
    warning: cycle < 3.2 || cycle >= 4.15,
    lightSide: (Math.floor(time * 6) % 2 === 0 ? 0 : 1),
  }
}

function addZonePattern(
  run: Run,
  zone: ZoneKind,
  patternStep: number,
  center: number,
  safeStart: number,
  safeEnd: number,
  roadAt: (x: number) => number,
  difficulty: number,
): void {
  const cluster = run.serial++
  if (zone === 'residential') {
    if (patternStep === 0) {
      const obstacleX = clamp(center, safeStart, safeEnd - 104)
      addObstacle(run, 'signal', obstacleX, roadAt(obstacleX + 52), cluster)
    } else if (patternStep === 1) {
      addObstacle(run, 'commuter', center, roadAt(center + 17), cluster)
      addCoinArc(run, center - 25, center + 85, roadAt(center + 17), 54)
    } else {
      if (difficulty > 0.16) {
        addObstacle(run, 'bird', center, roadAt(center + 21), cluster)
        for (let coinX = center - 35; coinX <= center + 75; coinX += 42) {
          addCoin(run, coinX, roadAt(coinX) - 44)
        }
      } else {
        addObstacle(run, 'ball', center, roadAt(center + 14), cluster)
      }
    }
    return
  }
  if (zone === 'shopping') {
    if (patternStep === 0) {
      addObstacle(run, 'fence', center, roadAt(center + 21), cluster)
      addCoinArc(run, center - 28, center + 72, roadAt(center + 21), 62)
    } else if (patternStep === 1) {
      addObstacle(run, 'commuter', center, roadAt(center + 17), cluster)
      addCoinArc(run, center - 25, center + 85, roadAt(center + 17), 54)
    } else {
      if (difficulty > 0.18) {
        addObstacle(run, 'ramp', center, roadAt(center + 29), cluster)
      } else {
        addObstacle(run, 'fence', center, roadAt(center + 21), cluster)
        addCoinArc(run, center - 28, center + 72, roadAt(center + 21), 62)
      }
    }
    return
  }
  if (zone === 'construction') {
    if (patternStep === 2 && difficulty > 0.3) {
      const truckX = clamp(center, safeStart, safeEnd - 118)
      addObstacle(run, 'truck', truckX, roadAt(truckX + 59), cluster)
      addCoinArc(run, truckX - 45, truckX + 165, roadAt(truckX + 59), 155)
      return
    }
    const count = patternStep === 1 ? 2 : 3
    const first = clamp(center - 40, safeStart, safeEnd - (count - 1) * 40)
    for (let index = 0; index < count; index++) {
      const obstacleX = first + index * 40
      addObstacle(run, 'pylon', obstacleX, roadAt(obstacleX + 12), cluster)
    }
    if (patternStep !== 1) {
      const fenceX = clamp(first + count * 40 + 15, safeStart, safeEnd - 42)
      addObstacle(run, 'fence', fenceX, roadAt(fenceX + 21), cluster)
    }
    addCoinArc(run, first - 5, first + count * 40 + 60, roadAt(center), 58)
    return
  }
  if (zone === 'station') {
    if (patternStep === 0) {
      addObstacle(run, 'crossing', center, roadAt(center + 10), cluster)
    } else if (patternStep === 1) {
      addObstacle(run, 'commuter', center, roadAt(center + 17), cluster)
      addCoinArc(run, center - 25, center + 85, roadAt(center + 17), 54)
    } else {
      addObstacle(run, 'fence', center, roadAt(center + 21), cluster)
      addCoinArc(run, center - 28, center + 72, roadAt(center + 21), 62)
    }
    return
  }
  if (patternStep === 0) {
    addObstacle(run, 'ball', center, roadAt(center + 14), cluster)
  } else if (patternStep === 1) {
    addObstacle(run, 'students', center, roadAt(center + 29), cluster)
  } else {
    addObstacle(run, 'students', center, roadAt(center + 29), cluster)
    addCoinArc(run, center - 25, center + 100, roadAt(center + 29), 82)
  }
}

function generateSegment(run: Run) {
  const dist = Math.max(0, run.nextX - run.startX)
  const speed = speedAt(dist)
  // 穴の途中で向かい風へ切り替わっても越えられる幅にする。
  const traversalSpeed = minimumMotionSpeedAt(run, dist)
  const difficulty = difficultyAt(dist)
  const zone = zoneAt(dist, run.seed)
  const zoneProfile = zoneProfileAt(zone)
  const zonePatternStep = Math.min(
    2,
    Math.floor(((dist % ZONE_LENGTH) / ZONE_LENGTH) * 3),
  )
  const rng = run.rng
  const underpass =
    difficulty > 0.12 &&
    zone === 'station' &&
    (zonePatternStep === 2
      ? rng() < 0.82
      : rng() < zoneProfile.specialRouteChance * 0.32)

  // 急降下なしでも二段ジャンプ後に着地できるよう、直前の障害物から
  // 次の穴までは十分な回復距離を空ける。
  const lastJumpObstacleEnd = run.obstacles.reduce(
    (latest, obstacle) =>
      obstacle.kind === 'bird' ? latest : Math.max(latest, obstacle.x + obstacle.w),
    -Infinity,
  )
  const recoveredFromObstacle = run.nextX - lastJumpObstacleEnd >= speed * 1.35
  // 穴を伴う区間遷移だけ高さを変える。地続きの段差は作らない。
  // 後半ほど穴が続く。幅もジャンプ限界へ寄せるが、物理上の上限は必ず守る。
  const hasGap =
    !underpass &&
    recoveredFromObstacle &&
    run.segments.length > 0 &&
    rng() < clamp(zoneProfile.gapChance + difficulty * 0.08, 0, 0.98)
  // 穴幅と同じ乱数から大穴かを決め、追加要素によって後続コースの乱数列を
  // ずらさない。既存の障害物配置のプレイ可能性を保ったまま大穴を混ぜられる。
  const gapRoll = hasGap ? rng() : 0
  const airGap = hasGap && difficulty > 0.12 && gapRoll < 0.2 + difficulty * 0.2
  const gap = hasGap
    ? airGap
      ? traversalSpeed * JUMP_AIRTIME * (1.06 + gapRoll * 0.07)
      : Math.max(
          64,
          maxGapFor(traversalSpeed) * (0.9 + gapRoll * (0.09 + difficulty * 0.01)),
        )
    : 0
  let y = run.nextY
  if (hasGap && rng() < 0.38) {
    const direction = rng() < 0.48 ? -1 : 1
    y = clamp(run.nextY + direction * STEP_H, ROAD_MIN_Y, ROAD_MAX_Y)
  }

  const x = run.nextX + gap
  // 地下道は分岐後の選択がしばらく続く、通常区間の倍以上の長さにする。
  const roofLaunchSegment =
    !underpass && zone === 'shopping' && zonePatternStep === 2 && difficulty > 0.18
  const w = underpass
    ? Math.max(2800, speed * (4.2 + rng() * 0.5))
    : roofLaunchSegment
      ? Math.max(3200, speed * (4 + rng() * 0.25))
      : Math.max(360, speed * (1.65 + rng() * 0.35))
  // 坂ごとに高低差と丸みを変える。区間末端を次区間の始点へ
  // 引き継ぐので、穴がない場所では路面が滑らかにつながる。
  const slopeRoll = rng()
  const slopeChance = zoneProfile.slopeChance
  let slopeDelta = 0
  if (!underpass && !roofLaunchSegment && slopeRoll < slopeChance) {
    let direction = rng() < 0.5 ? -1 : 1
    const height = 42 + rng() * (SLOPE_MAX_H - 42)
    if (
      (direction < 0 && y - 42 < ROAD_MIN_Y) ||
      (direction > 0 && y + 42 > ROAD_MAX_Y)
    ) {
      direction *= -1
    }
    slopeDelta = direction * height
  }
  const endY = clamp(y + slopeDelta, ROAD_MIN_Y, ROAD_MAX_Y)
  // 追加の乱数を消費せず、後続の障害物配置を変えない。
  const curve = slopeDelta === 0 ? undefined : 0.55 + (slopeRoll / slopeChance) * 0.45
  // 穴越えで空中ジャンプを使った場合も、着地前に次の専用パターンへ
  // 突っ込まないよう、穴がある区間は種類を問わず着地側を広く空ける。
  const entryClear = Math.max(90, speed * (hasGap ? 1.15 : 0.72))
  // 規定の0.32秒を下限に、障害物ジャンプが着地してから次の穴へ
  // 踏み切れる余白まで確保する（二段ジャンプを使っても穴へ直結しない）。
  const exitClear = Math.max(90, speed * 0.72)
  const segment: Segment = {
    id: run.serial++,
    x,
    w,
    y,
    endY,
    curve,
    gapBefore: gap,
    airGap,
    entryClear,
    exitClear,
  }
  if (underpass) segment.route = 'underpass'
  run.segments.push(segment)

  const safeStart = x + entryClear
  const safeEnd = x + w - exitClear
  const room = safeEnd - safeStart
  const roadAt = (px: number) => segmentSurfaceAt(segment, px)
  const roll = rng()
  if (!underpass && room > 120 && roll < 1) {
    const center = roofLaunchSegment
      ? safeStart + 80
      : safeStart + room * (0.25 + rng() * 0.5)
    addZonePattern(run, zone, zonePatternStep, center, safeStart, safeEnd, roadAt, difficulty)
  } else if (room > 180) {
    const start = safeStart + 35
    const end = Math.min(safeEnd - 20, start + 150)
    for (let px = start; px <= end; px += 42) addCoin(run, px, roadAt(px) - 48)
  }

  // 地上の安全ルートに対し、ジャンプで乗れる上ルートを重ねる。
  // 商店街では屋根が連続し、それ以外では短い分岐として現れる。
  const routeRoll = rng()
  const routeClear = Math.max(120, speed * 0.22)
  const routeStart = x + routeClear
  const routeEnd = x + w - routeClear
  const hasBirdOnSegment = run.obstacles.some(
    (obstacle) => obstacle.kind === 'bird' && obstacle.x >= x && obstacle.x < x + w,
  )
  const shoppingRamp = run.obstacles.find(
    (obstacle) =>
      obstacle.kind === 'ramp' &&
      obstacle.x >= x &&
      obstacle.x < x + w,
  )
  if (underpass) {
    const streetStart = x + Math.max(105, speed * 0.14)
    const streetEnd = x + w - Math.max(105, speed * 0.14)
    const streetY = y - UNDERPASS_STREET_LIFT
    addPlatform(run, 'street', streetStart, streetEnd - streetStart, streetY)
    // 地上は安全な代わりに少額報酬。3枚だけを等間隔に置く。
    for (let index = 1; index <= 3; index++) {
      const coinX = streetStart + ((streetEnd - streetStart) * index) / 4
      addCoin(run, coinX, streetY - 36)
    }
    // 地下は長い区間に障害物が続く代わりに大量報酬。コイン列は障害物の
    // 手前で途切れ、ジャンプ軌道へつながるので進路も読み取りやすい。
    const hazards = [
      { kind: 'fence' as const, x: x + w * 0.34, span: 42, lift: 66 },
      { kind: 'pylon' as const, x: x + w * 0.54, span: 104, lift: 54 },
      { kind: 'fence' as const, x: x + w * 0.74, span: 42, lift: 66 },
    ]
    for (const hazard of hazards) {
      const cluster = run.serial++
      if (hazard.kind === 'pylon') {
        for (let index = 0; index < 3; index++) {
          const obstacleX = hazard.x + index * 40
          addObstacle(run, 'pylon', obstacleX, roadAt(obstacleX + 12), cluster)
        }
      } else {
        addObstacle(run, 'fence', hazard.x, roadAt(hazard.x + 21), cluster)
      }
      addCoinArc(
        run,
        hazard.x - 38,
        hazard.x + hazard.span + 50,
        roadAt(hazard.x + hazard.span / 2),
        hazard.lift,
      )
    }
    for (let coinX = x + w * 0.16; coinX < x + w * 0.84; coinX += 38) {
      if (
        hazards.some(
          (hazard) => coinX > hazard.x - 70 && coinX < hazard.x + hazard.span + 80,
        )
      ) {
        continue
      }
      addCoin(run, coinX, segmentSurfaceAt(segment, coinX) - 45)
    }
  } else if (shoppingRamp && routeEnd - routeStart > 620) {
    // 商店街の屋根はジャンプ台からだけ入れる専用ルート。
    // 打ち上げ軌道の下降位置へ最初の屋根を置き、その後を連続させる。
    const roofs = [
      { offset: 720, w: 400, lift: 430 },
      { offset: 1300, w: 300, lift: 410 },
      { offset: 1900, w: 320, lift: 390 },
    ]
    const firstRoofX = shoppingRamp.x + roofs[0].offset
    for (const [index, roof] of roofs.entries()) {
      const platformX = shoppingRamp.x + roof.offset
      const platformW = roof.w
      if (platformX + platformW > routeEnd) break
      const platformY =
        roadAt(platformX + platformW / 2) - roof.lift
      addPlatform(run, 'roof', platformX, platformW, platformY, true, index === 0)
      for (
        let coinX = platformX + 24;
        coinX < platformX + platformW - 10;
        coinX += 36
      ) {
        addCoin(run, coinX, platformY - 34)
      }
    }
    addCoinArc(
      run,
      shoppingRamp.x + 42,
      firstRoofX + 80,
      roadAt((shoppingRamp.x + firstRoofX) / 2),
      420,
    )
  } else if (
    routeEnd - routeStart > 620 &&
    !hasBirdOnSegment &&
    difficulty > 0.18 &&
    zone !== 'shopping' &&
    (zone === 'school' && zonePatternStep === 2
      ? true
      : routeRoll < (zone === 'school' ? zoneProfile.specialRouteChance : 0.18))
  ) {
    const heights = [58, 94, 126, 94, 58]
    const platformW = 128
    for (let i = 0; i < heights.length; i++) {
      const px = routeStart + i * (platformW + 24)
      if (px + platformW > routeEnd) break
      const py = roadAt(px + platformW / 2) - heights[i]
      addPlatform(run, 'footbridge', px, platformW, py)
      for (let coinX = px + 25; coinX < px + platformW - 10; coinX += 40) addCoin(run, coinX, py - 32)
    }
  } else if (
    routeEnd - routeStart > 620 &&
    !hasBirdOnSegment &&
    difficulty > 0.18 &&
    zone !== 'shopping' &&
    routeRoll < 0.38
  ) {
    const count = 3
    const platformW = 180
    for (let i = 0; i < count; i++) {
      const px = routeStart + i * (platformW + 38)
      if (px + platformW > routeEnd) break
      const lift = 82 + i * 20
      const py = roadAt(px + platformW / 2) - lift
      addPlatform(run, 'branch', px, platformW, py)
      for (let coinX = px + 28; coinX < px + platformW - 12; coinX += 42) addCoin(run, coinX, py - 34)
    }
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
      platformId: null,
      rampRoute: false,
      rampLaunchActive: false,
      airJumpUsed: false,
      airTime: 0,
    },
    traits: { ...DEFAULT_RIDER_TRAITS, effects: [...DEFAULT_RIDER_TRAITS.effects] },
    startX,
    distance: 0,
    speed: speedAt(0),
    elapsed: 0,
    coinsTaken: 0,
    coinScore: 0,
    combo: 0,
    maxCombo: 0,
    comboTimer: 0,
    airBonuses: 0,
    events: [],
    segments: [first],
    platforms: [],
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
  if (obstacle.kind === 'ramp' || !obstacleActive(run, obstacle)) return false
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
  run.platforms = run.platforms.filter((p) => p.x + p.w >= cutoff)
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
    const oldRoadSurface = surfaceAt(run, oldX)
    const oldPlatform = platformAt(run, p.platformId, oldX)
    const oldSurface = oldPlatform?.y ?? oldRoadSurface
    const weatherTransition = effectiveWeatherTransitionFor(run)
    const rainStrength = weatherStrength(weatherTransition, 'rain')
    const windStrength = weatherStrength(weatherTransition, 'wind')

    if (first && input.jumpPressed) {
      if (p.grounded) {
        const wetTakeoff = 1 - 0.1 * (1 - run.traits.rainGrip) * rainStrength
        p.vy = -JUMP_V * run.traits.jumpMul * wetTakeoff
        p.grounded = false
        p.platformId = null
        p.rampLaunchActive = false
        p.airTime = 0
        event(run, 'jump')
      } else if (!p.airJumpUsed && !p.rampLaunchActive) {
        // 上昇中に早押ししても速度を弱めず、必ず追加の上向き加速を与える。
        // 下降中は最低限の空中ジャンプ速度まで戻し、早押し時だけ過剰に
        // 加速しないよう通常ジャンプの1.35倍で上限を設ける。
        // 強風時は車体が風を受けるぶん、2段目で大きく浮き直せる。
        // 向かい風で横移動が遅くなる大穴も、この揚力を使えば越えられる。
        const windLift = 1 + 0.1 * (1 - run.traits.windResist) * windStrength
        const airJumpV = AIR_JUMP_V * run.traits.airJumpMul * windLift
        p.vy = Math.max(
          -JUMP_V * run.traits.jumpMul * 1.35,
          Math.min(p.vy - airJumpV * 0.56, -airJumpV),
        )
        p.rampLaunchActive = false
        p.airJumpUsed = true
        event(run, 'airjump')
      }
    }
    if (
      !p.grounded &&
      !p.rampLaunchActive &&
      !input.jumpHeld &&
      p.vy < -JUMP_CUT_V
    ) {
      p.vy = -JUMP_CUT_V
    }
    p.x += motionSpeedFor(run) * h
    run.distance = Math.max(0, p.x - run.startX)
    run.speed = speedAt(run.distance)
    run.elapsed += h
    if (run.combo > 0) {
      run.comboTimer -= h
      if (run.comboTimer <= 0) {
        run.combo = 0
        run.comboTimer = 0
      }
    }
    ensureAhead(run, p.x + GENERATE_AHEAD)

    const continuedPlatform = platformAt(run, p.platformId, p.x)
    const newSurface = p.platformId == null ? surfaceAt(run, p.x) : continuedPlatform?.y ?? null
    if (p.grounded) {
      if (newSurface == null) {
        p.grounded = false
        p.platformId = null
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
      if (windStrength > 0) {
        const gust = Math.sin((run.elapsed + (run.seed % 11)) * 4.5)
        p.vy += gust * 180 * (1 - run.traits.windResist) * windStrength * h
      }
      p.y += p.vy * h
      p.airTime += h
      // 上り坂では路面もフレーム間で上へ動くため、直前位置は直前の路面と
      // 比較する。現在路面だけとの比較では交差瞬間を取り逃がすことがある。
      const landing = p.vy >= 0
        ? landingSurfaceAt(run, p.x, prevY, p.y, oldRoadSurface)
        : null
      if (landing) {
        p.y = landing.y
        p.vy = 0
        p.grounded = true
        p.platformId = landing.platformId
        if (landing.platformId == null) p.rampRoute = false
        p.rampLaunchActive = false
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
      if (o.vx) {
        // 鳥は前方で滞空せず、そのまま自転車の方向へ飛び抜ける。
        if (o.kind === 'bird') {
          // 生成直後の画面外から動かすと、着地用の安全帯へ入り込んでしまう。
          // 前方に見えてから動き出し、約0.6秒の予告を保ったまま接近させる。
          if (o.x - p.x <= 650) o.x += o.vx * h
        } else {
          const phase = commuteClockAt(run.elapsed, run.seed).phase
          const rushMul =
            phase === 'eveningRush'
              ? 1.5
              : phase === 'morningRush'
                ? 1.3
                : phase === 'lunch'
                  ? 1.15
                  : 1
          const maxDrift =
            run.speed *
            (phase === 'eveningRush'
              ? 0.28
              : phase === 'morningRush'
                ? 0.22
                : phase === 'lunch'
                  ? 0.2
                  : 0.18)
          const nextX = o.x + o.vx * rushMul * h
          o.x = Math.max((o.originX ?? o.x) - maxDrift, nextX)
        }
      }
      if (o.kind !== 'ramp' || o.used) continue
      const overX = p.x + PLAYER_W / 2 > o.x && p.x - PLAYER_W / 2 < o.x + o.w
      if (overX && p.y >= o.y && p.y <= o.y + o.h + 8 && p.vy >= 0) {
        o.used = true
        p.y = o.y
        p.vy = -RAMP_V
        p.grounded = false
        p.rampRoute = true
        p.rampLaunchActive = true
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
      const targetY = p.y - PLAYER_H * 0.55
      let dx = p.x - coin.x
      let dy = targetY - coin.y
      let distance = Math.hypot(dx, dy)
      if (
        run.traits.coinRadius > COIN_RADIUS &&
        (coin.magnetized || distance <= run.traits.coinRadius)
      ) {
        coin.magnetized = true
        const pull = Math.min(distance, 980 * h)
        if (distance > 0) {
          coin.x += (dx / distance) * pull
          coin.y += (dy / distance) * pull
        }
        dx = p.x - coin.x
        dy = targetY - coin.y
        distance = Math.hypot(dx, dy)
      }
      if (distance <= COIN_RADIUS) {
        coin.taken = true
        run.coinsTaken++
        run.combo++
        run.maxCombo = Math.max(run.maxCombo, run.combo)
        run.comboTimer = COMBO_TIMEOUT + run.traits.comboBonus
        const lunchBonus = commuteClockAt(run.elapsed, run.seed).phase === 'lunch' ? 2 : 1
        const zoneBonus = zoneProfileAt(zoneAt(run.distance, run.seed)).coinMultiplier
        const points =
          10 * Math.min(4, 1 + Math.floor(run.combo / 5)) * lunchBonus * zoneBonus
        run.coinScore += points
        event(run, 'coin', points)
        if (run.combo > 1) event(run, 'combo', run.combo)
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
  return metersOf(run) + run.coinScore + run.airBonuses * 30
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
