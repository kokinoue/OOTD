import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AIR_JUMP_V,
  BEST_KEY,
  JUMP_V,
  RAMP_V,
  ROAD_Y,
  STEP_H,
  WALL_TOL,
  createRun,
  ensureAhead,
  loadBest,
  maxGapFor,
  metersOf,
  minObstacleSpacing,
  saveBest,
  scoreOf,
  speedAt,
  step,
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
  segments: run.segments.map(({ x, w, y, gapBefore }) => [x, w, y, gapBefore]),
  obstacles: run.obstacles.map(({ kind, x, y, cluster }) => [kind, x, y, cluster]),
  coins: run.coins.map(({ x, y }) => [x, y]),
})

describe('チャリ通のコース生成', () => {
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
      if (s.gapBefore > 0) expect(s.gapBefore).toBeLessThanOrEqual(maxGapFor(speedAt(s.x - run.startX)))
    }
  })

  it('段差は穴を伴うときだけで、上りは44px以下になる', () => {
    const run = createRun(99)
    ensureAhead(run, 100_000)
    for (let i = 1; i < run.segments.length; i++) {
      const prev = run.segments[i - 1]
      const cur = run.segments[i]
      if (cur.y !== prev.y) expect(cur.gapBefore).toBeGreaterThan(0)
      expect(prev.y - cur.y).toBeLessThanOrEqual(STEP_H)
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
    step(run, { jumpPressed: true, jumpHeld: true, diveHeld: false }, 1 / 60)
    expect(run.events.some((e) => e.kind === 'airjump')).toBe(true)
    expect(run.player.vy).toBeGreaterThan(-AIR_JUMP_V)
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
})

describe('チャリ通のスコアと保存', () => {
  beforeEach(() => localStorage.clear())

  it('距離・コイン・エアボーナスを合算する', () => {
    const run = createRun(8)
    run.distance = 30 * 123 + 29
    run.coinsTaken = 4
    run.airBonuses = 2
    expect(metersOf(run)).toBe(123)
    expect(scoreOf(run)).toBe(223)
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
