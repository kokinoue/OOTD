import { useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import { SEASON_COLOR, SEASON_LABEL, seasonOf, type Season } from '../lib/duel'
import {
  createRun,
  deriveTraits,
  dominantColor,
  LEVELS,
  parseLevel,
  PLAYER_H,
  step,
  T_BELT_L,
  T_BELT_R,
  T_EMPTY,
  T_ICE,
  T_SPRING,
  TILE,
  type CutoutsFile,
  type Input,
  type Run,
  type Traits,
} from '../lib/platform'
import { colorBuckets, fmtDate, outfits, type Data } from '../lib/useData'

// ランウェイ: 出勤服からくり抜いた自分を操作するミニプラットフォーマー。
// キャラ選択（季節×色で特性が変わる）→ ステージ選択 → Canvasプレイの3画面。
// 物理・進行は lib/platform.ts、ここは描画と入力とUI。

const cutouts = cutoutsJson as CutoutsFile

type Props = {
  data: Data
  onBack: () => void
}

type Chara = {
  key: string
  no: number | null
  date: string
  season: Season
  color?: string
  traits: Traits
  ratio: number // スプライトの縦横比（w/h）
}

const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

const CHAR_KEY = 'plat.char'
const BEST_KEY = 'plat.best'
const SOUND_KEY = 'plat.sound'

type Best = { time: number; coins: number; total: number; miss: number }
const loadBest = (): Record<string, Best> => {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const colorLabel = (name?: string) => colorBuckets.find((b) => b.name === name)
const fmtTime = (t: number) => t.toFixed(1)

// ----------------------------------------------------------------------------
// 描画（Canvas）
// ----------------------------------------------------------------------------
const VIEW_W = 960
const VIEW_H = 540

const COL = {
  bg: '#f1eee3',
  grid: 'rgba(0, 0, 0, 0.04)',
  tile: '#3a3a41',
  tileTop: '#4d4d57',
  ice: '#bfe0f0',
  iceTop: '#e6f5fc',
  beltMark: '#c9c9ce',
  spikeBase: '#a34040',
  coin: '#e8a33d',
  coinCore: '#f6c86a',
  spring: '#e8a33d',
  door: '#69ac6c',
  doorDark: '#4c8a50',
  walker: '#8a5fc0',
  hopper: '#57b8a0',
}

type StageTheme = {
  label: string
  sky: [string, string, string]
  glow: string
  grid: string
  far: string
  tile: string
  tileTop: string
  accent: string
  accentSoft: string
  ambience: 'city' | 'embers' | 'petals' | 'snow' | 'neon' | 'storm'
}

// 描画ループ内でオブジェクトを作り直さない、ステージ固定の演出設定。
const STAGE_THEMES: Record<string, StageTheme> = {
  'RUN & JUMP': {
    label: 'CITY LIGHTS', sky: ['#17172d', '#35304d', '#80726f'], glow: '#f4cd9f',
    grid: 'rgba(255,255,255,.035)', far: 'rgba(15,15,27,.28)', tile: '#34343d',
    tileTop: '#555260', accent: '#9edfff', accentSoft: '#d9f2ff', ambience: 'city',
  },
  'SPIKE VALLEY': {
    label: 'DANGER ZONE', sky: ['#210d19', '#54212a', '#a34437'], glow: '#ff765f',
    grid: 'rgba(255,155,130,.045)', far: 'rgba(31,5,15,.42)', tile: '#34272f',
    tileTop: '#77404a', accent: '#ff776f', accentSoft: '#ffd0bb', ambience: 'embers',
  },
  SPRING: {
    label: 'BLOOM HIGH', sky: ['#20223f', '#6b4f79', '#d58b8b'], glow: '#ffd89a',
    grid: 'rgba(255,230,240,.04)', far: 'rgba(51,30,67,.3)', tile: '#41354d',
    tileTop: '#8b6689', accent: '#ff9bc7', accentSoft: '#ffe0ef', ambience: 'petals',
  },
  ICE: {
    label: 'AURORA ICE', sky: ['#071d36', '#164962', '#739aa6'], glow: '#a5fff0',
    grid: 'rgba(190,244,255,.055)', far: 'rgba(5,28,47,.38)', tile: '#213d52',
    tileTop: '#4d8294', accent: '#a7f3ff', accentSoft: '#e3fbff', ambience: 'snow',
  },
  BELT: {
    label: 'NEON FLOW', sky: ['#100c27', '#25205a', '#4c3875'], glow: '#a87cff',
    grid: 'rgba(99,240,255,.08)', far: 'rgba(9,6,29,.4)', tile: '#262745',
    tileTop: '#546b8d', accent: '#63f0ff', accentSoft: '#c9fbff', ambience: 'neon',
  },
  'HOP & STOMP': {
    label: 'FINAL SHOWDOWN', sky: ['#120b23', '#392057', '#743f68'], glow: '#dc86ff',
    grid: 'rgba(230,180,255,.045)', far: 'rgba(17,6,31,.46)', tile: '#30273e',
    tileTop: '#6d527d', accent: '#dfa1ff', accentSoft: '#f6e0ff', ambience: 'storm',
  },
}

const themeFor = (title: string) => STAGE_THEMES[title] ?? STAGE_THEMES['RUN & JUMP']

const MUSIC_PATTERNS = [
  { ms: 620, notes: [262, 330, 392, 330, 294, 370, 440, 370] },
  { ms: 540, notes: [196, 233, 262, 233, 196, 175, 196, 220] },
  { ms: 680, notes: [294, 370, 440, 494, 440, 370, 330, 370] },
  { ms: 760, notes: [220, 277, 330, 415, 330, 277, 247, 277] },
  { ms: 470, notes: [165, 220, 247, 330, 247, 220, 196, 247] },
  { ms: 500, notes: [147, 175, 220, 262, 220, 196, 175, 131] },
] as const

function drawStageBackdrop(
  ctx: CanvasRenderingContext2D,
  theme: StageTheme,
  t: number,
  camX: number,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H)
  sky.addColorStop(0, theme.sky[0])
  sky.addColorStop(0.58, theme.sky[1])
  sky.addColorStop(1, theme.sky[2])
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)

  const glowX = VIEW_W * 0.68 - camX * 0.025
  const glow = ctx.createRadialGradient(glowX, 90, 5, glowX, 90, 260)
  glow.addColorStop(0, `${theme.glow}42`)
  glow.addColorStop(1, `${theme.glow}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)

  ctx.fillStyle = theme.far
  if (theme.ambience === 'city' || theme.ambience === 'neon') {
    for (let i = -1; i < 13; i++) {
      const bx = i * 96 - ((camX * 0.12) % 96)
      const bh = 48 + ((i * 37 + 91) % 72)
      ctx.fillRect(bx, VIEW_H - 116 - bh, 68, bh)
      if (theme.ambience === 'neon') {
        ctx.fillStyle = i % 2 ? 'rgba(99,240,255,.12)' : 'rgba(218,111,255,.1)'
        ctx.fillRect(bx + 9, VIEW_H - 105 - bh, 3, Math.max(12, bh - 18))
        ctx.fillStyle = theme.far
      }
    }
  } else {
    // 山・丘の輪郭はステージごとに色を変え、近景よりゆっくり流す。
    ctx.beginPath()
    ctx.moveTo(0, VIEW_H - 92)
    for (let x = 0; x <= VIEW_W + 120; x += 120) {
      const peak = theme.ambience === 'embers' || theme.ambience === 'storm' ? 95 : 48
      ctx.lineTo(x - ((camX * 0.08) % 120), VIEW_H - 92 - ((x / 120) % 2 ? peak : peak * 0.45))
    }
    ctx.lineTo(VIEW_W, VIEW_H)
    ctx.lineTo(0, VIEW_H)
    ctx.fill()
  }

  if (theme.ambience === 'snow') {
    // オーロラの帯
    ctx.lineWidth = 22
    for (let band = 0; band < 3; band++) {
      ctx.strokeStyle = band === 1 ? 'rgba(119,255,220,.1)' : 'rgba(132,184,255,.08)'
      ctx.beginPath()
      for (let x = -30; x <= VIEW_W + 30; x += 30) {
        const y = 74 + band * 31 + Math.sin(x * 0.008 + t * 0.42 + band) * 22
        if (x === -30) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // 環境粒子。乱数を使わず、各粒子の位相を固定してフレーム間のちらつきを防ぐ。
  const count = theme.ambience === 'storm' ? 16 : 26
  for (let i = 0; i < count; i++) {
    const seedX = (i * 173 + 47) % VIEW_W
    const seedY = (i * 97 + 29) % 380
    let x = seedX
    let y = seedY
    let color = theme.accentSoft
    let size = 1.5
    ctx.globalAlpha = 0.22 + (i % 4) * 0.08
    if (theme.ambience === 'embers') {
      x = (seedX + Math.sin(t + i) * 18) % VIEW_W
      y = (seedY - t * (15 + (i % 5) * 4) + 1000) % 430
      color = i % 3 ? '#ff8b58' : '#ffd084'
      size = 1.4 + (i % 3)
    } else if (theme.ambience === 'petals') {
      x = (seedX + t * (11 + (i % 4) * 3)) % (VIEW_W + 30) - 15
      y = (seedY + t * (7 + (i % 3) * 2)) % 400
      color = i % 2 ? '#ffb4d2' : '#ffe2eb'
      size = 2.2 + (i % 2)
    } else if (theme.ambience === 'snow') {
      x = (seedX + Math.sin(t * 0.7 + i) * 22) % VIEW_W
      y = (seedY + t * (10 + (i % 5) * 3)) % 410
      color = '#e8fbff'
      size = 1 + (i % 3)
    } else if (theme.ambience === 'neon') {
      x = (seedX - t * (24 + (i % 5) * 8) + VIEW_W * 10) % VIEW_W
      y = 60 + (seedY % 310)
      color = i % 2 ? '#63f0ff' : '#da6fff'
      size = 1
    } else if (theme.ambience === 'storm') {
      x = seedX
      y = 50 + (seedY % 260)
      color = i % 2 ? '#dfa1ff' : '#7fdcff'
      size = 1.5 + (i % 2)
    } else {
      y = 60 + (seedY % 270)
      color = '#ffe2b5'
    }
    ctx.fillStyle = color
    if (theme.ambience === 'petals' || theme.ambience === 'neon') {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.8 + i)
      ctx.fillRect(-size * 2, -size / 2, size * 4, size)
      ctx.restore()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1

  if (theme.ambience === 'storm' && Math.sin(t * 1.7) > 0.985) {
    ctx.strokeStyle = 'rgba(225,215,255,.34)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(720, 0)
    ctx.lineTo(690, 62)
    ctx.lineTo(714, 55)
    ctx.lineTo(676, 132)
    ctx.stroke()
  }
}

type Particle = {
  kind: 'dot' | 'spark' | 'ring' | 'text' | 'ghost'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  r: number
  text?: string
  rotation?: number
}

// 外部音源なしで、操作の瞬間だけ短いSEを合成する。
// AudioContextはユーザー操作後に初めて起動するため、自動再生制限にも抵触しない。
function createRunwayAudio() {
  let audio: AudioContext | null = null
  let muted = localStorage.getItem(SOUND_KEY) === 'off'
  let musicStage = 0
  let musicBeat = 0
  let musicTimer: number | null = null

  const context = () => {
    if (!audio) audio = new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    return audio
  }
  const tone = (
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slide = 1,
    delay = 0,
  ) => {
    if (muted) return
    const ac = context()
    const at = ac.currentTime + delay
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * slide), at + duration)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.012, duration / 3))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(ac.destination)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }
  const noise = (duration: number, volume: number, highpass = 400) => {
    if (muted) return
    const ac = context()
    const frames = Math.max(1, Math.floor(ac.sampleRate * duration))
    const buffer = ac.createBuffer(1, frames, ac.sampleRate)
    const values = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) values[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    const source = ac.createBufferSource()
    const filter = ac.createBiquadFilter()
    const gain = ac.createGain()
    source.buffer = buffer
    filter.type = 'highpass'
    filter.frequency.value = highpass
    gain.gain.value = volume
    source.connect(filter).connect(gain).connect(ac.destination)
    source.start()
  }
  const stopMusic = () => {
    if (musicTimer != null) window.clearInterval(musicTimer)
    musicTimer = null
  }
  const startMusic = () => {
    stopMusic()
    if (muted || !audio) return
    const pattern = MUSIC_PATTERNS[musicStage] ?? MUSIC_PATTERNS[0]
    const tick = () => {
      const note = pattern.notes[musicBeat % pattern.notes.length]
      tone(note, pattern.ms / 1000 * 0.72, 'sine', 0.008, 0.995)
      if (musicBeat % 4 === 0) tone(note / 2, 0.48, 'triangle', 0.006, 0.92)
      musicBeat += 1
    }
    tick()
    musicTimer = window.setInterval(tick, pattern.ms)
  }
  return {
    unlock: () => {
      if (muted) return
      context()
      if (musicTimer == null) startMusic()
    },
    setStage: (stage: number) => {
      musicStage = stage
      musicBeat = 0
      if (musicTimer != null) startMusic()
    },
    isMuted: () => muted,
    toggle: () => {
      muted = !muted
      localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      if (muted) stopMusic()
      else {
        context()
        tone(520, 0.07, 'sine', 0.045, 1.35)
        startMusic()
      }
      return muted
    },
    play: (type: string) => {
      if (type === 'jump') tone(210, 0.09, 'triangle', 0.035, 1.8)
      else if (type === 'airjump') {
        tone(330, 0.12, 'sine', 0.045, 2.1)
        tone(660, 0.09, 'triangle', 0.025, 1.35, 0.025)
      } else if (type === 'land') noise(0.045, 0.018, 180)
      else if (type === 'dash') {
        noise(0.11, 0.035, 900)
        tone(150, 0.12, 'sawtooth', 0.025, 2.7)
      } else if (type === 'coin') {
        tone(880, 0.09, 'sine', 0.04, 1.45)
        tone(1320, 0.08, 'sine', 0.025, 1.15, 0.045)
      } else if (type === 'stomp') {
        tone(115, 0.16, 'square', 0.055, 0.5)
        noise(0.09, 0.04, 260)
      } else if (type === 'spring') {
        tone(140, 0.22, 'triangle', 0.05, 4.2)
        tone(280, 0.16, 'sine', 0.025, 2.4, 0.035)
      } else if (type === 'miss') {
        tone(180, 0.32, 'sawtooth', 0.04, 0.34)
        noise(0.15, 0.025, 160)
      } else if (type === 'clear') {
        ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.035, 1.08, i * 0.09))
      }
    },
    close: () => {
      stopMusic()
      void audio?.close()
    },
  }
}

function drawLevel(ctx: CanvasRenderingContext2D, run: Run, t: number, camX: number, camY: number) {
  const lv = run.level
  const theme = themeFor(lv.title)
  drawStageBackdrop(ctx, theme, t, camX)
  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = -(camX % TILE); x <= VIEW_W; x += TILE) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, VIEW_H)
  }
  for (let y = -(camY % TILE); y <= VIEW_H; y += TILE) {
    ctx.moveTo(0, y)
    ctx.lineTo(VIEW_W, y)
  }
  ctx.stroke()

  const x0 = Math.max(0, Math.floor(camX / TILE))
  const x1 = Math.min(lv.w - 1, Math.ceil((camX + VIEW_W) / TILE))
  const y0 = Math.max(0, Math.floor(camY / TILE))
  const y1 = Math.min(lv.h - 1, Math.ceil((camY + VIEW_H) / TILE))
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const k = lv.cells[ty * lv.w + tx]
      const px = tx * TILE - camX
      const py = ty * TILE - camY
      const aboveEmpty = ty === 0 || lv.cells[(ty - 1) * lv.w + tx] === T_EMPTY
      if (k === T_EMPTY) {
        if (lv.spikes[ty * lv.w + tx]) {
          // トゲ: 赤い帯の上に三角形3つ
          ctx.fillStyle = lv.title === 'SPIKE VALLEY' ? '#ff5d5d' : COL.spikeBase
          ctx.fillRect(px, py + TILE - 5, TILE, 5)
          ctx.fillStyle = theme.tile
          for (let i = 0; i < 3; i++) {
            const sx = px + i * (TILE / 3)
            ctx.beginPath()
            ctx.moveTo(sx + 1, py + TILE - 4)
            ctx.lineTo(sx + TILE / 6, py + 8)
            ctx.lineTo(sx + TILE / 3 - 1, py + TILE - 4)
            ctx.fill()
          }
        }
        continue
      }
      if (k === T_ICE) {
        ctx.fillStyle = COL.ice
        ctx.fillRect(px, py, TILE, TILE)
        if (aboveEmpty) {
          ctx.fillStyle = COL.iceTop
          ctx.fillRect(px, py, TILE, 4)
        }
      } else if (k === T_BELT_L || k === T_BELT_R) {
        ctx.fillStyle = theme.tile
        ctx.fillRect(px, py, TILE, TILE)
        // 流れる向きに動くシェブロン
        const dir = k === T_BELT_R ? 1 : -1
        const off = ((t * 40 * dir) % 12 + 12) % 12
        ctx.strokeStyle = COL.beltMark
        ctx.lineWidth = 2
        for (let i = -1; i < 4; i++) {
          const cx = px + i * 12 + off
          if (cx < px - 6 || cx > px + TILE) continue
          ctx.beginPath()
          ctx.moveTo(cx, py + 4)
          ctx.lineTo(cx + dir * 5, py + 9)
          ctx.lineTo(cx, py + 14)
          ctx.stroke()
        }
      } else if (k === T_SPRING) {
        ctx.fillStyle = theme.tile
        ctx.fillRect(px, py + 12, TILE, TILE - 12)
        ctx.fillStyle = COL.spring
        ctx.fillRect(px + 3, py, TILE - 6, 8)
        ctx.strokeStyle = theme.tileTop
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px + 8, py + 12)
        ctx.lineTo(px + TILE - 8, py + 12)
        ctx.stroke()
      } else {
        ctx.fillStyle = theme.tile
        ctx.fillRect(px, py, TILE, TILE)
        if (aboveEmpty) {
          ctx.fillStyle = theme.tileTop
          ctx.fillRect(px, py, TILE, 3)
        }
      }
    }
  }

  // 開始直後だけ各ステージ固有のショータイトルを表示。
  if (t < 2.4) {
    const q = Math.min(1, t / 0.35) * Math.min(1, (2.4 - t) / 0.45)
    ctx.save()
    ctx.globalAlpha = Math.max(0, q) * 0.76
    ctx.fillStyle = theme.accent
    ctx.fillRect(VIEW_W / 2 - 54, 74, 108, 2)
    ctx.fillStyle = '#fff'
    ctx.font = '700 17px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.letterSpacing = '2px'
    ctx.fillText(theme.label, VIEW_W / 2, 62)
    ctx.restore()
  }

  // コイン（ふわふわ上下）
  for (let i = 0; i < lv.coins.length; i++) {
    if (run.coins[i]) continue
    const c = lv.coins[i]
    const bob = Math.sin(t * 3.2 + c.x * 0.05) * 3
    const cx = c.x - camX
    const cy = c.y - camY + bob
    if (cx < -20 || cx > VIEW_W + 20) continue
    ctx.fillStyle = COL.coin
    ctx.beginPath()
    ctx.arc(cx, cy, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COL.coinCore
    ctx.beginPath()
    ctx.arc(cx - 1.5, cy - 1.5, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // ゴール扉
  const g = lv.goal
  const gx = g.x - camX
  const gy = g.y - camY
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.roundRect(gx, gy, g.w, g.h, [10, 10, 0, 0])
  ctx.fill()
  ctx.fillStyle = theme.tile
  ctx.beginPath()
  ctx.roundRect(gx + 5, gy + 6, g.w - 10, g.h - 6, [7, 7, 0, 0])
  ctx.fill()
  ctx.fillStyle = COL.coinCore
  ctx.beginPath()
  ctx.arc(gx + g.w - 9, gy + g.h / 2 + 4, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

function drawEnemies(ctx: CanvasRenderingContext2D, run: Run, t: number, camX: number, camY: number) {
  for (const e of run.enemies) {
    if (e.dead) continue
    const x = e.x - camX
    const y = e.y - camY
    if (x < -40 || x > VIEW_W + 40) continue
    const grounded = e.vy === 0
    // 跳ねる前のタメ／歩きの揺れで squash
    const squash =
      e.kind === 'hopper'
        ? grounded
          ? 1 - Math.min(0.25, Math.max(0, 0.9 - e.timer) * 0.4)
          : 1.12
        : 1 + Math.sin(t * 10 + e.x) * 0.04
    const w = 26 / squash
    const h = 22 * squash
    ctx.fillStyle = e.kind === 'walker' ? COL.walker : COL.hopper
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - h, w, h, 8)
    ctx.fill()
    // 目（進行方向を見る）
    const look = e.kind === 'walker' ? Math.sign(e.vx) * 2.5 : 0
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(x - 5 + look, y - h + 8, 2.6, 0, Math.PI * 2)
    ctx.arc(x + 5 + look, y - h + 8, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ----------------------------------------------------------------------------
// 画面
// ----------------------------------------------------------------------------
export default function PlatformGameView({ data, onBack }: Props) {
  // くり抜きスプライトがあるコーデだけがプレイアブルキャラになる
  const charas = useMemo<Chara[]>(() => {
    const list: Chara[] = []
    for (const o of outfits) {
      const sp = cutouts.sprites[o.key]
      if (!sp) continue
      const ids = data.outfitItemIds.get(o.key)
      const color = dominantColor([...(ids ?? [])].map((id) => data.itemMap.get(id)?.color))
      list.push({
        key: o.key,
        no: o.no,
        date: o.date,
        season: seasonOf(o.date),
        color,
        traits: deriveTraits(o.date, color),
        ratio: sp.w / sp.h,
      })
    }
    return list
  }, [data])

  const [charKey, setCharKey] = useState<string | null>(() => {
    const k = localStorage.getItem(CHAR_KEY)
    return k && cutouts.sprites[k] ? k : null
  })
  const chara = charas.find((c) => c.key === charKey) ?? null
  const [screen, setScreen] = useState<'select' | 'stages' | 'play'>(chara ? 'stages' : 'select')
  const [stageIdx, setStageIdx] = useState(0)
  const [best, setBest] = useState<Record<string, Best>>(loadBest)

  const pickChara = (key: string) => {
    localStorage.setItem(CHAR_KEY, key)
    setCharKey(key)
    setScreen('stages')
    window.scrollTo({ top: 0 })
  }

  const saveBest = (idx: number, r: Best) => {
    setBest((cur) => {
      const prev = cur[idx]
      const better =
        !prev || r.coins > prev.coins || (r.coins === prev.coins && r.time < prev.time)
      const next = better ? { ...cur, [idx]: r } : cur
      localStorage.setItem(BEST_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <main className="plat">
      {screen === 'select' && (
        <CharaSelect charas={charas} current={charKey} onPick={pickChara} onBack={onBack} />
      )}
      {screen === 'stages' && chara && (
        <StageSelect
          chara={chara}
          best={best}
          onStart={(i) => {
            setStageIdx(i)
            setScreen('play')
          }}
          onChangeChara={() => setScreen('select')}
          onBack={onBack}
        />
      )}
      {screen === 'play' && chara && (
        <Play
          chara={chara}
          stageIdx={stageIdx}
          onClearBest={saveBest}
          onExit={() => setScreen('stages')}
          onNext={() => setStageIdx((i) => Math.min(LEVELS.length - 1, i + 1))}
        />
      )}
    </main>
  )
}

// --- キャラ選択 ---------------------------------------------------------------
function CharaSelect({
  charas,
  current,
  onPick,
  onBack,
}: {
  charas: Chara[]
  current: string | null
  onPick: (key: string) => void
  onBack: () => void
}) {
  const [season, setSeason] = useState<Season | 'all'>('all')
  const filtered = season === 'all' ? charas : charas.filter((c) => c.season === season)
  const seasons: (Season | 'all')[] = ['all', 'spring', 'summer', 'autumn', 'winter']

  return (
    <div className="plat-inner">
      <div className="game-nav">
        <button className="game-back jp" onClick={onBack}>
          ← ゲーム選択にもどる
        </button>
        <GameShareButton game="platform" title="ランウェイ" />
      </div>
      <h2 className="plat-title jp">ランウェイ</h2>
      <p className="plat-sub jp">
        操作キャラにする出勤服を選んでください。季節と色で特性が変わります（全{charas.length}着）。
      </p>
      <div className="plat-filter">
        {seasons.map((s) => (
          <button
            key={s}
            className={`plat-chip jp ${season === s ? 'active' : ''}`}
            onClick={() => setSeason(s)}
          >
            {s === 'all' ? 'すべて' : SEASON_LABEL[s]}
          </button>
        ))}
        <button
          className="plat-chip jp"
          onClick={() => onPick(filtered[Math.floor(Math.random() * filtered.length)].key)}
          disabled={filtered.length === 0}
        >
          おまかせ
        </button>
      </div>
      <div className="plat-chara-grid">
        {filtered.map((c) => (
          <button
            key={c.key}
            className={`plat-chara ${current === c.key ? 'selected' : ''}`}
            onClick={() => onPick(c.key)}
          >
            <span className="plat-chara-stage">
              <img src={spriteUrl(c.key)} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="plat-chara-no mono">#{c.no ?? '—'}</span>
            <span className="plat-chara-date mono">{fmtDate(c.date)}</span>
            <span className="plat-chara-tags">
              <span className="plat-tag jp" style={{ background: SEASON_COLOR[c.season] }}>
                {SEASON_LABEL[c.season]}
              </span>
              {colorLabel(c.color) && (
                <span
                  className="plat-tag jp plat-tag-color"
                  style={{ background: colorLabel(c.color)!.swatch }}
                >
                  {colorLabel(c.color)!.label}
                </span>
              )}
            </span>
            <span className="plat-chara-traits jp">
              {c.traits.notes.map((n) => n.name).join(' / ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// --- ステージ選択 ---------------------------------------------------------------
function StageSelect({
  chara,
  best,
  onStart,
  onChangeChara,
  onBack,
}: {
  chara: Chara
  best: Record<string, Best>
  onStart: (i: number) => void
  onChangeChara: () => void
  onBack: () => void
}) {
  return (
    <div className="plat-inner">
      <button className="game-back jp" onClick={onBack}>
        ← ゲーム選択にもどる
      </button>
      <h2 className="plat-title jp">ランウェイ</h2>
      <div className="plat-lobby">
        <div className="plat-lobby-chara">
          <span className="plat-chara-stage big">
            <img src={spriteUrl(chara.key)} alt="" />
          </span>
          <div className="plat-lobby-meta">
            <span className="mono">#{chara.no ?? '—'} · {fmtDate(chara.date)}</span>
            <span className="plat-chara-tags">
              <span className="plat-tag jp" style={{ background: SEASON_COLOR[chara.season] }}>
                {SEASON_LABEL[chara.season]}
              </span>
              {colorLabel(chara.color) && (
                <span
                  className="plat-tag jp plat-tag-color"
                  style={{ background: colorLabel(chara.color)!.swatch }}
                >
                  {colorLabel(chara.color)!.label}
                </span>
              )}
            </span>
            <ul className="plat-traits jp">
              {chara.traits.notes.map((n) => (
                <li key={n.name}>
                  <b>{n.name}</b> — {n.desc}
                </li>
              ))}
            </ul>
            <button className="plat-change jp" onClick={onChangeChara}>
              べつの服にする →
            </button>
          </div>
        </div>
        <div className="plat-stage-list">
          {LEVELS.map((lv, i) => {
            const b = best[i]
            return (
              <button key={lv.title} className="plat-stage" onClick={() => onStart(i)}>
                <span className="plat-stage-no mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="plat-stage-name mono">{lv.title}</span>
                <span className="plat-stage-best mono">
                  {b
                    ? `★ コイン ${b.coins}/${b.total} · タイム ${fmtTime(b.time)} · ミス ${b.miss}`
                    : '未クリア'}
                </span>
                <span className="plat-stage-go jp">あそぶ →</span>
              </button>
            )
          })}
        </div>
      </div>
      <p className="plat-help jp">
        ←→ 移動 / Z・スペース ジャンプ（空中でもう1回） / X ダッシュ / R やりなおし / ESC ステージ選択
      </p>
    </div>
  )
}

// --- プレイ画面 ---------------------------------------------------------------
function Play({
  chara,
  stageIdx,
  onClearBest,
  onExit,
  onNext,
}: {
  chara: Chara
  stageIdx: number
  onClearBest: (i: number, b: Best) => void
  onExit: () => void
  onNext: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudCoinRef = useRef<HTMLSpanElement>(null)
  const hudMissRef = useRef<HTMLSpanElement>(null)
  const hudTimeRef = useRef<HTMLSpanElement>(null)
  const hudFlowRef = useRef<HTMLSpanElement>(null)
  const [cleared, setCleared] = useState<Best | null>(null)
  const [showTip, setShowTip] = useState(true)
  const [restartTick, setRestartTick] = useState(0)
  const audioRef = useRef<ReturnType<typeof createRunwayAudio> | null>(null)
  if (!audioRef.current) audioRef.current = createRunwayAudio()
  const [muted, setMuted] = useState(() => audioRef.current!.isMuted())
  const touch = useMemo(
    () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    [],
  )
  // 全画面（スマホは横向きに固定してコントローラーふうに遊ぶ）。
  // iPhone Safari は Fullscreen API 非対応なので、fixed オーバーレイの擬似全画面で代替する。
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isFs, setIsFs] = useState(false)
  const [pseudoFs, setPseudoFs] = useState(false)
  useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  // 擬似全画面中は背後のページがスクロールしないようにする
  useEffect(() => {
    if (!pseudoFs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [pseudoFs])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (pseudoFs) {
      setPseudoFs(false)
      return
    }
    const el = wrapRef.current
    if (!el) return
    if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen()
        .then(() => {
          // 横向きロックは対応端末のみ（iOS は lock 自体がない）
          const so = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>
          }
          so.lock?.('landscape').catch(() => {})
        })
        .catch(() => setPseudoFs(true)) // 拒否されたら擬似全画面に切り替え
    } else {
      setPseudoFs(true)
    }
  }
  // タッチボタンの押下状態（ゲームループから参照）
  const touchKeys = useRef({ left: false, right: false, jump: false, jumpEdge: false, dash: false })

  const level = useMemo(() => parseLevel(LEVELS[stageIdx]), [stageIdx])
  const totalCoins = level.coins.length
  const stageTheme = themeFor(level.title)

  useEffect(() => () => audioRef.current?.close(), [])
  useEffect(() => audioRef.current?.setStage(stageIdx), [stageIdx])

  useEffect(() => {
    setCleared(null)
    setShowTip(true)
    window.scrollTo({ top: 0 }) // 小さい画面でもHUDからパッドまで一目で収める
    const tipTimer = setTimeout(() => setShowTip(false), 5500)

    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr

    const sprite = new Image()
    sprite.src = spriteUrl(chara.key)

    let run = createRun(level, chara.traits)
    const keys = { left: false, right: false, jump: false, dash: false }
    let jumpEdge = false
    let dashEdge = false
    let reported = false
    let particles: Particle[] = []
    let camX = 0
    let squashT = 0
    let raf = 0
    let last = performance.now()
    let acc = 0
    let t = 0
    let introT = 2.15
    let hitStop = 0
    let flash = 0
    let flashColor = '#fff'
    let coinStreak = 0
    let lastCoinAt = -10
    let flow = 0
    let flowUntil = 0
    let lastTrailAt = -10
    let goalCinematic = 0
    let clearRevealTimer: number | null = null
    const DT = 1 / 60
    const audio = audioRef.current!

    const onKeyDown = (e: KeyboardEvent) => {
      audio.unlock()
      if (e.repeat) return
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true
      else if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true
      else if (e.key === 'z' || e.key === 'Z' || e.key === ' ' || e.key === 'ArrowUp') {
        keys.jump = true
        jumpEdge = true
        e.preventDefault()
      } else if (e.key === 'x' || e.key === 'X' || e.key === 'Shift') dashEdge = true
      else if (e.key === 'r' || e.key === 'R') setRestartTick((n) => n + 1)
      else if (e.key === 'Escape') onExit()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false
      else if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false
      else if (e.key === 'z' || e.key === 'Z' || e.key === ' ' || e.key === 'ArrowUp') keys.jump = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const emit = (p: Omit<Particle, 'maxLife'>) => particles.push({ ...p, maxLife: p.life })
    const burst = (x: number, y: number, count: number, color: string, speed: number, life: number) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.2
        const v = speed * (0.55 + Math.random() * 0.65)
        emit({
          kind: i % 3 === 0 ? 'spark' : 'dot', x, y,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          life: life * (0.7 + Math.random() * 0.5), color,
          r: 2 + Math.random() * 3, rotation: a,
        })
      }
    }
    const label = (x: number, y: number, text: string, color = '#fff', size = 18) =>
      emit({ kind: 'text', x, y, vx: 0, vy: -42, life: 0.7, color, r: size, text })
    const ring = (x: number, y: number, color: string, radius = 10, life = 0.35) =>
      emit({ kind: 'ring', x, y, vx: 0, vy: 0, life, color, r: radius })
    const bumpFlow = (amount = 1) => {
      flow = Math.min(9, flow + amount)
      flowUntil = t + 2.2
    }

    const spawnFx = () => {
      for (const ev of run.events) {
        audio.play(ev.type)
        if (ev.type === 'coin') {
          bumpFlow()
          coinStreak = t - lastCoinAt < 1.35 ? coinStreak + 1 : 1
          lastCoinAt = t
          burst(ev.x, ev.y, 14, '#ffd36a', 150, 0.48)
          ring(ev.x, ev.y, '#fff0a8', 8, 0.32)
          label(ev.x, ev.y - 12, coinStreak > 1 ? `+1  ×${coinStreak}` : '+1', '#fff2a4', 17)
          flash = 0.09
          flashColor = '#ffe9a3'
        } else if (ev.type === 'land' || ev.type === 'jump') {
          squashT = ev.type === 'land' ? 0.14 : 0
          for (let i = 0; i < 6; i++) emit({
            kind: 'dot', x: ev.x + (i - 2.5) * 5, y: ev.y,
            vx: (i - 2.5) * 35, vy: -35 - Math.random() * 35,
            life: 0.3, color: 'rgba(245,224,210,.58)', r: 2.5,
          })
          if (ev.type === 'land') ring(ev.x, ev.y, 'rgba(255,255,255,.36)', 8, 0.23)
        } else if (ev.type === 'airjump') {
          bumpFlow()
          ring(ev.x, ev.y - 22, stageTheme.accent, 12, 0.42)
          burst(ev.x, ev.y - 22, 12, stageTheme.accentSoft, 115, 0.42)
          label(ev.x, ev.y - 42, 'AIR!', stageTheme.accentSoft, 14)
        } else if (ev.type === 'dash') {
          bumpFlow()
          camShake = 0.12
          flash = 0.06
          flashColor = stageTheme.accent
          ring(ev.x, ev.y - 30, stageTheme.accent, 14, 0.27)
          for (let i = 0; i < 3; i++) emit({
            kind: 'ghost', x: ev.x - run.facing * i * 15, y: ev.y,
            vx: -run.facing * 95, vy: 0, life: 0.24 + i * 0.04,
            color: stageTheme.accent, r: 1,
          })
        } else if (ev.type === 'stomp' || ev.type === 'spring') {
          bumpFlow(ev.type === 'stomp' ? 2 : 1)
          const color = ev.type === 'stomp' ? stageTheme.accent : stageTheme.accentSoft
          burst(ev.x, ev.y, ev.type === 'stomp' ? 24 : 18, color, 230, 0.55)
          ring(ev.x, ev.y, '#fff', 12, 0.42)
          label(ev.x, ev.y - 25, ev.type === 'stomp' ? 'NICE!' : 'BOING!', color, 20)
          camShake = ev.type === 'stomp' ? 0.24 : 0.15
          hitStop = ev.type === 'stomp' ? 0.055 : 0.025
          flash = 0.11
          flashColor = color
        } else if (ev.type === 'miss') {
          flow = 0
          camShake = 0.42
          hitStop = 0.08
          flash = 0.2
          flashColor = '#ff6d72'
          burst(ev.x, ev.y - 25, 22, '#ff7378', 240, 0.55)
          label(ev.x, ev.y - 46, 'MISS', '#ffd4d4', 21)
        } else if (ev.type === 'clear') {
          goalCinematic = 1
          camShake = 0.18
          flash = 0.32
          flashColor = '#fff2b4'
          ring(ev.x, ev.y - 30, stageTheme.accentSoft, 18, 0.65)
          for (let i = 0; i < 52; i++) {
            const palette = ['#ffd36a', stageTheme.accent, stageTheme.accentSoft, '#b9e986', '#fff']
            emit({
              kind: 'spark', x: ev.x + (Math.random() - 0.5) * 180, y: ev.y - 100 - Math.random() * 120,
              vx: (Math.random() - 0.5) * 220, vy: -40 - Math.random() * 180,
              life: 1 + Math.random() * 0.8, color: palette[i % palette.length],
              r: 3 + Math.random() * 3, rotation: Math.random() * Math.PI,
            })
          }
        }
      }
    }
    let camShake = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      acc += Math.min(0.1, (now - last) / 1000)
      last = now
      while (acc >= DT) {
        acc -= DT
        t += DT
        if (introT > 0) {
          introT = Math.max(0, introT - DT)
          continue
        }
        if (hitStop > 0) {
          hitStop = Math.max(0, hitStop - DT)
          continue
        }
        const tk = touchKeys.current
        const input: Input = {
          left: keys.left || tk.left,
          right: keys.right || tk.right,
          jumpHeld: keys.jump || tk.jump,
          jumpPressed: jumpEdge || tk.jumpEdge,
          dashPressed: dashEdge,
        }
        jumpEdge = false
        dashEdge = false
        tk.jumpEdge = false
        if (tk.dash) {
          input.dashPressed = true
          tk.dash = false
        }
        const wasClear = run.status === 'clear'
        step(run, input, DT)
        spawnFx()
        if (Math.abs(run.vx) > 300 && t - lastTrailAt > 0.085) {
          lastTrailAt = t
          emit({
            kind: 'ghost', x: run.x - run.facing * 8, y: run.y,
            vx: -run.facing * 45, vy: 0, life: 0.16,
            color: stageTheme.accent, r: 1,
          })
        }
        if (run.status === 'clear' && !wasClear && !reported) {
          reported = true
          const b: Best = { time: run.time, coins: run.coinCount, total: totalCoins, miss: run.miss }
          onClearBest(stageIdx, b)
          clearRevealTimer = window.setTimeout(() => setCleared(b), 900)
        }
        for (const p of particles) {
          p.life -= DT
          p.x += p.vx * DT
          p.y += p.vy * DT
          if (p.kind === 'dot' || p.kind === 'spark') p.vy += 500 * DT
          else if (p.kind === 'ghost') p.vx *= 0.92
        }
        particles = particles.filter((p) => p.life > 0)
        squashT = Math.max(0, squashT - DT)
        camShake = Math.max(0, camShake - DT)
        flash = Math.max(0, flash - DT)
        goalCinematic = Math.max(0, goalCinematic - DT)
        if (flow > 0 && t > flowUntil) flow = 0
      }

      // HUD
      if (hudCoinRef.current) hudCoinRef.current.textContent = `${run.coinCount}/${totalCoins}`
      if (hudMissRef.current) hudMissRef.current.textContent = String(run.miss)
      if (hudTimeRef.current) hudTimeRef.current.textContent = fmtTime(run.time)
      if (hudFlowRef.current) {
        hudFlowRef.current.textContent = flow > 0 ? `FLOW ×${flow}` : 'FLOW —'
        hudFlowRef.current.classList.toggle('active', flow > 0)
      }

      // カメラ（横追従＋ミス時に小さく揺れる）
      const levelW = level.w * TILE
      const levelH = level.h * TILE
      const targetX = Math.max(0, Math.min(levelW - VIEW_W, run.x - VIEW_W * 0.42))
      camX += (targetX - camX) * 0.12
      let camY = levelH > VIEW_H ? Math.max(0, Math.min(levelH - VIEW_H, run.y - VIEW_H * 0.6)) : (levelH - VIEW_H) / 2
      if (camShake > 0) {
        camX += (Math.random() - 0.5) * camShake * 24
        camY += (Math.random() - 0.5) * camShake * 24
      }

      const cinematicZoom = goalCinematic > 0 ? 1 + Math.sin((1 - goalCinematic) * Math.PI) * 0.065 : 1
      const zoomOffsetX = -VIEW_W * (cinematicZoom - 1) * 0.5 * dpr
      const zoomOffsetY = -VIEW_H * (cinematicZoom - 1) * 0.5 * dpr
      ctx.setTransform(dpr * cinematicZoom, 0, 0, dpr * cinematicZoom, zoomOffsetX, zoomOffsetY)
      drawLevel(ctx, run, t, camX, camY)
      drawEnemies(ctx, run, t, camX, camY)

      // パーティクル（火花・衝撃波・数値・ダッシュ残像）
      for (const p of particles) {
        const q = Math.max(0, p.life / p.maxLife)
        const sx = p.x - camX
        const sy = p.y - camY
        ctx.globalAlpha = p.kind === 'ghost' ? q * 0.28 : q
        if (p.kind === 'ring') {
          ctx.strokeStyle = p.color
          ctx.lineWidth = 2.5 * q
          ctx.beginPath()
          ctx.arc(sx, sy, p.r + (1 - q) * 46, 0, Math.PI * 2)
          ctx.stroke()
        } else if (p.kind === 'text') {
          ctx.fillStyle = p.color
          ctx.font = `800 ${p.r}px ui-monospace, monospace`
          ctx.textAlign = 'center'
          ctx.shadowColor = 'rgba(0,0,0,.55)'
          ctx.shadowBlur = 6
          ctx.fillText(p.text ?? '', sx, sy)
          ctx.shadowBlur = 0
        } else if (p.kind === 'ghost') {
          if (sprite.complete && sprite.naturalWidth > 0) {
            const gh = PLAYER_H + 16
            ctx.save()
            ctx.translate(sx, sy)
            ctx.scale(run.facing, 1)
            ctx.drawImage(sprite, -(gh * chara.ratio) / 2, -gh, gh * chara.ratio, gh)
            ctx.restore()
          }
        } else if (p.kind === 'spark') {
          ctx.save()
          ctx.translate(sx, sy)
          ctx.rotate((p.rotation ?? 0) + (1 - q) * 3)
          ctx.fillStyle = p.color
          ctx.fillRect(-p.r * 1.8, -p.r / 2, p.r * 3.6, p.r)
          ctx.restore()
        } else {
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(sx, sy, p.r * (0.65 + q * 0.35), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      // プレイヤー（くり抜きスプライト）
      const px = run.x - camX
      const py = run.y - camY
      if (run.onGround) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.beginPath()
        ctx.ellipse(px, py + 2, 16, 3.5, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      const drawH = PLAYER_H + 16
      const drawW = drawH * chara.ratio
      // ジャンプで伸び、着地でつぶれる
      const stretch = squashT > 0 ? 0.9 : Math.abs(run.vy) > 420 ? 1.05 : 1
      const blink = run.invuln > 0 && Math.floor(t * 12) % 2 === 0
      ctx.save()
      ctx.translate(px, py)
      if (run.dashT > 0) ctx.rotate(run.facing * 0.12)
      ctx.scale(run.facing * (squashT > 0 ? 1.08 : 1), stretch)
      ctx.globalAlpha = blink ? 0.35 : 1
      if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH)
      } else {
        ctx.fillStyle = '#d66'
        ctx.beginPath()
        ctx.roundRect(-11, -drawH, 22, drawH, 8)
        ctx.fill()
      }
      ctx.restore()
      ctx.globalAlpha = 1

      // ダッシュ時のスピード線、画面フラッシュ、常時のシネマティックな縁取り。
      if (run.dashT > 0) {
        ctx.strokeStyle = `${stageTheme.accent}80`
        ctx.lineWidth = 2
        for (let i = 0; i < 10; i++) {
          const ly = (i * 71 + Math.floor(t * 900)) % VIEW_H
          const lx = (i * 137 + Math.floor(t * 420)) % VIEW_W
          ctx.beginPath()
          ctx.moveTo(lx, ly)
          ctx.lineTo(lx - run.facing * (55 + (i % 4) * 18), ly)
          ctx.stroke()
        }
      }
      const vignette = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 190, VIEW_W / 2, VIEW_H / 2, 590)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(3,2,12,.34)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      if (flash > 0) {
        ctx.globalAlpha = Math.min(0.32, flash * 1.8)
        ctx.fillStyle = flashColor
        ctx.fillRect(0, 0, VIEW_W, VIEW_H)
        ctx.globalAlpha = 1
      }

      if (introT > 0) {
        const elapsed = 2.15 - introT
        const word = elapsed < 0.58 ? '3' : elapsed < 1.08 ? '2' : elapsed < 1.58 ? '1' : 'GO!'
        const phase = elapsed < 0.58 ? elapsed : elapsed < 1.08 ? elapsed - 0.58 : elapsed < 1.58 ? elapsed - 1.08 : elapsed - 1.58
        ctx.save()
        ctx.globalAlpha = Math.min(1, phase * 8) * Math.min(1, introT * 5)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `900 ${word === 'GO!' ? 52 : 64}px ui-monospace, monospace`
        ctx.shadowColor = stageTheme.accent
        ctx.shadowBlur = 28
        ctx.fillStyle = '#fff'
        ctx.fillText(word, VIEW_W / 2, VIEW_H / 2)
        ctx.strokeStyle = stageTheme.accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(VIEW_W / 2, VIEW_H / 2, 54 + phase * 45, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (goalCinematic > 0) {
        const q = 1 - goalCinematic
        ctx.save()
        ctx.globalAlpha = Math.min(1, q * 5) * Math.min(1, goalCinematic * 4)
        ctx.textAlign = 'center'
        ctx.font = '900 30px ui-monospace, monospace'
        ctx.shadowColor = stageTheme.accent
        ctx.shadowBlur = 24
        ctx.fillStyle = '#fff'
        ctx.fillText('RUNWAY COMPLETE', VIEW_W / 2, 112)
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(tipTimer)
      if (clearRevealTimer != null) window.clearTimeout(clearRevealTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [chara, level, stageIdx, restartTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLast = stageIdx === LEVELS.length - 1
  const press = (k: 'left' | 'right', v: boolean) => () => {
    touchKeys.current[k] = v
  }

  return (
    <div
      className={`plat-inner plat-playwrap${pseudoFs ? ' plat-fs-mode' : ''}`}
      ref={wrapRef}
      onPointerDownCapture={() => audioRef.current?.unlock()}
    >
      <div className="plat-hud mono">
        <span className="plat-hud-stage">
          STAGE {stageIdx + 1}/{LEVELS.length} {level.title}
        </span>
        <span className="plat-hud-stats">
          コイン <span ref={hudCoinRef}>0/{totalCoins}</span> ミス <span ref={hudMissRef}>0</span> タイム{' '}
          <span ref={hudTimeRef}>0.0</span>
        </span>
        <span className="plat-hud-flow" ref={hudFlowRef}>FLOW —</span>
        <button
          className="plat-sound"
          onClick={() => setMuted(audioRef.current!.toggle())}
          title={muted ? 'サウンドをオン' : 'サウンドをオフ'}
          aria-label={muted ? 'サウンドをオン' : 'サウンドをオフ'}
          aria-pressed={!muted}
        >
          {muted ? '音 OFF' : '音 ON'}
        </button>
        <button
          className="plat-fs"
          onClick={toggleFullscreen}
          title="全画面（スマホは横向き固定）"
          aria-label="全画面切り替え"
        >
          {isFs || pseudoFs ? '✕' : '⛶'}
        </button>
      </div>
      <div className="plat-screen">
        <canvas ref={canvasRef} className="plat-canvas" />
        {showTip && !cleared && <div className="plat-tip jp">{level.tip}</div>}
        {cleared && (
          <div className="plat-overlay">
            <div className="plat-clear jp">
              <b className="mono">{isLast ? 'ALL CLEAR!!' : 'STAGE CLEAR!'}</b>
              <span className="mono">
                コイン {cleared.coins}/{cleared.total} · タイム {fmtTime(cleared.time)} · ミス{' '}
                {cleared.miss}
              </span>
              <span className="plat-clear-actions">
                {!isLast && (
                  <button className="plat-btn primary jp" onClick={onNext}>
                    次のステージ →
                  </button>
                )}
                <button className="plat-btn jp" onClick={() => setRestartTick((n) => n + 1)}>
                  もう一度
                </button>
                <button className="plat-btn jp" onClick={onExit}>
                  ステージ選択
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
      {touch && !cleared && (
        <div className="plat-pads" onContextMenu={(e) => e.preventDefault()}>
            <div className="plat-pad-move">
              <button
                className="plat-pad"
                onPointerDown={press('left', true)}
                onPointerUp={press('left', false)}
                onPointerLeave={press('left', false)}
                onPointerCancel={press('left', false)}
              >
                ◀
              </button>
              <button
                className="plat-pad"
                onPointerDown={press('right', true)}
                onPointerUp={press('right', false)}
                onPointerLeave={press('right', false)}
                onPointerCancel={press('right', false)}
              >
                ▶
              </button>
            </div>
            <div className="plat-pad-act">
              <button
                className="plat-pad"
                onPointerDown={() => {
                  touchKeys.current.dash = true
                }}
              >
                DASH
              </button>
              <button
                className="plat-pad plat-pad-jump"
                onPointerDown={() => {
                  touchKeys.current.jump = true
                  touchKeys.current.jumpEdge = true
                }}
                onPointerUp={() => {
                  touchKeys.current.jump = false
                }}
                onPointerLeave={() => {
                  touchKeys.current.jump = false
                }}
                onPointerCancel={() => {
                  touchKeys.current.jump = false
                }}
              >
                JUMP
              </button>
            </div>
        </div>
      )}
      <div className="plat-controls jp">
        ←→ 移動 / Z・スペース ジャンプ（空中でもう1回） / X ダッシュ / R やりなおし / ESC ステージ選択
      </div>
    </div>
  )
}
