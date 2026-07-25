import { useEffect, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  createRun,
  loadBest,
  metersOf,
  saveBest,
  scoreOf,
  step,
  type GameEvent,
  type Input,
  type Run,
} from '../lib/chari'
import type { CutoutsFile } from '../lib/platform'
import { fmtDate, outfits, type Data } from '../lib/useData'
import GameShareButton from './GameShareButton'

// チャリ通: 自動で進む自転車をジャンプと急降下だけで操るエンドレスラン。
// ロジックは lib/chari.ts、ここではCanvas描画・入力・HUD・音を扱う。

const VIEW_W = 960
const VIEW_H = 540
const HERO_X = 220
const SOUND_KEY = 'chari.sound'
const cutouts = cutoutsJson as CutoutsFile
const spriteKeys = Object.keys(cutouts.sprites)
const outfitByKey = new Map(outfits.map((o) => [o.key, o]))
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

type Props = { data: Data; onBack: () => void }
type Result = { meters: number; coins: number; score: number; best: number }
type Particle = {
  kind: 'dust' | 'spark' | 'text'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  text?: string
  color: string
}

function randomKey(prev?: string) {
  let key = spriteKeys[Math.floor(Math.random() * spriteKeys.length)]
  while (spriteKeys.length > 1 && key === prev) key = spriteKeys[Math.floor(Math.random() * spriteKeys.length)]
  return key
}

function createAudio() {
  let ctx: AudioContext | null = null
  let muted = localStorage.getItem(SOUND_KEY) === 'off'
  const context = () => {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  const tone = (freq: number, duration: number, volume = 0.05, slide = 1) => {
    if (muted) return
    const ac = context()
    const at = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(45, freq * slide), at + duration)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(ac.destination)
    osc.start()
    osc.stop(at + duration + 0.02)
  }
  return {
    unlock: () => {
      if (!muted) context()
    },
    play: (kind: GameEvent['kind']) => {
      if (kind === 'jump') tone(260, 0.08, 0.035, 1.8)
      else if (kind === 'airjump') tone(390, 0.1, 0.04, 1.7)
      else if (kind === 'coin') tone(760, 0.07, 0.035, 1.35)
      else if (kind === 'ramp') tone(180, 0.16, 0.05, 2.8)
      else if (kind === 'land') tone(90, 0.05, 0.025, 0.7)
      else if (kind === 'airbonus') tone(520, 0.18, 0.04, 1.8)
      else if (kind === 'crash') tone(150, 0.38, 0.07, 0.2)
      else if (kind === 'fall') tone(330, 0.45, 0.05, 0.15)
    },
    toggle: () => {
      muted = !muted
      localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      if (!muted) {
        context()
        tone(440, 0.05, 0.025, 1.3)
      }
      return muted
    },
    muted: () => muted,
    close: () => void ctx?.close(),
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, cameraX: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, 410)
  sky.addColorStop(0, '#b9dcf2')
  sky.addColorStop(0.58, '#e8d9bd')
  sky.addColorStop(1, '#f3e7d3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)

  ctx.fillStyle = 'rgba(255,239,183,.72)'
  ctx.beginPath()
  ctx.arc(750 - (cameraX * 0.015) % 100, 86, 42, 0, Math.PI * 2)
  ctx.fill()

  // 遠景ビル
  ctx.fillStyle = '#a8b2b3'
  for (let i = -2; i < 15; i++) {
    const x = i * 92 - ((cameraX * 0.08) % 92)
    const h = 58 + ((i * 31 + 120) % 92)
    ctx.fillRect(x, 305 - h, 66, h)
    ctx.fillStyle = 'rgba(255,248,210,.38)'
    for (let wy = 0; wy < h - 20; wy += 21) ctx.fillRect(x + 10, 295 - h + wy, 8, 5)
    ctx.fillStyle = '#a8b2b3'
  }

  // 中景の家並み
  ctx.fillStyle = '#777c78'
  for (let i = -2; i < 11; i++) {
    const x = i * 130 - ((cameraX * 0.18) % 130)
    ctx.fillRect(x, 286, 94, 80)
    ctx.fillStyle = i % 2 ? '#826b5e' : '#6d7777'
    ctx.beginPath()
    ctx.moveTo(x - 8, 286)
    ctx.lineTo(x + 47, 248)
    ctx.lineTo(x + 102, 286)
    ctx.fill()
    ctx.fillStyle = '#777c78'
  }

  // 近景の街路樹・ガードレール
  for (let i = -2; i < 10; i++) {
    const x = i * 150 - ((cameraX * 0.36) % 150)
    ctx.strokeStyle = '#5c574d'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(x + 55, 370)
    ctx.lineTo(x + 55, 303)
    ctx.stroke()
    ctx.fillStyle = '#6e8b61'
    ctx.beginPath()
    ctx.arc(x + 54, 281, 34, 0, Math.PI * 2)
    ctx.arc(x + 34, 300, 25, 0, Math.PI * 2)
    ctx.arc(x + 75, 302, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = '#dad5c8'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(0, 357)
  ctx.lineTo(VIEW_W, 357)
  ctx.stroke()
}

function drawRoadAndItems(ctx: CanvasRenderingContext2D, run: Run, cameraX: number, t: number) {
  for (const s of run.segments) {
    const x = s.x - cameraX
    if (x > VIEW_W + 60 || x + s.w < -60) continue
    ctx.fillStyle = '#3a3a41'
    ctx.fillRect(x, s.y, s.w, VIEW_H - s.y)
    ctx.fillStyle = '#4d4d57'
    ctx.fillRect(x, s.y, s.w, 9)
    ctx.strokeStyle = 'rgba(255,255,255,.26)'
    ctx.lineWidth = 3
    ctx.setLineDash([34, 28])
    ctx.beginPath()
    ctx.moveTo(x, s.y + 75)
    ctx.lineTo(x + s.w, s.y + 75)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const coin of run.coins) {
    if (coin.taken) continue
    const x = coin.x - cameraX
    if (x < -30 || x > VIEW_W + 30) continue
    const squash = 0.35 + Math.abs(Math.cos(t * 5 + coin.id)) * 0.65
    ctx.fillStyle = '#e8a33d'
    ctx.beginPath()
    ctx.ellipse(x, coin.y, 10 * squash, 13, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#f8d784'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  for (const o of run.obstacles) {
    const x = o.x - cameraX
    if (x < -80 || x > VIEW_W + 80) continue
    if (o.kind === 'pylon') {
      ctx.fillStyle = '#ed713e'
      ctx.beginPath()
      ctx.moveTo(x + o.w / 2, o.y)
      ctx.lineTo(x + o.w, o.y + o.h)
      ctx.lineTo(x, o.y + o.h)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#f6eee0'
      ctx.fillRect(x + 5, o.y + 18, o.w - 10, 5)
    } else if (o.kind === 'fence') {
      ctx.fillStyle = '#f1b542'
      ctx.fillRect(x, o.y + 5, o.w, 10)
      ctx.fillRect(x, o.y + 27, o.w, 9)
      ctx.fillStyle = '#55535a'
      ctx.fillRect(x + 3, o.y, 5, o.h)
      ctx.fillRect(x + o.w - 8, o.y, 5, o.h)
    } else {
      ctx.fillStyle = o.used ? '#77747b' : '#dc9b36'
      ctx.beginPath()
      ctx.moveTo(x, o.y + o.h)
      ctx.lineTo(x + o.w, o.y)
      ctx.lineTo(x + o.w, o.y + o.h)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#f4d38b'
      ctx.stroke()
    }
  }
}

function drawBike(
  ctx: CanvasRenderingContext2D,
  run: Run,
  image: HTMLImageElement | null,
  ratio: number,
  crashTilt: number,
) {
  const p = run.player
  const x = HERO_X
  const y = p.y
  const spin = run.distance / 18
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(crashTilt)
  const wheelY = -15
  for (const wx of [-27, 29]) {
    ctx.strokeStyle = '#202126'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(wx, wheelY, 21, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(235,235,235,.65)'
    ctx.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      const a = spin + (i * Math.PI) / 3
      ctx.beginPath()
      ctx.moveTo(wx, wheelY)
      ctx.lineTo(wx + Math.cos(a) * 19, wheelY + Math.sin(a) * 19)
      ctx.stroke()
    }
  }
  ctx.strokeStyle = '#436d78'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-27, wheelY)
  ctx.lineTo(-5, -42)
  ctx.lineTo(17, wheelY)
  ctx.lineTo(-27, wheelY)
  ctx.lineTo(3, wheelY)
  ctx.lineTo(29, wheelY)
  ctx.moveTo(-5, -42)
  ctx.lineTo(17, -45)
  ctx.lineTo(29, wheelY)
  ctx.stroke()
  ctx.strokeStyle = '#202126'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(15, -45)
  ctx.lineTo(24, -55)
  ctx.lineTo(33, -55)
  ctx.moveTo(-12, -44)
  ctx.lineTo(-1, -44)
  ctx.stroke()

  if (image?.complete) {
    const h = 93
    const w = Math.max(28, h * ratio)
    ctx.save()
    // スプライトの足元をペダル付近へ置き、人物と自転車を一体に見せる。
    ctx.translate(-1, -37)
    ctx.rotate(-0.13)
    ctx.drawImage(image, -w / 2, -h, w, h)
    ctx.restore()
  } else {
    ctx.fillStyle = '#24252a'
    ctx.beginPath()
    ctx.arc(0, -114, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(-12, -100, 24, 58)
  }
  ctx.restore()
}

export default function ChariGameView({ data, onBack }: Props) {
  void data
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const meterRef = useRef<HTMLSpanElement>(null)
  const coinRef = useRef<HTMLSpanElement>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const bestRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<Input>({ jumpPressed: false, jumpHeld: false, diveHeld: false })
  const audioRef = useRef<ReturnType<typeof createAudio> | null>(null)
  const spriteRef = useRef<HTMLImageElement | null>(null)
  const ratioRef = useRef(0.5)
  const [caption, setCaption] = useState('')
  const [muted, setMuted] = useState(() => localStorage.getItem(SOUND_KEY) === 'off')
  const [touch, setTouch] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [resetTick, setResetTick] = useState(0)
  const keyRef = useRef('')

  const changeOutfit = () => {
    const key = randomKey(keyRef.current)
    keyRef.current = key
    const img = new Image()
    img.src = spriteUrl(key)
    spriteRef.current = img
    const sp = cutouts.sprites[key]
    ratioRef.current = sp.w / sp.h
    const outfit = outfitByKey.get(key)
    setCaption(outfit?.no ? `#${outfit.no} · ${fmtDate(outfit.date)}` : fmtDate(outfit?.date ?? ''))
  }

  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
    audioRef.current = createAudio()
    changeOutfit()
    return () => {
      audioRef.current?.close()
      audioRef.current = null
    }
    // 初回だけ音と衣装を準備する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const run = createRun()
    const particles: Particle[] = []
    let raf = 0
    let last = performance.now()
    let disposed = false
    let finished = false
    let crashAt = 0

    const addParticles = (e: GameEvent) => {
      if (e.kind === 'land') {
        for (let i = 0; i < 7; i++) {
          particles.push({
            kind: 'dust', x: e.x, y: e.y, vx: -30 - Math.random() * 80,
            vy: -20 - Math.random() * 60, life: 0.45, max: 0.45, color: '#d7cec0',
          })
        }
      } else if (e.kind === 'coin' || e.kind === 'airbonus') {
        particles.push({
          kind: 'text', x: e.x, y: e.y - 70, vx: 0, vy: -42, life: 0.75, max: 0.75,
          text: e.kind === 'coin' ? '+10' : 'AIR!', color: e.kind === 'coin' ? '#ffd25e' : '#9ee4ff',
        })
      } else if (e.kind === 'crash') {
        crashAt = performance.now()
        for (let i = 0; i < 18; i++) {
          particles.push({
            kind: 'spark', x: e.x, y: e.y - 25, vx: (Math.random() - 0.5) * 280,
            vy: -80 - Math.random() * 180, life: 0.6, max: 0.6, color: '#ff704f',
          })
        }
      }
    }

    const finish = () => {
      if (finished) return
      finished = true
      const score = scoreOf(run)
      saveBest(score)
      const best = loadBest()
      setResult({ meters: metersOf(run), coins: run.coinsTaken, score, best })
      if (bestRef.current) bestRef.current.textContent = String(best)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (e.repeat && (key === ' ' || key === 'z' || key === 'arrowup')) return
      if (key === ' ' || key === 'z' || key === 'arrowup') {
        e.preventDefault()
        audioRef.current?.unlock()
        inputRef.current.jumpPressed = true
        inputRef.current.jumpHeld = true
      } else if (key === 'arrowdown' || key === 'x') {
        e.preventDefault()
        audioRef.current?.unlock()
        inputRef.current.diveHeld = true
      } else if (key === 'r') {
        setResult(null)
        setResetTick((n) => n + 1)
      } else if (key === 'escape') onBack()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === ' ' || key === 'z' || key === 'arrowup') inputRef.current.jumpHeld = false
      if (key === 'arrowdown' || key === 'x') inputRef.current.diveHeld = false
    }
    const jumpDown = (e: PointerEvent) => {
      if (run.status !== 'playing') return
      canvas.setPointerCapture(e.pointerId)
      audioRef.current?.unlock()
      inputRef.current.jumpPressed = true
      inputRef.current.jumpHeld = true
    }
    const jumpUp = () => {
      inputRef.current.jumpHeld = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', jumpDown)
    canvas.addEventListener('pointerup', jumpUp)
    canvas.addEventListener('pointercancel', jumpUp)

    const frame = (now: number) => {
      if (disposed) return
      const rawDt = Math.min(0.034, (now - last) / 1000)
      last = now
      const slow = crashAt && now - crashAt < 480 ? 0.24 : 1
      if (run.status === 'playing') {
        step(run, inputRef.current, rawDt * slow)
        inputRef.current.jumpPressed = false
        for (const e of run.events) {
          audioRef.current?.play(e.kind)
          addParticles(e)
        }
        if (run.overReason) finish()
      }

      const cameraX = run.player.x - HERO_X
      drawBackground(ctx, cameraX)
      drawRoadAndItems(ctx, run, cameraX, now / 1000)
      const crashTilt = run.overReason === 'crash' ? Math.min(1.18, ((now - crashAt) / 420) * 1.18) : 0
      drawBike(ctx, run, spriteRef.current, ratioRef.current, crashTilt)

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= rawDt
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        p.x += p.vx * rawDt
        p.y += p.vy * rawDt
        p.vy += 240 * rawDt
        const alpha = p.life / p.max
        const sx = p.x - cameraX
        ctx.globalAlpha = alpha
        ctx.fillStyle = p.color
        if (p.kind === 'text') {
          ctx.font = 'bold 22px ui-monospace, monospace'
          ctx.textAlign = 'center'
          ctx.fillText(p.text ?? '', sx, p.y)
        } else {
          ctx.beginPath()
          ctx.arc(sx, p.y, p.kind === 'dust' ? 5 : 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      if (run.overReason === 'crash' && now - crashAt < 190) {
        ctx.fillStyle = `rgba(255,80,55,${0.3 * (1 - (now - crashAt) / 190)})`
        ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      }
      if (meterRef.current) meterRef.current.textContent = String(metersOf(run))
      if (coinRef.current) coinRef.current.textContent = String(run.coinsTaken)
      if (scoreRef.current) scoreRef.current.textContent = String(scoreOf(run))
      if (bestRef.current) bestRef.current.textContent = String(Math.max(loadBest(), scoreOf(run)))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', jumpDown)
      canvas.removeEventListener('pointerup', jumpUp)
      canvas.removeEventListener('pointercancel', jumpUp)
      inputRef.current = { jumpPressed: false, jumpHeld: false, diveHeld: false }
    }
  }, [onBack, resetTick])

  const retry = () => {
    setResult(null)
    setResetTick((n) => n + 1)
  }
  const shareResultOnX = () => {
    if (!result) return
    const url = `${location.origin}${import.meta.env.BASE_URL}game/chari/`
    const record = result.score >= result.best ? '（自己ベスト更新！）' : ''
    const text = `出勤服アーカイブの「チャリ通」で ${result.meters}m 走りました！ SCORE ${result.score}${record} #出勤服アーカイブ`
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }
  const dive = (v: boolean) => () => {
    audioRef.current?.unlock()
    inputRef.current.diveHeld = v
  }

  return (
    <main className="chari">
      <div className="chari-inner">
        <div className="chari-head">
          <button className="chari-back jp" onClick={onBack}>← ゲーム</button>
          <h2 className="chari-title jp">チャリ通</h2>
          <span className="chari-stats mono">
            <span ref={meterRef}>0</span>m · COIN <span ref={coinRef}>0</span> · SCORE{' '}
            <span ref={scoreRef}>0</span> · BEST <span ref={bestRef}>{loadBest()}</span>
          </span>
          <button className="chari-change jp" onClick={changeOutfit}>着替え</button>
          <button
            className="chari-sound mono"
            onClick={() => setMuted(audioRef.current?.toggle() ?? muted)}
            aria-label={muted ? 'サウンドをオン' : 'サウンドをオフ'}
          >
            {muted ? '音 OFF' : '音 ON'}
          </button>
          <GameShareButton game="chari" title="チャリ通" />
        </div>
        <div className="chari-screen">
          <canvas ref={canvasRef} className="chari-canvas" aria-label="チャリ通のゲーム画面" />
          {result && (
            <div className="chari-overlay">
              <div className="chari-result jp">
                <small>{result.score >= result.best ? '自己ベスト更新！' : '通勤終了'}</small>
                <b className="mono">{result.meters} m</b>
                <span className="mono">COIN {result.coins} · SCORE {result.score} · BEST {result.best}</span>
                <span className="chari-result-actions">
                  <button className="chari-btn primary jp" onClick={retry}>もういちど</button>
                  <button className="chari-btn jp" onClick={shareResultOnX}>Xでポスト</button>
                  <button className="chari-btn jp" onClick={onBack}>もどる</button>
                </span>
              </div>
            </div>
          )}
          {touch && (
            <div className="chari-pads">
              <button
                className="chari-dive mono"
                onPointerDown={dive(true)}
                onPointerUp={dive(false)}
                onPointerCancel={dive(false)}
                onPointerLeave={dive(false)}
              >
                DIVE
              </button>
            </div>
          )}
        </div>
        <div className="chari-foot">
          <span className="chari-caption mono">{caption}</span>
          <span className="jp">Space / Z / ↑ ジャンプ · ↓ / X 急降下 · R やりなおし · ESC もどる</span>
        </div>
      </div>
    </main>
  )
}
