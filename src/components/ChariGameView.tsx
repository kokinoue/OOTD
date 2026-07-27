import { useEffect, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  DEFAULT_RIDER_TRAITS,
  GAME_TIME_SCALE,
  UNDERPASS_STREET_LIFT,
  commuteClockAt,
  crossingStateAt,
  createRun,
  deriveRiderTraits,
  effectiveWeatherTransitionFor,
  isUnderpassAt,
  isNightTimeAt,
  loadBest,
  metersOf,
  nextZoneInfo,
  saveBest,
  scoreOf,
  setpieceAt,
  segmentSurfaceAt,
  signalStateAt,
  sprinklerStateAt,
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
const MOBILE_VIEW_H = 920
const MOBILE_SCENE_Y = 200
const HERO_X = 220
const SOUND_KEY = 'chari.sound'
const cutouts = cutoutsJson as CutoutsFile
const spriteKeys = Object.keys(cutouts.sprites)
const outfitByKey = new Map(outfits.map((o) => [o.key, o]))
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

type Props = { data: Data; onBack: () => void }
type Result = {
  meters: number
  coins: number
  combo: number
  nearMisses: number
  perfectLandings: number
  score: number
  best: number
}
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
      else if (kind === 'nearmiss') tone(680, 0.1, 0.035, 1.45)
      else if (kind === 'perfectland') tone(440, 0.12, 0.04, 1.65)
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
  construction: '工事現場',
  station: '駅前',
  park: '公園通り',
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
  park: '🌳',
} as const

const setpieceLabel = {
  roofRun: '🏬 連続屋根渡り',
  longUnderpass: '🚇 ロング地下道',
  parkRun: '🌳 公園パルクール',
} as const

const weatherIcon = {
  clear: '☀',
  rain: '☂',
  wind: '≋',
  fog: '▤',
} as const

function effectLabel(effect: string): string {
  const separator = effect.indexOf('：')
  return separator < 0 ? effect : effect.slice(separator + 1)
}

function mixHex(from: string, to: string, progress: number): string {
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map((offset) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * progress),
  )
  return `rgb(${mixed.join(',')})`
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  run: Run,
  cameraX: number,
  viewHeight: number,
  sceneOffsetY: number,
) {
  const zone = zoneAt(run.distance, run.seed)
  const weatherTransition = weatherTransitionAt(run.distance, run.seed)
  const rainStrength = weatherStrength(weatherTransition, 'rain')
  const fogStrength = weatherStrength(weatherTransition, 'fog')
  const commute = commuteClockAt(run.elapsed, run.seed)
  const isNight = isNightTimeAt(run.elapsed, run.seed)
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
  ctx.fillRect(0, 0, VIEW_W, viewHeight)

  ctx.save()
  ctx.translate(0, sceneOffsetY)
  ctx.fillStyle = isNight ? 'rgba(240,244,219,.82)' : 'rgba(255,239,183,.72)'
  ctx.beginPath()
  ctx.arc(750 - (cameraX * 0.015) % 100, 86, 42, 0, Math.PI * 2)
  ctx.fill()

  // 背景は不透明のまま彩度とコントラストだけを落とす。
  // 要素ごとに透明化すると、建物や木が重なって透けた見た目になる。
  ctx.save()
  ctx.filter = isNight
    ? 'saturate(65%) contrast(88%) brightness(82%)'
    : 'saturate(58%) contrast(84%) brightness(106%)'

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
  } else if (zone === 'park') {
    ctx.fillStyle = '#78945f'
    ctx.fillRect(0, 326, VIEW_W, 40)
    for (let i = -2; i < 9; i++) {
      const x = i * 145 - ((cameraX * 0.28) % 145)
      ctx.fillStyle = '#554f43'
      ctx.fillRect(x + 57, 278, 9, 88)
      ctx.fillStyle = i % 2 ? '#5f8454' : '#6f955d'
      ctx.beginPath()
      ctx.arc(x + 60, 260, 34, 0, Math.PI * 2)
      ctx.arc(x + 36, 281, 25, 0, Math.PI * 2)
      ctx.arc(x + 84, 282, 27, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#78684f'
      ctx.fillRect(x + 93, 337, 42, 7)
      ctx.fillRect(x + 99, 344, 5, 18)
      ctx.fillRect(x + 125, 344, 5, 18)
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
  ctx.restore()

  // 建物や木の輪郭をなじませ、直後に描く道路・障害物との明度差を作る。
  const separation = ctx.createLinearGradient(0, 120, 0, 430)
  if (isNight) {
    separation.addColorStop(0, 'rgba(8,12,23,.02)')
    separation.addColorStop(0.58, 'rgba(8,12,23,.1)')
    separation.addColorStop(1, 'rgba(8,12,23,.2)')
  } else {
    separation.addColorStop(0, 'rgba(246,243,235,.02)')
    separation.addColorStop(0.58, 'rgba(246,243,235,.12)')
    separation.addColorStop(1, 'rgba(246,243,235,.28)')
  }
  ctx.fillStyle = separation
  ctx.fillRect(0, 120, VIEW_W, 310)
  ctx.restore()
}

function drawRoadAndItems(
  ctx: CanvasRenderingContext2D,
  run: Run,
  cameraX: number,
  t: number,
  viewHeight: number,
) {
  for (const s of run.segments) {
    const x = s.x - cameraX
    if (x > VIEW_W + 60 || x + s.w < -60) continue
    const isCurved = s.route === 'underpass' || Math.abs((s.endY ?? s.y) - s.y) > 0.5
    const samples = isCurved ? 24 : 1
    const firstX = s.x - cameraX
    const firstY = segmentSurfaceAt(s, s.x)
    ctx.fillStyle = '#3a3a41'
    ctx.beginPath()
    ctx.moveTo(firstX, firstY)
    for (let index = 1; index <= samples; index++) {
      const worldX = s.x + (s.w * index) / samples
      ctx.lineTo(worldX - cameraX, segmentSurfaceAt(s, worldX))
    }
    ctx.lineTo(x + s.w, viewHeight)
    ctx.lineTo(x, viewHeight)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#4d4d57'
    ctx.beginPath()
    ctx.moveTo(firstX, firstY)
    for (let index = 1; index <= samples; index++) {
      const worldX = s.x + (s.w * index) / samples
      ctx.lineTo(worldX - cameraX, segmentSurfaceAt(s, worldX))
    }
    for (let index = samples; index >= 0; index--) {
      const worldX = s.x + (s.w * index) / samples
      ctx.lineTo(worldX - cameraX, segmentSurfaceAt(s, worldX) + 9)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.26)'
    ctx.lineWidth = 3
    ctx.setLineDash([34, 28])
    ctx.beginPath()
    ctx.moveTo(firstX, firstY + 75)
    for (let index = 1; index <= samples; index++) {
      const worldX = s.x + (s.w * index) / samples
      ctx.lineTo(worldX - cameraX, segmentSurfaceAt(s, worldX) + 75)
    }
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
    if (platform.kind === 'park') {
      ctx.fillStyle = '#6f8e58'
      ctx.fillRect(x, platform.y, platform.w, 15)
      ctx.fillStyle = '#456843'
      for (let bush = 12; bush < platform.w - 5; bush += 25) {
        ctx.beginPath()
        ctx.arc(x + bush, platform.y - 4, 15, 0, Math.PI * 2)
        ctx.fill()
      }
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
    const coinGlow = ctx.createRadialGradient(x, coin.y, 4, x, coin.y, 22)
    coinGlow.addColorStop(0, 'rgba(255,221,96,.48)')
    coinGlow.addColorStop(1, 'rgba(255,221,96,0)')
    ctx.fillStyle = coinGlow
    ctx.beginPath()
    ctx.arc(x, coin.y, 22, 0, Math.PI * 2)
    ctx.fill()
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
  ctx.save()
  const nightObstacles = isNightTimeAt(run.elapsed, run.seed)
  ctx.shadowColor = 'rgba(255,232,151,.62)'
  ctx.shadowBlur = nightObstacles ? 7 : 0
  for (const o of run.obstacles) {
    const x = o.x - cameraX
    if (x < -80 || x > VIEW_W + 80) continue
    if (o.kind === 'pylon') {
      const wobble = Math.sin(t * 6 + o.id) * 0.035
      ctx.save()
      ctx.translate(x + o.w / 2, o.y + o.h)
      ctx.rotate(wobble)
      ctx.fillStyle = '#ed713e'
      ctx.beginPath()
      ctx.moveTo(0, -o.h)
      ctx.lineTo(o.w / 2, 0)
      ctx.lineTo(-o.w / 2, 0)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#f6eee0'
      ctx.fillRect(-o.w / 2 + 5, -14, o.w - 10, 5)
      ctx.restore()
    } else if (o.kind === 'fence') {
      ctx.fillStyle = '#f1b542'
      ctx.fillRect(x, o.y + 5, o.w, 10)
      ctx.fillRect(x, o.y + 27, o.w, 9)
      ctx.fillStyle = '#55535a'
      ctx.fillRect(x + 3, o.y, 5, o.h)
      ctx.fillRect(x + o.w - 8, o.y, 5, o.h)
      const beacon = Math.floor(t * 6 + o.id) % 2
      for (let index = 0; index < 2; index++) {
        ctx.fillStyle = index === beacon ? '#ff654d' : '#7b463d'
        ctx.beginPath()
        ctx.arc(x + 7 + index * (o.w - 14), o.y - 3, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (o.kind === 'truck') {
      const engineBob = Math.sin(t * 14 + o.id) * 1.5
      ctx.save()
      ctx.translate(0, engineBob)
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
        ctx.strokeStyle = '#555b60'
        ctx.lineWidth = 2
        const wheelAngle = t * 9 + wheelX
        ctx.beginPath()
        ctx.moveTo(x + wheelX, o.y + o.h - 15)
        ctx.lineTo(
          x + wheelX + Math.cos(wheelAngle) * 6,
          o.y + o.h - 15 + Math.sin(wheelAngle) * 6,
        )
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(205,215,216,.46)'
      for (let puff = 0; puff < 3; puff++) {
        const phase = (t * 1.8 + puff * 0.31 + o.id * 0.07) % 1
        ctx.beginPath()
        ctx.arc(x - phase * 30, o.y + 72 - phase * 12, 3 + phase * 5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (o.kind === 'signal') {
      const signal = signalStateAt(run, o)
      ctx.strokeStyle = '#4b5054'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(x + 88, o.y + o.h)
      ctx.lineTo(x + 88, o.y - 94)
      ctx.stroke()
      ctx.fillStyle = '#303338'
      ctx.fillRect(x + 72, o.y - 102, 32, 86)
      const lights = [
        { state: 'red', y: o.y - 86, on: '#e85a47', off: '#563c3c' },
        { state: 'yellow', y: o.y - 60, on: '#f3c44f', off: '#554d38' },
        { state: 'green', y: o.y - 34, on: '#62c97a', off: '#3c5044' },
      ] as const
      for (const light of lights) {
        const lit = signal.light === light.state
        ctx.fillStyle = lit ? light.on : light.off
        if (light.state === 'yellow' && lit) {
          ctx.shadowColor = '#ffd86b'
          ctx.shadowBlur = 10 * signal.warningPulse
        }
        ctx.beginPath()
        ctx.arc(x + 88, light.y, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 7
      }
      if (signal.blockage > 0.01) {
        const carX = x + (1 - signal.blockage) * 90
        ctx.save()
        ctx.globalAlpha *= Math.min(1, signal.blockage * 2.4)
        ctx.fillStyle = '#b94f42'
        ctx.fillRect(carX, o.y + 18, 72, 31)
        ctx.fillStyle = '#cae0e3'
        ctx.fillRect(carX + 13, o.y + 8, 34, 18)
        ctx.fillStyle = '#26282c'
        for (const wx of [17, 57]) {
          ctx.beginPath()
          ctx.arc(carX + wx, o.y + 52, 9, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
    } else if (o.kind === 'commuter') {
      const pedal = t * 13 + o.id
      const wheelY = o.y + o.h - 9
      const rearX = x + 6
      const frontX = x + 31
      ctx.strokeStyle = 'rgba(238,241,232,.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x + 39, o.y + 22)
      ctx.lineTo(x + 52, o.y + 22)
      ctx.moveTo(x + 41, o.y + 31)
      ctx.lineTo(x + 48, o.y + 31)
      ctx.stroke()
      ctx.strokeStyle = '#27343b'
      ctx.lineWidth = 3
      for (const wx of [rearX, frontX]) {
        ctx.beginPath()
        ctx.arc(wx, wheelY, 10, 0, Math.PI * 2)
        ctx.stroke()
        ctx.lineWidth = 1
        for (let spoke = 0; spoke < 4; spoke++) {
          const angle = pedal + (spoke * Math.PI) / 2
          ctx.beginPath()
          ctx.moveTo(wx, wheelY)
          ctx.lineTo(wx + Math.cos(angle) * 8, wheelY + Math.sin(angle) * 8)
          ctx.stroke()
        }
        ctx.lineWidth = 3
      }
      ctx.strokeStyle = '#527d8c'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(rearX, wheelY)
      ctx.lineTo(x + 18, o.y + 38)
      ctx.lineTo(frontX, wheelY)
      ctx.lineTo(x + 13, wheelY)
      ctx.lineTo(rearX, wheelY)
      ctx.moveTo(x + 18, o.y + 38)
      ctx.lineTo(x + 25, o.y + 33)
      ctx.stroke()
      const hipX = x + 17
      const hipY = o.y + 29
      const footX = hipX + Math.cos(pedal) * 7
      const footY = o.y + 43 + Math.sin(pedal) * 5
      ctx.strokeStyle = '#303b44'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(hipX, hipY)
      ctx.lineTo(footX, footY)
      ctx.moveTo(hipX, hipY)
      ctx.lineTo(hipX - Math.cos(pedal) * 7, o.y + 43 - Math.sin(pedal) * 5)
      ctx.stroke()
      ctx.fillStyle = '#496c83'
      ctx.beginPath()
      ctx.moveTo(x + 11, o.y + 13)
      ctx.lineTo(x + 25, o.y + 15)
      ctx.lineTo(x + 20, o.y + 32)
      ctx.lineTo(x + 10, o.y + 29)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#c49a52'
      ctx.fillRect(x + 22, o.y + 19, 9, 13)
      ctx.strokeStyle = '#303b44'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x + 22, o.y + 18)
      ctx.lineTo(x + 29, o.y + 30)
      ctx.stroke()
      ctx.fillStyle = '#d6a681'
      ctx.beginPath()
      ctx.arc(x + 16, o.y + 8, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#32363b'
      ctx.beginPath()
      ctx.arc(x + 15, o.y + 5, 7, Math.PI, Math.PI * 2)
      ctx.fill()
    } else if (o.kind === 'crossing') {
      const crossing = crossingStateAt(run, o)
      ctx.fillStyle = '#33363b'
      ctx.fillRect(x - 4, o.y - 25, 9, 83)
      ctx.fillStyle = '#25282d'
      ctx.fillRect(x - 17, o.y - 37, 34, 20)
      for (let light = 0; light < 2; light++) {
        ctx.fillStyle =
          crossing.warning && crossing.lightSide === light
            ? '#ff4e3f'
            : '#683a37'
        ctx.beginPath()
        ctx.arc(x - 8 + light * 16, o.y - 27, 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.save()
      ctx.translate(x, o.y + 3)
      ctx.rotate(-(1 - crossing.closure) * Math.PI * 0.43)
      ctx.fillStyle = '#f1d9b5'
      ctx.fillRect(0, -6, 92, 12)
      ctx.fillStyle = '#e14f45'
      for (let stripe = 11; stripe < 88; stripe += 24) ctx.fillRect(stripe, -6, 12, 12)
      ctx.restore()
    } else if (o.kind === 'bird') {
      const flap = Math.sin(t * 12 + o.id) * 7
      // 左向きの頭・くちばしと後方の速度線で、こちらへ飛ぶ動きを見せる。
      ctx.strokeStyle = 'rgba(246,239,216,.7)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x + 45, o.y + 8)
      ctx.lineTo(x + 62, o.y + 8)
      ctx.moveTo(x + 47, o.y + 17)
      ctx.lineTo(x + 57, o.y + 17)
      ctx.stroke()
      ctx.fillStyle = '#343842'
      ctx.beginPath()
      ctx.ellipse(x + 25, o.y + 13, 17, 8, -0.08, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x + 8, o.y + 12, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e3a43d'
      ctx.beginPath()
      ctx.moveTo(x + 2, o.y + 10)
      ctx.lineTo(x - 8, o.y + 13)
      ctx.lineTo(x + 2, o.y + 16)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#272930'
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x + 13, o.y + 12)
      ctx.quadraticCurveTo(x + 22, o.y + flap, x + 31, o.y + 12)
      ctx.quadraticCurveTo(x + 36, o.y + flap, x + 42, o.y + 12)
      ctx.stroke()
      ctx.fillStyle = '#f4e8c7'
      ctx.beginPath()
      ctx.arc(x + 6, o.y + 10, 1.5, 0, Math.PI * 2)
      ctx.fill()
    } else if (o.kind === 'ball') {
      const bounce = Math.abs(Math.sin(t * 7 + o.id)) * 7
      const ballX = x + o.w / 2
      const ballY = o.y + o.h / 2 - bounce
      const spin = t * 8 + o.id
      ctx.fillStyle = '#f2e8d2'
      ctx.beginPath()
      ctx.arc(ballX, ballY, o.w / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#d45c4b'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(ballX, ballY, 8, spin, spin + Math.PI * 1.45)
      ctx.stroke()
    } else if (o.kind === 'dog') {
      const stride = Math.sin(t * 12 + o.id) * 5
      const dogX = x + 18
      const baseY = o.y + o.h - 7
      ctx.strokeStyle = '#e16f55'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(dogX + 15, baseY - 17)
      ctx.quadraticCurveTo(x + 58, o.y - 12 + stride, x + 95, o.y + 5)
      ctx.stroke()
      ctx.fillStyle = '#805e43'
      ctx.beginPath()
      ctx.ellipse(dogX, baseY - 15, 20, 11, 0, 0, Math.PI * 2)
      ctx.arc(dogX - 18, baseY - 21, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#5c4635'
      ctx.lineWidth = 4
      for (const leg of [-10, 8]) {
        ctx.beginPath()
        ctx.moveTo(dogX + leg, baseY - 8)
        ctx.lineTo(dogX + leg + stride, baseY)
        ctx.stroke()
      }
      ctx.fillStyle = '#4d765b'
      ctx.fillRect(x + 88, o.y + 5, 14, 27)
      ctx.fillStyle = '#d3a17e'
      ctx.beginPath()
      ctx.arc(x + 95, o.y - 2, 7, 0, Math.PI * 2)
      ctx.fill()
    } else if (o.kind === 'sprinkler') {
      const spray = sprinklerStateAt(run, o)
      const baseY = o.y + o.h
      if (spray.warning) {
        ctx.fillStyle = `rgba(93,177,215,${0.35 + spray.pulse * 0.45})`
        ctx.beginPath()
        ctx.arc(x + o.w / 2, baseY - 8, 8 + spray.pulse * 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = 'rgba(140,218,242,.78)'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(x + o.w / 2, baseY - 8)
      ctx.quadraticCurveTo(
        x + o.w / 2 + 35,
        baseY - 108 * spray.pressure,
        x + o.w + 22,
        baseY - 12,
      )
      ctx.stroke()
      ctx.fillStyle = '#477d70'
      ctx.fillRect(x + 15, baseY - 12, 16, 12)
    } else if (o.kind === 'jogger') {
      const stride = Math.sin(t * 13 + o.id) * 10
      ctx.fillStyle = '#e36f55'
      ctx.fillRect(x + 10, o.y + 18, 14, 27)
      ctx.fillStyle = '#d4a07c'
      ctx.beginPath()
      ctx.arc(x + 17, o.y + 9, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#33434c'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(x + 14, o.y + 44)
      ctx.lineTo(x + 10 + stride, o.y + 65)
      ctx.moveTo(x + 20, o.y + 44)
      ctx.lineTo(x + 24 - stride, o.y + 65)
      ctx.moveTo(x + 11, o.y + 25)
      ctx.lineTo(x + 2 - stride * 0.5, o.y + 40)
      ctx.moveTo(x + 23, o.y + 25)
      ctx.lineTo(x + 31 + stride * 0.5, o.y + 38)
      ctx.stroke()
    } else if (o.kind === 'bench') {
      ctx.fillStyle = '#806548'
      ctx.fillRect(x, o.y + 5, o.w, 10)
      ctx.fillRect(x, o.y + 22, o.w, 9)
      ctx.fillStyle = '#454b43'
      ctx.fillRect(x + 8, o.y + 30, 6, 14)
      ctx.fillRect(x + o.w - 14, o.y + 30, 6, 14)
    } else {
      const arrowPhase = (t * 42 + o.id * 7) % 18
      ctx.fillStyle = o.used ? '#77747b' : '#dc9b36'
      ctx.beginPath()
      ctx.moveTo(x, o.y + o.h)
      ctx.lineTo(x + o.w, o.y)
      ctx.lineTo(x + o.w, o.y + o.h)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#f4d38b'
      ctx.stroke()
      if (!o.used) {
        ctx.strokeStyle = 'rgba(255,244,190,.9)'
        ctx.lineWidth = 3
        for (let arrow = 8 + arrowPhase; arrow < o.w - 8; arrow += 18) {
          const progress = arrow / o.w
          const arrowY = o.y + o.h - progress * o.h
          ctx.beginPath()
          ctx.moveTo(x + arrow - 5, arrowY + 3)
          ctx.lineTo(x + arrow, arrowY - 2)
          ctx.lineTo(x + arrow + 5, arrowY + 3)
          ctx.stroke()
        }
        ctx.fillStyle = '#fff0b8'
        ctx.font = '800 11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText('ROOF ↑', x + o.w / 2, o.y - 10)
      }
    }
  }
  ctx.restore()
  for (const segment of run.segments) {
    if (segment.route !== 'underpass') continue
    const signX = segment.x + 88 - cameraX
    if (signX < -130 || signX > VIEW_W + 20) continue
    const upperY = segment.y - UNDERPASS_STREET_LIFT - 42
    const lowerY = segment.y + 38
    ctx.font = '700 13px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(30,34,40,.88)'
    ctx.fillRect(signX - 7, upperY - 17, 116, 24)
    ctx.fillRect(signX - 7, lowerY - 17, 168, 24)
    ctx.fillStyle = '#dcebf0'
    ctx.fillText('↑ 地上 SAFE', signX, upperY)
    ctx.fillStyle = '#ffd45f'
    ctx.fillText('↓ 地下 COIN / RISK', signX, lowerY)
  }
}

function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  run: Run,
  t: number,
  viewHeight: number,
  sceneOffsetY: number,
  reducedEffects: boolean,
) {
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
    const rainCount = reducedEffects ? 44 : 75
    for (let i = 0; i < rainCount; i++) {
      const x = (i * 73 + t * 310) % (VIEW_W + 80) - 40
      const y = (i * 41 + t * 520) % viewHeight
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
          run.player.y + sceneOffsetY - 5 - Math.sin(phase * Math.PI) * 13,
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
    const windCount = reducedEffects ? 8 : 12
    for (let i = 0; i < windCount; i++) {
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
    ctx.fillRect(0, 0, VIEW_W, viewHeight)
    ctx.save()
    ctx.filter = reducedEffects ? 'blur(12px)' : 'blur(18px)'
    const fogCount = reducedEffects ? 6 : 9
    for (let i = 0; i < fogCount; i++) {
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
      305 + sceneOffsetY,
      75 + fogRelief * 120,
      HERO_X + 25,
      305 + sceneOffsetY,
      620 + fogRelief * 260,
    )
    visibility.addColorStop(0, 'rgba(218,226,221,0)')
    visibility.addColorStop(0.3, 'rgba(218,226,221,.12)')
    visibility.addColorStop(0.62, 'rgba(218,226,221,.48)')
    const fogPulse = Math.sin(t * 1.7) * 0.07
    visibility.addColorStop(1, `rgba(218,226,221,${0.78 + fogPulse - fogRelief * 0.36})`)
    ctx.fillStyle = visibility
    ctx.fillRect(0, 0, VIEW_W, viewHeight)
    ctx.restore()
  }
  if (isNightTimeAt(run.elapsed, run.seed)) {
    const light = ctx.createRadialGradient(
      HERO_X + 55,
      330 + sceneOffsetY,
      20,
      HERO_X + 55,
      330 + sceneOffsetY,
      300,
    )
    light.addColorStop(0, 'rgba(255,244,183,0)')
    light.addColorStop(0.62, 'rgba(7,10,22,.32)')
    light.addColorStop(1, 'rgba(4,7,18,.72)')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, VIEW_W, viewHeight)
  }
  if (zone === 'construction') {
    ctx.fillStyle = 'rgba(199,166,111,.22)'
    const dustCount = reducedEffects ? 10 : 16
    for (let i = 0; i < dustCount; i++) {
      const phase = (t * 0.18 + i * 0.093) % 1
      const x = (i * 83 - t * 55) % (VIEW_W + 100)
      ctx.beginPath()
      ctx.arc(x, 410 + sceneOffsetY - phase * 190, 18 + phase * 34, 0, Math.PI * 2)
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
  const screenRef = useRef<HTMLDivElement>(null)
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
    const screen = screenRef.current
    if (!canvas || !screen) return
    const ctx = canvas.getContext('2d', { alpha: false })!
    const isMobileLayout = window.matchMedia('(max-width: 760px)').matches
    // 論理解像度自体が表示幅より大きいため、Retinaの倍率をそのまま掛けない。
    // 特にスマホは960px幅を縮小表示するので1倍でも十分な密度があり、
    // これ以上は見た目より毎フレームの塗りつぶし負荷の方が大きくなる。
    const dpr = Math.min(isMobileLayout ? 1 : 1.25, window.devicePixelRatio || 1)
    const viewHeight = isMobileLayout ? MOBILE_VIEW_H : VIEW_H
    const baseSceneOffsetY = isMobileLayout ? MOBILE_SCENE_Y : 0
    canvas.width = VIEW_W * dpr
    canvas.height = viewHeight * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const run = createRun()
    run.traits = traitsRef.current
    const particles: Particle[] = []
    let raf = 0
    let last = performance.now()
    let disposed = false
    let finished = false
    let crashAt = 0
    let sceneCameraY = baseSceneOffsetY
    let lastHudAt = -Infinity
    let cachedBest = loadBest()

    const addParticles = (e: GameEvent) => {
      if (e.kind === 'land') {
        for (let i = 0; i < 7; i++) {
          particles.push({
            kind: 'dust', x: e.x, y: e.y, vx: -30 - Math.random() * 80,
            vy: -20 - Math.random() * 60, life: 0.45, max: 0.45, color: '#d7cec0',
          })
        }
      } else if (
        e.kind === 'coin' ||
        e.kind === 'airbonus' ||
        e.kind === 'combo' ||
        e.kind === 'nearmiss' ||
        e.kind === 'perfectland'
      ) {
        particles.push({
          kind: 'text', x: e.x, y: e.y - 70, vx: 0, vy: -42, life: 0.75, max: 0.75,
          text:
            e.kind === 'coin'
              ? `+${e.value ?? 10}`
              : e.kind === 'combo'
                ? `${e.value} COMBO`
                : e.kind === 'nearmiss'
                  ? `NEAR MISS +${e.value}`
                  : e.kind === 'perfectland'
                    ? `PERFECT +${e.value}`
                    : 'AIR!',
          color:
            e.kind === 'coin'
              ? '#ffd25e'
              : e.kind === 'combo'
                ? '#ff9fd0'
                : e.kind === 'nearmiss'
                  ? '#ffbd72'
                  : '#9ee4ff',
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
      cachedBest = best
      setResult({
        meters: metersOf(run),
        coins: run.coinsTaken,
        combo: run.maxCombo,
        nearMisses: run.nearMisses,
        perfectLandings: run.perfectLandings,
        score,
        best,
      })
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
      if ((e.target as Element | null)?.closest('button')) return
      e.preventDefault()
      screen.setPointerCapture(e.pointerId)
      audioRef.current?.unlock()
      jumpQueueRef.current = Math.min(2, jumpQueueRef.current + 1)
      inputRef.current.jumpHeld = true
    }
    const jumpUp = () => {
      inputRef.current.jumpHeld = false
    }
    const preventGameContextMenu = (e: Event) => {
      if ((e.target as Element | null)?.closest('button')) return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    screen.addEventListener('pointerdown', jumpDown)
    screen.addEventListener('pointerup', jumpUp)
    screen.addEventListener('pointercancel', jumpUp)
    screen.addEventListener('contextmenu', preventGameContextMenu)
    screen.addEventListener('selectstart', preventGameContextMenu)

    const frame = (now: number) => {
      if (disposed) return
      const rawDt = Math.min(0.034, (now - last) / 1000)
      last = now
      const slow = crashAt && now - crashAt < 480 ? 0.24 : 1
      if (run.status === 'playing') {
        run.traits = traitsRef.current
        inputRef.current.jumpPressed = jumpQueueRef.current > 0
        if (jumpQueueRef.current > 0) jumpQueueRef.current--
        step(run, inputRef.current, rawDt * slow * GAME_TIME_SCALE)
        inputRef.current.jumpPressed = false
        for (const e of run.events) {
          audioRef.current?.play(e.kind)
          addParticles(e)
        }
        if (run.overReason) finish()
      }

      const cameraX = run.player.x - HERO_X
      const minimumPlayerY = isMobileLayout ? 230 : 170
      const targetSceneY = Math.max(
        baseSceneOffsetY,
        minimumPlayerY - run.player.y,
      )
      sceneCameraY +=
        (targetSceneY - sceneCameraY) *
        (1 - Math.exp(-rawDt * 8))
      const sceneOffsetY = sceneCameraY
      const timeSeconds = now / 1000
      drawBackground(ctx, run, cameraX, viewHeight, sceneOffsetY)
      ctx.save()
      ctx.translate(0, sceneOffsetY)
      drawRoadAndItems(ctx, run, cameraX, timeSeconds, viewHeight)
      const crashTilt = run.overReason === 'crash' ? Math.min(1.18, ((now - crashAt) / 420) * 1.18) : 0
      drawBike(ctx, run, spriteRef.current, ratioRef.current, crashTilt)
      ctx.restore()
      drawAtmosphere(ctx, run, timeSeconds, viewHeight, sceneOffsetY, isMobileLayout)

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
          ctx.fillText(p.text ?? '', sx, p.y + sceneOffsetY)
        } else {
          ctx.beginPath()
          ctx.arc(sx, p.y + sceneOffsetY, p.kind === 'dust' ? 5 : 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      if (run.overReason === 'crash' && now - crashAt < 190) {
        ctx.fillStyle = `rgba(255,80,55,${0.3 * (1 - (now - crashAt) / 190)})`
        ctx.fillRect(0, 0, VIEW_W, viewHeight)
      }
      // HUDは10fpsで十分滑らか。毎フレームのDOM書き換えとlocalStorage参照を避ける。
      if (now - lastHudAt >= 100) {
        lastHudAt = now
        const currentScore = scoreOf(run)
        if (meterRef.current) meterRef.current.textContent = String(metersOf(run))
        if (coinRef.current) coinRef.current.textContent = String(run.coinsTaken)
        if (scoreRef.current) scoreRef.current.textContent = String(currentScore)
        if (comboRef.current) {
          comboRef.current.textContent = run.combo > 1 ? ` · ${run.combo} COMBO` : ''
        }
        const zone = zoneAt(run.distance, run.seed)
        const weather = weatherAt(run.distance, run.seed)
        const weatherTransition = weatherTransitionAt(run.distance, run.seed)
        const commute = commuteClockAt(run.elapsed, run.seed)
        if (zoneRef.current) {
          zoneRef.current.textContent = `${zoneIcon[zone]} ${zoneLabel[zone]}`
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
          const setpiece = setpieceAt(run)
          const next = nextZoneInfo(run.distance, run.seed)
          const show = setpiece != null || next.distance <= 1500
          noticeRef.current.textContent =
            setpiece != null
              ? `SET PIECE · ${setpieceLabel[setpiece]}`
              : show
                ? `この先 ${zoneIcon[next.zone]} ${zoneLabel[next.zone]} ${Math.ceil(next.distance / 30)}m`
                : ''
          noticeRef.current.classList.toggle('is-visible', show)
        }
        if (bestRef.current) {
          bestRef.current.textContent = String(Math.max(cachedBest, currentScore))
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      screen.removeEventListener('pointerdown', jumpDown)
      screen.removeEventListener('pointerup', jumpUp)
      screen.removeEventListener('pointercancel', jumpUp)
      screen.removeEventListener('contextmenu', preventGameContextMenu)
      screen.removeEventListener('selectstart', preventGameContextMenu)
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
        <div ref={screenRef} className="chari-screen">
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
          <div className="chari-outfit-power jp" aria-label="現在の服効果">
            <b>服効果</b>
            <div className="chari-outfit-effects">
              {traits.effects.map((effect, index) => (
                <span key={`${effect}-${index}`}>{effectLabel(effect)}</span>
              ))}
            </div>
          </div>
          <button
            className="chari-change-mobile jp"
            onClick={changeOutfit}
            aria-label="着替える"
          >
            <span aria-hidden="true">👕</span>
            <b>着替え</b>
          </button>
          {result && (
            <div className="chari-overlay">
              <div className="chari-result jp">
                <small>{result.score >= result.best ? '自己ベスト更新！' : '通勤終了'}</small>
                <b className="mono">{result.meters} m</b>
                <span className="mono">COIN {result.coins} · SCORE {result.score} · BEST {result.best}</span>
                <span className="mono">MAX COMBO {result.combo}</span>
                <span className="mono">
                  NEAR MISS {result.nearMisses} · PERFECT {result.perfectLandings}
                </span>
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
