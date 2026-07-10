import { useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import type { CutoutsFile } from '../lib/platform'
import {
  checkRackHit,
  comboMultiplier,
  computeLaunchVelocity,
  levelForCatches,
  LIVES_START,
  loadBest,
  MIN_DRAG_PX,
  movingRackCount,
  PREVIEW_THROWS,
  RACK_CAPACITY,
  RACK_SCORES,
  rackOscillateX,
  rackSpeedForLevel,
  saveBest,
  scoreForCatch,
  trajectory,
  type Point,
  type Rect,
} from '../lib/laundry'
import { outfits, thumb } from '../lib/useData'
import type { Outfit } from '../types'

// 洗濯物フリック: 出勤服を指でフリックしてハンガーラックに掛けるスコアアタック。
// 物理・当たり判定・スコア計算は lib/laundry.ts（純粋関数）。ここは Canvas描画と入力、
// そして React 側のフェーズ管理（setup → playing → over）だけを持つ。
// 「フリック」なので、パチンコ（引っ張った逆方向へ飛ぶ）ではなく指を動かした方向へ
// そのまま飛ぶ直感的な操作にした（詳細は lib/laundry.ts のコメント参照）。

const cutouts = cutoutsJson as CutoutsFile

type Props = {
  onBack: () => void
}

const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

// くり抜きスプライトを持ち、代表画像もあるコーデだけがプレイアブル
const POOL = outfits.filter((o) => cutouts.sprites[o.key] && o.images[0]?.url)

const VIEW_W = 480
const VIEW_H = 720
const GRAVITY = 1500 // px/s^2
const FLOOR_Y = VIEW_H - 26 // これより下（床）に落ちたらミス
const OFFSCREEN_MARGIN = 60 // 上下左右にこれ以上外れて戻らなければミス確定
const LAUNCH_X = VIEW_W / 2
const LAUNCH_Y = VIEW_H - 82 // カゴの口（次の服の待機位置）
const RACK_WIDTH = 232
const RACK_BAND_H = 30 // 当たり判定帯の高さ（すり抜け防止は checkRackHit の線分判定側で担保）
const RACK_AMPLITUDE = 82
const HUNG_H = 58 // ラックに掛かった服の表示高さ
const HANG_ANIM = 0.18 // 掛かった直後の「ふわっ」の長さ(秒)
const FADE_DUR = 0.4 // 満杯で押し出されるときのフェード時間(秒)
const THROW_DISP_H = 96 // 待機中・飛行中の服の表示高さ

type RackTier = 0 | 1 | 2 // 0:低い(100pt) 1:中間(200pt) 2:高い(300pt)
const RACK_Y: Record<RackTier, number> = { 2: 116, 1: 250, 0: 384 }
const RACK_LABEL: Record<RackTier, string> = { 2: '高い', 1: '中間', 0: '低い' }
const RACK_COLOR: Record<RackTier, string> = { 2: '#c9a338', 1: '#9aa0aa', 0: '#a9764f' } // 金・銀・銅

const COL = {
  bg: '#f1eee3',
  grid: 'rgba(0, 0, 0, 0.04)',
  pole: '#3a3a41',
  poleTop: '#4d4d57',
  basket: '#c9a26a',
  basketDark: '#a9824f',
  guide: 'rgba(0, 0, 0, 0.24)',
  miss: 'rgba(0, 0, 0, 0.16)',
}

type HungItem = {
  key: string
  img: HTMLImageElement
  ratio: number
  rot: number
  bornAt: number // セッション内経過秒。出現アニメ用
  fadeFrom: number | null // フェード開始時刻。null なら未フェード
}

type Rack = {
  tier: RackTier
  y: number
  x: number // 現在のx（往復移動するラックのみ変化）
  hung: HungItem[]
}

type FlyingPiece = {
  key: string
  outfit: Outfit
  img: HTMLImageElement
  ratio: number
  launchT: number
  v0: { vx: number; vy: number }
  pos: Point
  prevPos: Point
  spin: number
}

type WaitingPiece = {
  outfit: Outfit
  img: HTMLImageElement
  ratio: number
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number }

type GalleryItem = { key: string; url: string; noteUrl: string }
type Result = { score: number; catches: number }

async function loadPiece(outfit: Outfit): Promise<WaitingPiece> {
  const img = new Image()
  img.src = spriteUrl(outfit.key)
  await img.decode()
  const sp = cutouts.sprites[outfit.key]
  return { outfit, img, ratio: sp.w / sp.h }
}

function pickOutfit(prevKey?: string): Outfit {
  if (POOL.length <= 1) return POOL[0]
  let o = POOL[Math.floor(Math.random() * POOL.length)]
  while (o.key === prevKey) o = POOL[Math.floor(Math.random() * POOL.length)]
  return o
}

export default function LaundryGameView({ onBack }: Props) {
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup')
  const [result, setResult] = useState<Result | null>(null)
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [best, setBest] = useState(loadBest)
  const [runTick, setRunTick] = useState(0)

  const start = () => {
    setResult(null)
    setGallery([])
    setPhase('playing')
    setRunTick((t) => t + 1)
  }

  const handleOver = (r: Result, g: GalleryItem[]) => {
    setResult(r)
    setGallery(g)
    setBest(loadBest())
    setPhase('over')
  }

  if (phase === 'setup') {
    return (
      <main className="g-setup">
        <div className="g-setup-card">
          <div className="game-nav">
            <button className="game-back jp" onClick={onBack}>
              ← ゲームを選ぶ
            </button>
            <GameShareButton game="laundry" title="洗濯物フリック" />
          </div>
          <h2 className="g-setup-title jp">洗濯物フリック</h2>
          <p className="g-setup-lead jp">
            カゴから出てきた出勤服を指でフリックして、上のハンガーラックに掛けよう。
            狙う段が高いほど高得点。連続で決めるほどコンボ倍率が上がる。
          </p>
          <ul className="g-rules jp">
            <li>
              低い / 中間 / 高いラックはそれぞれ <b className="g-pt">100 / 200 / 300pt</b>
            </li>
            <li>連続成功でスコア倍率アップ（×1 → ×1.2 → ×1.5 → ×2）。ミスでリセット</li>
            <li>ライフは3。カゴの外や床に落とすと1減り、0でゲームオーバー</li>
            <li>10着掛けるごとにレベルアップ。ラックが左右に動きだし、だんだん速くなる</li>
            <li>最初の3投だけ、指を離す前に予測軌道が見える</li>
          </ul>
          <button className="g-start jp" onClick={start}>
            ゲーム開始
          </button>
        </div>
      </main>
    )
  }

  if (phase === 'over' && result) {
    return (
      <main className="g-finished">
        <div className="g-setup-card">
          <h2 className="g-setup-title jp">ゲームオーバー</h2>
          <div className="g-laundry-result mono">
            <span className="g-laundry-result-item">
              SCORE<b>{result.score}</b>
            </span>
            <span className="g-laundry-result-item">
              掛けた着数<b>{result.catches}</b>
            </span>
            <span className="g-laundry-result-item">
              BEST<b>{Math.max(best, result.score)}</b>
            </span>
          </div>
          {gallery.length > 0 && (
            <div className="g-laundry-gallery-wrap">
              <h3 className="g-laundry-gallery-title jp">今日掛けた服</h3>
              <div className="g-laundry-gallery">
                {gallery.map((g, i) => (
                  <a
                    key={`${g.key}-${i}`}
                    className="g-laundry-gallery-item"
                    href={g.noteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="noteで見る"
                  >
                    <img src={thumb(g.url, 160)} alt="" loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="g-finished-actions">
            <button className="g-start jp" onClick={start}>
              もう一度
            </button>
            <button className="chip jp" onClick={onBack}>
              ゲームを選ぶ
            </button>
          </div>
        </div>
      </main>
    )
  }

  return <Play key={runTick} onBack={onBack} onOver={handleOver} />
}

// --- プレイ画面（Canvas） ---------------------------------------------------
function Play({ onBack, onOver }: { onBack: () => void; onOver: (r: Result, g: GalleryItem[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES_START)
  const [streak, setStreak] = useState(0)
  const [level, setLevel] = useState(1)
  const [showTip, setShowTip] = useState(true)
  const initialBest = useMemo(() => loadBest(), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr
    ctx.scale(dpr, dpr)

    let raf = 0
    let last = performance.now()
    let acc = 0
    const DT = 1 / 60
    let sessionT = 0
    let disposed = false

    // --- ゲーム状態（描画・判定のソースオブトゥルース。React state はHUD表示のみに使う） ---
    let scoreLocal = 0
    let livesLocal = LIVES_START
    let streakLocal = 0
    let catchesLocal = 0
    let levelLocal = 1
    let throwCountLocal = 0
    let overCalled = false
    const galleryLocal: GalleryItem[] = []

    const racks: Rack[] = ([2, 1, 0] as RackTier[]).map((tier) => ({
      tier,
      y: RACK_Y[tier],
      x: LAUNCH_X,
      hung: [],
    }))

    let waiting: WaitingPiece | null = null
    let waitingPrevKey: string | undefined
    let flyings: FlyingPiece[] = []
    let particles: Particle[] = []

    const spawnWaiting = async () => {
      const outfit = pickOutfit(waitingPrevKey)
      waitingPrevKey = outfit.key
      const piece = await loadPiece(outfit)
      if (disposed) return
      waiting = piece
    }
    void spawnWaiting()

    // --- 入力: ドラッグ→リリースでフリック ---
    let dragging = false
    let dragStart: Point | null = null
    let dragCurrent: Point | null = null

    const toLocal = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
        y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
      }
    }
    const onDown = (e: PointerEvent) => {
      if (overCalled || !waiting) return
      canvas.setPointerCapture(e.pointerId)
      dragging = true
      dragStart = toLocal(e)
      dragCurrent = dragStart
      setShowTip(false)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      dragCurrent = toLocal(e)
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      const start = dragStart
      const cur = dragCurrent
      dragStart = null
      dragCurrent = null
      if (!start || !cur || !waiting) return
      const dragVec = { x: cur.x - start.x, y: cur.y - start.y }
      if (Math.hypot(dragVec.x, dragVec.y) < MIN_DRAG_PX) return // タップはフリック扱いしない
      const v0 = computeLaunchVelocity(dragVec)
      const launchPos = { x: LAUNCH_X, y: LAUNCH_Y }
      flyings.push({
        key: waiting.outfit.key,
        outfit: waiting.outfit,
        img: waiting.img,
        ratio: waiting.ratio,
        launchT: sessionT,
        v0,
        pos: launchPos,
        prevPos: launchPos,
        spin: (v0.vx >= 0 ? 1 : -1) * (1.4 + Math.random() * 1.3),
      })
      throwCountLocal += 1
      waiting = null
      void spawnWaiting()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    const finishGame = () => {
      if (overCalled) return
      overCalled = true
      saveBest(scoreLocal)
      onOver({ score: scoreLocal, catches: catchesLocal }, galleryLocal.slice())
    }

    const registerCatch = (f: FlyingPiece, rack: Rack) => {
      streakLocal += 1
      catchesLocal += 1
      const base = RACK_SCORES[rack.tier]
      scoreLocal += scoreForCatch(base, streakLocal)
      levelLocal = levelForCatches(catchesLocal)
      setScore(scoreLocal)
      setStreak(streakLocal)
      setLevel(levelLocal)
      galleryLocal.push({ key: f.key, url: f.outfit.images[0].url, noteUrl: f.outfit.noteUrl })

      const item: HungItem = {
        key: f.key,
        img: f.img,
        ratio: f.ratio,
        rot: (Math.random() - 0.5) * 0.3,
        bornAt: sessionT,
        fadeFrom: null,
      }
      rack.hung.push(item)
      const active = rack.hung.filter((h) => h.fadeFrom == null)
      if (active.length > RACK_CAPACITY) active[0].fadeFrom = sessionT

      for (let i = 0; i < 8; i++) {
        particles.push({
          x: f.pos.x,
          y: f.pos.y,
          vx: Math.cos((i / 8) * Math.PI * 2) * 110,
          vy: Math.sin((i / 8) * Math.PI * 2) * 110 - 40,
          life: 0.4,
          color: RACK_COLOR[rack.tier],
          r: 3,
        })
      }
    }

    const registerMiss = (f: FlyingPiece) => {
      streakLocal = 0
      livesLocal -= 1
      setStreak(0)
      setLives(livesLocal)
      const y = Math.min(f.pos.y, FLOOR_Y)
      for (let i = 0; i < 5; i++) {
        particles.push({
          x: f.pos.x + (i - 2) * 8,
          y,
          vx: (i - 2) * 30,
          vy: -30 - Math.random() * 40,
          life: 0.3,
          color: COL.miss,
          r: 2.5,
        })
      }
      if (livesLocal <= 0) finishGame()
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      acc += Math.min(0.1, (now - last) / 1000)
      last = now
      while (acc >= DT) {
        acc -= DT
        if (overCalled) continue
        sessionT += DT

        // ラックの往復移動（レベルに応じて本数・速度が変わる）
        const movingCount = movingRackCount(levelLocal)
        const speed = rackSpeedForLevel(levelLocal)
        for (const r of racks) {
          const moving = r.tier === 1 ? movingCount >= 1 : r.tier === 2 ? movingCount >= 2 : false
          r.x = moving ? rackOscillateX(LAUNCH_X, RACK_AMPLITUDE, speed, sessionT) : LAUNCH_X
        }

        // 飛行中の服: 放物線を進めてラック当たり判定・場外判定
        for (let i = flyings.length - 1; i >= 0; i--) {
          const f = flyings[i]
          f.prevPos = f.pos
          const t = sessionT - f.launchT
          const rel = trajectory(f.v0, GRAVITY, t)
          f.pos = { x: LAUNCH_X + rel.x, y: LAUNCH_Y - rel.y }

          let caught = false
          for (const r of racks) {
            const rect: Rect = {
              x: r.x - RACK_WIDTH / 2,
              y: r.y - RACK_BAND_H / 2,
              w: RACK_WIDTH,
              h: RACK_BAND_H,
            }
            if (checkRackHit(f.pos, f.prevPos, rect)) {
              registerCatch(f, r)
              caught = true
              break
            }
          }
          if (caught) {
            flyings.splice(i, 1)
            continue
          }
          const offscreen =
            f.pos.y > FLOOR_Y ||
            f.pos.y < -OFFSCREEN_MARGIN ||
            f.pos.x < -OFFSCREEN_MARGIN ||
            f.pos.x > VIEW_W + OFFSCREEN_MARGIN
          if (offscreen) {
            flyings.splice(i, 1)
            registerMiss(f)
          }
        }

        // パーティクル
        for (const p of particles) {
          p.life -= DT
          p.x += p.vx * DT
          p.y += p.vy * DT
          p.vy += 260 * DT
        }
        particles = particles.filter((p) => p.life > 0)

        // フェード完了した掛け服を除去
        for (const r of racks) {
          r.hung = r.hung.filter((h) => h.fadeFrom == null || sessionT - h.fadeFrom < FADE_DUR)
        }
      }

      draw()
    }

    const draw = () => {
      ctx.fillStyle = COL.bg
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      ctx.strokeStyle = COL.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= VIEW_W; x += 40) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, VIEW_H)
      }
      for (let y = 0; y <= VIEW_H; y += 40) {
        ctx.moveTo(0, y)
        ctx.lineTo(VIEW_W, y)
      }
      ctx.stroke()

      // 支柱
      const poleTop = RACK_Y[2] - 36
      ctx.fillStyle = COL.pole
      ctx.fillRect(36, poleTop, 9, FLOOR_Y - poleTop)
      ctx.fillRect(VIEW_W - 45, poleTop, 9, FLOOR_Y - poleTop)
      ctx.fillStyle = COL.poleTop
      ctx.fillRect(36, poleTop, 9, 6)
      ctx.fillRect(VIEW_W - 45, poleTop, 9, 6)

      // ラック（バー＋掛かった服）
      for (const r of racks) {
        ctx.strokeStyle = RACK_COLOR[r.tier]
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(r.x - RACK_WIDTH / 2, r.y)
        ctx.lineTo(r.x + RACK_WIDTH / 2, r.y)
        ctx.stroke()

        const cap = RACK_CAPACITY
        for (let i = 0; i < r.hung.length; i++) {
          const h = r.hung[i]
          const slotX = r.x - RACK_WIDTH / 2 + (i + 0.5) * (RACK_WIDTH / cap)
          const age = sessionT - h.bornAt
          const pop = Math.min(1, age / HANG_ANIM)
          const fading = h.fadeFrom != null
          const alpha = fading ? Math.max(0, 1 - (sessionT - h.fadeFrom!) / FADE_DUR) : 0.4 + 0.6 * pop
          const scale = fading ? 1 : 0.7 + 0.3 * pop
          const hh = HUNG_H * scale
          const ww = hh * h.ratio
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.translate(slotX, r.y + 3)
          ctx.rotate(h.rot)
          ctx.drawImage(h.img, -ww / 2, 0, ww, hh)
          ctx.restore()
        }
      }
      ctx.globalAlpha = 1

      // カゴ
      ctx.fillStyle = COL.basket
      ctx.beginPath()
      ctx.moveTo(LAUNCH_X - 68, FLOOR_Y)
      ctx.lineTo(LAUNCH_X - 92, FLOOR_Y - 54)
      ctx.lineTo(LAUNCH_X + 92, FLOOR_Y - 54)
      ctx.lineTo(LAUNCH_X + 68, FLOOR_Y)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = COL.basketDark
      ctx.fillRect(LAUNCH_X - 92, FLOOR_Y - 58, 184, 7)

      // 待機中の服 + 予測軌道
      if (waiting) {
        let px = LAUNCH_X
        let py = LAUNCH_Y
        if (dragging && dragStart && dragCurrent) {
          px = LAUNCH_X + (dragCurrent.x - dragStart.x)
          py = LAUNCH_Y + (dragCurrent.y - dragStart.y)
        } else {
          py = LAUNCH_Y + Math.sin(sessionT * 2.4) * 4
        }
        const dispW = THROW_DISP_H * waiting.ratio
        ctx.drawImage(waiting.img, px - dispW / 2, py - THROW_DISP_H, dispW, THROW_DISP_H)

        if (dragging && dragStart && dragCurrent && throwCountLocal < PREVIEW_THROWS) {
          const dragVec = { x: dragCurrent.x - dragStart.x, y: dragCurrent.y - dragStart.y }
          if (Math.hypot(dragVec.x, dragVec.y) >= MIN_DRAG_PX) {
            const v0 = computeLaunchVelocity(dragVec)
            ctx.fillStyle = COL.guide
            for (let i = 1; i <= 22; i++) {
              const tt = i * 0.045
              const rel = trajectory(v0, GRAVITY, tt)
              const gx = LAUNCH_X + rel.x
              const gy = LAUNCH_Y - rel.y
              if (gy > FLOOR_Y || gy < -20 || gx < -20 || gx > VIEW_W + 20) break
              ctx.globalAlpha = Math.max(0.12, 1 - i / 22)
              ctx.beginPath()
              ctx.arc(gx, gy, 2.6, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.globalAlpha = 1
          }
        }
      }

      // 飛行中の服
      for (const f of flyings) {
        const t = sessionT - f.launchT
        const dispW = THROW_DISP_H * f.ratio
        ctx.save()
        ctx.translate(f.pos.x, f.pos.y)
        ctx.rotate(f.spin * t)
        ctx.drawImage(f.img, -dispW / 2, -THROW_DISP_H / 2, dispW, THROW_DISP_H)
        ctx.restore()
      }

      // パーティクル
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / 0.4)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const comboMult = comboMultiplier(streak)

  return (
    <div className="g-laundry-inner">
      <div className="game-nav">
        <button className="game-back jp" onClick={onBack}>
          ← ゲームを選ぶ
        </button>
        <GameShareButton game="laundry" title="洗濯物フリック" />
      </div>
      <div className="g-laundry-hud">
        <span className="g-laundry-hud-score mono">
          SCORE <b>{score}</b>
        </span>
        <span className="g-laundry-lives" aria-label={`残りライフ ${lives}`}>
          {Array.from({ length: LIVES_START }, (_, i) => (
            <span key={i} className={'g-laundry-life' + (i < lives ? '' : ' lost')} />
          ))}
        </span>
        <span className="g-laundry-hud-sub mono">
          Lv.{level} · COMBO ×{comboMult} · BEST {Math.max(initialBest, score)}
        </span>
      </div>
      <div className="g-laundry-screen">
        <canvas ref={canvasRef} className="g-laundry-canvas" />
        {showTip && (
          <div className="g-laundry-tip jp">ドラッグして指を離すとフリック。高いラックほど高得点。</div>
        )}
      </div>
      <div className="g-laundry-legend jp">
        {([2, 1, 0] as RackTier[]).map((tier) => (
          <span className="g-laundry-legend-item" key={tier}>
            <span className="g-laundry-legend-dot" style={{ background: RACK_COLOR[tier] }} />
            {RACK_LABEL[tier]} {RACK_SCORES[tier]}pt
          </span>
        ))}
      </div>
    </div>
  )
}
