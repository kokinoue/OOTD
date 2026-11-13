import { describe, expect, it } from 'vitest'
import {
  easeOutBack,
  heightMeters,
  PX_PER_M,
  samplePalette,
  settleNoteHz,
  skyAt,
  topOffset,
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
})
