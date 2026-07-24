import { useEffect, useRef, useState } from 'react'
import { Box, Vec2, World, type Body } from 'planck'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import type { CutoutsFile } from '../lib/platform'
import {
  DENSITY,
  extractShapeRects,
  FRICTION,
  GRAVITY,
  loadBest,
  PPM,
  RESTITUTION,
  saveBest,
  SETTLE_ANGULAR,
  SETTLE_FRAMES,
  SETTLE_SPEED,
  SPRITE_H_PX,
  type ShapeRect,
} from '../lib/tower'
import { fmtDate, outfits } from '../lib/useData'

// タワー: 出勤服のくり抜きを積む物理パズル（1人スコアアタック）。
// 操作は どうぶつタワーバトル 流 — ドラッグで横位置、タップで90°回転、離すと落下。
// 物理は planck.js（Box2D）、衝突形状は lib/tower.ts のアルファスキャンで作る。
// ここは描画（Canvas 2D）と入力とUI。

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
  bg: '#f1eee3',
  grid: 'rgba(0, 0, 0, 0.04)',
  pedestal: '#3a3a41',
  pedestalTop: '#4d4d57',
  guide: 'rgba(0, 0, 0, 0.18)',
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
  }
}

function randomKey(prev?: string): string {
  let k = SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]
  if (SPRITE_KEYS.length > 1) {
    while (k === prev) k = SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]
  }
  return k
}

export default function TowerGameView({ onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(loadBest)
  const [over, setOver] = useState(false)
  const [nextKey, setNextKey] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [resetTick, setResetTick] = useState(0) // もういちど で全体を作り直す

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
    }

    const rotate = () => {
      if (!current || gameOver) return
      aimAngle = (aimAngle + Math.PI / 2) % (Math.PI * 2)
      aimX = Math.min(Math.max(aimX, aimHalfW(current) + 8), VIEW_W - aimHalfW(current) - 8)
    }

    const finishGame = () => {
      if (gameOver) return
      gameOver = true
      saveBest(scoreLocal)
      setBest(loadBest())
      setOver(true)
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
      world.step(1 / 60, 8, 3)

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

      draw()
      raf = requestAnimationFrame(step)
    }

    const draw = () => {
      ctx.fillStyle = COL.bg
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      // 薄い方眼（他ゲームと同じ雰囲気）
      ctx.strokeStyle = COL.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      const g = 40
      for (let x = 0; x <= VIEW_W; x += g) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, VIEW_H)
      }
      for (let y = -(camY % g); y <= VIEW_H; y += g) {
        ctx.moveTo(0, y)
        ctx.lineTo(VIEW_W, y)
      }
      ctx.stroke()

      // 台座（上面 + 下に伸びる柱）
      const gy = GROUND_TOP - camY
      ctx.fillStyle = COL.pedestal
      ctx.fillRect(VIEW_W / 2 - GROUND_W / 2, gy, GROUND_W, VIEW_H)
      ctx.fillStyle = COL.pedestalTop
      ctx.fillRect(VIEW_W / 2 - GROUND_W / 2, gy, GROUND_W, 8)

      // 置かれたピース
      for (const p of placed) {
        if (!p.body) continue
        const pos = p.body.getPosition()
        ctx.save()
        ctx.translate(pos.x * PPM, pos.y * PPM - camY)
        ctx.rotate(p.body.getAngle())
        ctx.drawImage(p.img, -p.dispW / 2, -p.dispH / 2, p.dispW, p.dispH)
        ctx.restore()
      }

      // 照準中ピース + 落下ガイド
      if (current && !gameOver) {
        const y = aimY() - camY
        ctx.strokeStyle = COL.guide
        ctx.setLineDash([6, 6])
        ctx.beginPath()
        ctx.moveTo(aimX, y)
        ctx.lineTo(aimX, VIEW_H)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.save()
        ctx.translate(aimX, y)
        ctx.rotate(aimAngle)
        ctx.drawImage(current.img, -current.dispW / 2, -current.dispH / 2, current.dispW, current.dispH)
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
    const record = score > 0 && score >= best ? '（自己ベスト更新！）' : ''
    const text = `出勤服アーカイブの「タワー」で ${score}体 積み上げました！${record} #出勤服アーカイブ`
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
    window.open(intentUrl, '_blank', 'noopener,noreferrer')
  }

  const retry = () => {
    setScore(0)
    setOver(false)
    setNextKey(null)
    setCaption('')
    setResetTick((t) => t + 1)
  }

  return (
    <main className="tower">
      <div className="tower-inner">
        <div className="tower-head">
          <button className="tower-back jp" onClick={onBack}>
            ← ゲーム
          </button>
          <h2 className="tower-title jp">タワー</h2>
          <span className="tower-stats mono">
            {score} <small>体</small> / BEST {Math.max(best, score)}
          </span>
          <GameShareButton game="tower" title="タワー" />
        </div>
        <div className="tower-screen">
          <canvas ref={canvasRef} className="tower-canvas" />
          {over && (
            <div className="tower-overlay">
              <div className="tower-result jp">
                <b className="mono">{score} 体</b>
                <span>{score > 0 && score >= best ? '自己ベスト更新！' : `BEST ${best} 体`}</span>
                <span className="tower-result-actions">
                  <button className="tower-btn primary jp" onClick={retry}>
                    もういちど
                  </button>
                  <button className="tower-btn jp" onClick={shareResultOnX}>
                    Xでポスト
                  </button>
                  <button className="tower-btn jp" onClick={onBack}>
                    もどる
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="tower-foot jp">
          <span className="tower-caption mono">{caption}</span>
          <span className="tower-hint">ドラッグで移動 / タップで回転 / はなすと落下</span>
          {nextKey && (
            <span className="tower-next">
              つぎ <img src={spriteUrl(nextKey)} alt="次の出勤服" />
            </span>
          )}
        </div>
      </div>
    </main>
  )
}
