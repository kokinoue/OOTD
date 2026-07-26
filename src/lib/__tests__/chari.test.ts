import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEST_KEY,
  COIN_RADIUS,
  COMBO_TIMEOUT,
  DEFAULT_RIDER_TRAITS,
  GRAV,
  JUMP_V,
  PLAYER_H,
  RAMP_V,
  ROAD_Y,
  SLOPE_MAX_H,
  STEP_H,
  WALL_TOL,
  createRun,
  commuteClockAt,
  deriveRiderTraits,
  ensureAhead,
  loadBest,
  maxAirGapFor,
  maxGapFor,
  metersOf,
  minObstacleSpacing,
  nextZoneInfo,
  obstacleActive,
  saveBest,
  scoreOf,
  speedAt,
  step,
  surfaceAt,
  weatherAt,
  zoneAt,
  type Run,
} from '../chari'

const idle = { jumpPressed: false, jumpHeld: false, diveHeld: false }
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  clear: () => storage.clear(),
})
const snapshot = (run: Run) => ({
  segments: run.segments.map(({ x, w, y, endY, gapBefore, airGap }) => [
    x,
    w,
    y,
    endY,
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
      const speed = speedAt(s.x - run.startX)
      expect(s.gapBefore).toBeLessThanOrEqual(s.airGap ? maxAirGapFor(speed) : maxGapFor(speed))
    }
  })

  it('二段ジャンプ専用の大穴は単発ジャンプの理論到達距離を超える', () => {
    const run = createRun(2027)
    ensureAhead(run, 100_000)
    const airGaps = run.segments.filter((s) => s.airGap)
    expect(airGaps.length).toBeGreaterThan(0)
    for (const s of airGaps) {
      const speed = speedAt(s.x - run.startX)
      expect(s.gapBefore).toBeGreaterThan((speed * 2 * JUMP_V) / GRAV)
      expect(s.gapBefore).toBeLessThanOrEqual(maxAirGapFor(speed))
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
    for (const s of slopes) {
      const endY = s.endY ?? s.y
      expect(Math.abs(endY - s.y)).toBeLessThanOrEqual(SLOPE_MAX_H)
      expect(surfaceAt(run, s.x + s.w / 2)).toBeCloseTo((s.y + endY) / 2, 5)
    }
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

  it('長距離コースに低空の鳥が生成される', () => {
    const run = createRun(777)
    ensureAhead(run, 100_000)
    expect(run.obstacles.some((o) => o.kind === 'bird')).toBe(true)
  })

  it('長距離コースに二段ジャンプ用の配送トラックが生成される', () => {
    const run = createRun(778)
    ensureAhead(run, 100_000)
    expect(run.obstacles.some((o) => o.kind === 'truck')).toBe(true)
  })

  it('信号・通勤者・踏切と、分岐・連続屋根ルートを生成する', () => {
    const kinds = new Set<string>()
    let hasBranch = false
    let hasRoofChain = false
    for (let seed = 1; seed <= 12; seed++) {
      const run = createRun(seed)
      ensureAhead(run, 180_000)
      run.obstacles.forEach((o) => kinds.add(o.kind))
      hasBranch ||= run.platforms.some((p) => p.kind === 'branch')
      const roofs = run.platforms.filter((p) => p.kind === 'roof').sort((a, b) => a.x - b.x)
      hasRoofChain ||= roofs.some((p, i) => i > 0 && p.x - (roofs[i - 1].x + roofs[i - 1].w) < 80)
    }
    expect(kinds.has('signal')).toBe(true)
    expect(kinds.has('commuter')).toBe(true)
    expect(kinds.has('crossing')).toBe(true)
    expect(hasBranch).toBe(true)
    expect(hasRoofChain).toBe(true)
  })

  it('住宅街・商店街・工事区間・河川敷・夜間を順番に巡回する', () => {
    expect([0, 9000, 18000, 27000, 36000, 45000].map(zoneAt)).toEqual([
      'residential',
      'shopping',
      'construction',
      'riverside',
      'night',
      'residential',
    ])
  })

  it('晴れ・雨・強風・霧が距離に応じて切り替わる', () => {
    expect(new Set([0, 6000, 12000, 18000].map((d) => weatherAt(d, 0)))).toEqual(
      new Set(['clear', 'rain', 'wind', 'fog']),
    )
  })

  it('通勤時刻が距離で進み、早朝・ラッシュ・遅刻帯へ切り替わる', () => {
    expect(commuteClockAt(0)).toMatchObject({ label: '07:20', phase: 'early' })
    expect(commuteClockAt(12_000)).toMatchObject({ label: '08:00', phase: 'rush' })
    expect(commuteClockAt(25_500)).toMatchObject({ label: '08:45', phase: 'late' })
  })

  it('次のエリアと境界までの距離を返す', () => {
    expect(nextZoneInfo(8_100)).toEqual({ zone: 'shopping', distance: 900 })
    expect(nextZoneInfo(9_000)).toEqual({ zone: 'construction', distance: 9000 })
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
})

describe('チャリ通の物理', () => {
  it('ジャンプを離すと最高到達点が低くなる', () => {
    const held = createRun(1)
    const cut = createRun(1)
    let heldTop = ROAD_Y
    let cutTop = ROAD_Y
    for (let i = 0; i < 60; i++) {
      step(held, { jumpPressed: i === 0, jumpHeld: true, diveHeld: false }, 1 / 120)
      step(cut, { jumpPressed: i === 0, jumpHeld: i < 2, diveHeld: false }, 1 / 120)
      heldTop = Math.min(heldTop, held.player.y)
      cutTop = Math.min(cutTop, cut.player.y)
    }
    expect(heldTop).toBeLessThan(cutTop - 45)
  })

  it('空中ジャンプは1回だけ使える', () => {
    const run = createRun(2)
    step(run, { jumpPressed: true, jumpHeld: true, diveHeld: false }, 1 / 60)
    expect(run.player.vy).toBeGreaterThan(-JUMP_V)
    const beforeAirJump = run.player.vy
    step(run, { jumpPressed: true, jumpHeld: true, diveHeld: false }, 1 / 60)
    expect(run.events.some((e) => e.kind === 'airjump')).toBe(true)
    expect(run.player.vy).toBeLessThan(beforeAirJump)
    expect(run.player.vy).toBeGreaterThanOrEqual(-JUMP_V * 1.35)
    const before = run.player.vy
    step(run, { jumpPressed: true, jumpHeld: true, diveHeld: false }, 1 / 60)
    expect(run.events.some((e) => e.kind === 'airjump')).toBe(false)
    expect(run.player.vy).toBeGreaterThan(before)
  })

  it('ジャンプ台は一度だけ打ち上げる', () => {
    const run = createRun(3)
    run.obstacles = [{ id: 999, kind: 'ramp', x: 125, y: ROAD_Y - 18, w: 58, h: 18, cluster: 1, used: false }]
    step(run, idle, 1 / 60)
    expect(run.events.some((e) => e.kind === 'ramp')).toBe(true)
    expect(run.player.vy).toBeGreaterThan(-RAMP_V)
    run.player.y = ROAD_Y
    run.player.vy = 0
    run.player.grounded = true
    step(run, idle, 1 / 60)
    expect(run.events.some((e) => e.kind === 'ramp')).toBe(false)
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
      step(single, { jumpPressed: frame === 0, jumpHeld: true, diveHeld: false }, 1 / 120)
      const useAirJump = !airJumped && !double.player.grounded && double.player.vy > -40
      step(
        double,
        { jumpPressed: frame === 0 || useAirJump, jumpHeld: true, diveHeld: false },
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
      step(run, { jumpPressed: frame === 0, jumpHeld: true, diveHeld: false }, 1 / 120)
      landed = run.player.grounded && run.player.platformId === 900
    }
    expect(landed).toBe(true)
    expect(run.player.y).toBe(ROAD_Y - 88)
  })

  it('信号と踏切は時間で開閉する', () => {
    const run = createRun(57)
    const signal = { id: 1, kind: 'signal' as const, x: 300, y: 326, w: 72, h: 58, cluster: 1, used: false, phase: 0 }
    const crossing = { id: 2, kind: 'crossing' as const, x: 500, y: 326, w: 92, h: 12, cluster: 2, used: false, phase: 0 }
    run.elapsed = 0
    expect(obstacleActive(run, signal)).toBe(true)
    expect(obstacleActive(run, crossing)).toBe(true)
    run.elapsed = 3.3
    expect(obstacleActive(run, signal)).toBe(false)
    expect(obstacleActive(run, crossing)).toBe(false)
    run.distance = 12_000
    run.elapsed = 2.7
    expect(obstacleActive(run, signal)).toBe(true)
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
    const run = createRun(58)
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
