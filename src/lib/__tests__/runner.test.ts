import { describe, expect, it } from 'vitest'
import {
  applyGate,
  applyObstacle,
  betterLane,
  CROWD_MAX,
  distanceToScore,
  generateSegment,
  hasSurvivableChoice,
  isGainGate,
  lossChance,
  segmentEvents,
  SEGMENT_M,
  simulateGreedyBot,
  speedAt,
  trainChance,
  type Gate,
} from '../runner'

// ----------------------------------------------------------------------------
// applyGate: 各効果と clamp 境界
// ----------------------------------------------------------------------------
describe('applyGate', () => {
  it('+n は加算する', () => {
    expect(applyGate(10, { op: 'add', value: 5 })).toBe(15)
    expect(applyGate(1, { op: 'add', value: 20 })).toBe(21)
  })

  it('×2 は倍にする（floor）', () => {
    expect(applyGate(10, { op: 'mul', value: 2 })).toBe(20)
    expect(applyGate(1, { op: 'mul', value: 2 })).toBe(2)
    expect(applyGate(7, { op: 'mul', value: 2 })).toBe(14)
  })

  it('−n は減算する', () => {
    expect(applyGate(10, { op: 'sub', value: 3 })).toBe(7)
    expect(applyGate(10, { op: 'sub', value: 10 })).toBe(0)
  })

  it('÷2 は半分にする（floor）', () => {
    expect(applyGate(10, { op: 'div', value: 2 })).toBe(5)
    expect(applyGate(7, { op: 'div', value: 2 })).toBe(3) // floor(3.5)
    expect(applyGate(1, { op: 'div', value: 2 })).toBe(0) // floor(0.5)
  })

  it('下限 0 でクランプされる（マイナスにならない）', () => {
    expect(applyGate(3, { op: 'sub', value: 20 })).toBe(0)
    expect(applyGate(0, { op: 'div', value: 2 })).toBe(0)
  })

  it('上限 9999 でクランプされる', () => {
    expect(applyGate(9000, { op: 'add', value: 20 })).toBe(9020)
    expect(applyGate(9000, { op: 'mul', value: 2 })).toBe(CROWD_MAX)
    expect(applyGate(CROWD_MAX, { op: 'add', value: 20 })).toBe(CROWD_MAX)
  })
})

describe('isGainGate', () => {
  it('add と mul は増加ゲート、sub と div は減少ゲート', () => {
    expect(isGainGate({ op: 'add', value: 3 })).toBe(true)
    expect(isGainGate({ op: 'mul', value: 2 })).toBe(true)
    expect(isGainGate({ op: 'sub', value: 3 })).toBe(false)
    expect(isGainGate({ op: 'div', value: 2 })).toBe(false)
  })
})

describe('betterLane', () => {
  it('結果人数が多い方のレーンを返す', () => {
    const plus: Gate = { op: 'add', value: 10 }
    const minus: Gate = { op: 'sub', value: 5 }
    expect(betterLane(plus, minus, 10)).toBe(0)
    expect(betterLane(minus, plus, 10)).toBe(1)
  })

  it('同点なら上レーン（0）を選ぶ', () => {
    const g: Gate = { op: 'add', value: 5 }
    expect(betterLane(g, { ...g }, 10)).toBe(0)
  })
})

// ----------------------------------------------------------------------------
// applyObstacle
// ----------------------------------------------------------------------------
describe('applyObstacle', () => {
  it('満員電車は30%減（×0.7・floor）', () => {
    expect(applyObstacle(100, 'train')).toBe(70)
    expect(applyObstacle(10, 'train')).toBe(7)
    expect(applyObstacle(1, 'train')).toBe(0) // floor(0.7)
  })

  it('水たまりは10%減（×0.9・floor）', () => {
    expect(applyObstacle(100, 'puddle')).toBe(90)
    expect(applyObstacle(10, 'puddle')).toBe(9)
  })
})

// ----------------------------------------------------------------------------
// generateSegment: 決定性
// ----------------------------------------------------------------------------
describe('generateSegment の決定性', () => {
  it('同じ seed・index なら常に同じセグメントを返す', () => {
    for (const seed of [0, 1, 42, 9999]) {
      for (const i of [0, 1, 5, 20, 99]) {
        expect(generateSegment(seed, i)).toEqual(generateSegment(seed, i))
      }
    }
  })

  it('seed が違えば（多くの場合）違う結果になる', () => {
    const a = Array.from({ length: 30 }, (_, i) => JSON.stringify(generateSegment(1, i)))
    const b = Array.from({ length: 30 }, (_, i) => JSON.stringify(generateSegment(2, i)))
    const same = a.filter((x, i) => x === b[i]).length
    expect(same).toBeLessThan(a.length) // 全部一致はしない
  })

  it('segmentEvents は距離昇順で、ゲートと障害物が重ならない', () => {
    for (let i = 0; i < 40; i++) {
      const events = segmentEvents(7, i)
      for (let k = 1; k < events.length; k++) {
        expect(events[k].dist).toBeGreaterThanOrEqual(events[k - 1].dist)
      }
      const gate = events.find((e) => e.kind === 'gate')!
      const base = i * SEGMENT_M
      for (const e of events) {
        if (e.kind === 'obstacle') {
          // 障害物はゲート位置から十分離れている（重ならない）
          expect(Math.abs(e.dist - gate.dist)).toBeGreaterThan(10)
          expect(e.dist).toBeGreaterThanOrEqual(base)
          expect(e.dist).toBeLessThan(base + SEGMENT_M)
        }
      }
    }
  })
})

// ----------------------------------------------------------------------------
// generateSegment: 即死しない選択肢が常に存在する
// ----------------------------------------------------------------------------
describe('ゲート対には即死しない選択肢が常に存在する', () => {
  // expect() を70万回呼ぶとCIの遅いマシンで5秒を超えるため、違反だけ集めて最後に1回検証する
  it('群れが2人以上なら、どのゲート対にも1人以上残せる選択肢がある', { timeout: 15000 }, () => {
    const violations: string[] = []
    for (let seed = 0; seed < 300; seed++) {
      for (let i = 0; i < 60; i++) {
        const seg = generateSegment(seed, i)
        for (let count = 2; count <= 40; count++) {
          if (!hasSurvivableChoice(seg.top, seg.bottom, count)) {
            violations.push(`seed=${seed} index=${i} count=${count}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('序盤（index<3）はマイナスゲートが出ないので1人でも安全', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (let i = 0; i < 3; i++) {
        const seg = generateSegment(seed, i)
        expect(isGainGate(seg.top)).toBe(true)
        expect(isGainGate(seg.bottom)).toBe(true)
        expect(hasSurvivableChoice(seg.top, seg.bottom, 1)).toBe(true)
      }
    }
  })

  it('両方マイナスのゲート対も出現する（難易度の演出）', () => {
    let bothMinus = 0
    for (let seed = 0; seed < 200; seed++) {
      for (let i = 0; i < 60; i++) {
        const seg = generateSegment(seed, i)
        if (!isGainGate(seg.top) && !isGainGate(seg.bottom)) bothMinus++
      }
    }
    expect(bothMinus).toBeGreaterThan(0)
  })
})

// ----------------------------------------------------------------------------
// 難易度曲線
// ----------------------------------------------------------------------------
describe('難易度曲線は単調非減少', () => {
  it('lossChance は index が進むほど増える（頭打ちあり）', () => {
    for (let i = 1; i < 60; i++) {
      expect(lossChance(i)).toBeGreaterThanOrEqual(lossChance(i - 1))
    }
    expect(lossChance(0)).toBe(0)
    expect(lossChance(100)).toBeLessThanOrEqual(0.45)
  })

  it('trainChance は index が進むほど増える（頭打ちあり）', () => {
    for (let i = 1; i < 60; i++) {
      expect(trainChance(i)).toBeGreaterThanOrEqual(trainChance(i - 1))
    }
    expect(trainChance(100)).toBeLessThanOrEqual(0.5)
  })
})

// ----------------------------------------------------------------------------
// スコア・速度
// ----------------------------------------------------------------------------
describe('スコアと速度', () => {
  it('distanceToScore は距離の整数化', () => {
    expect(distanceToScore(0)).toBe(0)
    expect(distanceToScore(123.9)).toBe(123)
    expect(distanceToScore(-5)).toBe(0)
  })

  it('speedAt は距離とともに単調増加する', () => {
    for (let d = 100; d <= 3000; d += 100) {
      expect(speedAt(d)).toBeGreaterThan(speedAt(d - 100))
    }
  })
})

// ----------------------------------------------------------------------------
// プレイアビリティ（platform.playability の文化を踏襲）
// 「常に期待値の高い方のゲートを選ぶ bot」がシード10種で最低2000m生存できること
// ----------------------------------------------------------------------------
describe('プレイアビリティ: 貪欲botが2000m生存できる', () => {
  const SEEDS = [1, 2, 3, 7, 11, 42, 99, 123, 777, 2024]
  for (const seed of SEEDS) {
    it(`seed ${seed} で 2000m 到達`, () => {
      const r = simulateGreedyBot(seed, 2000)
      expect(r.survived).toBe(true)
      expect(r.distance).toBeGreaterThanOrEqual(2000)
      expect(r.finalCount).toBeGreaterThan(0)
    })
  }
})
