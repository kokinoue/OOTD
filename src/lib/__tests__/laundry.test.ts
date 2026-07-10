import { describe, expect, it } from 'vitest'
import {
  checkRackHit,
  comboMultiplier,
  computeLaunchVelocity,
  LAUNCH_SCALE,
  levelForCatches,
  MAX_LAUNCH_SPEED,
  movingRackCount,
  scoreForCatch,
  trajectory,
  type Point,
  type Rect,
} from '../laundry'

describe('trajectory', () => {
  it('頂点では上昇と下降が対称になる（vy=0相当）', () => {
    const v0 = { vx: 120, vy: 500 }
    const g = 1000
    const tApex = v0.vy / g // dy/dt = vy - g*t = 0 の時刻
    const d = 0.05
    const before = trajectory(v0, g, tApex - d).y
    const after = trajectory(v0, g, tApex + d).y
    const atApex = trajectory(v0, g, tApex).y
    expect(before).toBeCloseTo(after, 6)
    expect(atApex).toBeGreaterThan(before)
    expect(atApex).toBeGreaterThan(after)
  })

  it('x成分は時間に対して線形（等速）', () => {
    const v0 = { vx: 80, vy: 300 }
    const g = 900
    const a = trajectory(v0, g, 0.2)
    const b = trajectory(v0, g, 0.4)
    expect(b.x).toBeCloseTo(a.x * 2, 6)
  })

  it('t=0 では発射点そのもの（原点）', () => {
    const p = trajectory({ vx: 50, vy: 50 }, 500, 0)
    expect(p).toEqual({ x: 0, y: 0 })
  })
})

describe('computeLaunchVelocity', () => {
  it('ゼロベクトル入力は速度ゼロを返す', () => {
    expect(computeLaunchVelocity({ x: 0, y: 0 })).toEqual({ vx: 0, vy: 0 })
  })

  it('小さいドラッグは LAUNCH_SCALE 倍そのまま（clampなし）', () => {
    const v = computeLaunchVelocity({ x: 10, y: -20 })
    expect(v.vx).toBeCloseTo(10 * LAUNCH_SCALE, 6)
    expect(v.vy).toBeCloseTo(20 * LAUNCH_SCALE, 6) // 上方向のドラッグ(dy<0) → vy>0
  })

  it('上方向へのドラッグは正のvyになる（画面下方向が正、投げるのは上）', () => {
    const v = computeLaunchVelocity({ x: 0, y: -100 })
    expect(v.vy).toBeGreaterThan(0)
  })

  it('大きいドラッグは最大初速でclampされる（境界: ちょうどMAXなら等倍）', () => {
    const dist = MAX_LAUNCH_SPEED / LAUNCH_SCALE // ちょうどclamp境界になる大きさ
    const v = computeLaunchVelocity({ x: dist, y: 0 })
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(MAX_LAUNCH_SPEED, 4)
  })

  it('大きいドラッグはclampされても方向（角度）は保たれる', () => {
    const raw = { x: 800, y: -500 }
    const v = computeLaunchVelocity(raw)
    const speed = Math.hypot(v.vx, v.vy)
    expect(speed).toBeCloseTo(MAX_LAUNCH_SPEED, 4)
    // clamp前の角度と一致するか（vyはdyの符号反転のみ）
    const rawAngle = Math.atan2(-raw.y, raw.x)
    const gotAngle = Math.atan2(v.vy, v.vx)
    expect(gotAngle).toBeCloseTo(rawAngle, 6)
  })
})

describe('checkRackHit', () => {
  const rack: Rect = { x: 100, y: 100, w: 60, h: 20 } // x:100-160, y:100-120

  it('矩形を通過する線分はヒット', () => {
    const prev: Point = { x: 130, y: 60 }
    const pos: Point = { x: 130, y: 140 }
    expect(checkRackHit(pos, prev, rack)).toBe(true)
  })

  it('矩形から外れた線分はヒットしない', () => {
    const prev: Point = { x: 0, y: 60 }
    const pos: Point = { x: 0, y: 140 }
    expect(checkRackHit(pos, prev, rack)).toBe(false)
  })

  it('境界ちょうど（矩形の端）はヒット扱い', () => {
    const prev: Point = { x: 100, y: 90 }
    const pos: Point = { x: 100, y: 110 } // x=100 は左端ちょうど、yは帯を通過
    expect(checkRackHit(pos, prev, rack)).toBe(true)
  })

  it('高速移動で1フレームに帯を跨いでも検知できる（すり抜け防止）', () => {
    // pos自体はラックのはるか下（帯の外）だが、prev→posの線分は帯を通過している
    const prev: Point = { x: 130, y: 20 }
    const pos: Point = { x: 130, y: 500 }
    expect(checkRackHit(pos, prev, rack)).toBe(true)
    // 素朴な「posが矩形内か」だけの判定なら見逃すケースであることの確認
    const naivePointCheck =
      pos.x >= rack.x && pos.x <= rack.x + rack.w && pos.y >= rack.y && pos.y <= rack.y + rack.h
    expect(naivePointCheck).toBe(false)
  })

  it('横方向にすり抜けるケース（yは範囲内だがxが帯の外を通過）は検知しない', () => {
    const prev: Point = { x: 0, y: 110 }
    const pos: Point = { x: 50, y: 110 } // xは0→50でラック(100-160)に届かない
    expect(checkRackHit(pos, prev, rack)).toBe(false)
  })

  it('始点が既に矩形内にある場合もヒット', () => {
    const prev: Point = { x: 130, y: 110 }
    const pos: Point = { x: 132, y: 111 }
    expect(checkRackHit(pos, prev, rack)).toBe(true)
  })
})

describe('comboMultiplier', () => {
  it('streak 0〜2 は等倍', () => {
    expect(comboMultiplier(0)).toBe(1)
    expect(comboMultiplier(1)).toBe(1)
    expect(comboMultiplier(2)).toBe(1)
  })
  it('streak 3〜5 は ×1.2', () => {
    expect(comboMultiplier(3)).toBe(1.2)
    expect(comboMultiplier(5)).toBe(1.2)
  })
  it('streak 6〜9 は ×1.5', () => {
    expect(comboMultiplier(6)).toBe(1.5)
    expect(comboMultiplier(9)).toBe(1.5)
  })
  it('streak 10以上は ×2 で上限（それ以上増えない）', () => {
    expect(comboMultiplier(10)).toBe(2)
    expect(comboMultiplier(999)).toBe(2)
  })
  it('負のstreakは0扱い相当（等倍）', () => {
    expect(comboMultiplier(-5)).toBe(1)
  })
})

describe('scoreForCatch', () => {
  it('コンボ倍率を掛けて四捨五入する', () => {
    expect(scoreForCatch(100, 0)).toBe(100)
    expect(scoreForCatch(300, 3)).toBe(360) // 300 * 1.2
    expect(scoreForCatch(200, 6)).toBe(300) // 200 * 1.5
    expect(scoreForCatch(100, 10)).toBe(200) // 100 * 2
  })
})

describe('levelForCatches / movingRackCount', () => {
  it('10着ごとにレベルアップする', () => {
    expect(levelForCatches(0)).toBe(1)
    expect(levelForCatches(9)).toBe(1)
    expect(levelForCatches(10)).toBe(2)
    expect(levelForCatches(19)).toBe(2)
    expect(levelForCatches(20)).toBe(3)
  })
  it('レベル1は移動ラックなし、レベル2以降1本、レベル4以降2本', () => {
    expect(movingRackCount(1)).toBe(0)
    expect(movingRackCount(2)).toBe(1)
    expect(movingRackCount(3)).toBe(1)
    expect(movingRackCount(4)).toBe(2)
    expect(movingRackCount(10)).toBe(2)
  })
})
