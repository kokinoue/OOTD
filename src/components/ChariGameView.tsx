import { useEffect, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  DEFAULT_RIDER_TRAITS,
  commuteClockAt,
  createRun,
  deriveRiderTraits,
  effectiveWeatherTransitionFor,
  isUnderpassAt,
  isNightTimeAt,
  loadBest,
  metersOf,
  nextZoneInfo,
  obstacleActive,
  saveBest,
  scoreOf,
  segmentSurfaceAt,
  step,
  weatherAt,
  weatherStrength,
  weatherTransitionAt,
  zoneAt,
  type GameEvent,
  type Input,
  type RiderTraits,
  type Run,
} from '../lib/chari'
import type { CutoutsFile } from '../lib/platform'
import { fmtDate, outfits, type Data } from '../lib/useData'
import GameShareButton from './GameShareButton'

// チャリ通: 自動で進む自転車をジャンプで操るエンドレスラン。
// ロジックは lib/chari.ts、ここではCanvas描画・入力・HUD・音を扱う。

const VIEW_W = 960
const VIEW_H = 540
const HERO_X = 220
const MOBILE_TIME_SCALE = 0.55
const SOUND_KEY = 'chari.sound'
const cutouts = cutoutsJson as CutoutsFile
const spriteKeys = Object.keys(cutouts.sprites)
const outfitByKey = new Map(outfits.map((o) => [o.key, o]))
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

type Props = { data: Data; onBack: () => void }
type Result = { meters: number; coins: number; combo: number; score: number; best: number }
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
      else if (kind === 'combo') tone(900, 0.08, 0.025, 1.15)
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

const zoneLabel = {
  residential: '住宅街',
  shopping: '商店街',
  construction: '工事区間',
  station: '駅前',
  school: 'スクールゾーン',
} as const

const zoneEffectLabel = {
  residential: '信号中心',
  shopping: '屋根・COIN×2',
  construction: '大穴・急坂',
  station: '踏切・地下道',
  school: '児童・歩道橋',
} as const

const weatherLabel = {
  clear: '晴れ',
  rain: '雨',
  wind: '強風',
  fog: '霧',
} as const

const weatherEffectLabel = {
  clear: '安定',
  rain: '強スリップ',
  wind: '風に流される',
  fog: '濃霧',
} as const

const commutePhaseLabel = {
  early: '早朝',
  morningRush: '出勤ラッシュ',
  daytime: '午前',
  lunch: 'ランチ・COIN×2',
  afternoon: '午後',
  eveningRush: '帰宅ラッシュ',
  night: '夜間',
} as const

const zoneIcon = {
  residential: '🏘',
  shopping: '🏬',
  construction: '🚧',
  station: '🚉',
  school: '🏫',
} as const

const weatherIcon = {
  clear: '☀',
  rain: '☂',
  wind: '≋',
  fog: '▤',
} as const

function mixHex(from: string, to: string, progress: number): string {
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map((offset) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * progress),
  )
  return `rgb(${mixed.join(',')})`
}

function drawBackground(ctx: CanvasRenderingContext2D, run: Run, cameraX: number) {
  const zone = zoneAt(run.distance, run.seed)
  const weatherTransition = weatherTransitionAt(run.distance, run.seed)
  const rainStrength = weatherStrength(weatherTransition, 'rain')
  const fogStrength = weatherStrength(weatherTransition, 'fog')
  const commute = commuteClockAt(run.distance, run.seed)
  const isNight = isNightTimeAt(run.distance, run.seed)
  const daytimeTop =
    commute.phase === 'early'
      ? '#e6b5a1'
      : commute.phase === 'lunch'
        ? '#65b7df'
        : commute.phase === 'afternoon'
          ? '#83afd0'
          : commute.phase === 'eveningRush'
            ? '#d98970'
            : '#b9dcf2'
  const daytimeMiddle =
    commute.phase === 'early'
      ? '#f0d0ac'
      : commute.phase === 'lunch'
        ? '#d5edf2'
        : commute.phase === 'eveningRush'
          ? '#efc49b'
          : '#e8d9bd'
  const sky = ctx.createLinearGradient(0, 0, 0, 410)
  sky.addColorStop(
    0,
    isNight
      ? '#11182d'
      : mixHex(daytimeTop, '#8194a0', rainStrength),
  )
  sky.addColorStop(
    0.58,
    isNight
      ? '#27314a'
      : mixHex(daytimeMiddle, '#c8cfcb', fogStrength),
  )
  sky.addColorStop(1, isNight ? '#3a4050' : '#f3e7d3')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)

  ctx.fillStyle = isNight ? 'rgba(240,244,219,.82)' : 'rgba(255,239,183,.72)'
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

  if (zone === 'shopping') {
    for (let i = -1; i < 7; i++) {
      const x = i * 170 - ((cameraX * 0.3) % 170)
      ctx.fillStyle = i % 2 ? '#b65f55' : '#d39752'
      ctx.fillRect(x, 305, 128, 18)
      ctx.fillStyle = '#eee2c8'
      ctx.fillRect(x + 9, 323, 110, 42)
    }
  } else if (zone === 'construction') {
    ctx.strokeStyle = '#d89b38'
    ctx.lineWidth = 7
    for (let i = -1; i < 4; i++) {
      const x = i * 310 - ((cameraX * 0.2) % 310)
      ctx.beginPath()
      ctx.moveTo(x + 80, 365)
      ctx.lineTo(x + 80, 205)
      ctx.lineTo(x + 235, 205)
      ctx.stroke()
    }
  } else if (zone === 'station') {
    for (let i = -1; i < 5; i++) {
      const x = i * 280 - ((cameraX * 0.24) % 280)
      ctx.fillStyle = '#b9b7ae'
      ctx.fillRect(x, 250, 232, 115)
      ctx.fillStyle = '#536d78'
      ctx.fillRect(x + 15, 272, 202, 52)
      ctx.fillStyle = '#eee8d7'
      ctx.fillRect(x + 82, 332, 68, 33)
      ctx.fillStyle = '#d45b4c'
      ctx.fillRect(x + 92, 258, 48, 7)
    }
    const trainX = ((cameraX * -0.72) % (VIEW_W + 620)) - 180
    ctx.fillStyle = '#d9e1e2'
    ctx.fillRect(trainX, 292, 520, 62)
    ctx.fillStyle = '#4f7381'
    for (let wx = 18; wx < 490; wx += 62) ctx.fillRect(trainX + wx, 304, 42, 25)
    ctx.fillStyle = '#d85d4b'
    ctx.fillRect(trainX, 342, 520, 8)
  } else if (zone === 'school') {
    for (let i = -1; i < 5; i++) {
      const x = i * 300 - ((cameraX * 0.2) % 300)
      ctx.fillStyle = '#d8c59d'
      ctx.fillRect(x, 242, 248, 123)
      ctx.fillStyle = '#7898a2'
      for (let wx = 18; wx < 220; wx += 48) ctx.fillRect(x + wx, 264, 28, 31)
      ctx.fillStyle = '#c66b55'
      ctx.fillRect(x + 94, 318, 56, 47)
      ctx.fillStyle = '#f3e8c8'
      ctx.fillRect(x + 78, 248, 88, 10)
    }
    ctx.fillStyle = 'rgba(255,255,255,.72)'
    for (let x = -80 - ((cameraX * 0.65) % 150); x < VIEW_W; x += 150) {
      ctx.fillRect(x, 346, 76, 9)
    }
  }

  if (commute.phase === 'lunch') {
    for (let i = -1; i < 5; i++) {
      const x = i * 245 - ((cameraX * 0.3) % 245)
      ctx.fillStyle = '#f0e6cf'
      ctx.fillRect(x + 35, 320, 126, 43)
      ctx.fillStyle = i % 2 ? '#d85f4e' : '#e0a53e'
      ctx.fillRect(x + 28, 310, 140, 13)
      ctx.fillStyle = '#39434a'
      ctx.font = 'bold 11px sans-serif'
      ctx.fillText('LUNCH', x + 74, 347)
      ctx.strokeStyle = 'rgba(255,255,255,.65)'
      ctx.lineWidth = 3
      for (let steam = 0; steam < 3; steam++) {
        ctx.beginPath()
        ctx.arc(x + 66 + steam * 23, 299, 7, Math.PI * 0.15, Math.PI * 1.2)
        ctx.stroke()
      }
    }
  } else if (commute.phase === 'eveningRush') {
    ctx.fillStyle = 'rgba(235,81,55,.7)'
    for (let i = 0; i < 14; i++) {
      const x = (i * 91 - cameraX * 0.42) % (VIEW_W + 80)
      ctx.beginPath()
      ctx.arc(x, 345 + (i % 3) * 7, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (const segment of run.segments) {
    if (segment.route !== 'underpass') continue
    const x = segment.x - cameraX
    if (x > VIEW_W || x + segment.w < 0) continue
    const y = Math.min(segment.y, segment.endY ?? segment.y)
    ctx.fillStyle = '#343a40'
    ctx.fillRect(x, y + 12, segment.w, 126)
    ctx.fillStyle = '#20252b'
    ctx.fillRect(x, y + 12, segment.w, 18)
    ctx.fillStyle = 'rgba(255,235,166,.8)'
    for (let lx = x + 65; lx < x + segment.w - 20; lx += 170) {
      ctx.fillRect(lx, y + 38, 74, 7)
    }
    ctx.fillStyle = '#697078'
    ctx.fillRect(x, y + 10, segment.w, 8)
  }
}

function drawRoadAndItems(ctx: CanvasRenderingContext2D, run: Run, cameraX: number, t: number) {
  for (const s of run.segments) {
    const x = s.x - cameraX
    if (x > VIEW_W + 60 || x + s.w < -60) continue
    const isCurved = s.route === 'underpass' || Math.abs((s.endY ?? s.y) - s.y) > 0.5
    const samples = isCurved ? 24 : 1
    const points = Array.from({ length: samples + 1 }, (_, index) => {
      const worldX = s.x + (s.w * index) / samples
      return { x: worldX - cameraX, y: segmentSurfaceAt(s, worldX) }
    })
    ctx.fillStyle = '#3a3a41'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
    ctx.lineTo(x + s.w, VIEW_H)
    ctx.lineTo(x, VIEW_H)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#4d4d57'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
    for (const point of [...points].reverse()) ctx.lineTo(point.x, point.y + 9)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.26)'
    ctx.lineWidth = 3
    ctx.setLineDash([34, 28])
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y + 75)
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y + 75)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const platform of run.platforms) {
    const x = platform.x - cameraX
    if (x > VIEW_W + 60 || x + platform.w < -60) continue
    if (platform.kind === 'street') {
      ctx.fillStyle = '#3a3a41'
      ctx.fillRect(x, platform.y, platform.w, 18)
      ctx.fillStyle = '#4d4d57'
      ctx.fillRect(x, platform.y, platform.w, 7)
      ctx.strokeStyle = 'rgba(255,255,255,.34)'
      ctx.lineWidth = 3
      ctx.setLineDash([28, 22])
      ctx.beginPath()
      ctx.moveTo(x + 12, platform.y + 10)
      ctx.lineTo(x + platform.w - 12, platform.y + 10)
      ctx.stroke()
      ctx.setLineDash([])
      continue
    }
    if (platform.kind === 'footbridge') {
      ctx.fillStyle = '#69757b'
      ctx.fillRect(x, platform.y, platform.w, 12)
      ctx.strokeStyle = '#9aa5a8'
      ctx.lineWidth = 4
      ctx.strokeRect(x + 3, platform.y - 25, platform.w - 6, 25)
      continue
    }
    ctx.fillStyle = platform.kind === 'roof' ? '#875e55' : '#596b72'
    ctx.fillRect(x, platform.y, platform.w, 14)
    ctx.fillStyle = platform.kind === 'roof' ? '#b77a67' : '#82959a'
    ctx.beginPath()
    ctx.moveTo(x - 8, platform.y)
    ctx.lineTo(x + platform.w / 2, platform.y - (platform.kind === 'roof' ? 27 : 12))
    ctx.lineTo(x + platform.w + 8, platform.y)
    ctx.closePath()
    ctx.fill()
  }
  for (const coin of run.coins) {
    if (coin.taken) continue
    const x = coin.x - cameraX
    if (x < -30 || x > VIEW_W + 30) continue
    const squash = 0.35 + Math.abs(Math.cos(t * 5 + coin.id)) * 0.65
    if (coin.magnetized) {
      const glow = ctx.createRadialGradient(x, coin.y, 2, x, coin.y, 25)
      glow.addColorStop(0, 'rgba(255,224,112,.7)')
      glow.addColorStop(1, 'rgba(255,224,112,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, coin.y, 25, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,222,108,.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, coin.y)
      ctx.quadraticCurveTo((x + HERO_X) / 2, coin.y - 14, HERO_X, run.player.y - 28)
      ctx.stroke()
    }
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
    const active = obstacleActive(run, o)
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
    } else if (o.kind === 'truck') {
      ctx.fillStyle = '#315f78'
      ctx.fillRect(x, o.y, 76, o.h - 20)
      ctx.fillStyle = '#477f98'
      ctx.beginPath()
      ctx.moveTo(x + 76, o.y + 62)
      ctx.lineTo(x + o.w - 8, o.y + 88)
      ctx.lineTo(x + o.w, o.y + o.h - 20)
      ctx.lineTo(x + 76, o.y + o.h - 20)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#b9d4dc'
      ctx.fillRect(x + 83, o.y + 76, 25, 22)
      ctx.fillStyle = '#f0b348'
      ctx.fillRect(x + 12, o.y + 22, 48, 9)
      ctx.fillStyle = '#25272c'
      for (const wheelX of [24, 91]) {
        ctx.beginPath()
        ctx.arc(x + wheelX, o.y + o.h - 15, 15, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#b9bec1'
      for (const wheelX of [24, 91]) {
        ctx.beginPath()
        ctx.arc(x + wheelX, o.y + o.h - 15, 6, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (o.kind === 'signal') {
      ctx.strokeStyle = '#4b5054'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(x + 88, o.y + o.h)
      ctx.lineTo(x + 88, o.y - 70)
      ctx.stroke()
      ctx.fillStyle = '#303338'
      ctx.fillRect(x + 72, o.y - 78, 32, 62)
      ctx.fillStyle = active ? '#e85a47' : '#435048'
      ctx.beginPath()
      ctx.arc(x + 88, o.y - 62, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = active ? '#425049' : '#62c97a'
      ctx.beginPath()
      ctx.arc(x + 88, o.y - 34, 8, 0, Math.PI * 2)
      ctx.fill()
      if (active) {
        ctx.fillStyle = '#b94f42'
        ctx.fillRect(x, o.y + 18, 72, 31)
        ctx.fillStyle = '#cae0e3'
        ctx.fillRect(x + 13, o.y + 8, 34, 18)
        ctx.fillStyle = '#26282c'
        for (const wx of [17, 57]) {
          ctx.beginPath()
          ctx.arc(x + wx, o.y + 52, 9, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    } else if (o.kind === 'commuter') {
      ctx.strokeStyle = '#38434a'
      ctx.lineWidth = 4
      for (const wx of [8, 28]) {
        ctx.beginPath()
        ctx.arc(x + wx, o.y + o.h - 9, 9, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = '#596f86'
      ctx.fillRect(x + 12, o.y + 18, 14, 28)
      ctx.fillStyle = '#d6a681'
      ctx.beginPath()
      ctx.arc(x + 19, o.y + 10, 8, 0, Math.PI * 2)
      ctx.fill()
    } else if (o.kind === 'crossing') {
      ctx.fillStyle = '#33363b'
      ctx.fillRect(x - 4, o.y - 25, 9, 83)
      ctx.save()
      ctx.translate(x, o.y + 3)
      ctx.rotate(active ? 0 : -Math.PI * 0.43)
      ctx.fillStyle = '#f1d9b5'
      ctx.fillRect(0, -6, 92, 12)
      ctx.fillStyle = '#e14f45'
      for (let stripe = 11; stripe < 88; stripe += 24) ctx.fillRect(stripe, -6, 12, 12)
      ctx.restore()
    } else if (o.kind === 'bird') {
      const flap = Math.sin(t * 12 + o.id) * 7
      ctx.strokeStyle = '#272930'
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, o.y + 12)
      ctx.quadraticCurveTo(x + 10, o.y + flap, x + 20, o.y + 12)
      ctx.quadraticCurveTo(x + 31, o.y + flap, x + 42, o.y + 12)
      ctx.stroke()
      ctx.fillStyle = '#d86f45'
      ctx.beginPath()
      ctx.arc(x + 21, o.y + 13, 5, 0, Math.PI * 2)
      ctx.fill()
    } else if (o.kind === 'ball') {
      ctx.fillStyle = '#f2e8d2'
      ctx.beginPath()
      ctx.arc(x + o.w / 2, o.y + o.h / 2, o.w / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#d45c4b'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(x + o.w / 2, o.y + o.h / 2, 8, 0, Math.PI * 2)
      ctx.stroke()
    } else if (o.kind === 'students') {
      for (let i = 0; i < 3; i++) {
        const sx = x + 8 + i * 19
        ctx.fillStyle = i % 2 ? '#e0b24c' : '#4b7089'
        ctx.fillRect(sx - 7, o.y + 25, 14, 34)
        ctx.fillStyle = '#d9aa86'
        ctx.beginPath()
        ctx.arc(sx, o.y + 15, 8, 0, Math.PI * 2)
        ctx.fill()
      }
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

function drawAtmosphere(ctx: CanvasRenderingContext2D, run: Run, t: number) {
  const weatherTransition = effectiveWeatherTransitionFor(run)
  const rainStrength = weatherStrength(weatherTransition, 'rain')
  const windStrength = weatherStrength(weatherTransition, 'wind')
  const fogStrength = weatherStrength(weatherTransition, 'fog')
  const zone = zoneAt(run.distance, run.seed)
  if (rainStrength > 0.01) {
    ctx.save()
    ctx.globalAlpha *= rainStrength
    ctx.strokeStyle = 'rgba(220,239,247,.62)'
    ctx.lineWidth = 2
    for (let i = 0; i < 75; i++) {
      const x = (i * 73 + t * 310) % (VIEW_W + 80) - 40
      const y = (i * 41 + t * 520) % VIEW_H
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 9, y + 22)
      ctx.stroke()
    }
    if (run.player.grounded) {
      ctx.fillStyle = 'rgba(205,233,242,.58)'
      for (let i = 0; i < 8; i++) {
        const phase = (t * 7 + i * 0.37) % 1
        ctx.beginPath()
        ctx.ellipse(
          HERO_X - 24 - phase * (34 + i * 3),
          run.player.y - 5 - Math.sin(phase * Math.PI) * 13,
          5 - phase * 3,
          2,
          0,
          0,
          Math.PI * 2,
        )
        ctx.fill()
      }
    }
    ctx.restore()
  }
  if (windStrength > 0.01) {
    ctx.save()
    ctx.globalAlpha *= windStrength
    ctx.strokeStyle = 'rgba(242,247,232,.5)'
    ctx.lineWidth = 3
    const direction = (run.seed & 1) === 0 ? -1 : 1
    for (let i = 0; i < 12; i++) {
      const span = VIEW_W + 140
      const x = ((i * 103 + direction * t * 430) % span + span) % span - 70
      const y = 80 + (i * 47) % 300
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x - direction * 55, y - 13, x - direction * 118, y)
      ctx.stroke()
    }
    ctx.restore()
  }
  if (fogStrength > 0.01) {
    ctx.save()
    ctx.globalAlpha *= fogStrength
    // 一枚の白い膜ではなく、流れる濃霧と自転車周辺の視界を描き分ける。
    // 進行方向ほど霧が濃く、障害物を早めに見つけにくい天候にする。
    ctx.fillStyle = 'rgba(225,231,226,.24)'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.save()
    ctx.filter = 'blur(18px)'
    for (let i = 0; i < 9; i++) {
      const x = ((i * 173 - t * (24 + (i % 3) * 9)) % (VIEW_W + 360)) - 180
      const y = 90 + (i * 71) % 340
      ctx.fillStyle = `rgba(242,246,242,${0.2 + (i % 3) * 0.07})`
      ctx.beginPath()
      ctx.ellipse(x, y, 145 + (i % 2) * 55, 34 + (i % 3) * 13, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    const fogRelief = run.traits.fogVision
    const visibility = ctx.createRadialGradient(
      HERO_X + 25,
      305,
      75 + fogRelief * 120,
      HERO_X + 25,
      305,
      620 + fogRelief * 260,
    )
    visibility.addColorStop(0, 'rgba(218,226,221,0)')
    visibility.addColorStop(0.3, 'rgba(218,226,221,.12)')
    visibility.addColorStop(0.62, 'rgba(218,226,221,.48)')
    const fogPulse = Math.sin(t * 1.7) * 0.07
    visibility.addColorStop(1, `rgba(218,226,221,${0.78 + fogPulse - fogRelief * 0.36})`)
    ctx.fillStyle = visibility
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.restore()
  }
  if (isNightTimeAt(run.distance, run.seed)) {
    const light = ctx.createRadialGradient(HERO_X + 55, 330, 20, HERO_X + 55, 330, 300)
    light.addColorStop(0, 'rgba(255,244,183,0)')
    light.addColorStop(0.62, 'rgba(7,10,22,.32)')
    light.addColorStop(1, 'rgba(4,7,18,.72)')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  }
  if (zone === 'construction') {
    ctx.fillStyle = 'rgba(199,166,111,.22)'
    for (let i = 0; i < 16; i++) {
      const phase = (t * 0.18 + i * 0.093) % 1
      const x = (i * 83 - t * 55) % (VIEW_W + 100)
      ctx.beginPath()
      ctx.arc(x, 410 - phase * 190, 18 + phase * 34, 0, Math.PI * 2)
      ctx.fill()
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
  const road = p.grounded
    ? run.segments.find((s) => p.x >= s.x && p.x <= s.x + s.w)
    : undefined
  const roadTilt = road ? Math.atan2((road.endY ?? road.y) - road.y, road.w) : 0
  const windLean =
    ((run.seed & 1) === 0 ? 1 : -1) *
    0.055 *
    (1 - run.traits.windResist) *
    weatherStrength(effectiveWeatherTransitionFor(run), 'wind')
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(crashTilt + roadTilt + windLean)
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
  const comboRef = useRef<HTMLSpanElement>(null)
  const zoneRef = useRef<HTMLSpanElement>(null)
  const weatherRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const bestRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<Input>({ jumpPressed: false, jumpHeld: false })
  const jumpQueueRef = useRef(0)
  const audioRef = useRef<ReturnType<typeof createAudio> | null>(null)
  const spriteRef = useRef<HTMLImageElement | null>(null)
  const ratioRef = useRef(0.5)
  const changeOutfitRef = useRef<() => void>(() => {})
  const traitsRef = useRef<RiderTraits>({
    ...DEFAULT_RIDER_TRAITS,
    effects: [...DEFAULT_RIDER_TRAITS.effects],
  })
  const [caption, setCaption] = useState('')
  const [traits, setTraits] = useState<RiderTraits>(traitsRef.current)
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
    const itemIds = data.outfitItemIds.get(key) ?? new Set<string>()
    const riderItems = [...itemIds]
      .map((id) => data.itemMap.get(id))
      .filter((item) => item != null)
      .map((item) => ({ category: item.category, label: item.label, color: item.color }))
    const nextTraits = deriveRiderTraits(outfit?.date ?? '', riderItems)
    traitsRef.current = nextTraits
    setTraits(nextTraits)
    setCaption(outfit?.no ? `#${outfit.no} · ${fmtDate(outfit.date)}` : fmtDate(outfit?.date ?? ''))
  }
  changeOutfitRef.current = changeOutfit

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
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
    run.traits = traitsRef.current
    const timeScale = window.matchMedia('(max-width: 760px)').matches
      ? MOBILE_TIME_SCALE
      : 1
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
      } else if (e.kind === 'coin' || e.kind === 'airbonus' || e.kind === 'combo') {
        particles.push({
          kind: 'text', x: e.x, y: e.y - 70, vx: 0, vy: -42, life: 0.75, max: 0.75,
          text: e.kind === 'coin' ? `+${e.value ?? 10}` : e.kind === 'combo' ? `${e.value} COMBO` : 'AIR!',
          color: e.kind === 'coin' ? '#ffd25e' : e.kind === 'combo' ? '#ff9fd0' : '#9ee4ff',
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
      setResult({ meters: metersOf(run), coins: run.coinsTaken, combo: run.maxCombo, score, best })
      if (bestRef.current) bestRef.current.textContent = String(best)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (e.repeat && (key === ' ' || key === 'z' || key === 'arrowup')) return
      if (key === ' ' || key === 'z' || key === 'arrowup') {
        e.preventDefault()
        audioRef.current?.unlock()
        jumpQueueRef.current = Math.min(2, jumpQueueRef.current + 1)
        inputRef.current.jumpHeld = true
      } else if (key === 'c' && !e.repeat) {
        changeOutfitRef.current()
      } else if (key === 'r') {
        changeOutfitRef.current()
        setResult(null)
        setResetTick((n) => n + 1)
      } else if (key === 'escape') onBack()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === ' ' || key === 'z' || key === 'arrowup') inputRef.current.jumpHeld = false
    }
    const jumpDown = (e: PointerEvent) => {
      if (run.status !== 'playing') return
      canvas.setPointerCapture(e.pointerId)
      audioRef.current?.unlock()
      jumpQueueRef.current = Math.min(2, jumpQueueRef.current + 1)
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
        run.traits = traitsRef.current
        inputRef.current.jumpPressed = jumpQueueRef.current > 0
        if (jumpQueueRef.current > 0) jumpQueueRef.current--
        step(run, inputRef.current, rawDt * slow * timeScale)
        inputRef.current.jumpPressed = false
        for (const e of run.events) {
          audioRef.current?.play(e.kind)
          addParticles(e)
        }
        if (run.overReason) finish()
      }

      const cameraX = run.player.x - HERO_X
      drawBackground(ctx, run, cameraX)
      drawRoadAndItems(ctx, run, cameraX, now / 1000)
      const crashTilt = run.overReason === 'crash' ? Math.min(1.18, ((now - crashAt) / 420) * 1.18) : 0
      drawBike(ctx, run, spriteRef.current, ratioRef.current, crashTilt)
      drawAtmosphere(ctx, run, now / 1000)

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
      if (comboRef.current) comboRef.current.textContent = run.combo > 1 ? ` · ${run.combo} COMBO` : ''
      const zone = zoneAt(run.distance, run.seed)
      const weather = weatherAt(run.distance, run.seed)
      const weatherTransition = weatherTransitionAt(run.distance, run.seed)
      const commute = commuteClockAt(run.distance, run.seed)
      if (zoneRef.current) {
        zoneRef.current.textContent =
          `${zoneIcon[zone]} ${zoneLabel[zone]}・${zoneEffectLabel[zone]}`
        zoneRef.current.dataset.zone = zone
      }
      if (weatherRef.current) {
        const sheltered = isUnderpassAt(run)
        const effect =
          sheltered
            ? '地下道・天候無効'
            : weather === 'wind'
            ? (run.seed & 1) === 0
              ? '追い風・大加速'
              : '向かい風・大減速'
            : weatherEffectLabel[weather]
        weatherRef.current.textContent = sheltered
          ? `🚇 ${effect}`
          : weatherTransition.progress < 1 && weatherTransition.from !== weatherTransition.to
            ? `${weatherIcon[weatherTransition.from]}→${weatherIcon[weatherTransition.to]} ` +
              `${weatherLabel[weatherTransition.from]}→${weatherLabel[weatherTransition.to]}・変化中`
            : `${weatherIcon[weather]} ${weatherLabel[weather]}・${effect}`
        weatherRef.current.dataset.weather = sheltered ? 'clear' : weather
      }
      if (timeRef.current) {
        timeRef.current.textContent = `◷ ${commute.label} ${commutePhaseLabel[commute.phase]}`
        timeRef.current.dataset.phase = commute.phase
      }
      if (noticeRef.current) {
        const next = nextZoneInfo(run.distance, run.seed)
        const show = next.distance <= 1500
        noticeRef.current.textContent = show
          ? `この先 ${zoneIcon[next.zone]} ${zoneLabel[next.zone]} ${Math.ceil(next.distance / 30)}m`
          : ''
        noticeRef.current.classList.toggle('is-visible', show)
      }
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
      inputRef.current = { jumpPressed: false, jumpHeld: false }
      jumpQueueRef.current = 0
    }
  }, [onBack, resetTick])

  const retry = () => {
    changeOutfitRef.current()
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
  return (
    <main className="chari">
      <div className="chari-inner">
        <div className="chari-head">
          <button className="chari-back jp" onClick={onBack}>← ゲーム</button>
          <h2 className="chari-title jp">チャリ通</h2>
          <span className="chari-stats mono">
            <span ref={meterRef}>0</span>m · COIN <span ref={coinRef}>0</span> · SCORE{' '}
            <span ref={scoreRef}>0</span> · BEST <span ref={bestRef}>{loadBest()}</span>
            <span ref={comboRef} />
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
          <div className="chari-environment" aria-label="現在の地域と天候">
            <span ref={zoneRef} className="chari-zone-badge jp" data-zone="residential">
              🏘 住宅街
            </span>
            <span ref={weatherRef} className="chari-weather-badge jp" data-weather="clear">
              ☀ 晴れ・安定
            </span>
            <span ref={timeRef} className="chari-time-badge mono" data-phase="early">
              ◷ 07:20 早朝
            </span>
          </div>
          <div ref={noticeRef} className="chari-course-notice jp" aria-live="polite" />
          <div className="chari-outfit-power jp" title={traits.effects.join(' / ')}>
            <b>服効果</b>
            <span>{traits.effects.slice(0, 2).join(' · ')}</span>
          </div>
          {result && (
            <div className="chari-overlay">
              <div className="chari-result jp">
                <small>{result.score >= result.best ? '自己ベスト更新！' : '通勤終了'}</small>
                <b className="mono">{result.meters} m</b>
                <span className="mono">COIN {result.coins} · SCORE {result.score} · BEST {result.best}</span>
                <span className="mono">MAX COMBO {result.combo}</span>
                <span className="chari-result-actions">
                  <button className="chari-btn primary jp" onClick={retry}>もういちど</button>
                  <button className="chari-btn jp" onClick={shareResultOnX}>Xでポスト</button>
                  <button className="chari-btn jp" onClick={onBack}>もどる</button>
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="chari-foot">
          <span className="chari-caption mono">{caption}</span>
          <span className="jp">
            {touch
              ? '画面タップでジャンプ（長押し・空中でもう1回）'
              : 'Space / Z / ↑ ジャンプ · C 着替え · R やりなおし · ESC もどる'}
          </span>
        </div>
      </div>
    </main>
  )
}
