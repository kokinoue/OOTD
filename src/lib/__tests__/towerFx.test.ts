import { describe, expect, it } from 'vitest'
import {
  collapseView,
  easeOutBack,
  heightMeters,
  PHOTO_ASPECT,
  PX_PER_M,
  samplePalette,
  settleNoteHz,
  skyAt,
  smoothRects,
  stackView,
  topOffset,
  trimStillLead,
} from '../towerFx'

describe('towerFx', () => {
  it('人物1体ぶんの高さを 1.7m と数える', () => {
    expect(heightMeters(150)).toBeCloseTo(1.7)
    expect(heightMeters(PX_PER_M * 5)).toBeCloseTo(5)
    expect(heightMeters(-30)).toBe(0)
  })

  it('0m の空は従来の紙色のまま', () => {
    const sky = skyAt(0)
    expect(sky.top).toBe('rgb(241, 238, 227)')
    expect(sky.bottom).toBe('rgb(241, 238, 227)')
    expect(sky.dark).toBe(false)
    expect(sky.night).toBe(0)
  })

  it('高く積むほど夜に近づき、範囲外でも破綻しない', () => {
    expect(skyAt(7).dark).toBe(false)
    expect(skyAt(20).dark).toBe(true)
    expect(skyAt(20).night).toBe(1)
    expect(skyAt(999)).toEqual(skyAt(20))
    expect(skyAt(-5)).toEqual(skyAt(0))
    // キーフレームの境目で色が飛ばない
    expect(skyAt(6.999).top).toBe(skyAt(7).top)
  })

  it('回転したシルエットの最上端を返す', () => {
    const tall = [{ cx: 0, cy: 0, hw: 10, hh: 50 }]
    expect(topOffset(tall, 0)).toBeCloseTo(-50)
    expect(topOffset(tall, Math.PI / 2)).toBeCloseTo(-10)
    // 中心から右にずれた箱は、反時計回りに90°回すと上へ出る
    const arm = [...tall, { cx: 30, cy: 0, hw: 5, hh: 5 }]
    expect(topOffset(arm, -Math.PI / 2)).toBeCloseTo(-35)
    expect(topOffset([], 1)).toBe(0)
  })

  it('不透明な画素だけから上・中・下の色を取る', () => {
    const w = 2
    const h = 3
    const px = new Uint8ClampedArray(w * h * 4)
    const set = (i: number, r: number, g: number, b: number, a: number) => px.set([r, g, b, a], i * 4)
    set(0, 200, 0, 0, 255)
    set(1, 100, 0, 0, 255)
    set(2, 0, 90, 0, 255)
    set(3, 255, 255, 255, 0) // 透明は数えない
    expect(samplePalette(px, w, h)).toEqual(['rgb(150, 0, 0)', 'rgb(0, 90, 0)'])
    expect(samplePalette(new Uint8ClampedArray(16), 2, 2)).toHaveLength(1)
  })

  it('積むたびに音程が上がり、2オクターブ上で頭打ちになる', () => {
    expect(settleNoteHz(1)).toBeCloseTo(261.63)
    expect(settleNoteHz(6)).toBeCloseTo(261.63 * 2)
    for (let n = 1; n < 15; n++) expect(settleNoteHz(n + 1)).toBeGreaterThan(settleNoteHz(n))
    expect(settleNoteHz(16)).toBeCloseTo(settleNoteHz(11))
  })

  it('easeOutBack は 0→1 で少し行き過ぎて戻る', () => {
    expect(easeOutBack(0)).toBeCloseTo(0)
    expect(easeOutBack(1)).toBeCloseTo(1)
    expect(easeOutBack(0.7)).toBeGreaterThan(1)
    expect(easeOutBack(5)).toBeCloseTo(1)
  })

  describe('記念写真の構図', () => {
    const GROUND = 640
    const CENTER = 240

    it('積めた瞬間は台座を下端中央に置き、3:4 で頂上まで入れる', () => {
      const v = stackView(-560, GROUND, CENTER)
      expect(v.w / v.h).toBeCloseTo(PHOTO_ASPECT)
      expect(v.x + v.w / 2).toBeCloseTo(CENTER)
      expect(v.y + v.h).toBe(GROUND + 50)
      expect(v.y).toBe(-610)
    })

    it('低いタワーでも寄りすぎない', () => {
      const v = stackView(GROUND - 150, GROUND, CENTER)
      expect(v.h).toBe(506)
    })

    it('ピースが収まっているうちは、積めた瞬間と同じ構図のまま', () => {
      const base = stackView(-560, GROUND, CENTER)
      const v = collapseView(base, [
        { x: CENTER, y: 500, r: 75 },
        { x: CENTER + 20, y: -400, r: 75 },
      ])
      expect(v).toEqual(base)
    })

    it('横へ崩れたぶんだけ引き、3:4 と元の構図を保つ', () => {
      const base = stackView(-560, GROUND, CENTER)
      const v = collapseView(base, [{ x: base.x + base.w + 300, y: 200, r: 75 }])
      expect(v.w / v.h).toBeCloseTo(PHOTO_ASPECT)
      expect(v.x).toBeLessThanOrEqual(base.x)
      expect(v.x + v.w).toBeGreaterThanOrEqual(base.x + base.w + 375)
      expect(v.y).toBeLessThanOrEqual(base.y)
      expect(v.y + v.h).toBeGreaterThanOrEqual(base.y + base.h)
    })

    it('遠くへ飛んだ・台座の下まで落ちたピースは追わない', () => {
      const base = stackView(-560, GROUND, CENTER)
      expect(collapseView(base, [{ x: 1e6, y: 0, r: 75 }])).toEqual(base)
      expect(collapseView(base, [{ x: CENTER + 200, y: GROUND + 400, r: 75 }])).toEqual(base)
      // 追う範囲の端にいても、引く量には上限がある
      const edge = collapseView(base, [{ x: base.x + base.w * 1.75, y: 0, r: 75 }])
      expect(edge.w).toBeLessThanOrEqual(base.w * 1.75 + 1e-6)
    })

    it('構図を前後のコマでならしても 3:4 のまま', () => {
      const base = stackView(-560, GROUND, CENTER)
      const wide = collapseView(base, [{ x: base.x + base.w + 300, y: 200, r: 75 }])
      const smooth = smoothRects([base, base, wide, wide], 1)
      expect(smooth).toHaveLength(4)
      expect(smooth[0]).toEqual(base)
      expect(smooth[3]).toEqual(wide)
      expect(smooth[1]!.w).toBeGreaterThan(base.w)
      expect(smooth[1]!.w).toBeLessThan(smooth[2]!.w)
      for (const v of smooth) expect(v.w / v.h).toBeCloseTo(PHOTO_ASPECT)
    })
  })

  describe('trimStillLead', () => {
    const f = (...v: number[]) => Float32Array.from(v)

    it('冒頭の動いていないコマを落とし、動きはじめの1コマ前から残す', () => {
      const frames = [f(10, 20, 0), f(10, 20, 0), f(10, 20, 0), f(10, 26, 0), f(10, 40, 0.2)]
      expect(trimStillLead(frames)).toEqual(frames.slice(2))
    })

    it('わずかな回転も動きとして拾う', () => {
      const frames = [f(10, 20, 0), f(10, 20, 0), f(10, 20, 0.05)]
      expect(trimStillLead(frames)).toEqual(frames.slice(1))
    })

    it('ピースが増えたコマは動きとして扱う', () => {
      const frames = [f(10, 20, 0), f(10, 20, 0), f(10, 20, 0, 50, 0, 0)]
      expect(trimStillLead(frames)).toEqual(frames.slice(1))
    })

    it('ずっと静止していても最後の1コマは残す', () => {
      const frames = [f(1, 2, 0), f(1, 2, 0), f(1, 2, 0)]
      expect(trimStillLead(frames)).toHaveLength(1)
      expect(trimStillLead([])).toEqual([])
    })
  })
})
