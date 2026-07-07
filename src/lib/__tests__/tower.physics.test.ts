import { Box, Vec2, World } from 'planck'
import { describe, expect, it } from 'vitest'
import {
  DENSITY,
  extractShapeRects,
  FRICTION,
  GRAVITY,
  PPM,
  RESTITUTION,
  type ShapeRect,
} from '../tower'

// TowerGameView と同じ流儀で planck の世界を組み、落としたピースが台の上で
// 静止することを検証する（描画なしの物理スモークテスト）。
// ここが通れば planck の API の使い方（Vec2/Box/compound fixture）が正しい。

const GROUND_TOP = 640
const GROUND_W = 220
const VIEW_W = 480

function makeWorld() {
  const world = new World({ gravity: new Vec2(0, GRAVITY) })
  const ground = world.createBody({
    type: 'static' as const,
    position: new Vec2(VIEW_W / 2 / PPM, (GROUND_TOP + 20) / PPM),
  })
  ground.createFixture({
    shape: new Box(GROUND_W / 2 / PPM, 20 / PPM),
    friction: FRICTION,
    restitution: RESTITUTION,
  })
  return world
}

// スプライト中心基準で rects から compound body を作る（View の drop() と同じ変換）
function dropPiece(world: World, rects: ShapeRect[], sampleW: number, sampleH: number, dispW: number, dispH: number, x: number, y: number) {
  const body = world.createBody({
    type: 'dynamic' as const,
    position: new Vec2(x / PPM, y / PPM),
    bullet: true,
  })
  const sx = dispW / sampleW
  const sy = dispH / sampleH
  for (const r of rects) {
    const cx = ((r.x + r.w / 2) * sx - dispW / 2) / PPM
    const cy = ((r.y + r.h / 2) * sy - dispH / 2) / PPM
    body.createFixture({
      shape: new Box(((r.w * sx) / 2) * (1 / PPM), ((r.h * sy) / 2) * (1 / PPM), new Vec2(cx, cy), 0),
      density: DENSITY,
      friction: FRICTION,
      restitution: RESTITUTION,
    })
  }
  return body
}

// 人型っぽいテスト形状: 頭(細)・胴(広)・二本脚
function humanoidRgba(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h * 4)
  const set = (x: number, y: number) => (buf[(y * w + x) * 4 + 3] = 255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const head = y < h * 0.2 && x >= w * 0.35 && x < w * 0.65
      const torso = y >= h * 0.2 && y < h * 0.6
      const legL = y >= h * 0.6 && x >= w * 0.15 && x < w * 0.4
      const legR = y >= h * 0.6 && x >= w * 0.6 && x < w * 0.85
      if (head || torso || legL || legR) set(x, y)
    }
  }
  return buf
}

describe('タワーの物理（planck 統合）', () => {
  it('落としたピースが台の上で静止する', () => {
    const world = makeWorld()
    const sw = 48
    const sh = 96
    const rects = extractShapeRects(humanoidRgba(sw, sh), sw, sh)
    expect(rects.length).toBeGreaterThan(4) // 人型なら複数矩形になるはず
    const dispW = 75
    const dispH = 150
    const body = dropPiece(world, rects, sw, sh, dispW, dispH, VIEW_W / 2, 300)

    for (let i = 0; i < 600; i++) world.step(1 / 60, 8, 3) // 10秒分

    const pos = body.getPosition()
    const v = body.getLinearVelocity()
    // 台の上（下面が台上面付近）で静止している
    expect(pos.y * PPM).toBeLessThan(GROUND_TOP) // 台を突き抜けていない
    expect(pos.y * PPM).toBeGreaterThan(GROUND_TOP - dispH) // 上空に浮いてもいない
    expect(Math.hypot(v.x, v.y)).toBeLessThan(0.05)
  })

  it('台から外れた位置に落とすと落下し続ける（ゲームオーバー条件が成立する）', () => {
    const world = makeWorld()
    const rects: ShapeRect[] = [{ x: 0, y: 0, w: 20, h: 40 }]
    const body = dropPiece(world, rects, 20, 40, 50, 100, 30, 300) // 台（中央±110px）の外

    for (let i = 0; i < 300; i++) world.step(1 / 60, 8, 3)

    expect(body.getPosition().y * PPM).toBeGreaterThan(GROUND_TOP + 360) // kill line を割る
  })

  it('2体積むと1体目の上に静止する', () => {
    const world = makeWorld()
    const rects: ShapeRect[] = [{ x: 0, y: 0, w: 40, h: 40 }] // 正方形ブロック
    const a = dropPiece(world, rects, 40, 40, 80, 80, VIEW_W / 2, 500)
    for (let i = 0; i < 300; i++) world.step(1 / 60, 8, 3)
    const b = dropPiece(world, rects, 40, 40, 80, 80, VIEW_W / 2, 400)
    for (let i = 0; i < 600; i++) world.step(1 / 60, 8, 3)

    const ay = a.getPosition().y * PPM
    const by = b.getPosition().y * PPM
    expect(by).toBeLessThan(ay) // b が a の上
    expect(Math.abs(ay - by - 80)) // ほぼ1ブロック分の差
      .toBeLessThan(6)
    const bv = b.getLinearVelocity()
    expect(Math.hypot(bv.x, bv.y)).toBeLessThan(0.05)
  })
})
