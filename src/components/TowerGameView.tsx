import { useEffect, useRef, useState } from 'react'
import { Box, Vec2, World, type Body, type Contact } from 'planck'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import { useI18n } from '../lib/i18n'
import type { CutoutsFile } from '../lib/platform'
import {
  DENSITY,
  extractShapeRects,
  FRICTION,
  GRAVITY,
  loadBest,
  loadBestHeight,
  PPM,
  RESTITUTION,
  saveBest,
  saveBestHeight,
  SETTLE_ANGULAR,
  SETTLE_FRAMES,
  SETTLE_SPEED,
  SPRITE_H_PX,
  type ShapeRect,
} from '../lib/tower'
import { createTowerAudio, type TowerAudio } from '../lib/towerAudio'
import {
  clamp01,
  easeOutBack,
  heightMeters,
  PX_PER_M,
  samplePalette,
  skyAt,
  smoothstep,
  topOffset,
  type LocalBox,
} from '../lib/towerFx'
import { fmtDate, outfits } from '../lib/useData'

// タワー: 出勤服のくり抜きを積む物理パズル（1人スコアアタック）。
// 操作は どうぶつタワーバトル 流 — ドラッグで横位置、タップで90°回転、離すと落下。
// 物理は planck.js（Box2D）、衝突形状は lib/tower.ts のアルファスキャンで作る。
// ここは描画（Canvas 2D）と入力とUI。
//
// 演出（空・影・土煙・画面の揺れ・効果音・崩落のスローモーション・記念写真）は
// すべて「読むだけ」で、物理・入力・照準カメラ（camY）・スコアには書き込まない。

const cutouts = cutoutsJson as CutoutsFile

type Props = {
  onBack: () => void
}

const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

// 画面は縦長（タワーなので）。CSS 側で width 100% + aspect-ratio。
const VIEW_W = 480
const VIEW_H = 720
const GROUND_W = 220 // 台座の幅（px）。DTB と同じく狭めで、はみ出すと落ちる
const GROUND_TOP = 640 // 台座上面の world Y（px）
const AIM_MARGIN = 100 // 画面上端から照準までの距離（px）
const KILL_Y = GROUND_TOP + 360 // これより下に落ちた body があればゲームオーバー
const SAMPLE_H = 96 // アルファスキャンの縦解像度（px）。実寸240を縮めて走査する
const SETTLE_TIMEOUT_FRAMES = 60 * 8 // 8秒静止しなければ強制的に次へ（ゆっくり転がり続ける対策）

const COL = {
  pedestal: '#3a3a41',
  pedestalTop: '#4d4d57',
  pedestalEdge: '#2c2c32',
  gold: '#e0a82e',
  danger: '176, 58, 46',
}

// --- 演出の定数（フレーム基準。メインループが 1フレーム=1ステップなので合わせる） ---
const OVER_SLOW_FRAMES = 78 // 崩落のスローモーションを見せてからリザルトを出す
const OVER_SLOW_RATE = 0.3
const SPAWN_FRAMES = 14 // 新しいピースが「ぽん」と出る時間
const MILESTONE_EVERY = 5
const PHOTO_W = 300 // 記念写真（CSS px。実体は2倍で描く）
const PHOTO_H = 400
const SHADOW_SCALE = 4 // 影は 1/4 解像度で持ち、拡大時の補間でぼかす
const SHADOW_PAD = 4
const CONFETTI = ['#e0a82e', '#d9534f', '#3b7dd8', '#3fa672', '#f1eee3']

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  rot: number
  vr: number
  kind: 'dust' | 'confetti' | 'ring'
}
type Popup = { x: number; y: number; text: string; life: number }

// 星と雲は固定の擬似乱数で置く（リトライしても同じ空になる）
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const starRand = seeded(7)
const STARS = Array.from({ length: 70 }, () => ({
  x: starRand(),
  y: starRand(),
  r: 0.6 + starRand() * 1.1,
  p: starRand() * Math.PI * 2,
}))
const cloudRand = seeded(21)
const CLOUDS = Array.from({ length: 6 }, () => ({
  x: cloudRand(),
  y: cloudRand(),
  s: 0.7 + cloudRand() * 0.8,
  v: 0.05 + cloudRand() * 0.12,
}))

// 空（グラデーション・太陽・月・星・雲）。画面座標で描く。記念写真にも同じものを使う
function paintSky(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  meters: number,
  parallaxY: number,
  frame: number,
) {
  const sky = skyAt(meters)
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, sky.top)
  g.addColorStop(1, sky.bottom)
  c.fillStyle = g
  c.fillRect(0, 0, w, h)

  if (sky.night > 0.01) {
    c.fillStyle = '#fff'
    for (const st of STARS) {
      c.globalAlpha = sky.night * (0.45 + 0.55 * Math.sin(frame * 0.04 + st.p) ** 2)
      c.beginPath()
      c.arc(st.x * w, st.y * h * 0.85, st.r, 0, Math.PI * 2)
      c.fill()
    }
    // 三日月
    c.globalAlpha = sky.night
    const mx = w * 0.76
    const my = h * 0.16
    c.fillStyle = '#f6efd2'
    c.beginPath()
    c.arc(mx, my, 20, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = sky.top
    c.beginPath()
    c.arc(mx + 9, my - 5, 18, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1
  }

  // 太陽: 高さとともに左下から昇り、右下へ沈む
  const sunA = smoothstep(2, 5, meters) * (1 - smoothstep(13, 16.5, meters))
  if (sunA > 0.01) {
    const t = clamp01(meters / 15)
    const sx = w * (0.14 + 0.72 * t)
    const sy = h * (0.42 - 0.28 * Math.sin(t * Math.PI))
    const warm = smoothstep(9, 13, meters)
    const core = `rgba(255, ${Math.round(246 - 80 * warm)}, ${Math.round(214 - 130 * warm)}, `
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, 120)
    glow.addColorStop(0, core + `${0.55 * sunA})`)
    glow.addColorStop(1, core + '0)')
    c.fillStyle = glow
    c.fillRect(sx - 120, sy - 120, 240, 240)
    c.fillStyle = core + `${sunA})`
    c.beginPath()
    c.arc(sx, sy, 22, 0, Math.PI * 2)
    c.fill()
  }

  // 雲: カメラの上昇より遅く流れる（視差）
  const cloudA = smoothstep(2.5, 6, meters) * (1 - 0.75 * sky.night)
  if (cloudA > 0.01) {
    const span = h * 1.4
    const tint = smoothstep(10, 14, meters)
    c.fillStyle = `rgb(255, ${Math.round(255 - 35 * tint)}, ${Math.round(255 - 50 * tint)})`
    c.globalAlpha = cloudA * 0.75
    for (const cl of CLOUDS) {
      const x = ((cl.x * (w + 240) + frame * cl.v) % (w + 240)) - 120
      const y = ((((cl.y * span + parallaxY * 0.3) % span) + span) % span) - h * 0.2
      c.beginPath()
      c.ellipse(x, y, 46 * cl.s, 15 * cl.s, 0, 0, Math.PI * 2)
      c.ellipse(x - 26 * cl.s, y + 5 * cl.s, 30 * cl.s, 11 * cl.s, 0, 0, Math.PI * 2)
      c.ellipse(x + 24 * cl.s, y + 4 * cl.s, 34 * cl.s, 12 * cl.s, 0, 0, Math.PI * 2)
      c.ellipse(x + 4 * cl.s, y - 9 * cl.s, 24 * cl.s, 12 * cl.s, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  }
  return sky
}

// 台座（world 座標）。左右に陰をつけて柱らしく見せる
function paintPedestal(c: CanvasRenderingContext2D) {
  const x = VIEW_W / 2 - GROUND_W / 2
  const g = c.createLinearGradient(x, 0, x + GROUND_W, 0)
  g.addColorStop(0, COL.pedestalEdge)
  g.addColorStop(0.18, COL.pedestal)
  g.addColorStop(0.82, COL.pedestal)
  g.addColorStop(1, COL.pedestalEdge)
  c.fillStyle = g
  c.fillRect(x, GROUND_TOP, GROUND_W, 2400)
  c.fillStyle = COL.pedestalTop
  c.fillRect(x - 3, GROUND_TOP, GROUND_W + 6, 8)
  c.fillStyle = 'rgba(0, 0, 0, 0.22)'
  c.fillRect(x, GROUND_TOP + 8, GROUND_W, 5)
}

// 場に出す1体分。物理 body 生成前（照準中）は body が null。
type Piece = {
  key: string
  img: HTMLImageElement
  dispW: number // 表示サイズ（px）
  dispH: number
  rects: ShapeRect[] // サンプル座標系の衝突矩形
  sampleW: number
  sampleH: number
  no: number | null
  date: string
  body: Body | null
  settleCount: number
  fallFrames: number
  // --- 以下は演出用 ---
  boxes: LocalBox[] // 衝突矩形と同じ形（中心基準 px）。高さ表示の計測に使う
  palette: string[] // 服の色（上・中・下）。土煙と紙吹雪の色
  shadow: HTMLCanvasElement // シルエットの落ち影
  squash: number // 着地の「むにっ」（0..1、減衰する）
}

// 1体ぶんを world 座標に描く（影 → 本体）。記念写真にも使う
function paintPiece(c: CanvasRenderingContext2D, p: Piece, x: number, y: number, angle: number, squash = 0) {
  c.save()
  c.translate(x + 5, y + 7)
  c.rotate(angle)
  c.globalAlpha = 0.2
  c.drawImage(
    p.shadow,
    -p.dispW / 2 - SHADOW_PAD * SHADOW_SCALE,
    -p.dispH / 2 - SHADOW_PAD * SHADOW_SCALE,
    p.shadow.width * SHADOW_SCALE,
    p.shadow.height * SHADOW_SCALE,
  )
  c.restore()
  c.save()
  c.translate(x, y)
  if (squash > 0.01) c.scale(1 + squash * 0.07, 1 - squash * 0.07)
  c.rotate(angle)
  c.drawImage(p.img, -p.dispW / 2, -p.dispH / 2, p.dispW, p.dispH)
  c.restore()
}

const outfitByKey = new Map(outfits.map((o) => [o.key, o]))
const SPRITE_KEYS = Object.keys(cutouts.sprites)

// くり抜き画像を読み、アルファをスキャンして衝突矩形を作る（1ターン1回なので実行時で十分）
async function preparePiece(key: string): Promise<Piece> {
  const img = new Image()
  img.src = spriteUrl(key)
  await img.decode()
  const sp = cutouts.sprites[key]
  const dispH = SPRITE_H_PX
  const dispW = Math.max(12, Math.round((sp.w / sp.h) * dispH))
  const sampleH = SAMPLE_H
  const sampleW = Math.max(8, Math.round((sp.w / sp.h) * sampleH))
  const cv = document.createElement('canvas')
  cv.width = sampleW
  cv.height = sampleH
  const cx = cv.getContext('2d', { willReadFrequently: true })!
  cx.drawImage(img, 0, 0, sampleW, sampleH)
  const data = cx.getImageData(0, 0, sampleW, sampleH).data
  const rects = extractShapeRects(data, sampleW, sampleH)
  const outfit = outfitByKey.get(key)
  const sx = dispW / sampleW
  const sy = dispH / sampleH
  const boxes = rects.map((r) => ({
    cx: (r.x + r.w / 2) * sx - dispW / 2,
    cy: (r.y + r.h / 2) * sy - dispH / 2,
    hw: (r.w * sx) / 2,
    hh: (r.h * sy) / 2,
  }))
  // 影: 低解像度でシルエットを黒く塗る（拡大描画の補間がそのままぼかしになる）
  const shadow = document.createElement('canvas')
  shadow.width = Math.ceil(dispW / SHADOW_SCALE) + SHADOW_PAD * 2
  shadow.height = Math.ceil(dispH / SHADOW_SCALE) + SHADOW_PAD * 2
  const sc = shadow.getContext('2d')!
  sc.drawImage(img, SHADOW_PAD, SHADOW_PAD, dispW / SHADOW_SCALE, dispH / SHADOW_SCALE)
  sc.globalCompositeOperation = 'source-in'
  sc.fillStyle = '#14141c'
  sc.fillRect(0, 0, shadow.width, shadow.height)
  return {
    key,
    img,
    dispW,
    dispH,
    rects,
    sampleW,
    sampleH,
    no: outfit?.no ?? null,
    date: outfit?.date ?? '',
    body: null,
    settleCount: 0,
    fallFrames: 0,
    boxes,
    palette: samplePalette(data, sampleW, sampleH),
    shadow,
    squash: 0,
  }
}

// リザルトのスコアを 0 から数え上げる
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (value <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const dur = Math.min(900, 250 + value * 45)
    const tick = (now: number) => {
      const t = clamp01((now - t0) / dur)
      setShown(Math.round(value * (1 - (1 - t) ** 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown}</>
}

function randomKey(prev?: string): string {
  let k = SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]
  if (SPRITE_KEYS.length > 1) {
    while (k === prev) k = SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]
  }
  return k
}

export default function TowerGameView({ onBack }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(loadBest)
  const [over, setOver] = useState(false)
  const [nextKey, setNextKey] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [resetTick, setResetTick] = useState(0) // もういちど で全体を作り直す
  // リザルトに出す記念写真（最後に積めた瞬間のタワー）と到達高さ
  const [result, setResult] = useState<{ photo: string | null; height: number }>({ photo: null, height: 0 })
  const audioRef = useRef<TowerAudio | null>(null)
  if (!audioRef.current) audioRef.current = createTowerAudio()
  const [muted, setMuted] = useState(() => audioRef.current!.muted())
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const audio = audioRef.current
    return () => audio?.dispose()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr
    ctx.scale(dpr, dpr)

    // --- 物理世界。座標は px / PPM の m。y は下向き正（canvas と一致させる） ---
    const world = new World({ gravity: new Vec2(0, GRAVITY) })
    const ground = world.createBody({ type: 'static', position: new Vec2(VIEW_W / 2 / PPM, (GROUND_TOP + 20) / PPM) })
    ground.createFixture({
      shape: new Box(GROUND_W / 2 / PPM, 20 / PPM),
      friction: FRICTION,
      restitution: RESTITUTION,
    })

    // --- ゲーム状態（全部 ref 相当のローカル。React state は HUD 表示のみ） ---
    const placed: Piece[] = [] // body を持つ、場に出た全ピース
    let current: Piece | null = null // 照準中
    let falling: Piece | null = null // 落下中（静止待ち）
    let nextPrep: Promise<Piece> | null = null // 次ピースの先読み
    let aimX = VIEW_W / 2
    let aimAngle = 0
    let camY = GROUND_TOP + 80 - VIEW_H // 画面上端の world Y（px）
    const camMaxY = camY
    let towerTop = GROUND_TOP // 積み上がりの最高点（world px, 小さいほど高い）
    let gameOver = false
    let scoreLocal = 0
    let raf = 0
    let disposed = false
    let prevKey: string | undefined

    // --- 演出の状態（ここから下は見た目と音だけ。上のゲーム状態には書き込まない） ---
    const audio = audioRef.current!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const font = getComputedStyle(canvas).fontFamily
    const bestAtStart = loadBest()
    const bestHeightAtStart = loadBestHeight()
    let frame = 0
    let shake = 0
    let visTop = GROUND_TOP // 静止しているピースの最上端（world px、なめらかに追う）
    let skyM = 0 // 空の色を決める高さ（m）。ゆっくり追従させて色が飛ばないようにする
    let peakTop = GROUND_TOP // 最後に積めた時点の最上端（world px）
    let danger = 0 // タワーの揺れ 0..1（周辺を赤く落とす）
    let lastCreak = -999
    let lastThud = -999
    let spawnFrame = 0
    let visAngle = 0 // 照準中ピースの見た目の角度（aimAngle へなめらかに寄せる）
    let visAngleTarget = 0
    let overFrames = 0
    let revealed = false
    let zoom = 1
    let rcamY = camY // 描画用カメラ。プレイ中は camY と同じ、崩落後だけ引きの画に移る
    let bestCelebrated = false
    let banner: { text: string; life: number; gold: boolean } | null = null
    let impact: { x: number; y: number; strength: number; piece: Piece | null } | null = null
    const particles: Particle[] = []
    const popups: Popup[] = []
    const trail: Array<{ x: number; y: number; a: number }> = []
    const photo = document.createElement('canvas')
    photo.width = PHOTO_W * 2
    photo.height = PHOTO_H * 2
    let hasPhoto = false

    // 衝突の瞬間を拾う（読むだけ）。相対速度の大きい接触を1フレームに1件だけ採用する
    world.on('begin-contact', (contact: Contact) => {
      const a = contact.getFixtureA().getBody()
      const b = contact.getFixtureB().getBody()
      const va = a.getLinearVelocity()
      const vb = b.getLinearVelocity()
      const rel = Math.hypot(va.x - vb.x, va.y - vb.y)
      if (rel < 1.2) return
      const strength = clamp01((rel - 1) / 9)
      if (impact && impact.strength >= strength) return
      const mover = va.x * va.x + va.y * va.y > vb.x * vb.x + vb.y * vb.y ? a : b
      const pt = contact.getWorldManifold(null)?.points[0] ?? mover.getPosition()
      impact = {
        x: pt.x * PPM,
        y: pt.y * PPM,
        strength,
        piece: (mover.getUserData() as Piece | null) ?? null,
      }
    })

    // 振動（対応端末のみ）。未操作のうちに呼ぶとブラウザに弾かれるので確認してから
    const buzz = (pattern: number | number[]) => {
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(pattern)
    }

    const pieceTop = (p: Piece) => p.body!.getPosition().y * PPM + topOffset(p.boxes, p.body!.getAngle())

    const burstDust = (x: number, y: number, strength: number, palette: string[]) => {
      if (reduced) return
      const n = 5 + Math.round(strength * 12)
      for (let i = 0; i < n; i++) {
        const dir = Math.random() < 0.5 ? -1 : 1
        const max = 22 + Math.random() * 22
        particles.push({
          x: x + (Math.random() - 0.5) * 14,
          y,
          vx: dir * (0.6 + Math.random() * 2.6) * (0.5 + strength),
          vy: -(0.3 + Math.random() * 1.8) * (0.5 + strength),
          life: max,
          max,
          size: 2.5 + Math.random() * 4.5,
          color: Math.random() < 0.55 ? palette[i % palette.length]! : '#cfc8b6',
          rot: 0,
          vr: 0,
          kind: 'dust',
        })
      }
    }

    // 紙吹雪は画面座標で降らせる（カメラが動いても画面に残る）
    const burstConfetti = (count: number, palette: string[]) => {
      if (reduced) return
      const colors = [...CONFETTI, ...palette]
      for (let i = 0; i < count; i++) {
        const max = 90 + Math.random() * 60
        particles.push({
          x: VIEW_W / 2 + (Math.random() - 0.5) * 120,
          y: 190,
          vx: (Math.random() - 0.5) * 9,
          vy: -3 - Math.random() * 6,
          life: max,
          max,
          size: 4 + Math.random() * 5,
          color: colors[i % colors.length]!,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          kind: 'confetti',
        })
      }
    }

    // 記念写真: 積めた瞬間のタワー全体を、そのときの空と一緒に別キャンバスへ描いておく
    const takePhoto = () => {
      const c = photo.getContext('2d')!
      c.setTransform(2, 0, 0, 2, 0, 0)
      paintSky(c, PHOTO_W, PHOTO_H, heightMeters(GROUND_TOP - peakTop), 0, 0)
      const bottom = GROUND_TOP + 50
      const top = Math.min(peakTop - 50, bottom - 506)
      const s = PHOTO_H / (bottom - top)
      c.translate(PHOTO_W / 2, PHOTO_H)
      c.scale(s, s)
      c.translate(-VIEW_W / 2, -bottom)
      paintPedestal(c)
      for (const p of placed) {
        if (!p.body) continue
        const pos = p.body.getPosition()
        paintPiece(c, p, pos.x * PPM, pos.y * PPM, p.body.getAngle())
      }
      hasPhoto = true
    }

    // n 体目が静止した瞬間の演出一式
    const celebrateSettle = (p: Piece) => {
      const pos = p.body!.getPosition()
      const x = pos.x * PPM
      const y = pos.y * PPM
      let top = GROUND_TOP
      for (const q of placed) if (q.body) top = Math.min(top, pieceTop(q))
      peakTop = top
      saveBestHeight(heightMeters(GROUND_TOP - peakTop))
      takePhoto()
      popups.push({ x, y: pieceTop(p) - 14, text: '+1', life: 50 })
      particles.push({ x, y, vx: 0, vy: 0, life: 26, max: 26, size: 20, color: p.palette[0]!, rot: 0, vr: 0, kind: 'ring' })
      audio.settle(scoreLocal)
      if (bestAtStart > 0 && scoreLocal > bestAtStart && !bestCelebrated) {
        bestCelebrated = true
        banner = { text: 'NEW BEST', life: 110, gold: true }
        burstConfetti(70, p.palette)
        audio.best()
      } else if (scoreLocal % MILESTONE_EVERY === 0) {
        banner = { text: `${scoreLocal}${tRef.current('体')}!`, life: 90, gold: false }
        burstConfetti(36, p.palette)
        audio.milestone(scoreLocal)
      }
    }

    const reveal = () => {
      if (revealed) return
      revealed = true
      setResult({
        photo: hasPhoto ? photo.toDataURL('image/jpeg', 0.86) : null,
        height: heightMeters(GROUND_TOP - peakTop),
      })
      setOver(true)
    }

    const aimY = () => camY + AIM_MARGIN

    // 照準中ピースの回転を考慮した横方向の半幅（画面外へのはみ出し防止）
    const aimHalfW = (p: Piece) => {
      const quarter = Math.round(aimAngle / (Math.PI / 2)) % 2 !== 0
      return (quarter ? p.dispH : p.dispW) / 2
    }

    // 先読み済みの次ピースを場に出し、さらにその次の読み込みを始める
    const spawnNext = async () => {
      const p = await (nextPrep ?? preparePiece(randomKey(prevKey)))
      if (disposed) return
      prevKey = p.key
      current = p
      aimAngle = 0
      visAngle = 0
      visAngleTarget = 0
      spawnFrame = frame
      aimX = Math.min(Math.max(aimX, aimHalfW(p) + 8), VIEW_W - aimHalfW(p) - 8)
      setCaption(p.no ? `#${p.no} ${fmtDate(p.date)}` : '')
      const nk = randomKey(p.key)
      nextPrep = preparePiece(nk)
      setNextKey(nk)
    }

    // 初回も同じ流れ（先読みなしで spawnNext を呼ぶ）
    void spawnNext()

    const drop = () => {
      if (!current || falling || gameOver) return
      const p = current
      current = null
      const body = world.createBody({
        type: 'dynamic',
        position: new Vec2(aimX / PPM, aimY() / PPM),
        angle: aimAngle,
        bullet: true,
      })
      body.setUserData(p) // 衝突演出でどの服か引くためだけに持たせる
      // サンプル座標系の矩形 → スプライト中心基準の m に変換して compound body にする
      const sx = p.dispW / p.sampleW
      const sy = p.dispH / p.sampleH
      for (const r of p.rects) {
        const cx = ((r.x + r.w / 2) * sx - p.dispW / 2) / PPM
        const cy = ((r.y + r.h / 2) * sy - p.dispH / 2) / PPM
        body.createFixture({
          shape: new Box(((r.w * sx) / 2) * (1 / PPM), ((r.h * sy) / 2) * (1 / PPM), new Vec2(cx, cy), 0),
          density: DENSITY,
          friction: FRICTION,
          restitution: RESTITUTION,
        })
      }
      p.body = body
      p.settleCount = 0
      p.fallFrames = 0
      falling = p
      placed.push(p)
      trail.length = 0
      audio.drop()
    }

    const rotate = () => {
      if (!current || gameOver) return
      aimAngle = (aimAngle + Math.PI / 2) % (Math.PI * 2)
      visAngleTarget += Math.PI / 2
      audio.rotate()
      aimX = Math.min(Math.max(aimX, aimHalfW(current) + 8), VIEW_W - aimHalfW(current) - 8)
    }

    const finishGame = () => {
      if (gameOver) return
      gameOver = true
      saveBest(scoreLocal)
      setBest(loadBest())
      // 崩落はスローモーションで見せてからリザルトへ（動きを減らす設定なら即表示）
      overFrames = 1
      shake = 12
      audio.collapse()
      buzz([30, 40, 60])
      if (reduced) reveal()
    }

    // --- 入力: ドラッグで移動、タップで回転、ドラッグ後に離すと落下 ---
    let pointerDown = false
    let dragged = false
    let downX = 0
    const toLocalX = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return ((e.clientX - rect.left) / rect.width) * VIEW_W
    }
    const onDown = (e: PointerEvent) => {
      if (gameOver) return
      canvas.setPointerCapture(e.pointerId)
      pointerDown = true
      dragged = false
      downX = toLocalX(e)
    }
    const onMove = (e: PointerEvent) => {
      if (!pointerDown || !current) return
      const x = toLocalX(e)
      if (Math.abs(x - downX) > 6) dragged = true
      if (dragged) aimX = Math.min(Math.max(x, aimHalfW(current) + 8), VIEW_W - aimHalfW(current) - 8)
    }
    const onUp = () => {
      if (!pointerDown) return
      pointerDown = false
      if (dragged) drop()
      else rotate()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!current || gameOver) return
      if (e.key === 'ArrowLeft') aimX = Math.max(aimX - 12, aimHalfW(current) + 8)
      else if (e.key === 'ArrowRight') aimX = Math.min(aimX + 12, VIEW_W - aimHalfW(current) - 8)
      else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'r') rotate()
      else if (e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        drop()
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)

    // --- メインループ ---
    const step = () => {
      frame++
      // プレイ中は常に 1/60。スローにするのは勝敗が決まった後の崩落だけ
      const slow = gameOver && !reduced && overFrames <= OVER_SLOW_FRAMES
      world.step(slow ? OVER_SLOW_RATE / 60 : 1 / 60, 8, 3)
      if (gameOver && !revealed && ++overFrames > OVER_SLOW_FRAMES) reveal()

      // 落下中ピースの静止判定
      if (falling?.body) {
        const b = falling.body
        const v = b.getLinearVelocity()
        const speed = Math.hypot(v.x, v.y)
        const spin = Math.abs(b.getAngularVelocity())
        falling.fallFrames++
        if (speed < SETTLE_SPEED && spin < SETTLE_ANGULAR) falling.settleCount++
        else falling.settleCount = 0
        if (falling.settleCount >= SETTLE_FRAMES || falling.fallFrames >= SETTLE_TIMEOUT_FRAMES) {
          scoreLocal++
          setScore(scoreLocal)
          celebrateSettle(falling)
          falling = null
          void spawnNext()
        }
      }

      // 敗北判定: どれか1体でも kill line を割ったら終了（あとから崩れた場合も含む）
      for (const p of placed) {
        if (p.body && p.body.getPosition().y * PPM > KILL_Y) {
          finishGame()
          break
        }
      }

      // タワー最高点 → カメラ追従（照準スペースを一定に保つ）
      towerTop = GROUND_TOP
      for (const p of placed) {
        if (!p.body || p === falling) continue
        const y = p.body.getPosition().y * PPM - Math.max(p.dispW, p.dispH) / 2
        if (y < towerTop) towerTop = y
      }
      const targetCam = Math.min(camMaxY, towerTop - 220)
      camY += (targetCam - camY) * 0.08

      updateFx()
      draw()
      raf = requestAnimationFrame(step)
    }

    // 演出の更新（物理の結果を読むだけ）
    const updateFx = () => {
      // 着地・ぶつかり: 土煙、画面の揺れ、むにっ、音
      if (impact) {
        const { x, y, strength, piece } = impact
        impact = null
        if (!gameOver) {
          burstDust(x, y, strength, piece?.palette ?? ['#cfc8b6'])
          if (!reduced) shake = Math.max(shake, strength * 7)
          if (piece && !reduced) piece.squash = Math.max(piece.squash, strength)
          if (frame - lastThud > 4) {
            lastThud = frame
            audio.impact(strength)
            if (strength > 0.45) buzz(8)
          }
        }
      }
      shake *= 0.86

      // 静止しているピースから、表示用の高さと「揺れ」を測る
      let top = GROUND_TOP
      let sway = 0
      for (const p of placed) {
        p.squash *= 0.8
        if (!p.body || p === falling) continue
        top = Math.min(top, pieceTop(p))
        const v = p.body.getLinearVelocity()
        sway = Math.max(sway, Math.hypot(v.x, v.y) + Math.abs(p.body.getAngularVelocity()) * 1.2)
      }
      if (!gameOver) {
        visTop += (top - visTop) * 0.18
        skyM += (heightMeters(GROUND_TOP - visTop) - skyM) * 0.04
        const prev = danger
        danger += (clamp01((sway - 0.3) / 1.3) - danger) * 0.12
        if (prev < 0.3 && danger >= 0.3 && frame - lastCreak > 45) {
          lastCreak = frame
          audio.creak()
        }
      } else {
        danger *= 0.9
      }

      // 落下中の残像
      if (falling?.body && !reduced) {
        const pos = falling.body.getPosition()
        const v = falling.body.getLinearVelocity()
        if (Math.hypot(v.x, v.y) > 3) trail.push({ x: pos.x * PPM, y: pos.y * PPM, a: falling.body.getAngle() })
        else trail.length = 0
        if (trail.length > 5) trail.shift()
      } else {
        trail.length = 0
      }

      visAngle += (visAngleTarget - visAngle) * (reduced ? 1 : 0.34)

      // 描画用カメラ: プレイ中は照準カメラそのもの。崩落後はタワー全体が入る引きの画へ
      if (gameOver && !reduced) {
        const fit = Math.min(1, Math.max(0.42, VIEW_H / (VIEW_H + 90 - peakTop)))
        zoom += (fit - zoom) * 0.05
        rcamY += (camMaxY - rcamY) * 0.05
      } else {
        rcamY = camY
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i]!
        if (--q.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        if (q.kind === 'ring') continue
        q.x += q.vx
        q.y += q.vy
        q.rot += q.vr
        if (q.kind === 'dust') {
          q.vx *= 0.92
          q.vy = q.vy * 0.92 - 0.02
        } else {
          q.vx *= 0.97
          q.vy = Math.min(q.vy + 0.22, 3.2)
          q.x += Math.sin((q.life + q.size * 9) * 0.15) * 0.8
        }
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        const q = popups[i]!
        q.y -= 0.7
        if (--q.life <= 0) popups.splice(i, 1)
      }
      if (banner && --banner.life <= 0) banner = null
    }

    const draw = () => {
      const sky = paintSky(ctx, VIEW_W, VIEW_H, skyM, -rcamY, reduced ? 0 : frame)
      const ink = (a: number) => (sky.dark ? `rgba(255, 255, 255, ${a})` : `rgba(0, 0, 0, ${a})`)

      // --- ここから world 座標（下端中央を基準に zoom、揺れは画面全体に乗せる） ---
      ctx.save()
      if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
      ctx.translate(VIEW_W / 2, VIEW_H)
      ctx.scale(zoom, zoom)
      ctx.translate(-VIEW_W / 2, -VIEW_H - rcamY)
      const viewTop = rcamY + VIEW_H - VIEW_H / zoom
      const viewBottom = rcamY + VIEW_H
      const viewLeft = VIEW_W / 2 - VIEW_W / 2 / zoom
      const viewRight = VIEW_W / 2 + VIEW_W / 2 / zoom

      // 薄い方眼（他ゲームと同じ雰囲気）
      ctx.strokeStyle = ink(sky.dark ? 0.05 : 0.04)
      ctx.lineWidth = 1 / zoom
      ctx.beginPath()
      const g = 40
      for (let x = Math.floor(viewLeft / g) * g; x <= viewRight; x += g) {
        ctx.moveTo(x, viewTop)
        ctx.lineTo(x, viewBottom)
      }
      for (let y = Math.floor(viewTop / g) * g; y <= viewBottom; y += g) {
        ctx.moveTo(viewLeft, y)
        ctx.lineTo(viewRight, y)
      }
      ctx.stroke()

      // 高さの目盛り（左端。1m ごと、5m ごとに数字）
      ctx.strokeStyle = ink(0.28)
      ctx.fillStyle = ink(0.45)
      ctx.font = `${11 / zoom}px ${font}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.beginPath()
      const mTop = Math.ceil((GROUND_TOP - viewTop) / PX_PER_M)
      for (let m = 1; m <= mTop; m++) {
        const y = GROUND_TOP - m * PX_PER_M
        const major = m % 5 === 0
        ctx.moveTo(viewLeft, y)
        ctx.lineTo(viewLeft + (major ? 14 : 7) / zoom, y)
        if (major) ctx.fillText(`${m}m`, viewLeft + 18 / zoom, y)
      }
      ctx.stroke()

      // これまでの最高到達ライン
      if (bestHeightAtStart > 0.5) {
        const y = GROUND_TOP - bestHeightAtStart * PX_PER_M
        if (y > viewTop - 10 && y < viewBottom) {
          ctx.strokeStyle = COL.gold
          ctx.globalAlpha = 0.75
          ctx.setLineDash([2 / zoom, 5 / zoom])
          ctx.beginPath()
          ctx.moveTo(viewLeft, y)
          ctx.lineTo(viewRight, y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = COL.gold
          ctx.textAlign = 'right'
          ctx.fillText(`BEST ${bestHeightAtStart.toFixed(1)}m`, viewRight - 8 / zoom, y - 9 / zoom)
          ctx.globalAlpha = 1
        }
      }

      paintPedestal(ctx)

      // 落下中の残像
      if (falling && trail.length > 1) {
        for (let i = 0; i < trail.length - 1; i++) {
          const tr = trail[i]!
          ctx.save()
          ctx.globalAlpha = 0.05 + 0.05 * i
          ctx.translate(tr.x, tr.y)
          ctx.rotate(tr.a)
          ctx.drawImage(falling.img, -falling.dispW / 2, -falling.dispH / 2, falling.dispW, falling.dispH)
          ctx.restore()
        }
      }

      // 置かれたピース（影つき）
      for (const p of placed) {
        if (!p.body) continue
        const pos = p.body.getPosition()
        paintPiece(ctx, p, pos.x * PPM, pos.y * PPM, p.body.getAngle(), p.squash)
      }

      // 土煙と、積めた瞬間の輪
      for (const q of particles) {
        if (q.kind === 'confetti') continue
        const t = q.life / q.max
        if (q.kind === 'ring') {
          ctx.strokeStyle = q.color
          ctx.globalAlpha = t * 0.7
          ctx.lineWidth = 3 * t + 0.5
          ctx.beginPath()
          ctx.arc(q.x, q.y, q.size + (1 - t) * 70, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          ctx.fillStyle = q.color
          ctx.globalAlpha = t * 0.6
          ctx.beginPath()
          ctx.arc(q.x, q.y, q.size * (1.4 - t * 0.6), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      // いまの高さ（右端の小さな指標）
      if (!gameOver && visTop < GROUND_TOP - 4) {
        ctx.fillStyle = ink(0.6)
        ctx.textAlign = 'right'
        ctx.font = `600 12px ${font}`
        ctx.fillText(`${heightMeters(GROUND_TOP - visTop).toFixed(1)}m`, VIEW_W - 17, visTop)
        ctx.beginPath()
        ctx.moveTo(VIEW_W - 12, visTop)
        ctx.lineTo(VIEW_W - 5, visTop - 4)
        ctx.lineTo(VIEW_W - 5, visTop + 4)
        ctx.fill()
      }

      // 照準中ピース + 落下ガイド（破線が下へ流れる）
      if (current && !gameOver) {
        const y = aimY()
        ctx.strokeStyle = ink(sky.dark ? 0.35 : 0.18)
        ctx.lineWidth = 1
        ctx.setLineDash([6, 6])
        ctx.lineDashOffset = reduced ? 0 : -frame * 0.5
        ctx.beginPath()
        ctx.moveTo(aimX, y)
        ctx.lineTo(aimX, viewBottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
        const pop = reduced ? 1 : easeOutBack((frame - spawnFrame) / SPAWN_FRAMES)
        ctx.save()
        ctx.translate(aimX, y)
        ctx.rotate(visAngle)
        ctx.scale(pop, pop)
        ctx.globalAlpha = clamp01((frame - spawnFrame) / 6)
        ctx.drawImage(current.img, -current.dispW / 2, -current.dispH / 2, current.dispW, current.dispH)
        ctx.restore()
      }

      // +1
      ctx.textAlign = 'center'
      ctx.font = `700 20px ${font}`
      for (const q of popups) {
        ctx.fillStyle = ink(Math.min(1, q.life / 20) * 0.8)
        ctx.fillText(q.text, q.x, q.y)
      }
      ctx.restore()

      // --- ここから画面座標 ---
      // 揺れているとき・崩れた瞬間は周辺を赤く落とす
      const flash = gameOver && !reduced ? Math.max(0, 1 - overFrames / 40) * 0.5 : 0
      const vig = Math.max(danger * 0.32, flash)
      if (vig > 0.01) {
        const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.28, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.68)
        vg.addColorStop(0, `rgba(${COL.danger}, 0)`)
        vg.addColorStop(1, `rgba(${COL.danger}, ${vig})`)
        ctx.fillStyle = vg
        ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      }

      for (const q of particles) {
        if (q.kind !== 'confetti') continue
        ctx.save()
        ctx.globalAlpha = Math.min(1, q.life / 25)
        ctx.translate(q.x, q.y)
        ctx.rotate(q.rot)
        ctx.fillStyle = q.color
        ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2)
        ctx.restore()
      }

      // 節目の帯（5体ごと / 自己ベスト更新）
      if (banner) {
        const age = (banner.gold ? 110 : 90) - banner.life
        const s = reduced ? 1 : easeOutBack(age / 12)
        ctx.save()
        ctx.globalAlpha = Math.min(1, banner.life / 18)
        ctx.translate(VIEW_W / 2, 200)
        ctx.scale(s, s)
        ctx.font = `700 ${banner.gold ? 40 : 34}px ${font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 7
        ctx.strokeStyle = sky.dark ? 'rgba(11, 14, 36, 0.85)' : 'rgba(255, 255, 255, 0.9)'
        ctx.strokeText(banner.text, 0, 0)
        ctx.fillStyle = banner.gold ? COL.gold : sky.dark ? '#fff' : '#17171a'
        ctx.fillText(banner.text, 0, 0)
        ctx.restore()
      }
    }

    raf = requestAnimationFrame(step)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [resetTick])

  // 結果テキスト付きでX（Twitter）のポスト画面を開く。
  // URLはスコア別OGPページ（scripts/make-tower-score-og.mjs が 1〜50 を事前生成）。
  // 範囲外のスコアは汎用ページで共有する
  const shareResultOnX = () => {
    const page = score >= 1 && score <= 50 ? `game/tower/r/${score}/` : 'game/tower/'
    const url = `${location.origin}${import.meta.env.BASE_URL}${page}`
    const record = score > 0 && score >= best ? t('自己ベスト更新！') : ''
    const text = t('出勤服アーカイブの「タワー」で {score}体 積み上げました！{record} #出勤服アーカイブ', {
      score,
      record,
    })
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
    window.open(intentUrl, '_blank', 'noopener,noreferrer')
  }

  const retry = () => {
    setScore(0)
    setOver(false)
    setNextKey(null)
    setCaption('')
    setResult({ photo: null, height: 0 })
    setResetTick((t) => t + 1)
  }

  return (
    <main className="tower">
      <div className="tower-inner">
        <div className="tower-head">
          <button className="tower-back jp" onClick={onBack}>
            ← {t('ゲーム')}
          </button>
          <h2 className="tower-title jp">{t('タワー')}</h2>
          <span className="tower-stats mono">
            <b key={score} className="tower-score-num">
              {score}
            </b>{' '}
            <small>{t('体')}</small> / BEST {Math.max(best, score)}
          </span>
          <button
            className="tower-sound mono"
            aria-pressed={!muted}
            onClick={() => setMuted(audioRef.current!.toggle())}
            title={t(muted ? 'サウンドをオン' : 'サウンドをオフ')}
            aria-label={t(muted ? 'サウンドをオン' : 'サウンドをオフ')}
          >
            ♪
          </button>
          <GameShareButton game="tower" title="タワー" />
        </div>
        <div className="tower-screen">
          <canvas ref={canvasRef} className="tower-canvas mono" />
          {over && (
            <div className="tower-overlay">
              <div className="tower-result jp">
                {result.photo && (
                  <figure className="tower-photo">
                    <img src={result.photo} alt="" />
                    <figcaption className="mono">
                      {score}
                      {t('体')} · {result.height.toFixed(1)}m
                    </figcaption>
                  </figure>
                )}
                <b className="mono">
                  <CountUp value={score} />
                  {t('体')}
                </b>
                <span>{score > 0 && score >= best ? t('自己ベスト更新！') : `BEST ${best}${t('体')}`}</span>
                <span className="tower-result-actions">
                  <button className="tower-btn primary jp" onClick={retry}>
                    {t('もういちど')}
                  </button>
                  <button className="tower-btn jp" onClick={shareResultOnX}>
                    {t('Xでポスト')}
                  </button>
                  <button className="tower-btn jp" onClick={onBack}>
                    {t('もどる')}
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="tower-foot jp">
          <span className="tower-caption mono">{caption}</span>
          <span className="tower-hint">{t('ドラッグで移動 / タップで回転 / はなすと落下')}</span>
          {nextKey && (
            <span className="tower-next">
              {t('つぎ')} <img src={spriteUrl(nextKey)} alt={t('次の出勤服')} />
            </span>
          )}
        </div>
      </div>
    </main>
  )
}
