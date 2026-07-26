import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEST_KEY,
  COIN_RADIUS,
  COMBO_TIMEOUT,
  COMMUTE_MINUTE_SECONDS,
  DEFAULT_RIDER_TRAITS,
  GRAV,
  JUMP_V,
  PLAYER_H,
  RAMP_V,
  ROAD_Y,
  SLOPE_MAX_H,
  STEP_H,
  UNDERPASS_DEPTH,
  UNDERPASS_STREET_LIFT,
  WALL_TOL,
  createRun,
  commuteClockAt,
  commuteStartMinute,
  crossingStateAt,
  deriveRiderTraits,
  effectiveWeatherFor,
  ensureAhead,
  isUnderpassAt,
  isNightTimeAt,
  loadBest,
  maxAirGapFor,
  maxGapFor,
  metersOf,
  minimumMotionSpeedAt,
  minObstacleSpacing,
  motionSpeedAt,
  motionSpeedFor,
  nextZoneInfo,
  obstacleActive,
  saveBest,
  scoreOf,
  segmentSurfaceAt,
  signalStateAt,
  slopeSpeedMultiplierFor,
  speedAt,
  step,
  surfaceAt,
  weatherAt,
  weatherStrength,
  weatherTransitionAt,
  zoneAt,
  zoneProfileAt,
  type Run,
} from '../chari'

const idle = { jumpPressed: false, jumpHeld: false }
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  clear: () => storage.clear(),
})
const snapshot = (run: Run) => ({
  segments: run.segments.map(({ x, w, y, endY, curve, gapBefore, airGap }) => [
    x,
    w,
    y,
    endY,
    curve,
    gapBefore,
    airGap,
  ]),
  obstacles: run.obstacles.map(({ kind, x, y, cluster }) => [kind, x, y, cluster]),
  coins: run.coins.map(({ x, y }) => [x, y]),
})

describe('チャリ通のコース生成', () => {
  it('基本走行速度は距離にかかわらず800px/sになる', () => {
    expect(speedAt(0)).toBe(800)
    expect(speedAt(100_000)).toBe(800)
  })

  it('同じシードは同じコース、別シードは別のコースになる', () => {
    const a = createRun(42)
    const b = createRun(42)
    const c = createRun(43)
    ensureAhead(a, 50_000)
    ensureAhead(b, 50_000)
    ensureAhead(c, 50_000)
    expect(snapshot(a)).toEqual(snapshot(b))
    expect(snapshot(a)).not.toEqual(snapshot(c))
  })

  it('穴幅は地点の速度に応じた上限以下になる', () => {
    const run = createRun(10)
    ensureAhead(run, 100_000)
    for (const s of run.segments) {
      if (s.gapBefore <= 0) continue
      const speed = minimumMotionSpeedAt(run, s.x - run.startX)
      expect(s.gapBefore).toBeLessThanOrEqual(s.airGap ? maxAirGapFor(speed) : maxGapFor(speed))
    }
  })

  it('二段ジャンプ専用の大穴は単発ジャンプの理論到達距離を超える', () => {
    // 長い分岐区間を含むため、複数コースから大穴を集めて生成条件を検証する。
    const runs = Array.from({ length: 8 }, (_, index) => createRun(2027 + index))
    for (const run of runs) ensureAhead(run, 100_000)
    const airGaps = runs.flatMap((run) =>
      run.segments.filter((segment) => segment.airGap).map((segment) => ({ run, segment })),
    )
    expect(airGaps.length).toBeGreaterThan(0)
    for (const { run, segment } of airGaps) {
      const speed = minimumMotionSpeedAt(run, segment.x - run.startX)
      expect(segment.gapBefore).toBeGreaterThan((speed * 2 * JUMP_V) / GRAV)
      expect(segment.gapBefore).toBeLessThanOrEqual(maxAirGapFor(speed))
    }
  })

  it('段差は穴を伴うときだけで、上りは44px以下になる', () => {
    const run = createRun(99)
    ensureAhead(run, 100_000)
    for (let i = 1; i < run.segments.length; i++) {
      const prev = run.segments[i - 1]
      const cur = run.segments[i]
      const prevEnd = prev.endY ?? prev.y
      if (cur.y !== prevEnd) expect(cur.gapBefore).toBeGreaterThan(0)
      expect(prevEnd - cur.y).toBeLessThanOrEqual(STEP_H)
    }
  })

  it('上り坂と下り坂を生成し、路面高度が区間内で滑らかに変わる', () => {
    const run = createRun(314)
    ensureAhead(run, 100_000)
    const slopes = run.segments.filter((s) => (s.endY ?? s.y) !== s.y)
    expect(slopes.some((s) => (s.endY ?? s.y) < s.y)).toBe(true)
    expect(slopes.some((s) => (s.endY ?? s.y) > s.y)).toBe(true)
    expect(new Set(slopes.map((s) => Math.round(Math.abs((s.endY ?? s.y) - s.y)))).size)
      .toBeGreaterThan(5)
    expect(new Set(slopes.map((s) => s.curve?.toFixed(2))).size).toBeGreaterThan(5)
    expect(Math.max(...slopes.map((s) => Math.abs((s.endY ?? s.y) - s.y)))).toBeGreaterThan(84)
    for (const s of slopes) {
      const endY = s.endY ?? s.y
      expect(Math.abs(endY - s.y)).toBeLessThanOrEqual(SLOPE_MAX_H)
      expect(surfaceAt(run, s.x + s.w / 2)).toBeCloseTo((s.y + endY) / 2, 5)
      if (Math.abs(endY - s.y) > 10) {
        const quarterY = segmentSurfaceAt(s, s.x + s.w / 4)
        const linearQuarterY = s.y + (endY - s.y) / 4
        expect(Math.abs(quarterY - linearQuarterY)).toBeGreaterThan(1)
      }
    }
  })

  it('上りでは減速し、下りでは加速する', () => {
    const uphill = createRun(10)
    uphill.segments = [{
      id: 1,
      x: -500,
      w: 1200,
      y: ROAD_Y,
      endY: ROAD_Y - 120,
      curve: 1,
      gapBefore: 0,
      entryClear: 0,
      exitClear: 0,
    }]
    uphill.player.x = 100
    uphill.player.y = segmentSurfaceAt(uphill.segments[0], uphill.player.x)
    const flatSpeed = motionSpeedAt(uphill, uphill.distance)
    expect(slopeSpeedMultiplierFor(uphill)).toBeLessThan(1)
    expect(motionSpeedFor(uphill)).toBeLessThan(flatSpeed)

    const downhill = createRun(10)
    downhill.segments = [{
      ...uphill.segments[0],
      y: ROAD_Y - 120,
      endY: ROAD_Y,
    }]
    downhill.player.x = 100
    downhill.player.y = segmentSurfaceAt(downhill.segments[0], downhill.player.x)
    expect(slopeSpeedMultiplierFor(downhill)).toBeGreaterThan(1)
    expect(motionSpeedFor(downhill)).toBeGreaterThan(flatSpeed)
  })

  it('安全帯に障害物を置かず、別クラスタは最低間隔を空ける', () => {
    const run = createRun(2026)
    ensureAhead(run, 100_000)
    for (const s of run.segments) {
      const own = run.obstacles.filter((o) => o.x >= s.x && o.x < s.x + s.w)
      for (const o of own) {
        expect(o.x).toBeGreaterThanOrEqual(s.x + s.entryClear)
        expect(o.x + o.w).toBeLessThanOrEqual(s.x + s.w - s.exitClear + 75)
      }
    }
    const clusters = [...new Map(run.obstacles.map((o) => [o.cluster, o])).values()].sort((a, b) => a.x - b.x)
    for (let i = 1; i < clusters.length; i++) {
      const a = clusters[i - 1]
      const b = clusters[i]
      // 区間境界の安全帯を合算した距離は最低間隔以上になる。
      expect(b.x - a.x).toBeGreaterThanOrEqual(Math.min(180, minObstacleSpacing(speedAt(a.x - run.startX))))
    }
  })

  it('ジャンプが必要な障害物の直後には穴を生成しない', () => {
    const run = createRun(2028)
    ensureAhead(run, 100_000)
    for (const segment of run.segments.filter((item) => item.gapBefore > 0)) {
      const gapStart = segment.x - segment.gapBefore
      const latestObstacleEnd = Math.max(
        ...run.obstacles
          .filter((obstacle) => obstacle.kind !== 'bird' && obstacle.x < gapStart)
          .map((obstacle) => obstacle.x + obstacle.w),
        -Infinity,
      )
      if (latestObstacleEnd > -Infinity) {
        expect(gapStart - latestObstacleEnd)
          .toBeGreaterThanOrEqual(speedAt(gapStart - run.startX) * 1.35 - 1)
      }
    }
  })

  it('長距離コースに低空の鳥が生成される', () => {
    const run = createRun(777)
    ensureAhead(run, 100_000)
    const birds = run.obstacles.filter((obstacle) => obstacle.kind === 'bird')
    expect(birds.length).toBeGreaterThan(0)
    expect(birds.every((bird) => bird.vx === -260 && bird.originX === bird.x)).toBe(true)
  })

  it('鳥は前方で滞空せず自転車へ向かって飛んでくる', () => {
    const run = createRun(0)
    run.obstacles = [{
      id: 1,
      kind: 'bird',
      x: 700,
      y: ROAD_Y - 160,
      w: 42,
      h: 22,
      cluster: 1,
      used: false,
      vx: -260,
      originX: 700,
    }]
    step(run, idle, 0.1)
    expect(run.obstacles[0].x).toBeCloseTo(674)
  })

  it('長距離コースに二段ジャンプ用の配送トラックが生成される', () => {
    const run = createRun(778)
    ensureAhead(run, 100_000)
    expect(run.obstacles.some((o) => o.kind === 'truck')).toBe(true)
  })

  it('信号・通勤者・踏切・スクール障害物と、分岐・屋根・歩道橋・地下道を生成する', () => {
    const kinds = new Set<string>()
    let hasBranch = false
    let hasRoofChain = false
    let hasFootbridge = false
    let hasUnderpass = false
    let hasStreetRoute = false
    let hasRampLinkedRoofs = false
    for (let seed = 1; seed <= 12; seed++) {
      const run = createRun(seed)
      ensureAhead(run, 180_000)
      run.obstacles.forEach((o) => kinds.add(o.kind))
      hasBranch ||= run.platforms.some((p) => p.kind === 'branch')
      hasFootbridge ||= run.platforms.some((p) => p.kind === 'footbridge')
      hasUnderpass ||= run.segments.some((segment) => segment.route === 'underpass')
      hasStreetRoute ||= run.platforms.some((platform) => platform.kind === 'street')
      const roofs = run.platforms.filter((p) => p.kind === 'roof').sort((a, b) => a.x - b.x)
      hasRoofChain ||= run.obstacles.some(
        (obstacle) =>
          obstacle.kind === 'ramp' &&
          roofs.filter(
            (roof) =>
              roof.x > obstacle.x &&
              roof.x < obstacle.x + 2300,
          ).length >= 3,
      )
      if (roofs.length > 0) {
        hasRampLinkedRoofs ||= roofs.every(
          (roof) =>
            roof.requiresRamp === true &&
            run.obstacles.some(
              (obstacle) =>
                obstacle.kind === 'ramp' &&
                obstacle.x < roof.x &&
                roof.x - obstacle.x <= 2300,
            ),
        )
      }
    }
    expect(kinds.has('signal')).toBe(true)
    expect(kinds.has('commuter')).toBe(true)
    expect(kinds.has('crossing')).toBe(true)
    expect(kinds.has('ball')).toBe(true)
    expect(kinds.has('students')).toBe(true)
    expect(hasBranch).toBe(true)
    expect(hasRoofChain).toBe(true)
    expect(hasRampLinkedRoofs).toBe(true)
    expect(hasFootbridge).toBe(true)
    expect(hasUnderpass).toBe(true)
    expect(hasStreetRoute).toBe(true)
  })

  it('エリアはプレイごとのシードでランダムになる', () => {
    const first = Array.from({ length: 12 }, (_, index) => zoneAt(index * 9000, 123))
    const sameSeed = Array.from({ length: 12 }, (_, index) => zoneAt(index * 9000, 123))
    const anotherSeed = Array.from({ length: 12 }, (_, index) => zoneAt(index * 9000, 456))
    expect(first).toEqual(sameSeed)
    expect(first).not.toEqual(anotherSeed)
    expect(new Set(first)).toEqual(
      new Set(['residential', 'shopping', 'construction', 'station', 'school']),
    )
  })

  it('エリアごとにコース生成と報酬の特性が大きく異なる', () => {
    expect(zoneProfileAt('residential').gapChance).toBeLessThan(
      zoneProfileAt('construction').gapChance,
    )
    expect(zoneProfileAt('construction').slopeChance).toBeGreaterThan(0.8)
    expect(zoneProfileAt('shopping').coinMultiplier).toBe(2)
    expect(zoneProfileAt('station').specialRouteChance).toBeGreaterThan(0.5)
    expect(zoneProfileAt('school').specialRouteChance).toBeGreaterThan(0.8)
  })

  it('各エリアは3段階の専用障害物パターンを持つ', () => {
    const signatures = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const run = createRun(seed)
      ensureAhead(run, 200_000)
      for (const segment of run.segments) {
        if (segment.route === 'underpass') continue
        const dist = Math.max(0, segment.x - run.startX)
        const zone = zoneAt(dist, seed)
        const patternStep = Math.min(
          2,
          Math.floor(((dist % 9000) / 9000) * 3),
        )
        const kinds = run.obstacles
          .filter(
            (obstacle) =>
              obstacle.x >= segment.x && obstacle.x < segment.x + segment.w,
          )
          .map((obstacle) => obstacle.kind)
        for (const kind of kinds) signatures.add(`${zone}:${patternStep}:${kind}`)
      }
    }

    for (const signature of [
      'residential:0:signal',
      'residential:1:commuter',
      'residential:2:bird',
      'shopping:0:fence',
      'shopping:1:commuter',
      'shopping:2:ramp',
      'construction:0:pylon',
      'construction:1:pylon',
      'construction:2:truck',
      'station:0:crossing',
      'station:1:commuter',
      'school:0:ball',
      'school:1:students',
      'school:2:students',
    ]) {
      expect(signatures.has(signature), signature).toBe(true)
    }
  })

  it('晴れ・雨・強風・霧が距離に応じて切り替わる', () => {
    expect(new Set([0, 12000, 24000, 36000].map((d) => weatherAt(d, 0)))).toEqual(
      new Set(['clear', 'rain', 'wind', 'fog']),
    )
  })

  it('天候は区間境界から徐々に次の状態へ変化する', () => {
    const start = weatherTransitionAt(12000, 0)
    const middle = weatherTransitionAt(13200, 0)
    const end = weatherTransitionAt(14400, 0)
    expect(start).toEqual({ from: 'clear', to: 'rain', progress: 0 })
    expect(middle).toEqual({ from: 'clear', to: 'rain', progress: 0.5 })
    expect(end).toEqual({ from: 'clear', to: 'rain', progress: 1 })
    expect(weatherStrength(middle, 'clear')).toBe(0.5)
    expect(weatherStrength(middle, 'rain')).toBe(0.5)

    const run = createRun(0)
    expect(motionSpeedAt(run, 12000)).toBeCloseTo(800)
    expect(motionSpeedAt(run, 13200)).toBeCloseTo(844)
    expect(motionSpeedAt(run, 14400)).toBeCloseTo(888)
  })

  it('通勤時刻が一日の時間帯に応じて切り替わる', () => {
    expect(commuteClockAt(0)).toMatchObject({ label: '07:20', phase: 'early' })
    expect(commuteClockAt(15)).toMatchObject({ label: '08:00', phase: 'morningRush' })
    expect(commuteClockAt(31.875)).toMatchObject({ label: '08:45', phase: 'morningRush' })
    expect(commuteClockAt(60)).toMatchObject({ label: '10:00', phase: 'daytime' })
    expect(commuteClockAt(93.75)).toMatchObject({ label: '11:30', phase: 'lunch' })
    expect(commuteClockAt(138.75)).toMatchObject({ label: '13:30', phase: 'afternoon' })
    expect(commuteClockAt(217.5)).toMatchObject({ label: '17:00', phase: 'eveningRush' })
    expect(commuteClockAt(240)).toMatchObject({ label: '18:00', phase: 'eveningRush' })
    expect(commuteClockAt(285)).toMatchObject({ label: '20:00', phase: 'night' })
    expect(isNightTimeAt(240)).toBe(true)
    expect(commuteClockAt(540)).toMatchObject({ label: '07:20', phase: 'early' })
  })

  it('プレイごとに通勤時計の開始時刻が変わり、同じseedでは再現できる', () => {
    const starts = Array.from({ length: 24 }, (_, index) => commuteClockAt(0, index + 1).label)
    expect(new Set(starts).size).toBeGreaterThan(16)
    expect(commuteClockAt(0, 2026)).toEqual(commuteClockAt(0, 2026))
    expect(commuteClockAt(60 * COMMUTE_MINUTE_SECONDS, 2026).minute)
      .toBe((commuteStartMinute(2026) + 60) % 60)
  })

  it('夜間モードとエリアは独立して組み合わせられる', () => {
    const nightElapsed = 240
    const nightDistance = 192_000
    const area = zoneAt(nightDistance, 77)
    expect(['residential', 'shopping', 'construction', 'station', 'school']).toContain(area)
    expect(commuteClockAt(nightElapsed).phase).toBe('eveningRush')
    expect(isNightTimeAt(nightElapsed)).toBe(true)
  })

  it('次のエリアと境界までの距離を返す', () => {
    expect(nextZoneInfo(8_100, 99)).toEqual({ zone: zoneAt(9_000, 99), distance: 900 })
    expect(nextZoneInfo(9_000, 99)).toEqual({ zone: zoneAt(18_000, 99), distance: 9000 })
  })

  it('服のカテゴリ・季節・色から能力差とセット効果を作る', () => {
    const rainSet = deriveRiderTraits('2026-07-10', [
      { category: 'shoes', label: 'スニーカー', color: 'navy' },
      { category: 'jacket', label: 'レインジャケット', color: 'navy' },
      { category: 'bag', label: 'バッグ', color: 'navy' },
      { category: 'pants', label: 'パンツ', color: 'navy' },
      { category: 'hat', label: 'キャップ', color: 'navy' },
    ])
    expect(rainSet.speedMul).toBeGreaterThan(1)
    expect(rainSet.coinRadius).toBeGreaterThan(COIN_RADIUS)
    expect(rainSet.rainGrip).toBeGreaterThanOrEqual(0.7)
    expect(rainSet.windResist).toBeGreaterThanOrEqual(0.6)
    expect(rainSet.comboBonus).toBe(0.5)
    expect(rainSet.effects).toContain('雨支度セット：雨でも安定')
    expect(rainSet.effects).toContain('重ね着セット：強風耐性')

    const light = deriveRiderTraits('2026-05-10', [
      { category: 't-shirt', label: 'Tシャツ' },
      { category: 'shorts', label: 'ショーツ' },
    ])
    expect(light.jumpMul).toBeGreaterThan(1.09)
    expect(light.effects).toContain('軽装セット：ジャンプ強化')
  })

  it('必ず履く靴だけでは速度ボーナスが付かない', () => {
    const shoesOnly = deriveRiderTraits('2026-01-10', [
      { category: 'shoes', label: 'スニーカー' },
    ])
    expect(shoesOnly.speedMul).toBe(1)
    expect(shoesOnly.effects).not.toContain('足まわり：速度+4%')
  })
})

describe('チャリ通の物理', () => {
  it('ジャンプを離すと最高到達点が低くなる', () => {
    const held = createRun(1)
    const cut = createRun(1)
    let heldTop = ROAD_Y
    let cutTop = ROAD_Y
    for (let i = 0; i < 60; i++) {
      step(held, { jumpPressed: i === 0, jumpHeld: true }, 1 / 120)
      step(cut, { jumpPressed: i === 0, jumpHeld: i < 2 }, 1 / 120)
      heldTop = Math.min(heldTop, held.player.y)
      cutTop = Math.min(cutTop, cut.player.y)
    }
    expect(heldTop).toBeLessThan(cutTop - 45)
  })

  it('空中ジャンプは1回だけ使える', () => {
    const run = createRun(2)
    step(run, { jumpPressed: true, jumpHeld: true }, 1 / 60)
    expect(run.player.vy).toBeGreaterThan(-JUMP_V)
    const beforeAirJump = run.player.vy
    step(run, { jumpPressed: true, jumpHeld: true }, 1 / 60)
    expect(run.events.some((e) => e.kind === 'airjump')).toBe(true)
    expect(run.player.vy).toBeLessThan(beforeAirJump)
    expect(run.player.vy).toBeGreaterThanOrEqual(-JUMP_V * 1.35)
    const before = run.player.vy
    step(run, { jumpPressed: true, jumpHeld: true }, 1 / 60)
    expect(run.events.some((e) => e.kind === 'airjump')).toBe(false)
    expect(run.player.vy).toBeGreaterThan(before)
  })

  it('ジャンプ台は一度だけ打ち上げる', () => {
    const run = createRun(3)
    run.obstacles = [{ id: 999, kind: 'ramp', x: 125, y: ROAD_Y - 18, w: 58, h: 18, cluster: 1, used: false }]
    step(run, idle, 1 / 60)
    expect(run.events.some((e) => e.kind === 'ramp')).toBe(true)
    expect(run.player.rampRoute).toBe(true)
    expect(run.player.vy).toBeGreaterThan(-RAMP_V)
    run.player.y = ROAD_Y
    run.player.vy = 0
    run.player.grounded = true
    step(run, idle, 1 / 60)
    expect(run.events.some((e) => e.kind === 'ramp')).toBe(false)
  })

  it('商店街の屋根はジャンプ台を踏んだときだけ着地できる', () => {
    const makeRun = (rampRoute: boolean, rampLaunchActive = false) => {
      const run = createRun(30)
      run.segments = [{ ...run.segments[0], x: -500, w: 2000 }]
      run.platforms = [{
        id: 900,
        kind: 'roof',
        x: 125,
        w: 300,
        y: 300,
        requiresRamp: true,
        requiresRampLaunch: true,
      }]
      run.obstacles = []
      run.coins = []
      run.nextX = 10_000
      run.player.y = 298
      run.player.vy = 250
      run.player.grounded = false
      run.player.rampRoute = rampRoute
      run.player.rampLaunchActive = rampLaunchActive
      return run
    }
    const normalJump = makeRun(false)
    const staleRampRoute = makeRun(true)
    const rampJump = makeRun(true, true)
    step(normalJump, idle, 1 / 30)
    step(staleRampRoute, idle, 1 / 30)
    step(rampJump, idle, 1 / 30)
    expect(normalJump.player.platformId).toBeNull()
    expect(staleRampRoute.player.platformId).toBeNull()
    expect(rampJump.player.platformId).toBe(900)
  })

  it('商店街のジャンプ台は最初の屋根へ着地する軌道になる', () => {
    let selected:
      | { run: ReturnType<typeof createRun>; ramp: NonNullable<ReturnType<typeof createRun>['obstacles'][number]>; roofId: number }
      | undefined
    for (let seed = 1; seed <= 20 && !selected; seed++) {
      const run = createRun(seed)
      ensureAhead(run, 200_000)
      const roof = run.platforms.find((platform) => platform.kind === 'roof')
      const ramp = roof
        ? run.obstacles.find(
            (obstacle) =>
              obstacle.kind === 'ramp' &&
              obstacle.x < roof.x &&
              roof.x - obstacle.x <= 700,
          )
        : undefined
      if (roof && ramp) selected = { run, ramp, roofId: roof.id }
    }
    expect(selected).toBeDefined()
    const { run, ramp, roofId } = selected!
    const selectedRoof = run.platforms.find((platform) => platform.id === roofId)!
    const startX = ramp.x - 24
    run.player.x = startX
    run.player.y = surfaceAt(run, startX)!
    run.player.vy = 0
    run.player.grounded = true
    run.player.platformId = null
    run.player.rampRoute = false
    run.obstacles = [ramp]
    ramp.used = false

    for (
      let frame = 0;
      frame < 180 && run.player.platformId !== roofId;
      frame++
    ) {
      step(run, idle, 1 / 120)
    }
    expect(
      run.player.platformId,
      `ramp=${ramp.used}/${Math.round(ramp.x)}, roof=${Math.round(selectedRoof.x)}-${Math.round(selectedRoof.x + selectedRoof.w)}@${Math.round(selectedRoof.y)}, player=${Math.round(run.player.x)},${Math.round(run.player.y)}, route=${run.player.rampRoute}, status=${run.status}/${run.overReason}`,
    ).toBe(roofId)
  })

  it('柵への正面衝突はcrash、穴への落下はfallになる', () => {
    const crash = createRun(4)
    crash.obstacles = [{ id: 1, kind: 'fence', x: 135, y: ROAD_Y - 48, w: 42, h: 48, cluster: 1, used: false }]
    step(crash, idle, 1 / 10)
    expect(crash.overReason).toBe('crash')

    const fall = createRun(5)
    fall.segments = [{ ...fall.segments[0], x: -500, w: 625 }]
    fall.nextX = 10_000
    for (let i = 0; i < 180 && fall.status === 'playing'; i++) step(fall, idle, 1 / 60)
    expect(fall.overReason).toBe('fall')
  })

  it('鳥は地上なら通過できるが空中では衝突する', () => {
    const underBird = createRun(52)
    underBird.obstacles = [
      { id: 2, kind: 'bird', x: 135, y: ROAD_Y - 160, w: 42, h: 22, cluster: 2, used: false },
    ]
    step(underBird, idle, 1 / 10)
    expect(underBird.status).toBe('playing')

    const intoBird = createRun(53)
    intoBird.player.x = 140
    intoBird.player.y = ROAD_Y - 116
    intoBird.player.grounded = false
    intoBird.obstacles = [
      { id: 3, kind: 'bird', x: 135, y: ROAD_Y - 160, w: 42, h: 22, cluster: 3, used: false },
    ]
    step(intoBird, { ...idle, jumpHeld: true }, 1 / 120)
    expect(intoBird.overReason).toBe('crash')
  })

  it('配送トラックは通常ジャンプでは越えられず二段ジャンプなら越えられる', () => {
    const makeTruckRun = (seed: number) => {
      const run = createRun(seed)
      run.segments = [{ ...run.segments[0], x: -500, w: 2000 }]
      run.obstacles = [
        { id: 4, kind: 'truck', x: 420, y: ROAD_Y - 128, w: 118, h: 128, cluster: 4, used: false },
      ]
      run.coins = []
      run.nextX = 10_000
      return run
    }
    const single = makeTruckRun(54)
    const double = makeTruckRun(55)
    let airJumped = false
    for (let frame = 0; frame < 180; frame++) {
      step(single, { jumpPressed: frame === 0, jumpHeld: true }, 1 / 120)
      const useAirJump = !airJumped && !double.player.grounded && double.player.vy > -40
      step(
        double,
        { jumpPressed: frame === 0 || useAirJump, jumpHeld: true },
        1 / 120,
      )
      if (useAirJump) airJumped = true
    }
    expect(single.overReason).toBe('crash')
    expect(airJumped).toBe(true)
    expect(
      double.status,
      `double: ${double.overReason} at ${Math.round(double.player.x)},${Math.round(double.player.y)}`,
    ).toBe('playing')
    expect(double.player.x).toBeGreaterThan(538)
  })

  it('上ルートの足場へ着地して走れる', () => {
    const run = createRun(56)
    run.segments = [{ ...run.segments[0], x: -500, w: 2000 }]
    run.platforms = [{ id: 900, kind: 'branch', x: 250, w: 300, y: ROAD_Y - 88 }]
    run.obstacles = []
    run.coins = []
    run.nextX = 10_000
    let landed = false
    for (let frame = 0; frame < 180 && !landed; frame++) {
      step(run, { jumpPressed: frame === 0, jumpHeld: true }, 1 / 120)
      landed = run.player.grounded && run.player.platformId === 900
    }
    expect(landed).toBe(true)
    expect(run.player.y).toBe(ROAD_Y - 88)
  })

  it('信号と踏切は時間で開閉する', () => {
    const run = createRun(0)
    const signal = { id: 1, kind: 'signal' as const, x: 300, y: 326, w: 72, h: 58, cluster: 1, used: false, phase: 0 }
    const crossing = { id: 2, kind: 'crossing' as const, x: 500, y: 326, w: 92, h: 12, cluster: 2, used: false, phase: 0 }
    run.elapsed = 0
    expect(obstacleActive(run, signal)).toBe(false)
    expect(obstacleActive(run, crossing)).toBe(true)
    run.elapsed = 0.4
    expect(obstacleActive(run, signal)).toBe(true)
    run.elapsed = 3.3
    expect(obstacleActive(run, signal)).toBe(false)
    expect(obstacleActive(run, crossing)).toBe(false)
    run.elapsed = 19.1
    expect(obstacleActive(run, signal)).toBe(false)
    run.elapsed = 219.1
    expect(obstacleActive(run, signal)).toBe(false)
    run.elapsed = 218.7
    expect(obstacleActive(run, signal)).toBe(true)
  })

  it('信号は黄信号で予告してから車が滑らかに進入・退出する', () => {
    const run = createRun(0)
    const signal = {
      id: 1,
      kind: 'signal' as const,
      x: 300,
      y: 326,
      w: 72,
      h: 58,
      cluster: 1,
      used: false,
      phase: 0,
    }
    run.elapsed = 3.5
    expect(signalStateAt(run, signal).light).toBe('yellow')

    run.elapsed = 0.05
    const entering = signalStateAt(run, signal)
    run.elapsed = 0.4
    const blocked = signalStateAt(run, signal)
    expect(entering.light).toBe('red')
    expect(entering.blockage).toBeLessThan(blocked.blockage)
    expect(obstacleActive(run, signal)).toBe(true)

    run.elapsed = 2.1
    const leaving = signalStateAt(run, signal)
    run.elapsed = 2.4
    const nearlyClear = signalStateAt(run, signal)
    expect(leaving.blockage).toBeGreaterThan(nearlyClear.blockage)
    expect(obstacleActive(run, signal)).toBe(false)
  })

  it('踏切は警告灯のあと徐々に閉まり、徐々に開く', () => {
    const run = createRun(0)
    const crossing = {
      id: 2,
      kind: 'crossing' as const,
      x: 500,
      y: 326,
      w: 92,
      h: 12,
      cluster: 2,
      used: false,
      phase: 0,
    }
    run.elapsed = 3.5
    expect(crossingStateAt(run, crossing)).toMatchObject({
      closure: 0,
      warning: false,
    })

    run.elapsed = 4.2
    const warning = crossingStateAt(run, crossing)
    run.elapsed = 4.6
    const closing = crossingStateAt(run, crossing)
    run.elapsed = 4.9
    const closed = crossingStateAt(run, crossing)
    expect(warning.warning).toBe(true)
    expect(warning.closure).toBeLessThan(closing.closure)
    expect(closing.closure).toBeLessThan(closed.closure)
    expect(obstacleActive(run, crossing)).toBe(true)

    run.elapsed = 2.75
    const opening = crossingStateAt(run, crossing)
    run.elapsed = 3.05
    const nearlyOpen = crossingStateAt(run, crossing)
    expect(opening.closure).toBeGreaterThan(nearlyOpen.closure)
    expect(obstacleActive(run, crossing)).toBe(false)
  })

  it('帰宅ラッシュは出勤ラッシュより通勤者の移動が速い', () => {
    const makeCommuterRun = (elapsed: number) => {
      const run = createRun(0)
      run.elapsed = elapsed
      run.obstacles = [{
        id: 1,
        kind: 'commuter',
        x: 600,
        y: ROAD_Y - 64,
        w: 34,
        h: 64,
        cluster: 1,
        used: false,
        vx: -100,
        originX: 600,
      }]
      return run
    }
    const morning = makeCommuterRun(19)
    const evening = makeCommuterRun(219)
    step(morning, idle, 1 / 120)
    step(evening, idle, 1 / 120)
    expect(evening.obstacles[0].x).toBeLessThan(morning.obstacles[0].x)
  })

  it('雨支度セットは雨天の滑り加速を抑える', () => {
    const slippery = createRun(1)
    const protectedRun = createRun(1)
    slippery.obstacles = []
    protectedRun.obstacles = []
    protectedRun.traits = { ...DEFAULT_RIDER_TRAITS, rainGrip: 0.9, effects: ['雨支度'] }
    step(slippery, idle, 0.1)
    step(protectedRun, idle, 0.1)
    expect(slippery.player.x).toBeGreaterThan(protectedRun.player.x)
  })

  it('雨と追い風・向かい風で走行速度が大きく変わり、服の耐性で緩和される', () => {
    const rain = createRun(1)
    expect(motionSpeedFor(rain)).toBeCloseTo(888)

    const tailwind = createRun(2)
    expect(motionSpeedFor(tailwind)).toBeCloseTo(945)

    const headwind = createRun(1)
    headwind.distance = 15_600
    expect(motionSpeedFor(headwind)).toBeCloseTo(655)
    headwind.traits = { ...DEFAULT_RIDER_TRAITS, windResist: 0.8, effects: ['強風耐性'] }
    expect(motionSpeedFor(headwind)).toBeCloseTo(771)
  })

  it('地下道では現在の天候効果を受けない', () => {
    const run = createRun(1)
    run.segments[0].route = 'underpass'
    run.player.x = run.segments[0].x + run.segments[0].w * 0.9
    run.player.y = segmentSurfaceAt(run.segments[0], run.player.x)
    expect(isUnderpassAt(run)).toBe(true)
    expect(weatherAt(run.distance, run.seed)).toBe('rain')
    expect(effectiveWeatherFor(run)).toBe('clear')
    expect(motionSpeedFor(run)).toBeLessThan(800)

    run.platforms = [{ id: 900, kind: 'street', x: -500, y: ROAD_Y, w: 1200 }]
    run.player.platformId = 900
    run.player.y = ROAD_Y
    expect(isUnderpassAt(run)).toBe(false)
    expect(effectiveWeatherFor(run)).toBe('rain')
  })

  it('地下道と地上ルートのコインは吸引半径より離れている', () => {
    const run = createRun(1)
    const segment = {
      id: 1,
      x: -500,
      w: 1200,
      y: ROAD_Y,
      endY: ROAD_Y,
      gapBefore: 0,
      route: 'underpass' as const,
      entryClear: 0,
      exitClear: 0,
    }
    run.segments = [segment]
    run.nextX = 10_000
    run.player.x = 100
    run.player.y = segmentSurfaceAt(segment, run.player.x)
    run.traits = { ...DEFAULT_RIDER_TRAITS, coinRadius: 120, effects: ['バッグ'] }
    const streetCoinY = ROAD_Y - UNDERPASS_STREET_LIFT - 36
    expect(run.player.y - streetCoinY).toBeGreaterThan(120)
    expect(run.player.y).toBe(ROAD_Y + UNDERPASS_DEPTH)
    run.coins = [{ id: 2, x: run.player.x, y: streetCoinY, taken: false }]
    step(run, idle, 1 / 120)
    expect(run.coins[0].magnetized).not.toBe(true)
    expect(run.coins[0].taken).toBe(false)

    run.platforms = [{
      id: 900,
      kind: 'street',
      x: -500,
      y: ROAD_Y - UNDERPASS_STREET_LIFT,
      w: 1200,
    }]
    run.player.platformId = 900
    run.player.y = ROAD_Y - UNDERPASS_STREET_LIFT
    const tunnelCoinY = ROAD_Y + UNDERPASS_DEPTH - 45
    run.coins = [{ id: 3, x: run.player.x, y: tunnelCoinY, taken: false }]
    step(run, idle, 1 / 120)
    expect(run.coins[0].magnetized).not.toBe(true)
    expect(run.coins[0].taken).toBe(false)
  })

  it('地下道は地上ルートより大幅に多くコインを配置する', () => {
    const run = createRun(91)
    ensureAhead(run, 180_000)
    const underpass = run.segments.find((segment) => segment.route === 'underpass')!
    const street = run.platforms.find(
      (platform) =>
        platform.kind === 'street' &&
        platform.x >= underpass.x &&
        platform.x < underpass.x + underpass.w,
    )!
    const routeCoins = run.coins.filter(
      (coin) => coin.x >= underpass.x && coin.x < underpass.x + underpass.w,
    )
    const streetCoins = routeCoins.filter((coin) => Math.abs(coin.y - (street.y - 36)) < 1)
    const undergroundCoins = routeCoins.filter(
      (coin) => coin.y > street.y + UNDERPASS_STREET_LIFT * 0.6,
    )
    expect(streetCoins).toHaveLength(3)
    expect(undergroundCoins.length).toBeGreaterThan(streetCoins.length * 5)
  })

  it('地下道は長い分岐になり、障害物は地下ルートだけに配置する', () => {
    const run = createRun(91)
    ensureAhead(run, 180_000)
    const underpass = run.segments.find((segment) => segment.route === 'underpass')!
    const street = run.platforms.find(
      (platform) =>
        platform.kind === 'street' &&
        platform.x >= underpass.x &&
        platform.x < underpass.x + underpass.w,
    )!
    const undergroundObstacles = run.obstacles.filter(
      (obstacle) =>
        obstacle.x >= underpass.x && obstacle.x < underpass.x + underpass.w,
    )

    expect(underpass.w).toBeGreaterThanOrEqual(2800)
    expect(street.w).toBeGreaterThan(underpass.w * 0.85)
    expect(undergroundObstacles).toHaveLength(5)
    expect(
      undergroundObstacles.every(
        (obstacle) => obstacle.y > street.y + PLAYER_H,
      ),
    ).toBe(true)
  })

  it('雨は踏み切りを弱め、雨支度はジャンプ力の低下を抑える', () => {
    const slippery = createRun(1)
    const protectedRun = createRun(1)
    slippery.obstacles = []
    protectedRun.obstacles = []
    protectedRun.traits = { ...DEFAULT_RIDER_TRAITS, rainGrip: 0.9, effects: ['雨支度'] }
    const jump = { jumpPressed: true, jumpHeld: true }
    step(slippery, jump, 1 / 120)
    step(protectedRun, jump, 1 / 120)
    expect(slippery.player.vy).toBeGreaterThan(protectedRun.player.vy)
  })

  it('WALL_TOL以下の段差は乗り上げる', () => {
    const run = createRun(6)
    run.segments = [
      { id: 1, x: -500, w: 630, y: ROAD_Y, gapBefore: 0, entryClear: 0, exitClear: 0 },
      { id: 2, x: 130, w: 1000, y: ROAD_Y - WALL_TOL, gapBefore: 0, entryClear: 0, exitClear: 0 },
    ]
    run.nextX = 10_000
    step(run, idle, 1 / 10)
    expect(run.status).toBe('playing')
    expect(run.player.y).toBe(ROAD_Y - WALL_TOL)
  })

  it('コインは一度だけ取得する', () => {
    const run = createRun(7)
    run.coins = [{ id: 1, x: run.player.x + 2, y: run.player.y - 28, taken: false }]
    step(run, idle, 1 / 120)
    expect(run.coinsTaken).toBe(1)
    expect(run.events.some((e) => e.kind === 'coin')).toBe(true)
    step(run, idle, 1 / 120)
    expect(run.coinsTaken).toBe(1)
  })

  it('ランチタイムはコイン得点が2倍になる', () => {
    const candidate = Array.from({ length: 100 }, (_, index) => {
      const seed = index + 1
      const minutesUntilLunch = (11 * 60 + 30 - commuteStartMinute(seed) + 24 * 60) % (24 * 60)
      const elapsed = minutesUntilLunch * COMMUTE_MINUTE_SECONDS
      return { seed, elapsed }
    }).find(({ seed }) => zoneAt(0, seed) !== 'shopping')!
    const { seed, elapsed } = candidate
    const run = createRun(seed)
    run.elapsed = elapsed
    run.obstacles = []
    run.coins = [{ id: 1, x: run.player.x + 2, y: run.player.y - 28, taken: false }]
    step(run, idle, 1 / 120)
    expect(commuteClockAt(run.elapsed, run.seed).phase).toBe('lunch')
    expect(run.coinScore).toBe(20)
  })

  it('商店街はコイン得点が2倍になる', () => {
    const seed = Array.from({ length: 100 }, (_, index) => index + 1)
      .find(
        (candidate) =>
          zoneAt(0, candidate) === 'shopping' &&
          commuteClockAt(0, candidate).phase !== 'lunch',
      )!
    const run = createRun(seed)
    run.obstacles = []
    run.coins = [{ id: 1, x: run.player.x + 2, y: run.player.y - 28, taken: false }]
    step(run, idle, 1 / 120)
    expect(zoneAt(run.distance, run.seed)).toBe('shopping')
    expect(run.coinScore).toBe(20)
  })

  it('バッグ効果のコインは光りながら自転車へ追尾してから取得される', () => {
    const run = createRun(59)
    run.obstacles = []
    run.traits = { ...DEFAULT_RIDER_TRAITS, coinRadius: 120, effects: ['バッグ：コイン吸引'] }
    run.coins = [{
      id: 5,
      x: run.player.x + 100,
      y: run.player.y - PLAYER_H * 0.55,
      taken: false,
    }]
    const startX = run.coins[0].x
    step(run, idle, 1 / 120)
    expect(run.coins[0].magnetized).toBe(true)
    expect(run.coins[0].x).toBeLessThan(startX)
    expect(run.coins[0].taken).toBe(false)
    for (let i = 0; i < 60 && !run.coins[0].taken; i++) step(run, idle, 1 / 120)
    expect(run.coins[0].taken).toBe(true)
    expect(run.coinsTaken).toBe(1)
  })
})

describe('チャリ通のスコアと保存', () => {
  beforeEach(() => localStorage.clear())

  it('距離・コイン・エアボーナスを合算する', () => {
    const run = createRun(8)
    run.distance = 30 * 123 + 29
    run.coinsTaken = 4
    run.coinScore = 40
    run.airBonuses = 2
    expect(metersOf(run)).toBe(123)
    expect(scoreOf(run)).toBe(223)
  })

  it('コインを連続取得するとコンボ倍率が上がり、時間切れでリセットする', () => {
    const run = createRun(0)
    run.segments = [{ ...run.segments[0], x: -500, w: 4000 }]
    run.obstacles = []
    run.coins = Array.from({ length: 5 }, (_, i) => ({
      id: 1000 + i,
      x: run.player.x + 4 + i * 5,
      y: run.player.y - 28,
      taken: false,
    }))
    run.nextX = 10_000
    step(run, idle, 1 / 20)
    expect(run.combo).toBe(5)
    expect(run.maxCombo).toBe(5)
    expect(run.coinScore).toBe(60)
    for (let i = 0; i < Math.ceil((COMBO_TIMEOUT + 0.1) / 0.1); i++) step(run, idle, 0.1)
    expect(run.combo).toBe(0)
  })

  it('ベスト以下では上書きしない', () => {
    saveBest(120)
    saveBest(99)
    expect(loadBest()).toBe(120)
    expect(localStorage.getItem(BEST_KEY)).toBe('120')
    saveBest(121)
    expect(loadBest()).toBe(121)
  })

  it('長距離でも生成配列が増え続けない', () => {
    const run = createRun(123)
    // 衝突を避けて生成・pruneだけを長距離まで進める。
    run.player.y = -1000
    run.player.grounded = false
    for (let i = 0; i < 12_000; i++) {
      step(run, { ...idle, jumpHeld: true }, 1 / 120)
      if (run.status === 'over') {
        run.status = 'playing'
        run.overReason = null
        run.player.y = -1000
        run.player.vy = 0
      }
    }
    expect(run.segments.length).toBeLessThan(12)
    expect(run.obstacles.length).toBeLessThan(30)
    expect(run.coins.length).toBeLessThan(80)
  })
})
