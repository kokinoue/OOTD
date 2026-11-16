// 着戦の描画。対戦ルール（clash.ts）の状態を読むだけで、ルールには一切手を出さない。
// カメラ・くり抜きスプライトの身振り・エフェクト・HUD をすべて 2D Canvas で描く。
import {
  ARENA,
  ATTACKS,
  DODGES,
  attackHitboxAt,
  isDodging,
  ledgePoint,
  type AttackKind,
  type ClashEvent,
  type ClashKit,
  type ClashMatch,
  type Fighter,
  type Projectile,
} from './clash'

export type ClashLook = {
  key: string
  no: number | null
  season: ClashKit
  accent: string
  accentSoft: string
  ratio: number
}

const W = ARENA.width
const SPRITE_H = 132
const PIVOT_Y = 62
const TAU = Math.PI * 2

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - (1 - t) ** 3

function rgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 位置から決まる乱数（毎フレーム同じ値になるので、背景の街や粒が揺れない）。 */
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

type StageTheme = {
  title: string
  sky: [string, string, string]
  orb: string
  haze: string
  far: string
  near: string
  window: string
  beam: string
  rim: string
  ambient: 'petal' | 'mote' | 'leaf' | 'snow'
  ambientColors: string[]
}

export const STAGE_THEMES: Record<ClashKit, StageTheme> = {
  spring: {
    title: 'SPRING DAWN',
    sky: ['#120e2c', '#4b2f66', '#e795ac'],
    orb: '#ffe1ea',
    haze: '#ff9fbd',
    far: '#2a1d44',
    near: '#170f2b',
    window: '#ffd3e0',
    beam: '#ffc4dc',
    rim: '#ffd6e6',
    ambient: 'petal',
    ambientColors: ['#ffd1e1', '#ffb3cd', '#fff0f5'],
  },
  summer: {
    title: 'SUMMER DUSK',
    sky: ['#041029', '#143f70', '#ff8f52'],
    orb: '#ffd98a',
    haze: '#ff7a3c',
    far: '#0f2a4c',
    near: '#08182f',
    window: '#ffe2a0',
    beam: '#8fd8ff',
    rim: '#b9ecff',
    ambient: 'mote',
    ambientColors: ['#fff3a8', '#ffd27a', '#b9ffe6'],
  },
  autumn: {
    title: 'AUTUMN EMBER',
    sky: ['#140a10', '#4d2130', '#dc7b2c'],
    orb: '#ffbd6b',
    haze: '#ff8a3a',
    far: '#32161f',
    near: '#1c0c12',
    window: '#ffc98a',
    beam: '#ffb872',
    rim: '#ffd9a8',
    ambient: 'leaf',
    ambientColors: ['#e8873a', '#c9502a', '#f2c14e'],
  },
  winter: {
    title: 'WINTER NIGHT',
    sky: ['#040816', '#13254a', '#6485ba'],
    orb: '#eef5ff',
    haze: '#9cc0ff',
    far: '#172a4d',
    near: '#0b1730',
    window: '#dcebff',
    beam: '#bcd8ff',
    rim: '#e6f1ff',
    ambient: 'snow',
    ambientColors: ['#ffffff', '#dcecff', '#bcd8ff'],
  },
}

type Particle = {
  kind: 'dot' | 'spark' | 'ring' | 'text' | 'smoke' | 'shard' | 'pillar' | 'star'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
  gravity: number
  drag: number
  rot: number
  spin: number
  text?: string
  glow?: boolean
}

type Ghost = { x: number; y: number; rot: number; sx: number; sy: number; life: number }

type Anim = {
  squash: number
  spin: number
  flash: number
  hudShake: number
  ghostTimer: number
  smokeTimer: number
  ghosts: Ghost[]
  comboLife: number
  combo: number
  stockPop: number
  shownPercent: number
}

const newAnim = (): Anim => ({
  squash: 0,
  spin: 0,
  flash: 0,
  hudShake: 0,
  ghostTimer: 0,
  smokeTimer: 0,
  ghosts: [],
  comboLife: 0,
  combo: 0,
  stockPop: 0,
  shownPercent: 0,
})

type Banner = { text: string; sub?: string; color: string; t: number; life: number }

type Finish = { t: number; x: number; y: number; color: string }

export type RenderExtra = {
  /** この一撃で撃墜が確定している（先読みで判定）。 */
  lethal?: boolean
  /** しかも最後のストック。 */
  final?: boolean
}

export type ClashRendererOptions = {
  looks: [ClashLook, ClashLook]
  images: [HTMLImageElement, HTMLImageElement]
  labels: [string, string]
  stage: ClashKit
  /** 画面の揺れや閃光を弱める。 */
  calm: boolean
}

const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0

function tinted(image: HTMLImageElement, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0)
  context.globalCompositeOperation = 'source-atop'
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/** 蓄積ダメージの色。白→黄→橙→赤→深紅。 */
export function percentColor(percent: number) {
  const stops: [number, [number, number, number]][] = [
    [0, [255, 255, 255]],
    [40, [255, 238, 150]],
    [80, [255, 170, 80]],
    [120, [255, 96, 96]],
    [180, [200, 40, 70]],
  ]
  for (let i = 1; i < stops.length; i++) {
    if (percent <= stops[i][0]) {
      const [p0, c0] = stops[i - 1]
      const [p1, c1] = stops[i]
      const t = (percent - p0) / (p1 - p0)
      return `rgb(${Math.round(lerp(c0[0], c1[0], t))},${Math.round(lerp(c0[1], c1[1], t))},${Math.round(lerp(c0[2], c1[2], t))})`
    }
  }
  return 'rgb(200,40,70)'
}

export function createClashRenderer(options: ClashRendererOptions) {
  const { looks, images, labels, calm } = options
  const theme = STAGE_THEMES[options.stage]
  const power = calm ? 0.3 : 1
  // 画面の縦の広さ（論理ピクセル）。縦持ちのスマホでは 16:9 より縦長にして、対戦画面を大きく見せる。
  let H: number = ARENA.height
  let hudScale = 1
  const cam = { x: W / 2, y: 330, zoom: 0.92 }
  const anim: [Anim, Anim] = [newAnim(), newAnim()]
  const tints: ({ white: HTMLCanvasElement | null; ice: HTMLCanvasElement | null } | null)[] = [null, null]
  const heads: (HTMLCanvasElement | null)[] = [null, null]
  let particles: Particle[] = []
  let shake = 0
  let flash = 0
  let flashColor = '#ffffff'
  let banner: Banner | null = null
  let finish: Finish | null = null
  let hold = 0
  let clock = 0

  const prepare = (id: 0 | 1) => {
    if (tints[id] || !ready(images[id])) return
    tints[id] = { white: tinted(images[id], '#ffffff'), ice: tinted(images[id], '#8fd0ff') }
    // HUD 用の顔アイコン。くり抜きは頭が上・中央にある前提で切り出す。
    const image = images[id]
    const head = document.createElement('canvas')
    head.width = 96
    head.height = 96
    const context = head.getContext('2d')
    if (context) {
      const side = Math.min(image.naturalWidth * 0.62, image.naturalHeight * 0.3)
      context.drawImage(image, (image.naturalWidth - side) / 2, 0, side, side, 0, 0, 96, 96)
      heads[id] = head
    }
  }

  const push = (particle: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'life' | 'color' | 'size'>) => {
    if (particles.length > 520) particles.splice(0, particles.length - 520)
    particles.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0.975,
      rot: 0,
      spin: 0,
      maxLife: particle.life,
      ...particle,
    })
  }

  const burst = (
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    life: number,
    spread: { angle: number; arc: number } | null = null,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = spread
        ? spread.angle + (Math.random() - 0.5) * spread.arc
        : (i / count) * TAU + Math.random() * 0.4
      const velocity = speed * (0.35 + Math.random() * 0.9)
      push({
        kind: i % 3 === 0 ? 'spark' : 'dot',
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: life * (0.6 + Math.random() * 0.6),
        color,
        size: 2 + Math.random() * 4,
        gravity: 420,
        glow: true,
      })
    }
  }

  const ring = (x: number, y: number, color: string, size: number, life = 0.36) =>
    push({ kind: 'ring', x, y, life, color, size })

  const label = (x: number, y: number, text: string, color: string, size: number, life = 0.8) =>
    push({ kind: 'text', x, y, vy: -64, life, color, size, text, drag: 0.94 })

  const addShake = (amount: number) => {
    shake = Math.max(shake, amount * power)
  }
  const addFlash = (amount: number, color = '#ffffff') => {
    if (amount * power > flash) {
      flash = amount * power
      flashColor = color
    }
  }

  function onEvent(event: ClashEvent, match: ClashMatch, extra: RenderExtra = {}) {
    if (event.type === 'go') {
      banner = { text: 'GO!', color: '#ffffff', t: 0, life: 0.7 }
    } else if (event.type === 'jump' || event.type === 'airJump') {
      const color = looks[event.fighter].accentSoft
      anim[event.fighter].squash = -0.6
      ring(event.x, event.y - 6, color, event.type === 'airJump' ? 30 : 20, 0.3)
      if (event.type === 'jump') {
        for (const side of [-1, 1]) {
          push({
            kind: 'smoke',
            x: event.x + side * 14,
            y: event.y - 4,
            vx: side * 90,
            vy: -20,
            life: 0.34,
            color: 'rgba(255,255,255,.5)',
            size: 9,
          })
        }
      } else burst(event.x, event.y, color, 9, 150, 0.3, { angle: Math.PI / 2, arc: 1.6 })
    } else if (event.type === 'land') {
      anim[event.fighter].squash = 1
      for (const side of [-1, 1]) {
        push({
          kind: 'smoke',
          x: event.x + side * 16,
          y: event.y - 3,
          vx: side * 130,
          vy: -26,
          life: 0.36,
          color: 'rgba(255,255,255,.45)',
          size: 10,
        })
      }
    } else if (event.type === 'bounce') {
      anim[event.fighter].squash = 1
      ring(event.x, event.y, '#ffffff', 46, 0.3)
      burst(event.x, event.y, looks[event.fighter].accentSoft, 16, 320, 0.4, { angle: -Math.PI / 2, arc: 2.4 })
      addShake(0.5)
    } else if (event.type === 'dodge') {
      const color = looks[event.fighter].accentSoft
      ring(event.x, event.y - 50, color, 26, 0.24)
    } else if (event.type === 'ledge') {
      burst(event.x, event.y, theme.rim, 8, 140, 0.26)
      ring(event.x, event.y, theme.rim, 16, 0.24)
    } else if (event.type === 'climb') {
      push({
        kind: 'smoke',
        x: event.x,
        y: event.y - 4,
        vy: -30,
        life: 0.3,
        color: 'rgba(255,255,255,.4)',
        size: 9,
      })
    } else if (event.type === 'attack') {
      if (event.kind === 'burst') {
        const fighter = match.fighters[event.fighter]
        burst(event.x + fighter.facing * 40, event.y, '#ffb347', 14, 260, 0.4, {
          angle: fighter.facing > 0 ? 0 : Math.PI,
          arc: 1.1,
        })
      }
    } else if (event.type === 'projectile') {
      ring(event.x, event.y, looks[event.fighter].accentSoft, 18, 0.22)
    } else if (event.type === 'hit') {
      const attacker = looks[event.attacker]
      const target = anim[event.target]
      const heavy = clamp(event.power / 900, 0, 1)
      const angle = Math.atan2(event.vy, event.vx)
      target.flash = 0.14
      target.hudShake = 0.4
      burst(event.x, event.y, '#ffffff', 8 + Math.round(heavy * 10), 240 + event.power * 0.5, 0.34)
      burst(event.x, event.y, attacker.accentSoft, 10 + Math.round(heavy * 18), event.power * 0.9, 0.5, {
        angle,
        arc: 0.9,
      })
      ring(event.x, event.y, '#ffffff', clamp(event.power / 9, 26, 84))
      push({ kind: 'star', x: event.x, y: event.y, life: 0.16, color: '#ffffff', size: 40 + heavy * 70, rot: Math.random() * TAU })
      label(event.x + (Math.random() - 0.5) * 20, event.y - 40, `${event.damage}%`, '#ffffff', 20 + heavy * 12)
      if (event.source === 'frost') burst(event.x, event.y, '#bfe6ff', 14, 200, 0.6)
      if (event.combo >= 2) {
        const mine = anim[event.attacker]
        mine.combo = event.combo
        mine.comboLife = 1.5
      }
      addShake(clamp(event.power / 700, 0.18, 1.1))
      addFlash(clamp(event.power / 2200, 0.05, 0.3))
      if (extra.lethal) {
        // 決まる一撃は、当たった瞬間に画面で分かるようにする。
        hold = Math.max(hold, extra.final ? 0.62 : 0.2)
        addShake(1.4)
        addFlash(0.55, attacker.accentSoft)
        for (let i = 0; i < 18; i++) {
          push({
            kind: 'shard',
            x: event.x,
            y: event.y,
            vx: Math.cos(angle + (Math.random() - 0.5) * 1.8) * (300 + Math.random() * 700),
            vy: Math.sin(angle + (Math.random() - 0.5) * 1.8) * (300 + Math.random() * 700),
            life: 0.7,
            color: i % 2 ? '#ffffff' : attacker.accentSoft,
            size: 6 + Math.random() * 10,
            rot: Math.random() * TAU,
            spin: (Math.random() - 0.5) * 20,
            gravity: 300,
          })
        }
        if (extra.final) {
          finish = { t: 0, x: event.x, y: event.y, color: attacker.accentSoft }
        }
      }
    } else if (event.type === 'shield') {
      burst(event.x, event.y, '#bdf5ff', 12, 170, 0.3)
      label(event.x, event.y - 44, 'GUARD', '#d8fbff', 15, 0.5)
      addShake(0.2)
    } else if (event.type === 'parry') {
      const color = looks[event.target].accentSoft
      burst(event.x, event.y, '#ffffff', 22, 420, 0.42)
      ring(event.x, event.y, '#ffffff', 60, 0.32)
      ring(event.x, event.y, color, 96, 0.46)
      push({ kind: 'star', x: event.x, y: event.y, life: 0.24, color: '#ffffff', size: 120, rot: 0.4 })
      label(event.x, event.y - 62, event.reflected ? 'REFLECT!' : 'JUST GUARD!', '#ffffff', 24, 0.9)
      addShake(0.6)
      addFlash(0.3, color)
    } else if (event.type === 'shieldBreak') {
      burst(event.x, event.y, '#fff1a6', 40, 320, 0.72)
      label(event.x, event.y - 46, 'BREAK!', '#fff1a6', 28)
      addShake(0.8)
      addFlash(0.3)
    } else if (event.type === 'ko') {
      const color = event.by == null ? '#ffffff' : looks[event.by].accentSoft
      const x = clamp(event.x, ARENA.blast.left, ARENA.blast.right)
      const y = clamp(event.y, ARENA.blast.top, ARENA.blast.bottom)
      const angle =
        event.side === 'left' ? 0 : event.side === 'right' ? Math.PI : event.side === 'top' ? Math.PI / 2 : -Math.PI / 2
      push({ kind: 'pillar', x, y, life: 0.8, color, size: 230, rot: angle })
      push({ kind: 'pillar', x, y, life: 0.5, color: '#ffffff', size: 90, rot: angle })
      burst(x, y, color, 46, 760, 1, { angle, arc: 1.5 })
      burst(x, y, '#ffffff', 22, 520, 0.8, { angle, arc: 2.2 })
      anim[event.fighter].stockPop = 0.6
      anim[event.fighter].shownPercent = 0
      addShake(1.5)
      addFlash(0.5, color)
      if (!event.final) {
        banner = {
          text: event.by == null ? 'SELF DESTRUCT' : `${labels[event.by]} KO!`,
          color,
          t: 0,
          life: 1.1,
        }
      }
    } else if (event.type === 'respawn') {
      ring(event.x, event.y - 40, looks[event.fighter].accentSoft, 70, 0.7)
      burst(event.x, event.y - 40, looks[event.fighter].accentSoft, 16, 200, 0.6)
    } else if (event.type === 'gameOver') {
      banner = {
        text: event.timeUp ? 'TIME UP' : 'FINISH!',
        sub: `${labels[event.winner]} WINS`,
        color: looks[event.winner].accentSoft,
        t: 0,
        life: 4,
      }
      if (!finish) addFlash(0.6, looks[event.winner].accentSoft)
    }
  }

  function updateCamera(match: ClashMatch, dt: number) {
    let minX = 520
    let maxX = 760
    let minY = 300
    let maxY = 470
    for (const fighter of match.fighters) {
      if (fighter.respawn > 0 || fighter.stocks <= 0) continue
      const x = clamp(fighter.x, ARENA.blast.left + 40, ARENA.blast.right - 40)
      const y = clamp(fighter.y, ARENA.blast.top + 80, ARENA.blast.bottom - 20)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y - 100)
      maxY = Math.max(maxY, y)
    }
    let zoom = clamp(Math.min(W / (maxX - minX + 520), H / (maxY - minY + 330)), 0.6, 1.2)
    let x = clamp((minX + maxX) / 2, 400, 880)
    let y = clamp((minY + maxY) / 2 - 16, 200, 480)
    let speed = 4.2
    if (finish && finish.t < 1.1) {
      zoom = 1.7
      x = finish.x
      y = finish.y
      speed = 16
    }
    const k = 1 - Math.exp(-dt * speed)
    cam.x += (x - cam.x) * k
    cam.y += (y - cam.y) * k
    // 引くのは速く、寄るのはゆっくり（場外へ飛んだ相手を見失わない）。
    const zk = zoom < cam.zoom ? 1 - Math.exp(-dt * speed * 1.6) : 1 - Math.exp(-dt * speed * 0.55)
    cam.zoom += (zoom - cam.zoom) * (finish && finish.t < 1.1 ? k : zk)
  }

  /** 毎フレーム1回。`dt` は実時間（試合が止まっていても演出は進む）。 */
  function update(match: ClashMatch, dt: number, simDt: number) {
    clock += dt
    prepare(0)
    prepare(1)
    hold = Math.max(0, hold - dt)
    shake = Math.max(0, shake - dt * 3.6)
    flash = Math.max(0, flash - dt * 2.4)
    if (banner) {
      banner.t += dt
      if (banner.t >= banner.life) banner = null
    }
    if (finish) {
      finish.t += dt
      if (finish.t > 2.4) finish = null
    }
    for (const fighter of match.fighters) {
      const state = anim[fighter.id]
      state.squash *= Math.exp(-dt * 13)
      state.flash = Math.max(0, state.flash - dt)
      state.hudShake = Math.max(0, state.hudShake - dt)
      state.comboLife = Math.max(0, state.comboLife - dt)
      state.stockPop = Math.max(0, state.stockPop - dt)
      state.shownPercent += (fighter.percent - state.shownPercent) * (1 - Math.exp(-dt * 14))
      for (const ghost of state.ghosts) ghost.life -= dt
      state.ghosts = state.ghosts.filter((ghost) => ghost.life > 0)
      if (fighter.respawn > 0 || fighter.stocks <= 0) continue
      const speed = Math.hypot(fighter.vx, fighter.vy)
      if (fighter.hitstun > 0) {
        state.spin += simDt * (7 + speed / 70) * (fighter.vx >= 0 ? 1 : -1)
      } else {
        state.spin = 0
      }
      const kind = fighter.action?.kind
      const trailing =
        (fighter.hitstun > 0 && speed > 480) ||
        kind === 'rush' ||
        kind === 'recovery' ||
        fighter.dodge != null
      state.ghostTimer -= simDt
      if (trailing && state.ghostTimer <= 0) {
        state.ghostTimer = 0.032
        const pose = poseOf(fighter, state, clock)
        state.ghosts.push({
          x: fighter.x + pose.dx,
          y: fighter.y + pose.dy,
          rot: pose.rot,
          sx: pose.sx * fighter.facing,
          sy: pose.sy,
          life: 0.2,
        })
      }
      state.smokeTimer -= simDt
      if (fighter.hitstun > 0 && speed > 420 && state.smokeTimer <= 0) {
        state.smokeTimer = 0.028
        push({
          kind: 'smoke',
          x: fighter.x + (Math.random() - 0.5) * 16,
          y: fighter.y - 50 + (Math.random() - 0.5) * 20,
          vx: -fighter.vx * 0.05,
          vy: -fighter.vy * 0.05,
          life: 0.4,
          color: 'rgba(255,255,255,.55)',
          size: 9 + Math.min(14, speed / 90),
        })
      }
      if (fighter.chill > 0 && Math.random() < dt * 9) {
        push({
          kind: 'dot',
          x: fighter.x + (Math.random() - 0.5) * 40,
          y: fighter.y - Math.random() * 100,
          vy: 40,
          life: 0.6,
          color: '#cfeaff',
          size: 2.4,
          glow: true,
        })
      }
    }
    for (const projectile of match.projectiles) {
      if (Math.random() < simDt * 34) {
        const color = looks[projectile.owner].accentSoft
        push({
          kind: 'dot',
          x: projectile.x + (Math.random() - 0.5) * projectile.radius,
          y: projectile.y + (Math.random() - 0.5) * projectile.radius,
          vx: -projectile.vx * 0.12,
          vy: (Math.random() - 0.5) * 40,
          life: 0.34,
          color: projectile.kind === 'frost' ? '#d6eeff' : color,
          size: 2 + Math.random() * 2.5,
          glow: true,
        })
      }
    }
    for (const particle of particles) {
      particle.life -= dt
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      const drag = Math.pow(particle.drag, dt * 60)
      particle.vx *= drag
      particle.vy = particle.vy * drag + particle.gravity * dt
      particle.rot += particle.spin * dt
    }
    particles = particles.filter((particle) => particle.life > 0)
    updateCamera(match, dt)
  }

  type Pose = { dx: number; dy: number; rot: number; sx: number; sy: number; alpha: number }

  function poseOf(fighter: Fighter, state: Anim, time: number): Pose {
    const facing = fighter.facing
    const pose: Pose = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 }
    if (fighter.ledge) {
      const toward = fighter.ledge === 'left' ? 1 : -1
      pose.rot = -toward * 0.1 + Math.sin(time * 2.4 + fighter.id) * 0.035
      pose.dy = 36
      pose.sy = 1.04
      return pose
    }
    if (fighter.hitstun > 0) {
      pose.rot = state.spin
      const speed = Math.hypot(fighter.vx, fighter.vy)
      const stretch = clamp(speed / 2600, 0, 0.16)
      pose.sy = 1 + stretch
      pose.sx = 1 - stretch * 0.6
      return pose
    }
    pose.rot = clamp(fighter.vx / 1900, -0.12, 0.12)
    if (fighter.onGround) {
      if (Math.abs(fighter.vx) > 70) pose.dy = -Math.abs(Math.sin(time * 15 + fighter.id * 2)) * 5
      else pose.sy = 1 + Math.sin(time * 2.6 + fighter.id * 1.7) * 0.012
      if (fighter.squat > 0) {
        pose.sy *= 0.9
        pose.sx *= 1.07
      }
    } else if (fighter.vy < -150) {
      pose.sy = 1.07
      pose.sx = 0.95
    } else if (fighter.vy > 300) {
      pose.sy = 1.04
      pose.sx = 0.97
    }
    pose.sy *= 1 - 0.16 * state.squash
    pose.sx *= 1 + 0.12 * state.squash
    if (fighter.lag > 0.2) pose.rot += Math.sin(time * 34) * 0.09

    const dodge = fighter.dodge
    if (dodge) {
      const p = dodge.time / DODGES[dodge.kind].total
      if (dodge.kind === 'roll') pose.rot += dodge.dir * TAU * easeOut(p)
      else if (dodge.kind === 'spot') pose.sx *= 0.3 + 0.7 * Math.abs(Math.cos(Math.PI * p))
      else pose.rot += facing * Math.sin(p * Math.PI) * 0.5
      if (isDodging(fighter)) pose.alpha = 0.45
    }

    const action = fighter.action
    if (action) {
      const p = clamp(action.time / ATTACKS[action.kind].total, 0, 1)
      const swing = Math.sin(Math.PI * clamp(p * 2.2, 0, 1))
      switch (action.kind) {
        case 'jab':
          pose.dx += facing * 12 * swing
          pose.rot += facing * 0.12 * swing
          break
        case 'smash':
        case 'burst': {
          const wind = action.kind === 'smash' ? 0.33 : 0.27
          if (p < wind) {
            pose.rot -= facing * 0.26 * (p / wind)
            pose.dx -= facing * 9 * (p / wind)
            pose.sx *= 1 + 0.06 * (p / wind)
          } else {
            const out = 1 - (p - wind) / (1 - wind)
            pose.rot += facing * 0.36 * out
            pose.dx += facing * 28 * out
          }
          break
        }
        case 'up':
          pose.sy *= 1 + 0.17 * swing
          pose.sx *= 1 - 0.07 * swing
          pose.dy -= 16 * swing
          break
        case 'down':
          pose.sy *= 1 - 0.2 * swing
          pose.sx *= 1 + 0.14 * swing
          pose.rot += facing * 0.2 * swing
          break
        case 'air':
          pose.rot += facing * TAU * easeOut(p)
          break
        case 'airUp':
          pose.rot -= facing * TAU * easeOut(p)
          pose.sy *= 1.06
          break
        case 'airDown':
          pose.rot += facing * Math.PI * (p < 0.3 ? p / 0.3 : p < 0.72 ? 1 : 1 + (p - 0.72) / 0.28)
          pose.sy *= 1.1
          break
        case 'rush':
          pose.rot += facing * 0.38
          pose.sx *= 1.07
          break
        case 'recovery':
          pose.sx *= Math.cos(p * Math.PI * 6)
          pose.sy *= 1.1
          break
      }
    }
    return pose
  }

  function drawSprite(context: CanvasRenderingContext2D, source: CanvasImageSource | null, look: ClashLook) {
    const width = SPRITE_H * look.ratio
    if (source) context.drawImage(source, -width / 2, -SPRITE_H, width, SPRITE_H)
    else {
      context.fillStyle = look.accent
      context.beginPath()
      context.roundRect(-18, -112, 36, 112, 12)
      context.fill()
    }
  }

  function withPose(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    rot: number,
    sx: number,
    sy: number,
    draw: () => void,
  ) {
    context.save()
    context.translate(x, y - PIVOT_Y)
    context.rotate(rot)
    context.translate(0, PIVOT_Y)
    context.scale(sx, sy)
    draw()
    context.restore()
  }

  function groundBelow(x: number, y: number) {
    let best: number | null = null
    for (const platform of [ARENA.main, ...ARENA.platforms]) {
      if (x < platform.x - 10 || x > platform.x + platform.w + 10) continue
      if (platform.y < y - 2) continue
      if (best == null || platform.y < best) best = platform.y
    }
    return best
  }

  function drawFighter(context: CanvasRenderingContext2D, fighter: Fighter, time: number) {
    if (fighter.respawn > 0 || fighter.stocks <= 0) return
    const look = looks[fighter.id]
    const state = anim[fighter.id]
    const image = ready(images[fighter.id]) ? images[fighter.id] : null
    const tint = tints[fighter.id]
    const pose = poseOf(fighter, state, time)

    const floor = groundBelow(fighter.x, fighter.y)
    if (floor != null && !fighter.ledge) {
      const height = clamp((floor - fighter.y) / 320, 0, 1)
      context.fillStyle = `rgba(0,0,0,${0.32 * (1 - height * 0.75)})`
      context.beginPath()
      context.ellipse(fighter.x, floor + 3, 30 * (1 - height * 0.45), 6 * (1 - height * 0.4), 0, 0, TAU)
      context.fill()
    }

    for (const ghost of state.ghosts) {
      context.globalAlpha = (ghost.life / 0.2) * 0.3
      withPose(context, ghost.x, ghost.y, ghost.rot, ghost.sx, ghost.sy, () =>
        drawSprite(context, tint?.white ?? image, look),
      )
    }
    context.globalAlpha = 1

    // 足もとの色あかり。影ぼかしを使わずに、誰がどこにいるかを色で示す。
    const glow = context.createRadialGradient(fighter.x, fighter.y - 56, 6, fighter.x, fighter.y - 56, 86)
    glow.addColorStop(0, rgba(look.accent, fighter.action ? 0.34 : 0.2))
    glow.addColorStop(1, rgba(look.accent, 0))
    context.fillStyle = glow
    context.fillRect(fighter.x - 90, fighter.y - 146, 180, 180)

    const blink = fighter.invuln > 0.12 && Math.floor(time * 16) % 2 === 0
    context.globalAlpha = pose.alpha * (blink ? 0.4 : 1)
    withPose(context, fighter.x + pose.dx, fighter.y + pose.dy, pose.rot, pose.sx * fighter.facing, pose.sy, () => {
      drawSprite(context, image, look)
      if (fighter.chill > 0 && tint?.ice) {
        context.globalAlpha *= 0.42
        drawSprite(context, tint.ice, look)
      }
    })
    if (state.flash > 0 && tint?.white) {
      context.globalAlpha = clamp(state.flash / 0.1, 0, 1)
      withPose(context, fighter.x + pose.dx, fighter.y + pose.dy, pose.rot, pose.sx * fighter.facing, pose.sy, () =>
        drawSprite(context, tint.white, look),
      )
    }
    context.globalAlpha = 1

    if (fighter.shielding) drawShield(context, fighter, look, time)
    if (fighter.action) drawAttack(context, fighter, look)
    if (fighter.lag > 0.2) {
      // ジャストガードされてのけぞっている。
      for (let i = 0; i < 3; i++) {
        const angle = time * 7 + (i * TAU) / 3
        context.fillStyle = '#fff7b0'
        context.beginPath()
        context.arc(fighter.x + Math.cos(angle) * 26, fighter.y - 126 + Math.sin(angle) * 7, 4, 0, TAU)
        context.fill()
      }
    }
  }

  function drawShield(context: CanvasRenderingContext2D, fighter: Fighter, look: ClashLook, time: number) {
    const ratio = fighter.shield / 100
    const rx = 44 + ratio * 18
    const ry = 60 + ratio * 14
    const cx = fighter.x
    const cy = fighter.y - 55
    const bubble = context.createRadialGradient(cx - 16, cy - 16, 8, cx, cy, ry + 8)
    bubble.addColorStop(0, 'rgba(255,255,255,.5)')
    bubble.addColorStop(0.55, rgba(look.accent, 0.42))
    bubble.addColorStop(1, rgba(look.accent, 0.05))
    context.fillStyle = bubble
    context.strokeStyle = fighter.shield < 30 && Math.floor(time * 10) % 2 ? '#ff9aa8' : look.accentSoft
    context.lineWidth = 2 + ratio * 3
    context.beginPath()
    context.ellipse(cx, cy, rx, ry, 0, 0, TAU)
    context.fill()
    context.stroke()
    if (fighter.parryReady && fighter.guardTime < 0.12) {
      // 張った直後だけ光る。ここで受けるとジャストガード。
      context.strokeStyle = '#ffffff'
      context.lineWidth = 5
      context.globalAlpha = 1 - fighter.guardTime / 0.12
      context.beginPath()
      context.ellipse(cx, cy, rx + 9, ry + 9, 0, 0, TAU)
      context.stroke()
      context.globalAlpha = 1
    }
  }

  const SLASH_TURN: Record<AttackKind, number> = {
    jab: 0,
    smash: 0,
    down: 0.12,
    rush: 0,
    burst: 0,
    up: -Math.PI / 2,
    airUp: -Math.PI / 2,
    recovery: -Math.PI / 2,
    airDown: Math.PI / 2,
    air: 0,
  }

  /** 技の軌跡。当たり判定の箱と同じ位置・大きさで描くので、見た目どおりに当たる。 */
  function drawAttack(context: CanvasRenderingContext2D, fighter: Fighter, look: ClashLook) {
    const action = fighter.action
    if (!action) return
    const def = ATTACKS[action.kind]
    const lead = action.time - (def.activeFrom - 0.07)
    if (lead < 0 || action.time > def.activeTo + 0.1) return
    const box = attackHitboxAt(fighter, action.kind)
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const active = action.time >= def.activeFrom && action.time <= def.activeTo
    const fade = action.time > def.activeTo ? 1 - (action.time - def.activeTo) / 0.1 : 1
    const strength = (active ? 1 : 0.32) * fade
    const sweep = clamp((action.time - def.activeFrom + 0.07) / (def.activeTo - def.activeFrom + 0.07), 0, 1)

    context.save()
    context.globalCompositeOperation = 'lighter'
    context.translate(cx, cy)
    if (action.kind === 'burst') {
      const flame = context.createRadialGradient(0, 0, 4, 0, 0, box.w * 0.62)
      flame.addColorStop(0, `rgba(255,250,210,${0.9 * strength})`)
      flame.addColorStop(0.4, `rgba(255,170,60,${0.7 * strength})`)
      flame.addColorStop(1, 'rgba(255,80,20,0)')
      context.scale(1, box.h / box.w)
      context.fillStyle = flame
      context.beginPath()
      context.arc(0, 0, box.w * 0.62 * (0.7 + sweep * 0.4), 0, TAU)
      context.fill()
      context.restore()
      return
    }
    const horizontal = SLASH_TURN[action.kind] === 0 || action.kind === 'down'
    context.rotate(SLASH_TURN[action.kind] * (horizontal ? fighter.facing : 1))
    if (horizontal) context.scale(fighter.facing, 1)
    const long = horizontal ? box.w : box.h
    const short = horizontal ? box.h : box.w
    const radius = long * 0.62
    context.scale(1, clamp(short / long, 0.45, 1.25))
    if (action.kind === 'air') {
      context.strokeStyle = rgba(look.accentSoft, 0.85 * strength)
      context.lineWidth = 9
      context.beginPath()
      context.arc(0, 0, radius * 0.8, -Math.PI + sweep * TAU, -Math.PI + sweep * TAU + Math.PI * 1.3)
      context.stroke()
      context.strokeStyle = `rgba(255,255,255,${0.7 * strength})`
      context.lineWidth = 3
      context.stroke()
      context.restore()
      return
    }
    // 三日月の刃。外側の弧と、少しずらした内側の弧で挟む。
    const span = 1.15
    const from = -span + sweep * 0.5
    const to = span * (0.25 + sweep * 0.75)
    const blade = context.createRadialGradient(-radius * 0.5, 0, radius * 0.3, 0, 0, radius * 1.05)
    blade.addColorStop(0, rgba(look.accent, 0))
    blade.addColorStop(0.72, rgba(look.accentSoft, 0.75 * strength))
    blade.addColorStop(1, `rgba(255,255,255,${0.95 * strength})`)
    context.fillStyle = blade
    context.beginPath()
    context.arc(-radius * 0.5, 0, radius * 1.05, from, to)
    context.arc(-radius * 0.86, 0, radius * 1.12, to * 0.86, from * 0.86, true)
    context.closePath()
    context.fill()
    context.restore()
  }

  function drawProjectile(context: CanvasRenderingContext2D, projectile: Projectile, time: number) {
    const look = looks[projectile.owner]
    const { x, y, radius } = projectile
    context.save()
    context.translate(x, y)
    context.globalCompositeOperation = 'lighter'
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 2.6)
    const tone = projectile.kind === 'frost' ? '#9fd6ff' : look.accent
    glow.addColorStop(0, rgba(tone, 0.55))
    glow.addColorStop(1, rgba(tone, 0))
    context.fillStyle = glow
    context.beginPath()
    context.arc(0, 0, radius * 2.6, 0, TAU)
    context.fill()
    context.globalCompositeOperation = 'source-over'
    if (projectile.kind === 'petal') {
      context.rotate(time * 9 + projectile.id)
      context.fillStyle = '#ffe3ee'
      context.strokeStyle = look.accentSoft
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(-radius * 1.2, 0)
      context.quadraticCurveTo(0, -radius * 1.1, radius * 1.2, 0)
      context.quadraticCurveTo(0, radius * 0.7, -radius * 1.2, 0)
      context.fill()
      context.stroke()
    } else if (projectile.kind === 'leaf') {
      context.rotate(time * 16 * Math.sign(projectile.vx || 1))
      context.fillStyle = '#ffb65c'
      context.strokeStyle = '#7a3a12'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(-radius * 1.4, 0)
      context.quadraticCurveTo(-radius * 0.2, -radius * 1.15, radius * 1.4, 0)
      context.quadraticCurveTo(-radius * 0.2, radius * 1.15, -radius * 1.4, 0)
      context.fill()
      context.stroke()
      context.beginPath()
      context.moveTo(-radius * 1.2, 0)
      context.lineTo(radius * 1.2, 0)
      context.stroke()
    } else {
      context.rotate(time * 2 + projectile.id)
      context.fillStyle = 'rgba(214,238,255,.9)'
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2.5
      context.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * TAU
        const r = i % 2 ? radius * 0.82 : radius * 1.12
        if (i === 0) context.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
        else context.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      context.closePath()
      context.fill()
      context.stroke()
    }
    context.restore()
  }

  function drawParticles(context: CanvasRenderingContext2D) {
    for (const particle of particles) {
      const ratio = clamp(particle.life / particle.maxLife, 0, 1)
      context.globalAlpha = clamp(ratio * 1.7, 0, 1)
      context.globalCompositeOperation = particle.glow ? 'lighter' : 'source-over'
      if (particle.kind === 'ring') {
        context.strokeStyle = particle.color
        context.lineWidth = 1 + 4 * ratio
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * (2 - ratio), 0, TAU)
        context.stroke()
      } else if (particle.kind === 'spark') {
        context.strokeStyle = particle.color
        context.lineWidth = particle.size * ratio
        context.lineCap = 'round'
        context.beginPath()
        context.moveTo(particle.x, particle.y)
        context.lineTo(particle.x - particle.vx * 0.06, particle.y - particle.vy * 0.06)
        context.stroke()
      } else if (particle.kind === 'text') {
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.font = `900 ${particle.size}px ui-monospace, monospace`
        context.lineWidth = 5
        context.strokeStyle = 'rgba(8,6,20,.85)'
        context.strokeText(particle.text ?? '', particle.x, particle.y)
        context.fillStyle = particle.color
        context.fillText(particle.text ?? '', particle.x, particle.y)
      } else if (particle.kind === 'smoke') {
        context.globalAlpha = ratio * 0.55
        context.fillStyle = particle.color
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * (1.9 - ratio), 0, TAU)
        context.fill()
      } else if (particle.kind === 'shard') {
        context.save()
        context.translate(particle.x, particle.y)
        context.rotate(particle.rot)
        context.fillStyle = particle.color
        context.beginPath()
        context.moveTo(-particle.size, 0)
        context.lineTo(0, -particle.size * 0.4)
        context.lineTo(particle.size, 0)
        context.lineTo(0, particle.size * 0.4)
        context.fill()
        context.restore()
      } else if (particle.kind === 'star') {
        // 当たった瞬間の十字の閃光。
        context.save()
        context.globalCompositeOperation = 'lighter'
        context.translate(particle.x, particle.y)
        context.rotate(particle.rot)
        context.fillStyle = particle.color
        const size = particle.size * (1.3 - ratio * 0.3)
        for (let i = 0; i < 4; i++) {
          context.rotate(Math.PI / 2)
          context.beginPath()
          context.moveTo(0, -size * 0.07)
          context.lineTo(size, 0)
          context.lineTo(0, size * 0.07)
          context.fill()
        }
        context.restore()
      } else if (particle.kind === 'pillar') {
        // 撃墜の光柱。場外の縁からステージの内側へ向かって噴き出す。
        context.save()
        context.globalCompositeOperation = 'lighter'
        context.translate(particle.x, particle.y)
        context.rotate(particle.rot)
        const width = particle.size * (0.35 + ratio * 0.65)
        const beam = context.createLinearGradient(0, 0, 1500, 0)
        beam.addColorStop(0, particle.color)
        beam.addColorStop(1, 'rgba(255,255,255,0)')
        context.globalAlpha = ratio
        context.fillStyle = beam
        context.beginPath()
        context.moveTo(0, -width * 0.5)
        context.lineTo(1500, -width * 1.6)
        context.lineTo(1500, width * 1.6)
        context.lineTo(0, width * 0.5)
        context.fill()
        context.restore()
      } else {
        context.fillStyle = particle.color
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * (0.5 + ratio * 0.5), 0, TAU)
        context.fill()
      }
    }
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
  }

  /** 背景の層。`depth` が小さいほど遠く、カメラの動きにあまり付いてこない。 */
  function layer(context: CanvasRenderingContext2D, depth: number, draw: () => void) {
    const scale = 1 + (cam.zoom - 1) * depth
    context.save()
    context.translate(W / 2, H / 2)
    context.scale(scale, scale)
    context.translate(-W / 2 - (cam.x - W / 2) * depth, -H / 2 - (cam.y - 330) * depth)
    draw()
    context.restore()
  }

  function drawSkyline(context: CanvasRenderingContext2D, seed: number, base: number, color: string, lit: number) {
    for (let i = 0; i < 26; i++) {
      const width = 56 + hash(seed + i) * 60
      const height = 70 + hash(seed + i * 3.3) * 210
      const x = -480 + i * 88
      context.fillStyle = color
      context.fillRect(x, base - height, width, height + 500)
      context.fillStyle = rgba(theme.window, lit)
      for (let wy = base - height + 16; wy < base - 14; wy += 30) {
        for (let wx = x + 10; wx < x + width - 12; wx += 20) {
          if (hash(seed + wx * 0.37 + wy * 1.91) > 0.46) context.fillRect(wx, wy, 7, 12)
        }
      }
    }
  }

  function drawAmbient(context: CanvasRenderingContext2D, time: number, count: number, seed: number, scale: number) {
    for (let i = 0; i < count; i++) {
      const fx = hash(seed + i * 1.37)
      const fy = hash(seed + i * 2.11)
      const size = (2.5 + hash(seed + i * 4.7) * 5) * scale
      const color = theme.ambientColors[i % theme.ambientColors.length]
      const rising = theme.ambient === 'mote'
      const fall = (rising ? -18 : theme.ambient === 'snow' ? 46 : 62) * (0.6 + fy)
      const sway = Math.sin(time * (0.5 + fx) + i) * (theme.ambient === 'mote' ? 18 : 46)
      const x = (((fx * 2100 + sway + time * (theme.ambient === 'leaf' ? 34 : 12)) % 2100) + 2100) % 2100 - 410
      const y = (((fy * 1100 + time * fall) % 1100) + 1100) % 1100 - 190
      context.globalAlpha = 0.35 + hash(seed + i * 9.1) * 0.5
      context.fillStyle = color
      if (theme.ambient === 'snow' || theme.ambient === 'mote') {
        if (theme.ambient === 'mote') context.globalAlpha *= 0.5 + 0.5 * Math.sin(time * 2 + i)
        context.beginPath()
        context.arc(x, y, size * 0.5, 0, TAU)
        context.fill()
      } else {
        context.save()
        context.translate(x, y)
        context.rotate(time * (0.8 + fx * 1.6) + i)
        context.scale(1, 0.45 + 0.4 * Math.sin(time * 2.2 + i))
        context.beginPath()
        context.ellipse(0, 0, size, size * 0.6, 0, 0, TAU)
        context.fill()
        context.restore()
      }
    }
    context.globalAlpha = 1
  }

  function drawBackdrop(context: CanvasRenderingContext2D, time: number) {
    const sky = context.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, theme.sky[0])
    sky.addColorStop(0.55, theme.sky[1])
    sky.addColorStop(1, theme.sky[2])
    context.fillStyle = sky
    context.fillRect(0, 0, W, H)

    layer(context, 0.06, () => {
      const orb = context.createRadialGradient(640, 250, 10, 640, 250, 460)
      orb.addColorStop(0, rgba(theme.orb, 0.95))
      orb.addColorStop(0.09, rgba(theme.orb, 0.8))
      orb.addColorStop(0.11, rgba(theme.haze, 0.34))
      orb.addColorStop(0.5, rgba(theme.haze, 0.1))
      orb.addColorStop(1, rgba(theme.haze, 0))
      context.fillStyle = orb
      context.fillRect(-400, -300, 2100, 1300)
    })
    layer(context, 0.14, () => drawSkyline(context, 11, 560, theme.far, 0.16))
    layer(context, 0.28, () => {
      drawSkyline(context, 47, 640, theme.near, 0.3)
      // ランウェイ会場の照明。ゆっくり明滅する。
      context.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 8; i++) {
        const x = -60 + i * 200
        const alpha = 0.05 + Math.sin(time * 1.3 + i * 1.7) * 0.022
        const beam = context.createLinearGradient(x, -200, x + 90, 640)
        beam.addColorStop(0, rgba(theme.beam, alpha + 0.07))
        beam.addColorStop(1, rgba(theme.beam, 0))
        context.fillStyle = beam
        context.beginPath()
        context.moveTo(x, -200)
        context.lineTo(x + 150, 640)
        context.lineTo(x + 290, 640)
        context.lineTo(x + 30, -200)
        context.fill()
      }
      context.globalCompositeOperation = 'source-over'
    })
    layer(context, 0.5, () => drawAmbient(context, time, 34, 5, 1))
  }

  function drawStage(context: CanvasRenderingContext2D, time: number) {
    const main = ARENA.main
    // 浮島の下の光と支柱（当たりはない飾り）。
    const under = context.createRadialGradient(640, main.y + main.h + 20, 20, 640, main.y + main.h + 20, 430)
    under.addColorStop(0, rgba(theme.beam, 0.3))
    under.addColorStop(1, rgba(theme.beam, 0))
    context.fillStyle = under
    context.fillRect(main.x - 80, main.y + main.h - 30, main.w + 160, 240)
    context.fillStyle = rgba(theme.near, 0.9)
    context.beginPath()
    context.moveTo(main.x + 90, main.y + main.h - 2)
    context.lineTo(main.x + main.w - 90, main.y + main.h - 2)
    context.lineTo(main.x + main.w / 2 + 70, main.y + main.h + 74)
    context.lineTo(main.x + main.w / 2 - 70, main.y + main.h + 74)
    context.fill()

    const body = context.createLinearGradient(0, main.y, 0, main.y + main.h)
    body.addColorStop(0, '#f4f0ff')
    body.addColorStop(0.1, '#8a84ad')
    body.addColorStop(0.2, '#4a4668')
    body.addColorStop(1, '#1d1b30')
    context.fillStyle = body
    context.beginPath()
    context.roundRect(main.x, main.y, main.w, main.h, [5, 5, 16, 16])
    context.fill()
    context.fillStyle = 'rgba(255,255,255,.8)'
    context.fillRect(main.x + 8, main.y + 2, main.w - 16, 3)
    // ランウェイの中央線。
    context.fillStyle = rgba(theme.rim, 0.5)
    for (let x = main.x + 40; x < main.x + main.w - 40; x += 56) {
      context.fillRect(x, main.y + 22, 30, 3)
    }
    // 崖。つかまれる角を光らせておく。
    for (const side of ['left', 'right'] as const) {
      const point = ledgePoint(side)
      const dir = side === 'left' ? 1 : -1
      const pulse = 0.6 + Math.sin(time * 3 + (side === 'left' ? 0 : 2)) * 0.25
      context.fillStyle = rgba(theme.rim, pulse)
      context.beginPath()
      context.roundRect(dir > 0 ? point.x : point.x - 12, point.y, 12, 26, 3)
      context.fill()
    }

    for (const platform of ARENA.platforms) {
      const glass = context.createLinearGradient(0, platform.y, 0, platform.y + 12)
      glass.addColorStop(0, rgba(theme.rim, 0.95))
      glass.addColorStop(1, rgba(theme.beam, 0.22))
      context.fillStyle = glass
      context.beginPath()
      context.roundRect(platform.x, platform.y, platform.w, 11, 5)
      context.fill()
      context.fillStyle = rgba(theme.beam, 0.12)
      context.beginPath()
      context.moveTo(platform.x + 16, platform.y + 11)
      context.lineTo(platform.x + platform.w - 16, platform.y + 11)
      context.lineTo(platform.x + platform.w / 2, platform.y + 60)
      context.fill()
    }
  }

  const toScreen = (x: number, y: number) => ({
    x: (x - cam.x) * cam.zoom + W / 2,
    y: (y - cam.y) * cam.zoom + H / 2,
  })

  /** 画面の外へ出たファイターを、縁の小窓に映す。 */
  function drawOffscreen(context: CanvasRenderingContext2D, fighter: Fighter) {
    if (fighter.respawn > 0 || fighter.stocks <= 0) return
    const point = toScreen(fighter.x, fighter.y - 50)
    if (point.x > 20 && point.x < W - 20 && point.y > 20 && point.y < H - 20) return
    const look = looks[fighter.id]
    const x = clamp(point.x, 54, W - 54)
    const y = clamp(point.y, 150 * hudScale, H - 60)
    context.save()
    context.translate(x, y)
    context.fillStyle = 'rgba(10,8,24,.82)'
    context.strokeStyle = look.accentSoft
    context.lineWidth = 3
    context.beginPath()
    context.arc(0, 0, 40, 0, TAU)
    context.fill()
    context.stroke()
    context.save()
    context.beginPath()
    context.arc(0, 0, 37, 0, TAU)
    context.clip()
    context.translate(0, 34)
    context.rotate(anim[fighter.id].spin)
    context.scale(0.52 * fighter.facing, 0.52)
    drawSprite(context, ready(images[fighter.id]) ? images[fighter.id] : null, look)
    context.restore()
    const angle = Math.atan2(point.y - y, point.x - x)
    context.rotate(angle)
    context.fillStyle = look.accentSoft
    context.beginPath()
    context.moveTo(54, 0)
    context.lineTo(42, -8)
    context.lineTo(42, 8)
    context.fill()
    context.restore()
  }

  function drawHud(context: CanvasRenderingContext2D, match: ClashMatch) {
    context.textBaseline = 'alphabetic'
    context.textAlign = 'center'
    context.save()
    context.translate(W / 2, 0)
    context.scale(hudScale, hudScale)
    context.translate(-W / 2, 0)
    const low = match.phase === 'fight' && match.clock <= 10
    context.font = `800 ${low ? 30 : 24}px ui-monospace, monospace`
    context.lineWidth = 5
    context.strokeStyle = 'rgba(8,6,20,.7)'
    context.fillStyle = low ? '#ff8f9c' : '#ffffff'
    const minutes = Math.floor(match.clock / 60)
    const seconds = Math.floor(match.clock % 60)
    const text = `${minutes}:${String(seconds).padStart(2, '0')}`
    context.strokeText(text, W / 2, 46)
    context.fillText(text, W / 2, 46)
    context.font = '700 10px ui-monospace, monospace'
    context.fillStyle = rgba(theme.rim, 0.75)
    context.fillText(theme.title, W / 2, 64)
    context.restore()

    const drawSide = (id: 0 | 1) => {
      const fighter = match.fighters[id]
      const look = looks[id]
      const state = anim[id]
      const left = id === 0
      context.save()
      // 小さい画面では HUD だけ拡大する（左右それぞれの上の角を基準に）。
      context.translate(left ? 0 : W, 0)
      context.scale(hudScale, hudScale)
      context.translate(left ? 0 : -W, 0)
      const dir = left ? 1 : -1
      const edge = left ? 30 : W - 30
      const jitter = state.hudShake > 0 ? state.hudShake * 16 : 0
      const ox = (Math.random() - 0.5) * jitter
      const oy = (Math.random() - 0.5) * jitter

      // 下地
      const plate = context.createLinearGradient(edge, 0, edge + dir * 300, 0)
      plate.addColorStop(0, 'rgba(8,6,20,.7)')
      plate.addColorStop(1, 'rgba(8,6,20,0)')
      context.fillStyle = plate
      context.fillRect(left ? edge - 12 : edge - 300, 18, 312, 104)
      context.fillStyle = look.accent
      context.fillRect(left ? edge - 12 : edge + 8, 18, 4, 104)

      // 顔
      const hx = edge + dir * 44
      const hy = 68
      context.save()
      context.beginPath()
      context.arc(hx, hy, 36, 0, TAU)
      context.fillStyle = rgba(look.accent, 0.35)
      context.fill()
      context.clip()
      const head = heads[id]
      if (head) {
        context.translate(hx, hy)
        context.scale(dir, 1)
        context.drawImage(head, -38, -36, 76, 76)
      }
      context.restore()
      context.strokeStyle = look.accentSoft
      context.lineWidth = 3
      context.beginPath()
      context.arc(hx, hy, 36, 0, TAU)
      context.stroke()

      const tx = edge + dir * 92
      context.textAlign = left ? 'left' : 'right'
      context.font = '800 13px ui-monospace, monospace'
      context.fillStyle = look.accentSoft
      context.fillText(`${labels[id]} · LOOK #${look.no ?? '—'}`, tx, 40)

      const percent = Math.round(state.shownPercent)
      context.font = `900 ${percent >= 100 ? 50 : 46}px ui-monospace, monospace`
      context.lineWidth = 6
      context.strokeStyle = 'rgba(8,6,20,.85)'
      context.strokeText(`${percent}%`, tx + ox, 88 + oy)
      context.fillStyle = percentColor(fighter.percent)
      context.fillText(`${percent}%`, tx + ox, 88 + oy)

      // ストック
      for (let i = 0; i < 3; i++) {
        const cx = tx + dir * (9 + i * 22)
        const alive = i < fighter.stocks
        const pop = !alive && i === fighter.stocks && state.stockPop > 0 ? state.stockPop / 0.6 : 0
        context.fillStyle = alive ? look.accentSoft : 'rgba(255,255,255,.14)'
        context.beginPath()
        context.arc(cx, 106, 7 + pop * 9, 0, TAU)
        context.fill()
        if (pop > 0) {
          context.strokeStyle = `rgba(255,255,255,${pop})`
          context.lineWidth = 2
          context.beginPath()
          context.arc(cx, 106, 10 + (1 - pop) * 22, 0, TAU)
          context.stroke()
        }
      }
      // 盾と必殺技の残り
      const barX = tx + dir * 76
      const barW = 84
      const bx = left ? barX : barX - barW
      context.fillStyle = 'rgba(255,255,255,.14)'
      context.fillRect(bx, 100, barW, 4)
      context.fillStyle = fighter.shield < 30 ? '#ff9aa8' : '#bfeaff'
      context.fillRect(left ? bx : bx + barW * (1 - fighter.shield / 100), 100, barW * (fighter.shield / 100), 4)
      const charge = 1 - clamp(fighter.specialCooldown / 1.5, 0, 1)
      context.fillStyle = 'rgba(255,255,255,.14)'
      context.fillRect(bx, 108, barW, 4)
      context.fillStyle = charge >= 1 ? look.accentSoft : rgba(look.accent, 0.7)
      context.fillRect(left ? bx : bx + barW * (1 - charge), 108, barW * charge, 4)

      if (state.comboLife > 0 && state.combo >= 2) {
        const alpha = clamp(state.comboLife / 0.4, 0, 1)
        const pop = 1 + clamp(state.comboLife - 1.3, 0, 0.2) * 2
        context.save()
        context.globalAlpha = alpha
        context.translate(edge + dir * 20, 168)
        context.scale(pop, pop)
        context.textAlign = left ? 'left' : 'right'
        context.font = '900 40px ui-monospace, monospace'
        context.lineWidth = 6
        context.strokeStyle = 'rgba(8,6,20,.85)'
        context.strokeText(`${state.combo}`, 0, 0)
        context.fillStyle = look.accentSoft
        context.fillText(`${state.combo}`, 0, 0)
        const width = context.measureText(`${state.combo}`).width
        context.font = '800 14px ui-monospace, monospace'
        context.fillStyle = '#ffffff'
        context.strokeText('HIT COMBO', dir * (width + 8), -4)
        context.fillText('HIT COMBO', dir * (width + 8), -4)
        context.restore()
      }
      context.restore()
    }
    drawSide(0)
    drawSide(1)
  }

  function drawBanner(context: CanvasRenderingContext2D) {
    if (!banner) return
    const enter = clamp(banner.t / 0.16, 0, 1)
    const leave = clamp((banner.life - banner.t) / 0.25, 0, 1)
    const scale = 2.1 - 1.1 * easeOut(enter)
    context.save()
    context.globalAlpha = Math.min(enter, leave)
    context.translate(W / 2, H / 2 - 30)
    context.scale(scale, scale)
    context.rotate(-0.045)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `900 ${banner.text.length > 9 ? 78 : 112}px ui-monospace, monospace`
    context.lineJoin = 'round'
    context.lineWidth = 16
    context.strokeStyle = 'rgba(8,6,20,.9)'
    context.strokeText(banner.text, 0, 0)
    context.lineWidth = 6
    context.strokeStyle = banner.color
    context.strokeText(banner.text, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillText(banner.text, 0, 0)
    if (banner.sub) {
      context.font = '800 30px ui-monospace, monospace'
      context.lineWidth = 8
      context.strokeStyle = 'rgba(8,6,20,.9)'
      context.strokeText(banner.sub, 0, 84)
      context.fillStyle = banner.color
      context.fillText(banner.sub, 0, 84)
    }
    context.restore()
  }

  function drawCountdown(context: CanvasRenderingContext2D, match: ClashMatch) {
    if (match.phase !== 'countdown') return
    const steps = match.countdown > 2.25 ? 3 : match.countdown > 1.35 ? 2 : match.countdown > 0.45 ? 1 : 0
    const edges = [0.45, 1.35, 2.25, 3.2]
    const within = steps === 0 ? 1 - match.countdown / 0.45 : 1 - (match.countdown - edges[steps - 1]) / (edges[steps] - edges[steps - 1])
    const text = steps === 0 ? 'READY' : String(steps)
    const scale = 1.7 - 0.7 * easeOut(clamp(within * 3, 0, 1))
    context.save()
    context.globalAlpha = clamp((1 - within) * 4, 0, 1)
    context.translate(W / 2, H / 2 - 30)
    context.scale(scale, scale)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `900 ${steps === 0 ? 96 : 150}px ui-monospace, monospace`
    context.lineJoin = 'round'
    context.lineWidth = 16
    context.strokeStyle = 'rgba(8,6,20,.85)'
    context.strokeText(text, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillText(text, 0, 0)
    context.restore()
  }

  /** 決着の一撃。暗転して、当たった点から集中線を走らせる。 */
  function drawFinish(context: CanvasRenderingContext2D) {
    if (!finish || finish.t > 1.2) return
    const strength = finish.t < 0.6 ? 1 : 1 - (finish.t - 0.6) / 0.6
    const point = toScreen(finish.x, finish.y)
    context.save()
    context.globalCompositeOperation = 'lighter'
    context.translate(point.x, point.y)
    for (let i = 0; i < 44; i++) {
      const angle = (i / 44) * TAU + hash(i) * 0.2
      const inner = 150 + hash(i * 3) * 120 + (1 - strength) * 200
      const width = 0.012 + hash(i * 7) * 0.03
      context.fillStyle = i % 3 ? `rgba(255,255,255,${0.5 * strength})` : rgba(finish.color, 0.8 * strength)
      context.beginPath()
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
      context.lineTo(Math.cos(angle - width) * 1700, Math.sin(angle - width) * 1700)
      context.lineTo(Math.cos(angle + width) * 1700, Math.sin(angle + width) * 1700)
      context.fill()
    }
    context.restore()
  }

  function render(context: CanvasRenderingContext2D, match: ClashMatch, time: number) {
    context.clearRect(0, 0, W, H)
    drawBackdrop(context, time)

    context.save()
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 22 : 0
    context.translate(W / 2 + sx, H / 2 + sy)
    context.scale(cam.zoom, cam.zoom)
    context.translate(-cam.x, -cam.y)
    drawStage(context, time)
    for (const projectile of match.projectiles) drawProjectile(context, projectile, time)
    // 前後関係が固定されないよう、画面の上側にいるファイターから描く。
    const order = [...match.fighters].sort((a, b) => a.y - b.y)
    drawFinishDim(context)
    for (const fighter of order) drawFighter(context, fighter, time)
    drawParticles(context)
    context.restore()

    layer(context, 1.25, () => drawAmbient(context, time, 9, 91, 2.2))

    const vignette = context.createRadialGradient(W / 2, H / 2, 240, W / 2, H / 2, 780)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,10,.5)')
    context.fillStyle = vignette
    context.fillRect(0, 0, W, H)

    drawFinish(context)
    for (const fighter of match.fighters) drawOffscreen(context, fighter)
    drawHud(context, match)
    drawCountdown(context, match)
    drawBanner(context)

    if (flash > 0) {
      context.globalAlpha = Math.min(0.5, flash)
      context.fillStyle = flashColor
      context.fillRect(0, 0, W, H)
      context.globalAlpha = 1
    }
  }

  /** 決着の瞬間は、ファイターの後ろ（ステージと背景）だけを暗くして人物を浮かせる。 */
  function drawFinishDim(context: CanvasRenderingContext2D) {
    if (!finish || finish.t > 1.2) return
    const strength = finish.t < 0.6 ? 1 : 1 - (finish.t - 0.6) / 0.6
    context.fillStyle = `rgba(4,2,12,${0.72 * strength})`
    context.fillRect(cam.x - W, cam.y - H, W * 2, H * 2)
  }

  return {
    onEvent,
    update,
    render,
    /** 表示領域の縦の広さと、HUD の拡大率を変える。 */
    resize: (height: number, hud: number) => {
      H = height
      hudScale = hud
    },
    /** 演出のために試合を止めておく時間が残っているか。 */
    holding: () => hold > 0,
    /** 試合の進む速さ。決着の直後だけスローになる。 */
    timeScale: () => (finish && finish.t < 1.5 ? 0.35 : 1),
    camera: () => ({ ...cam }),
  }
}

export type ClashRenderer = ReturnType<typeof createClashRenderer>
