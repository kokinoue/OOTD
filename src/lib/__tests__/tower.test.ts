import { describe, expect, it } from 'vitest'
import { ALPHA_THRESHOLD, coveredArea, extractShapeRects, type ShapeRect } from '../tower'

// テスト用の RGBA バッファを作る。opaque(x, y) が true のピクセルだけ不透明にする。
function makeRgba(width: number, height: number, opaque: (x: number, y: number) => boolean): Uint8Array {
  const buf = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[(y * width + x) * 4 + 3] = opaque(x, y) ? 255 : 0
    }
  }
  return buf
}

const within = (r: ShapeRect, x: number) => x >= r.x && x < r.x + r.w

describe('extractShapeRects', () => {
  it('全面不透明なら全体を覆う矩形群になる', () => {
    const w = 32
    const h = 64
    const rects = extractShapeRects(makeRgba(w, h, () => true), w, h, 8)
    expect(rects.length).toBe(8) // バンドごとに1矩形
    expect(coveredArea(rects)).toBe(w * h)
    for (const r of rects) {
      expect(r.x).toBe(0)
      expect(r.w).toBe(w)
    }
  })

  it('全面透明なら矩形なし', () => {
    const rects = extractShapeRects(makeRgba(16, 16, () => false), 16, 16, 4)
    expect(rects).toEqual([])
  })

  it('二本脚（左右の柱）は別々の矩形に分かれ、間の隙間が保たれる', () => {
    const w = 40
    const h = 40
    // x: 5-14 と 25-34 の2本柱
    const rects = extractShapeRects(
      makeRgba(w, h, (x) => (x >= 5 && x < 15) || (x >= 25 && x < 35)),
      w,
      h,
      4,
    )
    // 各バンドに2矩形ずつ
    expect(rects.length).toBe(8)
    const mid = 20
    for (const r of rects) {
      expect(within(r, mid)).toBe(false) // 隙間（股）にはどの矩形もかからない
    }
    // 左右それぞれの柱を覆っている
    expect(rects.some((r) => within(r, 7))).toBe(true)
    expect(rects.some((r) => within(r, 30))).toBe(true)
  })

  it('くびれ（上が広く下が細い）はバンドごとに幅が変わる', () => {
    const w = 40
    const h = 40
    // 上半分は全幅、下半分は中央 10px のみ
    const rects = extractShapeRects(makeRgba(w, h, (x, y) => (y < 20 ? true : x >= 15 && x < 25)), w, h, 4)
    const top = rects.filter((r) => r.y < 20)
    const bottom = rects.filter((r) => r.y >= 20)
    expect(Math.max(...top.map((r) => r.w))).toBe(w)
    expect(Math.max(...bottom.map((r) => r.w))).toBe(10)
  })

  it('細すぎるノイズ区間 (MIN_RUN_PX 未満) は捨てる', () => {
    const w = 32
    const h = 8
    // 幅2px の孤立ノイズ
    const rects = extractShapeRects(makeRgba(w, h, (x) => x === 10 || x === 11), w, h, 1)
    expect(rects).toEqual([])
  })

  it('アンチエイリアスの 1px ギャップは連結される', () => {
    const w = 32
    const h = 8
    // x=8-14 と x=16-22 が 1px ギャップ (x=15) を挟んで並ぶ → 1矩形に連結
    const rects = extractShapeRects(makeRgba(w, h, (x) => (x >= 8 && x < 15) || (x >= 16 && x < 23)), w, h, 1)
    expect(rects.length).toBe(1)
    expect(rects[0].x).toBe(8)
    expect(rects[0].x + rects[0].w).toBeGreaterThanOrEqual(22)
  })

  it('閾値未満の半透明ピクセルは無視される', () => {
    const w = 16
    const h = 8
    const buf = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        buf[(y * w + x) * 4 + 3] = ALPHA_THRESHOLD - 1
      }
    }
    expect(extractShapeRects(buf, w, h, 2)).toEqual([])
  })
})
