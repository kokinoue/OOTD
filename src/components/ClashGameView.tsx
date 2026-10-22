import { useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  ARENA,
  ATTACKS,
  CPU_PROFILES,
  createClashMatch,
  cpuClashInput,
  emptyClashInput,
  stepClashMatch,
  type ClashEvent,
  type ClashInput,
  type ClashMatch,
  type Fighter,
  type FighterStats,
} from '../lib/clash'
import { SEASON_COLOR, SEASON_LABEL, seasonOf, type Season } from '../lib/duel'
import { dominantColor, type CutoutsFile } from '../lib/platform'
import { colorBuckets, fmtDate, outfits, type Data } from '../lib/useData'
import GameShareButton from './GameShareButton'

type Props = {
  data: Data
  onBack: () => void
}

type Difficulty = keyof typeof CPU_PROFILES
type Mode = 'cpu' | 'local'
type Screen = 'select' | 'play'

type ClashChara = {
  key: string
  no: number | null
  date: string
  season: Season
  color?: string
  accent: string
  accentSoft: string
  ratio: number
  stats: FighterStats
  typeLabel: string
  specialLabel: string
}

const cutouts = cutoutsJson as CutoutsFile
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`
const SOUND_KEY = 'clash.sound'
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const COLOR_SOFT: Record<string, string> = {
  white: '#ffffff',
  beige: '#f4dfb5',
  gray: '#dedee5',
  black: '#9b9baa',
  brown: '#d9a47f',
  navy: '#a7b7ef',
  blue: '#9dccff',
  green: '#a9e0a0',
  yellow: '#fff09a',
  orange: '#ffc092',
  red: '#ffaaa2',
  pink: '#ffc2d8',
  purple: '#d7b8f2',
}

const SPECIAL_BY_SEASON: Record<Season, string> = {
  spring: 'BLOOM UPPER',
  summer: 'HEAT RUSH',
  autumn: 'LEAF CAST',
  winter: 'FROST GUARD',
}

function statsFor(season: Season, color?: string): FighterStats {
  const stats: FighterStats = {
    speed: 1,
    jump: 1,
    power: 1,
    weight: 1,
    airJumps: 1,
    airControl: 1,
  }
  if (season === 'spring') {
    stats.jump += 0.1
    stats.airControl += 0.05
  } else if (season === 'summer') {
    stats.speed += 0.1
    stats.weight -= 0.04
  } else if (season === 'autumn') {
    stats.airControl += 0.13
    stats.power += 0.04
  } else {
    stats.weight += 0.13
    stats.speed -= 0.05
  }
  if (color === 'black' || color === 'red') stats.power += 0.1
  if (color === 'white') {
    stats.speed += 0.035
    stats.jump += 0.035
    stats.power += 0.035
  }
  if (color === 'navy' || color === 'brown') stats.weight += 0.08
  if (color === 'blue' || color === 'purple') {
    stats.airJumps += 1
    stats.weight -= 0.07
  }
  if (color === 'green' || color === 'pink') stats.jump += 0.075
  if (color === 'yellow' || color === 'orange') stats.speed += 0.075
  if (color === 'gray' || color === 'beige') stats.airControl += 0.075
  return stats
}

function typeLabel(stats: FighterStats) {
  const scored = [
    ['SPEED', stats.speed + stats.airControl * 0.3],
    ['POWER', stats.power + stats.weight * 0.22],
    ['AIR', stats.jump + stats.airControl * 0.5 + (stats.airJumps - 1) * 0.4],
    ['HEAVY', stats.weight + stats.power * 0.2],
  ] as const
  return [...scored].sort((a, b) => b[1] - a[1])[0][0]
}

function buildRoster(data: Data): ClashChara[] {
  const playable = outfits.filter((outfit) => cutouts.sprites[outfit.key])
  const selected = (['spring', 'summer', 'autumn', 'winter'] as Season[]).flatMap((season) =>
    playable.filter((outfit) => seasonOf(outfit.date) === season).slice(0, 3),
  )
  return selected.map((outfit) => {
    const ids = data.outfitItemIds.get(outfit.key)
    const color = dominantColor([...(ids ?? [])].map((id) => data.itemMap.get(id)?.color))
    const bucket = colorBuckets.find((entry) => entry.name === color)
    const accent = bucket?.swatch ?? SEASON_COLOR[seasonOf(outfit.date)]
    const stats = statsFor(seasonOf(outfit.date), color)
    const sprite = cutouts.sprites[outfit.key]
    return {
      key: outfit.key,
      no: outfit.no,
      date: outfit.date,
      season: seasonOf(outfit.date),
      color,
      accent,
      accentSoft: COLOR_SOFT[color ?? ''] ?? '#ffffff',
      ratio: sprite.w / sprite.h,
      stats,
      typeLabel: typeLabel(stats),
      specialLabel: SPECIAL_BY_SEASON[seasonOf(outfit.date)],
    }
  })
}

function createClashAudio() {
  let context: AudioContext | null = null
  let muted = localStorage.getItem(SOUND_KEY) === 'off'
  let musicTimer: number | null = null
  let beat = 0

  const getContext = () => {
    if (!context || context.state === 'closed') context = new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
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
    const audio = getContext()
    const at = audio.currentTime + delay
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(32, frequency * slide),
      at + duration,
    )
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(at)
    oscillator.stop(at + duration + 0.03)
  }
  const noise = (duration: number, volume: number) => {
    if (muted) return
    const audio = getContext()
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * duration), audio.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < channel.length; i++) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length)
    }
    const source = audio.createBufferSource()
    const filter = audio.createBiquadFilter()
    const gain = audio.createGain()
    source.buffer = buffer
    filter.type = 'highpass'
    filter.frequency.value = 500
    gain.gain.value = volume
    source.connect(filter).connect(gain).connect(audio.destination)
    source.start()
  }
  const stopMusic = () => {
    if (musicTimer != null) window.clearInterval(musicTimer)
    musicTimer = null
  }
  const startMusic = () => {
    if (muted || musicTimer != null || !context) return
    const bass = [82, 82, 98, 110, 82, 123, 110, 98]
    const high = [330, 392, 440, 494, 392, 523, 494, 440]
    const tick = () => {
      tone(bass[beat % bass.length], 0.4, 'sawtooth', 0.006, 0.78)
      if (beat % 2 === 0) tone(high[beat % high.length], 0.18, 'triangle', 0.006, 1.02)
      beat += 1
    }
    tick()
    musicTimer = window.setInterval(tick, 390)
  }

  return {
    unlock: () => {
      getContext()
      startMusic()
    },
    isMuted: () => muted,
    toggle: () => {
      muted = !muted
      localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      if (muted) stopMusic()
      else {
        getContext()
        tone(660, 0.1, 'sine', 0.04, 1.35)
        startMusic()
      }
      return muted
    },
    play: (event: ClashEvent, humanWinner: boolean) => {
      if (event.type === 'go') {
        ;[330, 440, 660].forEach((frequency, index) =>
          tone(frequency, 0.25, 'square', 0.028, 1.08, index * 0.08),
        )
      } else if (event.type === 'jump' || event.type === 'airJump') {
        tone(event.type === 'jump' ? 210 : 330, 0.12, 'triangle', 0.018, 1.8)
      } else if (event.type === 'attack') {
        tone(event.kind === 'smash' ? 92 : 145, 0.11, 'sawtooth', 0.014, 1.8)
      } else if (event.type === 'projectile') {
        tone(410, 0.2, 'sine', 0.025, 2.1)
      } else if (event.type === 'hit') {
        tone(Math.max(52, 160 - event.power * 0.08), 0.16, 'square', 0.035, 0.46)
        noise(0.09, Math.min(0.06, 0.018 + event.power / 13000))
      } else if (event.type === 'shield') {
        tone(520, 0.13, 'sine', 0.025, 0.55)
      } else if (event.type === 'shieldBreak') {
        tone(220, 0.5, 'sawtooth', 0.034, 0.17)
        noise(0.25, 0.045)
      } else if (event.type === 'ko') {
        tone(70, 0.55, 'sawtooth', 0.055, 4.8)
        noise(0.26, 0.055)
      } else if (event.type === 'gameOver') {
        if (humanWinner) {
          ;[392, 494, 587, 784].forEach((frequency, index) =>
            tone(frequency, 0.45, 'triangle', 0.032, 1.04, index * 0.11),
          )
        } else {
          tone(196, 0.9, 'sawtooth', 0.035, 0.22)
        }
      }
    },
    close: () => {
      stopMusic()
      void context?.close()
    },
  }
}

type Particle = {
  kind: 'dot' | 'line' | 'ring' | 'text' | 'ghost'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
  text?: string
  fighter?: 0 | 1
}

function drawRoundedPlatform(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const gradient = context.createLinearGradient(x, y, x, y + height + 38)
  gradient.addColorStop(0, '#e7e3ff')
  gradient.addColorStop(0.16, '#67628a')
  gradient.addColorStop(1, '#232239')
  context.fillStyle = gradient
  context.beginPath()
  context.roundRect(x, y, width, height + 28, [8, 8, 18, 18])
  context.fill()
  context.fillStyle = 'rgba(255,255,255,.65)'
  context.fillRect(x + 8, y + 3, width - 16, 3)
  context.strokeStyle = 'rgba(154,128,255,.4)'
  context.lineWidth = 2
  context.strokeRect(x + 1, y + 1, width - 2, height + 24)
}

function drawBackdrop(context: CanvasRenderingContext2D, time: number) {
  const sky = context.createLinearGradient(0, 0, 0, ARENA.height)
  sky.addColorStop(0, '#080817')
  sky.addColorStop(0.55, '#241f46')
  sky.addColorStop(1, '#8b496b')
  context.fillStyle = sky
  context.fillRect(0, 0, ARENA.width, ARENA.height)

  const glow = context.createRadialGradient(640, 190, 10, 640, 190, 420)
  glow.addColorStop(0, 'rgba(255,185,151,.38)')
  glow.addColorStop(0.48, 'rgba(155,97,220,.12)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, ARENA.width, ARENA.height)

  // 遠景の街並みと、ランウェイ会場の縦照明。
  context.fillStyle = 'rgba(5,5,17,.5)'
  for (let i = 0; i < 18; i++) {
    const width = 54 + ((i * 29) % 45)
    const height = 60 + ((i * 71) % 170)
    const x = i * 82 - 40
    context.fillRect(x, 525 - height, width, height)
    context.fillStyle = 'rgba(255,220,181,.12)'
    for (let windowY = 525 - height + 18; windowY < 500; windowY += 31) {
      context.fillRect(x + 13, windowY, 7, 12)
      context.fillRect(x + 32, windowY, 7, 12)
    }
    context.fillStyle = 'rgba(5,5,17,.5)'
  }
  for (let i = 0; i < 7; i++) {
    const x = 120 + i * 175
    const alpha = 0.04 + Math.sin(time * 1.4 + i) * 0.018
    const beam = context.createLinearGradient(x, 0, x + 70, 590)
    beam.addColorStop(0, `rgba(204,190,255,${alpha + 0.06})`)
    beam.addColorStop(1, 'rgba(204,190,255,0)')
    context.fillStyle = beam
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + 130, 570)
    context.lineTo(x + 250, 570)
    context.lineTo(x + 25, 0)
    context.fill()
  }

  // 高速に流れる細い光で、静止中も会場に生命感を出す。
  context.strokeStyle = 'rgba(199,187,255,.08)'
  context.lineWidth = 1
  for (let i = 0; i < 24; i++) {
    const y = (i * 43 + time * (18 + (i % 4) * 8)) % ARENA.height
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(ARENA.width, y - 110)
    context.stroke()
  }
}

function drawStage(context: CanvasRenderingContext2D) {
  drawRoundedPlatform(
    context,
    ARENA.main.x,
    ARENA.main.y,
    ARENA.main.w,
    ARENA.main.h,
  )
  for (const platform of ARENA.platforms) {
    drawRoundedPlatform(context, platform.x, platform.y, platform.w, platform.h)
  }
  context.fillStyle = 'rgba(0,0,0,.34)'
  context.beginPath()
  context.ellipse(640, 655, 470, 34, 0, 0, Math.PI * 2)
  context.fill()
}

function attackProgress(fighter: Fighter) {
  if (!fighter.action) return 0
  return fighter.action.time / ATTACKS[fighter.action.kind].total
}

function drawAttack(
  context: CanvasRenderingContext2D,
  fighter: Fighter,
  chara: ClashChara,
) {
  if (!fighter.action) return
  const def = ATTACKS[fighter.action.kind]
  if (fighter.action.time < def.activeFrom - 0.045 || fighter.action.time > def.activeTo + 0.08) {
    return
  }
  const kind = fighter.action.kind
  const vertical = kind === 'up' || kind === 'recovery'
  const radius = kind === 'smash' || kind === 'rush' ? 92 : 68
  const centerX = fighter.x + (vertical ? 0 : fighter.facing * 28)
  const centerY = fighter.y - (vertical ? 75 : 53)
  context.save()
  context.translate(centerX, centerY)
  context.scale(vertical ? 0.68 : 1, vertical ? 1.25 : 0.72)
  context.strokeStyle = chara.accentSoft
  context.shadowColor = chara.accent
  context.shadowBlur = 22
  context.lineWidth = kind === 'smash' ? 12 : 8
  context.globalAlpha = 0.78
  context.beginPath()
  const start = fighter.facing > 0 ? -1.15 : Math.PI - 1.95
  context.arc(0, 0, radius, start, start + Math.PI * 1.2)
  context.stroke()
  context.lineWidth = 2
  context.globalAlpha = 0.95
  context.beginPath()
  context.arc(0, 0, radius + 13, start + 0.2, start + Math.PI * 0.88)
  context.stroke()
  context.restore()
}

function drawFighter(
  context: CanvasRenderingContext2D,
  fighter: Fighter,
  chara: ClashChara,
  image: HTMLImageElement,
  time: number,
) {
  if (fighter.respawn > 0 || fighter.stocks <= 0) return
  const height = 132
  const width = height * chara.ratio
  const action = fighter.action?.kind
  const progress = attackProgress(fighter)
  const lean =
    action === 'rush'
      ? fighter.facing * 0.32
      : action === 'smash'
        ? fighter.facing * (progress < 0.34 ? -0.18 : 0.28)
        : action === 'air'
          ? Math.sin(progress * Math.PI * 2) * 0.35
          : clamp(fighter.vx / 1800, -0.13, 0.13)
  const stretch =
    action === 'recovery' ? 1.08 : Math.abs(fighter.vy) > 520 ? 1.045 : fighter.onGround ? 1 : 1.02
  const blink = fighter.invuln > 0 && Math.floor(time * 14) % 2 === 0

  context.save()
  context.translate(fighter.x, fighter.y)
  context.rotate(lean)
  context.scale(fighter.facing, stretch)
  context.globalAlpha = blink ? 0.32 : 1
  context.shadowColor = chara.accent
  context.shadowBlur = fighter.action ? 24 : 12
  if (image.complete && image.naturalWidth > 0) {
    context.drawImage(image, -width / 2, -height, width, height)
  } else {
    context.fillStyle = chara.accent
    context.beginPath()
    context.roundRect(-18, -112, 36, 112, 12)
    context.fill()
  }
  context.restore()
  context.globalAlpha = 1

  if (fighter.onGround) {
    context.fillStyle = 'rgba(0,0,0,.28)'
    context.beginPath()
    context.ellipse(fighter.x, fighter.y + 4, 28, 6, 0, 0, Math.PI * 2)
    context.fill()
  }
  if (fighter.shielding) {
    const shieldRatio = fighter.shield / 100
    const shield = context.createRadialGradient(
      fighter.x - 16,
      fighter.y - 70,
      8,
      fighter.x,
      fighter.y - 56,
      72,
    )
    shield.addColorStop(0, 'rgba(255,255,255,.5)')
    shield.addColorStop(0.55, `${chara.accent}7d`)
    shield.addColorStop(1, `${chara.accent}08`)
    context.fillStyle = shield
    context.strokeStyle = chara.accentSoft
    context.lineWidth = 2 + shieldRatio * 3
    context.beginPath()
    context.ellipse(
      fighter.x,
      fighter.y - 55,
      45 + shieldRatio * 17,
      62 + shieldRatio * 13,
      0,
      0,
      Math.PI * 2,
    )
    context.fill()
    context.stroke()
  }
  drawAttack(context, fighter, chara)
}

function drawProjectiles(
  context: CanvasRenderingContext2D,
  match: ClashMatch,
  charas: [ClashChara, ClashChara],
  time: number,
) {
  for (const projectile of match.projectiles) {
    const chara = charas[projectile.owner]
    const radius = projectile.radius + Math.sin(time * 18 + projectile.id) * 3
    const glow = context.createRadialGradient(
      projectile.x,
      projectile.y,
      0,
      projectile.x,
      projectile.y,
      radius * 2.7,
    )
    glow.addColorStop(0, '#fff')
    glow.addColorStop(0.22, chara.accentSoft)
    glow.addColorStop(0.58, `${chara.accent}b8`)
    glow.addColorStop(1, `${chara.accent}00`)
    context.fillStyle = glow
    context.beginPath()
    context.arc(projectile.x, projectile.y, radius * 2.7, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = chara.accentSoft
    context.lineWidth = 3
    context.beginPath()
    context.arc(projectile.x, projectile.y, radius, 0, Math.PI * 2)
    context.stroke()
    for (let i = 1; i < 5; i++) {
      context.fillStyle = `${chara.accent}${Math.round(130 / i)
        .toString(16)
        .padStart(2, '0')}`
      context.beginPath()
      context.arc(
        projectile.x - (projectile.vx / Math.abs(projectile.vx)) * i * 15,
        projectile.y,
        Math.max(2, radius - i * 3),
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  }
}

function drawParticles(
  context: CanvasRenderingContext2D,
  particles: Particle[],
  images: [HTMLImageElement, HTMLImageElement],
  charas: [ClashChara, ClashChara],
) {
  for (const particle of particles) {
    const ratio = particle.life / particle.maxLife
    context.globalAlpha = clamp(ratio * 1.6, 0, 1)
    if (particle.kind === 'ring') {
      context.strokeStyle = particle.color
      context.lineWidth = 3
      context.beginPath()
      context.arc(particle.x, particle.y, particle.size * (2 - ratio), 0, Math.PI * 2)
      context.stroke()
    } else if (particle.kind === 'line') {
      context.strokeStyle = particle.color
      context.lineWidth = particle.size * ratio
      context.beginPath()
      context.moveTo(particle.x, particle.y)
      context.lineTo(particle.x - particle.vx * 0.08, particle.y - particle.vy * 0.08)
      context.stroke()
    } else if (particle.kind === 'text') {
      context.fillStyle = particle.color
      context.textAlign = 'center'
      context.font = `900 ${particle.size}px ui-monospace, monospace`
      context.shadowColor = particle.color
      context.shadowBlur = 16
      context.fillText(particle.text ?? '', particle.x, particle.y)
      context.shadowBlur = 0
    } else if (particle.kind === 'ghost' && particle.fighter != null) {
      const chara = charas[particle.fighter]
      const image = images[particle.fighter]
      const height = 126
      const width = height * chara.ratio
      if (image.complete && image.naturalWidth > 0) {
        context.drawImage(image, particle.x - width / 2, particle.y - height, width, height)
      }
    } else {
      context.fillStyle = particle.color
      context.beginPath()
      context.arc(particle.x, particle.y, particle.size * (0.55 + ratio * 0.45), 0, Math.PI * 2)
      context.fill()
    }
  }
  context.globalAlpha = 1
}

function drawStockIcons(
  context: CanvasRenderingContext2D,
  fighter: Fighter,
  x: number,
  y: number,
  align: 'left' | 'right',
  color: string,
) {
  for (let i = 0; i < 3; i++) {
    const cx = align === 'left' ? x + i * 25 : x - i * 25
    context.fillStyle = i < fighter.stocks ? color : 'rgba(255,255,255,.12)'
    context.beginPath()
    context.arc(cx, y, 7, 0, Math.PI * 2)
    context.fill()
  }
}

function drawHud(
  context: CanvasRenderingContext2D,
  match: ClashMatch,
  charas: [ClashChara, ClashChara],
  mode: Mode,
) {
  context.textBaseline = 'alphabetic'
  context.textAlign = 'center'
  context.font = '700 24px ui-monospace, monospace'
  context.fillStyle = '#fff'
  const minutes = Math.floor(match.clock / 60)
  const seconds = Math.floor(match.clock % 60)
  context.fillText(`${minutes}:${String(seconds).padStart(2, '0')}`, ARENA.width / 2, 48)

  const drawSide = (id: 0 | 1, x: number, align: 'left' | 'right') => {
    const fighter = match.fighters[id]
    const chara = charas[id]
    const label = id === 0 ? 'P1' : mode === 'cpu' ? 'CPU' : 'P2'
    context.textAlign = align
    context.font = '800 15px ui-monospace, monospace'
    context.fillStyle = chara.accentSoft
    context.fillText(`${label} · LOOK #${chara.no ?? '—'}`, x, 38)
    context.font = `900 ${fighter.percent >= 100 ? 44 : 39}px ui-monospace, monospace`
    context.fillStyle = fighter.percent >= 120 ? '#ff7b88' : '#fff'
    context.fillText(`${Math.floor(fighter.percent)}%`, x, 82)
    drawStockIcons(context, fighter, x, 103, align, chara.accentSoft)
    if (fighter.shield < 99) {
      const width = 106
      const left = align === 'left' ? x : x - width
      context.fillStyle = 'rgba(255,255,255,.14)'
      context.fillRect(left, 115, width, 4)
      context.fillStyle = chara.accent
      context.fillRect(left, 115, width * (fighter.shield / 100), 4)
    }
  }
  drawSide(0, 46, 'left')
  drawSide(1, ARENA.width - 46, 'right')
}

function drawOffscreenMarker(
  context: CanvasRenderingContext2D,
  fighter: Fighter,
  chara: ClashChara,
) {
  if (
    fighter.respawn > 0 ||
    (fighter.x >= 22 &&
      fighter.x <= ARENA.width - 22 &&
      fighter.y >= 28 &&
      fighter.y <= ARENA.height - 20)
  ) {
    return
  }
  const x = clamp(fighter.x, 32, ARENA.width - 32)
  const y = clamp(fighter.y, 42, ARENA.height - 32)
  context.fillStyle = chara.accentSoft
  context.shadowColor = chara.accent
  context.shadowBlur = 18
  context.beginPath()
  context.arc(x, y, 18, 0, Math.PI * 2)
  context.fill()
  context.shadowBlur = 0
  context.fillStyle = '#131224'
  context.font = '900 12px ui-monospace, monospace'
  context.textAlign = 'center'
  context.fillText(fighter.id === 0 ? 'P1' : 'P2', x, y + 4)
}

function renderMatch(
  context: CanvasRenderingContext2D,
  match: ClashMatch,
  charas: [ClashChara, ClashChara],
  images: [HTMLImageElement, HTMLImageElement],
  particles: Particle[],
  time: number,
  shake: number,
  flash: number,
  mode: Mode,
) {
  context.clearRect(0, 0, ARENA.width, ARENA.height)
  context.save()
  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 22 : 0
  context.translate(shakeX, shakeY)
  drawBackdrop(context, time)
  drawStage(context)
  drawProjectiles(context, match, charas, time)
  drawParticles(context, particles, images, charas)
  // 前後関係が固定されないよう、画面の上側にいるファイターから描く。
  const order = [...match.fighters].sort((a, b) => a.y - b.y)
  for (const fighter of order) {
    drawFighter(context, fighter, charas[fighter.id], images[fighter.id], time)
  }
  for (const fighter of match.fighters) drawOffscreenMarker(context, fighter, charas[fighter.id])

  const vignette = context.createRadialGradient(640, 355, 210, 640, 355, 760)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,8,.5)')
  context.fillStyle = vignette
  context.fillRect(0, 0, ARENA.width, ARENA.height)
  context.restore()

  drawHud(context, match, charas, mode)

  if (match.phase === 'countdown') {
    const value =
      match.countdown > 2.25 ? '3' : match.countdown > 1.35 ? '2' : match.countdown > 0.45 ? '1' : 'GO!'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `900 ${value === 'GO!' ? 116 : 148}px ui-monospace, monospace`
    context.shadowColor = '#9e7bff'
    context.shadowBlur = 45
    context.fillStyle = '#fff'
    context.fillText(value, ARENA.width / 2, ARENA.height / 2 - 20)
    context.shadowBlur = 0
  }
  if (flash > 0) {
    context.globalAlpha = Math.min(0.34, flash)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, ARENA.width, ARENA.height)
    context.globalAlpha = 1
  }
}

function spawnBurst(
  particles: Particle[],
  x: number,
  y: number,
  color: string,
  count: number,
  speed: number,
  life = 0.55,
) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3
    const velocity = speed * (0.45 + Math.random() * 0.8)
    particles.push({
      kind: i % 3 === 0 ? 'line' : 'dot',
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life: life * (0.72 + Math.random() * 0.55),
      maxLife: life,
      color,
      size: 2 + Math.random() * 4,
    })
  }
}

function updateParticles(particles: Particle[], dt: number) {
  for (const particle of particles) {
    particle.life -= dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vx *= Math.pow(0.975, dt * 60)
    particle.vy += particle.kind === 'text' ? 0 : 260 * dt
  }
  return particles.filter((particle) => particle.life > 0)
}

export default function ClashGameView({ data, onBack }: Props) {
  const roster = useMemo(() => buildRoster(data), [data])
  const [screen, setScreen] = useState<Screen>('select')
  const [mode, setMode] = useState<Mode>('cpu')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [selected, setSelected] = useState<[number, number]>([0, Math.min(4, roster.length - 1)])
  const [picking, setPicking] = useState<0 | 1>(0)

  const pick = (index: number) => {
    setSelected((current) => {
      const next: [number, number] = [...current]
      next[picking] = index
      return next
    })
    setPicking(picking === 0 ? 1 : 0)
  }

  return (
    <main className="clash">
      {screen === 'select' ? (
        <ClashSelect
          roster={roster}
          selected={selected}
          picking={picking}
          mode={mode}
          difficulty={difficulty}
          onPick={pick}
          onPicking={setPicking}
          onMode={setMode}
          onDifficulty={setDifficulty}
          onRandom={() => {
            const first = Math.floor(Math.random() * roster.length)
            let second = Math.floor(Math.random() * roster.length)
            if (roster.length > 1 && second === first) second = (second + 1) % roster.length
            setSelected([first, second])
          }}
          onStart={() => setScreen('play')}
          onBack={onBack}
        />
      ) : (
        <ClashPlay
          charas={[roster[selected[0]], roster[selected[1]]]}
          mode={mode}
          difficulty={difficulty}
          onRoster={() => setScreen('select')}
        />
      )}
    </main>
  )
}

function StatMeter({ label, value }: { label: string; value: number }) {
  const percent = clamp(((value - 0.75) / 0.55) * 100, 8, 100)
  return (
    <span className="clash-stat">
      <span className="clash-stat-label mono">{label}</span>
      <span className="clash-stat-track">
        <span className="clash-stat-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  )
}

function ClashSelect({
  roster,
  selected,
  picking,
  mode,
  difficulty,
  onPick,
  onPicking,
  onMode,
  onDifficulty,
  onRandom,
  onStart,
  onBack,
}: {
  roster: ClashChara[]
  selected: [number, number]
  picking: 0 | 1
  mode: Mode
  difficulty: Difficulty
  onPick: (index: number) => void
  onPicking: (slot: 0 | 1) => void
  onMode: (mode: Mode) => void
  onDifficulty: (difficulty: Difficulty) => void
  onRandom: () => void
  onStart: () => void
  onBack: () => void
}) {
  const first = roster[selected[0]]
  const second = roster[selected[1]]
  return (
    <div className="clash-select">
      <div className="game-nav clash-nav">
        <button className="game-back jp" onClick={onBack}>
          ← ゲーム選択にもどる
        </button>
        <GameShareButton game="clash" title="着戦 KISEKAE CLASH" />
      </div>

      <div className="clash-title-lockup">
        <span className="clash-kicker mono">OUTFIT PLATFORM FIGHTER</span>
        <h2 className="clash-title">
          <span className="jp">着戦</span>
          <span>KISEKAE CLASH</span>
        </h2>
        <p className="clash-lead jp">
          ダメージをためて、ステージの外へ吹っ飛ばせ。3ストック先取の出勤服バトル。
        </p>
      </div>

      <div className="clash-match-options">
        <div className="clash-segment" role="group" aria-label="対戦モード">
          <button className={mode === 'cpu' ? 'active' : ''} onClick={() => onMode('cpu')}>
            <span className="mono">1P</span>
            <span className="jp">CPU戦</span>
          </button>
          <button className={mode === 'local' ? 'active' : ''} onClick={() => onMode('local')}>
            <span className="mono">2P</span>
            <span className="jp">ローカル対戦</span>
          </button>
        </div>
        {mode === 'cpu' && (
          <div className="clash-difficulty" aria-label="CPUの強さ">
            <span className="jp">CPU</span>
            {(['easy', 'normal', 'hard'] as Difficulty[]).map((level) => (
              <button
                key={level}
                className={difficulty === level ? 'active' : ''}
                onClick={() => onDifficulty(level)}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <button className="clash-random jp" onClick={onRandom}>
          ↻ おまかせ
        </button>
      </div>

      <div className="clash-versus">
        <ChosenFighter
          chara={first}
          side="P1"
          active={picking === 0}
          onClick={() => onPicking(0)}
        />
        <span className="clash-vs mono">VS</span>
        <ChosenFighter
          chara={second}
          side={mode === 'cpu' ? 'CPU' : 'P2'}
          active={picking === 1}
          right
          onClick={() => onPicking(1)}
        />
      </div>

      <div className="clash-roster-head">
        <span className="mono">{picking === 0 ? 'P1' : mode === 'cpu' ? 'CPU' : 'P2'} SELECT</span>
        <span className="jp">ファイターを選ぶ</span>
      </div>
      <div className="clash-roster">
        {roster.map((chara, index) => {
          const isFirst = selected[0] === index
          const isSecond = selected[1] === index
          return (
            <button
              key={chara.key}
              className={`clash-roster-card${isFirst ? ' p1' : ''}${isSecond ? ' p2' : ''}`}
              style={{ '--fighter-color': chara.accent } as React.CSSProperties}
              onClick={() => onPick(index)}
            >
              <span className="clash-roster-season mono">{SEASON_LABEL[chara.season]}</span>
              <span className="clash-roster-figure">
                <img src={spriteUrl(chara.key)} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="clash-roster-no mono">LOOK #{chara.no ?? '—'}</span>
              <span className="clash-roster-type mono">{chara.typeLabel}</span>
              {(isFirst || isSecond) && (
                <span className="clash-roster-pick mono">
                  {isFirst ? 'P1' : ''}
                  {isFirst && isSecond ? ' · ' : ''}
                  {isSecond ? (mode === 'cpu' ? 'CPU' : 'P2') : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <button className="clash-ready" onClick={onStart}>
        <span className="mono">READY TO CLASH</span>
        <span className="jp">対戦をはじめる</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}

function ChosenFighter({
  chara,
  side,
  active,
  right = false,
  onClick,
}: {
  chara: ClashChara
  side: string
  active: boolean
  right?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`clash-chosen${right ? ' right' : ''}${active ? ' active' : ''}`}
      style={{ '--fighter-color': chara.accent } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="clash-chosen-side mono">{side}</span>
      <span className="clash-chosen-figure">
        <img src={spriteUrl(chara.key)} alt="" />
      </span>
      <span className="clash-chosen-info">
        <span className="clash-chosen-name mono">LOOK #{chara.no ?? '—'}</span>
        <span className="clash-chosen-date mono">
          {fmtDate(chara.date)} · {SEASON_LABEL[chara.season]}
        </span>
        <span className="clash-chosen-type mono">{chara.typeLabel} TYPE</span>
        <span className="clash-chosen-special mono">B SPECIAL · {chara.specialLabel}</span>
        <span className="clash-stat-list">
          <StatMeter label="SPD" value={chara.stats.speed} />
          <StatMeter label="JMP" value={chara.stats.jump + (chara.stats.airJumps - 1) * 0.12} />
          <StatMeter label="PWR" value={chara.stats.power} />
          <StatMeter label="WGT" value={chara.stats.weight} />
        </span>
      </span>
      {active && <span className="clash-choosing mono">SELECTING</span>}
    </button>
  )
}

type TouchState = {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  jump: boolean
  attack: boolean
  special: boolean
  shield: boolean
  jumpEdge: boolean
  attackEdge: boolean
  specialEdge: boolean
  shieldEdge: boolean
}

const emptyTouch = (): TouchState => ({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  attack: false,
  special: false,
  shield: false,
  jumpEdge: false,
  attackEdge: false,
  specialEdge: false,
  shieldEdge: false,
})

function ClashPlay({
  charas,
  mode,
  difficulty,
  onRoster,
}: {
  charas: [ClashChara, ClashChara]
  mode: Mode
  difficulty: Difficulty
  onRoster: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const touchRef = useRef<TouchState>(emptyTouch())
  const audioRef = useRef<ReturnType<typeof createClashAudio> | null>(null)
  if (!audioRef.current) audioRef.current = createClashAudio()
  const [muted, setMuted] = useState(() => audioRef.current!.isMuted())
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [winner, setWinner] = useState<0 | 1 | null>(null)
  const [restartTick, setRestartTick] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])
  useEffect(() => () => audioRef.current?.close(), [])

  useEffect(() => {
    setWinner(null)
    setPaused(false)
    pausedRef.current = false
    window.scrollTo({ top: 0 })
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = ARENA.width * dpr
    canvas.height = ARENA.height * dpr
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    const images = charas.map((chara) => {
      const image = new Image()
      image.src = spriteUrl(chara.key)
      return image
    }) as [HTMLImageElement, HTMLImageElement]
    const match = createClashMatch(charas[0].stats, charas[1].stats)
    const held: [ClashInput, ClashInput] = [emptyClashInput(), emptyClashInput()]
    let cpuInput = emptyClashInput()
    let cpuThink = 0
    let particles: Particle[] = []
    let lastEventId = 0
    let shake = 0
    let flash = 0
    let resultReported = false
    let raf = 0
    let previous = performance.now()
    let accumulator = 0
    let time = 0
    const STEP = 1 / 60
    const audio = audioRef.current!

    const targetForKey = (key: string): [0 | 1, keyof ClashInput] | null => {
      const lower = key.toLowerCase()
      if (lower === 'a') return [0, 'left']
      if (lower === 'd') return [0, 'right']
      if (lower === 'w' || key === ' ') return [0, 'jumpHeld']
      if (lower === 's') return [0, 'down']
      if (lower === 'j' || lower === 'z') return [0, 'attackPressed']
      if (lower === 'k' || lower === 'x') return [0, 'specialPressed']
      if (lower === 'l' || lower === 'c') return [0, 'shield']
      const arrowPlayer: 0 | 1 = mode === 'cpu' ? 0 : 1
      if (key === 'ArrowLeft') return [arrowPlayer, 'left']
      if (key === 'ArrowRight') return [arrowPlayer, 'right']
      if (key === 'ArrowUp') return [arrowPlayer, 'jumpHeld']
      if (key === 'ArrowDown') return [arrowPlayer, 'down']
      if (lower === ',') return [1, 'attackPressed']
      if (lower === '.') return [1, 'specialPressed']
      if (lower === '/') return [1, 'shield']
      return null
    }
    const onKeyDown = (event: KeyboardEvent) => {
      audio.unlock()
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
        if (!event.repeat) setPaused((current) => !current)
        event.preventDefault()
        return
      }
      const target = targetForKey(event.key)
      if (!target) return
      const [id, action] = target
      if (mode === 'cpu' && id === 1) return
      if (
        action === 'jumpHeld' ||
        action === 'left' ||
        action === 'right' ||
        action === 'down' ||
        action === 'shield'
      ) {
        held[id][action] = true
        if (action === 'jumpHeld' && !event.repeat) {
          held[id].jumpPressed = true
          held[id].up = true
        }
        if (action === 'shield' && !event.repeat) held[id].shieldPressed = true
      } else if (!event.repeat) {
        held[id][action] = true
      }
      if (
        event.key === ' ' ||
        event.key.startsWith('Arrow') ||
        [',', '.', '/'].includes(event.key)
      ) {
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const target = targetForKey(event.key)
      if (!target) return
      const [id, action] = target
      if (action === 'jumpHeld') {
        held[id].jumpHeld = false
        held[id].up = false
      } else if (action === 'left' || action === 'right' || action === 'down' || action === 'shield') {
        held[id][action] = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const readHuman = (id: 0 | 1) => {
      const input = { ...held[id] }
      if (id === 0) {
        const touch = touchRef.current
        input.left ||= touch.left
        input.right ||= touch.right
        input.up ||= touch.up
        input.down ||= touch.down
        input.jumpHeld ||= touch.jump
        input.jumpPressed ||= touch.jumpEdge
        input.attackPressed ||= touch.attackEdge
        input.specialPressed ||= touch.specialEdge
        input.shield ||= touch.shield
        input.shieldPressed ||= touch.shieldEdge
        touch.jumpEdge = false
        touch.attackEdge = false
        touch.specialEdge = false
        touch.shieldEdge = false
      }
      held[id].jumpPressed = false
      held[id].attackPressed = false
      held[id].specialPressed = false
      held[id].shieldPressed = false
      return input
    }

    const addText = (x: number, y: number, text: string, color: string, size: number) => {
      particles.push({
        kind: 'text',
        x,
        y,
        vx: 0,
        vy: -62,
        life: 0.8,
        maxLife: 0.8,
        color,
        size,
        text,
      })
    }
    const processEvent = (event: ClashEvent) => {
      const humanWinner = event.type !== 'gameOver' || mode === 'local' || event.winner === 0
      audio.play(event, humanWinner)
      if (event.type === 'jump' || event.type === 'airJump') {
        const color = charas[event.fighter].accentSoft
        particles.push({
          kind: 'ring',
          x: event.x,
          y: event.y - 8,
          vx: 0,
          vy: 0,
          life: 0.34,
          maxLife: 0.34,
          color,
          size: event.type === 'airJump' ? 34 : 24,
        })
        spawnBurst(particles, event.x, event.y, color, 8, 90, 0.32)
      } else if (event.type === 'attack' && event.kind === 'rush') {
        particles.push({
          kind: 'ghost',
          x: event.x,
          y: event.y + 48,
          vx: -match.fighters[event.fighter].facing * 80,
          vy: 0,
          life: 0.34,
          maxLife: 0.34,
          color: charas[event.fighter].accent,
          size: 1,
          fighter: event.fighter,
        })
      } else if (event.type === 'hit') {
        const color = charas[event.attacker].accentSoft
        spawnBurst(particles, event.x, event.y, color, event.power > 600 ? 34 : 22, event.power * 0.55)
        particles.push({
          kind: 'ring',
          x: event.x,
          y: event.y,
          vx: 0,
          vy: 0,
          life: 0.38,
          maxLife: 0.38,
          color: '#fff',
          size: clamp(event.power / 8, 32, 90),
        })
        addText(event.x, event.y - 36, `${event.damage}%`, '#fff', 24)
        shake = clamp(event.power / 720, 0.2, 1.15)
        flash = clamp(event.power / 1700, 0.1, 0.42)
      } else if (event.type === 'shield') {
        spawnBurst(particles, event.x, event.y, '#bdf5ff', 14, 150, 0.3)
        addText(event.x, event.y - 44, 'BLOCK', '#d8fbff', 17)
        shake = 0.24
      } else if (event.type === 'shieldBreak') {
        spawnBurst(particles, event.x, event.y, '#fff1a6', 38, 290, 0.72)
        addText(event.x, event.y - 42, 'BREAK!', '#fff1a6', 28)
        shake = 0.72
        flash = 0.28
      } else if (event.type === 'ko') {
        const color = charas[event.fighter === 0 ? 1 : 0].accentSoft
        spawnBurst(
          particles,
          clamp(event.x, 30, ARENA.width - 30),
          clamp(event.y, 30, ARENA.height - 30),
          color,
          58,
          520,
          1,
        )
        addText(ARENA.width / 2, 205, 'STOCK LOST', '#fff', 34)
        shake = 1.35
        flash = 0.5
      } else if (event.type === 'respawn') {
        particles.push({
          kind: 'ring',
          x: event.x,
          y: event.y,
          vx: 0,
          vy: 0,
          life: 0.7,
          maxLife: 0.7,
          color: charas[event.fighter].accentSoft,
          size: 72,
        })
      }
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const frameDt = Math.min(0.08, (now - previous) / 1000)
      previous = now
      if (!pausedRef.current) {
        accumulator += frameDt
        time += frameDt
        while (accumulator >= STEP) {
          const firstInput = readHuman(0)
          let secondInput: ClashInput
          if (mode === 'local') secondInput = readHuman(1)
          else {
            cpuThink -= STEP
            if (cpuThink <= 0) {
              cpuInput = cpuClashInput(match, 1, CPU_PROFILES[difficulty])
              cpuThink = CPU_PROFILES[difficulty].reaction * (0.65 + Math.random() * 0.65)
            }
            secondInput = { ...cpuInput }
            cpuInput.jumpPressed = false
            cpuInput.attackPressed = false
            cpuInput.specialPressed = false
            cpuInput.shieldPressed = false
          }
          stepClashMatch(match, [firstInput, secondInput], STEP)
          accumulator -= STEP
          for (const event of match.events) {
            if (event.id <= lastEventId) continue
            processEvent(event)
            lastEventId = event.id
          }
          particles = updateParticles(particles, STEP)
          shake = Math.max(0, shake - STEP * 3.8)
          flash = Math.max(0, flash - STEP * 2.5)
          if (match.phase === 'result' && !resultReported) {
            resultReported = true
            window.setTimeout(() => setWinner(match.winner), 500)
          }
        }
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderMatch(context, match, charas, images, particles, time, shake, flash, mode)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [charas, difficulty, mode, restartTick])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void shellRef.current?.requestFullscreen?.()
  }

  const touchHandlers = (
    key: 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'special' | 'shield',
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      audioRef.current?.unlock()
      touchRef.current[key] = true
      if (key === 'jump') touchRef.current.jumpEdge = true
      if (key === 'attack') touchRef.current.attackEdge = true
      if (key === 'special') touchRef.current.specialEdge = true
      if (key === 'shield') touchRef.current.shieldEdge = true
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      touchRef.current[key] = false
    },
    onPointerCancel: () => {
      touchRef.current[key] = false
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  })

  const winnerLabel = winner === 0 ? 'P1' : mode === 'cpu' ? 'CPU' : 'P2'
  const playerWon = winner === 0

  return (
    <div
      ref={shellRef}
      className={`clash-play${fullscreen ? ' is-fullscreen' : ''}`}
      onPointerDownCapture={() => audioRef.current?.unlock()}
    >
      <div className="clash-playbar">
        <button className="clash-playbar-back jp" onClick={onRoster}>
          ← ファイター選択
        </button>
        <span className="clash-playbar-title mono">KISEKAE CLASH · 3 STOCK</span>
        <span className="clash-playbar-actions">
          <button onClick={() => setMuted(audioRef.current!.toggle())}>
            {muted ? 'SOUND OFF' : 'SOUND ON'}
          </button>
          <button onClick={() => setPaused((current) => !current)}>
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <button onClick={toggleFullscreen}>{fullscreen ? 'EXIT FULL' : 'FULL'}</button>
        </span>
      </div>
      <div className="clash-canvas-wrap">
        <canvas ref={canvasRef} className="clash-canvas" />
        {paused && winner == null && (
          <div className="clash-pause">
            <span className="mono">PAUSED</span>
            <button className="jp" onClick={() => setPaused(false)}>
              つづける
            </button>
          </div>
        )}
        {winner != null && (
          <div className={`clash-result${playerWon ? ' win' : ''}`}>
            <span className="clash-result-kicker mono">
              {playerWon ? 'RUNWAY DOMINATED' : mode === 'cpu' ? 'NEXT LOOK, NEXT FIGHT' : 'MATCH COMPLETE'}
            </span>
            <span className="clash-result-winner mono">{winnerLabel} WINS</span>
            <img src={spriteUrl(charas[winner].key)} alt="" />
            <span className="clash-result-look mono">LOOK #{charas[winner].no ?? '—'}</span>
            <div className="clash-result-actions">
              <button
                className="primary jp"
                onClick={() => {
                  setWinner(null)
                  setRestartTick((tick) => tick + 1)
                }}
              >
                もう一戦
              </button>
              <button className="jp" onClick={onRoster}>
                ファイター選択
              </button>
            </div>
          </div>
        )}

        <div className="clash-touch" aria-label="タッチ操作">
          <div className="clash-dpad">
            <button className="up" aria-label="上" {...touchHandlers('up')}>↑</button>
            <button className="left" aria-label="左" {...touchHandlers('left')}>←</button>
            <button className="down" aria-label="下" {...touchHandlers('down')}>↓</button>
            <button className="right" aria-label="右" {...touchHandlers('right')}>→</button>
          </div>
          <button className="clash-touch-shield mono" {...touchHandlers('shield')}>GUARD</button>
          <div className="clash-actions-pad">
            <button className="jump mono" {...touchHandlers('jump')}><b>J</b><small>JUMP</small></button>
            <button className="special mono" {...touchHandlers('special')}><b>B</b><small>SPECIAL</small></button>
            <button className="attack mono" {...touchHandlers('attack')}><b>A</b><small>ATTACK</small></button>
          </div>
        </div>
      </div>
      <div className="clash-controls">
        <span>
          <b className="mono">P1</b>
          <span className="jp"> A D 移動 · W/SPACE ジャンプ · S しゃがみ · J 攻撃 · K 必殺 · L ガード</span>
        </span>
        <span>
          <b className="mono">{mode === 'cpu' ? 'TECH' : 'P2'}</b>
          <span className="jp">
            {mode === 'cpu'
              ? '方向＋攻撃で強攻撃 · ↑＋必殺で復帰 · 空中で↓なら急降下'
              : '← → 移動 · ↑ ジャンプ · ↓ しゃがみ · , 攻撃 · . 必殺 · / ガード'}
          </span>
        </span>
      </div>
    </div>
  )
}
