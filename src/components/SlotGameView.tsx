import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import cutoutsJson from '../data/cutouts.json'
import hairJson from '../data/hair.json'
import GameShareButton from './GameShareButton'
import { useI18n } from '../lib/i18n'
import type { CutoutsFile } from '../lib/platform'
import {
  BET,
  BONUS_GAMES,
  BONUS_PAY,
  canRefill,
  canSpin,
  hashSeed,
  lever,
  LINES,
  loadMachine,
  newMachine,
  PAYOUT,
  pickLineup,
  REEL_LEN,
  reelControl,
  refill,
  REFILL,
  ROLE_SYMBOL,
  saveMachine,
  settingOf,
  stop,
  STRIPS,
  symbolAt,
  SYMBOLS,
  type Machine,
  type SpinOutcome,
  type SymbolId,
} from '../lib/slot'
import { createSlotAudio, type SlotAudio } from '../lib/slotAudio'
import { fmtDate, outfits } from '../lib/useData'
import type { HairFile } from '../types'

// 俺スロ: 出勤服のくり抜き（＝俺）を3人揃えるスロット。
// 抽選・リール制御・台の状態は lib/slot.ts（純粋ロジック）。ここは描画（Canvas 2D）と入力とUI。
//
// リールは「レバーONで抽選 → ストップを押した位置から最大4コマ滑って止まる」実機と同じ作り。
// 目押しのタイミングが大事なので、ボタンは click（指を離したとき）ではなく
// pointerdown（触れた瞬間）で反応させる。

const cutouts = cutoutsJson as CutoutsFile
const hair = hairJson as HairFile

type Props = {
  onBack: () => void
  /** 図柄になっているコーデの詳細をひらく */
  onOpenOutfit: (outfitKey: string) => void
}

/** 図柄ごとの呼び名・台紙の色。回転中は台紙の色で見分ける */
const SYMBOL_META: Record<SymbolId, { name: string; glyph: string; color: string; deep: string }> = {
  new: { name: '最新の俺', glyph: '新', color: '#ea5a3c', deep: '#c53a22' },
  blond: { name: '金髪の俺', glyph: '金', color: '#f0bb33', deep: '#d6961a' },
  coat: { name: 'コートの俺', glyph: '外', color: '#46568c', deep: '#2b3763' },
  cap: { name: '帽子の俺', glyph: '帽', color: '#4c8fd0', deep: '#3470ae' },
  tee: { name: 'Tシャツの俺', glyph: 'T', color: '#58ad7c', deep: '#3d8c5f' },
  usual: { name: 'いつもの俺', glyph: '常', color: '#a8a394', deep: '#858072' },
}

/** 早見表に出す短い配当表記 */
const MINI_PRIZE: Record<SymbolId, string> = {
  new: 'BIG',
  blond: 'REG',
  coat: String(PAYOUT.coat),
  cap: String(PAYOUT.cap),
  tee: String(PAYOUT.tee),
  usual: 'FREE',
}

const SPEED = 10 // 通常の回転速度（コマ/秒）。図柄の色と顔が追える速さ
const SPEED_SLOW = 5 // 狙う図柄があるゲーム（ボーナス確定中・チャンス）は遅くして、誰でも目押しできるようにする
const BLUR_SPEED = 7.5 // これより速いときは残像版の図柄で描く
const PULL_BACK = 0.07 // 回り始めに一瞬だけ逆へ引く時間（秒）
const SPIN_UP = 0.26 // 定速になるまでの時間（秒）
const STOP_READY = 0.36 // レバーからこの時間はストップを受け付けない（秒）
const BOUNCE = 0.16 // 停止時の揺り戻しの時間（秒）
const PRESS_TOLERANCE = 0.2 // 中段を通り過ぎた直後のコマも「押したコマ」として拾う幅
const WIN_FX_MS = 2600 // 揃った図柄を明滅させる時間
const BANNER_MS = 1700 // ボーナスの帯を出しておく時間（CSS の slot-banner アニメーションと合わせる）

const RARE = new Set<SymbolId>(['new', 'blond', 'coat'])

const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`
const mod = (n: number) => ((n % REEL_LEN) + REEL_LEN) % REEL_LEN

/** 端末のローカル日付（図柄の顔ぶれは日替わり） */
function todayKey() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function freshMachine(except?: number): Machine {
  let no = 1 + Math.floor(Math.random() * 999)
  if (no === except) no = (no % 999) + 1
  return newMachine(no, settingOf(no))
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // 振動に対応していない端末では何もしない
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

type ReelState = {
  pos: number // 中段にあるコマ番号（小数。回転中は減っていく＝図柄は下へ流れる）
  vel: number
  phase: 'idle' | 'spin' | 'stop'
  startAt: number
  t0: number
  from: number
  to: number
  dur: number
  landed: boolean
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  img: HTMLImageElement | null
  color: string
}

type Engine = {
  main: () => void
  stopReel: (reel: number) => void
  refill: () => void
}

type Result = {
  symbol: SymbolId | null
  payout: number
  replay: boolean
  bonusGained: number | null
  /** チャンス役（コート）を揃え損ねた */
  missedChance: boolean
}
type Banner = { kind: 'big' | 'reg' | 'end'; gained: number }

export default function SlotGameView({ onBack, onOpenOutfit }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const audioRef = useRef<SlotAudio | null>(null)
  const pointerActed = useRef(false)
  if (!audioRef.current) audioRef.current = createSlotAudio()

  // machineRef が正（ストップのたびに進む）。machine は「画面に見せてよい時点」の写しで、
  // 3リール目が止まりきるまでは結果（払い出し・ランプ）を先に見せない。
  const [machine, setMachine] = useState<Machine>(() => loadMachine() ?? freshMachine())
  const machineRef = useRef(machine)
  const [today] = useState(todayKey)
  const [ready, setReady] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [stopped, setStopped] = useState([true, true, true])
  const [shownCoins, setShownCoins] = useState(machine.coins)
  const [win, setWin] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [tenpai, setTenpai] = useState(false)
  const [chance, setChance] = useState(false) // このゲームでチャンス役（コート）が成立している
  const [muted, setMuted] = useState(() => audioRef.current!.muted())
  const [reveal, setReveal] = useState(false)

  const lineup = useMemo(
    () => pickLineup(outfits, cutouts.sprites, hair, hashSeed(`${today}:${machine.no}`)),
    [today, machine.no],
  )

  useEffect(() => () => audioRef.current?.dispose(), [])

  useEffect(() => {
    const canvas = canvasRef.current
    const fxCanvas = fxRef.current
    if (!canvas || !fxCanvas || !lineup) return
    const ctx = canvas.getContext('2d')!
    const fx = fxCanvas.getContext('2d')!
    const audio = audioRef.current!
    const control = reelControl()
    let disposed = false

    // ---- リールの初期出目: ハズレ目（何も揃っていない並び）から始める ----
    const reels: ReelState[] = []
    {
      let pos: [number | null, number | null, number | null] = [null, null, null]
      for (let r = 0; r < 3; r++) {
        const p = control.chooseStop(null, pos, r, Math.floor(Math.random() * REEL_LEN))
        pos = [r === 0 ? p : pos[0], r === 1 ? p : pos[1], r === 2 ? p : pos[2]]
        reels.push({ pos: p, vel: 0, phase: 'idle', startAt: 0, t0: 0, from: p, to: p, dur: 0, landed: true })
      }
    }

    // ---- 描画サイズ（すべて実ピクセル） ----
    let W = 0
    let H = 0
    let tw = 0 // 図柄1コマの幅
    let th = 0 // 図柄1コマの高さ
    let gap = 0 // リール間のすき間
    const images = new Map<SymbolId, HTMLImageElement>()
    const tiles = new Map<SymbolId, { sharp: HTMLCanvasElement; blur: HTMLCanvasElement }>()

    // くり抜きに白フチを付けて「ステッカー」にする。濃い台紙の上でも服の輪郭が沈まない
    const buildTile = (sym: SymbolId) => {
      const img = images.get(sym)!
      const meta = SYMBOL_META[sym]
      const c = document.createElement('canvas')
      c.width = tw
      c.height = Math.ceil(th)
      const g = c.getContext('2d')!
      const padX = tw * 0.055
      const padY = th * 0.03
      const pw = tw - padX * 2
      const ph = th - padY * 2
      const grad = g.createLinearGradient(0, padY, 0, padY + ph)
      grad.addColorStop(0, meta.color)
      grad.addColorStop(1, meta.deep)
      roundRect(g, padX, padY, pw, ph, tw * 0.13)
      g.fillStyle = grad
      g.fill()
      g.lineWidth = Math.max(1, tw * 0.014)
      g.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      roundRect(g, padX + g.lineWidth, padY + g.lineWidth, pw - g.lineWidth * 2, ph - g.lineWidth * 2, tw * 0.11)
      g.stroke()

      g.fillStyle = 'rgba(255, 255, 255, 0.92)'
      g.font = `700 ${Math.round(tw * 0.19)}px "Hiragino Sans", "Noto Sans JP", "Outfit", sans-serif`
      g.textBaseline = 'top'
      g.fillText(meta.glyph, padX + tw * 0.075, padY + th * 0.04)

      let fh = ph * 0.94
      let fw = (fh * img.naturalWidth) / img.naturalHeight
      if (fw > pw * 0.9) {
        fh *= (pw * 0.9) / fw
        fw = pw * 0.9
      }
      const fxPos = (tw - fw) / 2
      const fyPos = padY + ph - fh - ph * 0.015
      const sil = document.createElement('canvas')
      sil.width = Math.ceil(fw)
      sil.height = Math.ceil(fh)
      const sg = sil.getContext('2d')!
      sg.drawImage(img, 0, 0, fw, fh)
      sg.globalCompositeOperation = 'source-in'
      sg.fillStyle = '#fff'
      sg.fillRect(0, 0, sil.width, sil.height)
      const o = Math.max(1.5, tw * 0.022)
      g.save()
      g.shadowColor = 'rgba(0, 0, 0, 0.28)'
      g.shadowBlur = tw * 0.05
      g.shadowOffsetY = tw * 0.02
      g.drawImage(sil, fxPos, fyPos)
      g.restore()
      for (let a = 0; a < 12; a++) {
        const rad = (a / 12) * Math.PI * 2
        g.drawImage(sil, fxPos + Math.cos(rad) * o, fyPos + Math.sin(rad) * o)
      }
      g.drawImage(img, fxPos, fyPos, fw, fh)

      // 回転中に使う残像版（縦にずらして重ね描きしたもの）
      const b = document.createElement('canvas')
      b.width = tw
      b.height = Math.ceil(th * 1.6)
      const bg = b.getContext('2d')!
      const passes = 24
      bg.globalAlpha = 2.4 / passes
      for (let k = 0; k < passes; k++) {
        bg.drawImage(c, 0, th * 0.3 + (k / (passes - 1) - 0.5) * th * 0.3)
      }
      return { sharp: c, blur: b }
    }

    const buildTiles = () => {
      if (tw <= 0 || images.size < SYMBOLS.length) return
      for (const sym of SYMBOLS) tiles.set(sym, buildTile(sym))
    }

    // ボーナス確定中（ランプ点灯後）に狙う図柄。それ以外を少し沈めて目押ししやすくする
    let aim: SymbolId | null = null

    // ---- 当たりの明滅 ----
    let winCells: boolean[][] | null = null // [reel][row(0..2)] が当たりラインに乗っているか
    let fxUntil = 0

    const draw = (now: number) => {
      if (W === 0) return
      ctx.clearRect(0, 0, W, H)
      const pulse = now < fxUntil ? 0.5 + 0.5 * Math.sin(now / 70) : 0.7

      for (let r = 0; r < 3; r++) {
        const reel = reels[r]!
        const x = r * (tw + gap)
        ctx.save()
        roundRect(ctx, x, 0, tw, H, tw * 0.07)
        ctx.clip()
        const bg = ctx.createLinearGradient(0, 0, 0, H)
        bg.addColorStop(0, '#d9d5c7')
        bg.addColorStop(0.5, '#f6f3e8')
        bg.addColorStop(1, '#d9d5c7')
        ctx.fillStyle = bg
        ctx.fillRect(x, 0, tw, H)

        const fast = reel.phase === 'spin' && reel.vel > BLUR_SPEED
        const base = Math.round(reel.pos)
        for (let i = base - 2; i <= base + 2; i++) {
          const y = H / 2 + (i - reel.pos) * th - th / 2
          if (y > H || y + th < 0) continue
          const sym = STRIPS[r]![mod(i)]!
          const tile = tiles.get(sym)
          if (!tile) continue
          const row = i - base + 1
          const isWin = winCells != null && reel.phase === 'idle' && winCells[r]?.[row] === true
          // 狙い目になるレア図柄（最新・金髪・コート）は回転中もくっきり描き、流れてくるのが見えるようにする
          if (fast && !RARE.has(sym)) {
            ctx.drawImage(tile.blur, x, y - th * 0.3)
          } else if (isWin && now < fxUntil) {
            // 当たり図柄は少し跳ねる
            const s = 1 + 0.045 * (0.5 + 0.5 * Math.sin(now / 90))
            ctx.drawImage(tile.sharp, x - (tw * (s - 1)) / 2, y - (th * (s - 1)) / 2, tw * s, th * s)
          } else {
            ctx.drawImage(tile.sharp, x, y)
          }
          if (winCells != null && reel.phase === 'idle') {
            if (isWin) {
              ctx.lineWidth = Math.max(2, tw * 0.035)
              ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 + 0.45 * pulse})`
              roundRect(ctx, x + tw * 0.055, y + th * 0.03, tw * 0.89, th * 0.94, tw * 0.13)
              ctx.stroke()
            } else {
              ctx.fillStyle = 'rgba(22, 22, 26, 0.55)'
              ctx.fillRect(x, y, tw, th + 1)
            }
          }
        }

        // ボーナス確定中: リール全体を沈めてから、狙う図柄だけ明るく描き直す
        if (aim && reel.phase !== 'idle') {
          ctx.fillStyle = 'rgba(22, 22, 26, 0.45)'
          ctx.fillRect(x, 0, tw, H)
          for (let i = base - 2; i <= base + 2; i++) {
            if (STRIPS[r]![mod(i)] !== aim) continue
            const y = H / 2 + (i - reel.pos) * th - th / 2
            const tile = tiles.get(aim)
            if (!tile || y > H || y + th < 0) continue
            ctx.fillStyle = '#f6f3e8'
            ctx.fillRect(x, y, tw, th)
            ctx.drawImage(tile.sharp, x, y)
          }
        }

        // 円筒っぽい陰影（上下が奥へ回り込む）
        const shade = ctx.createLinearGradient(0, 0, 0, H)
        shade.addColorStop(0, 'rgba(20, 18, 14, 0.5)')
        shade.addColorStop(0.16, 'rgba(20, 18, 14, 0)')
        shade.addColorStop(0.84, 'rgba(20, 18, 14, 0)')
        shade.addColorStop(1, 'rgba(20, 18, 14, 0.5)')
        ctx.fillStyle = shade
        ctx.fillRect(x, 0, tw, H)
        ctx.restore()
      }
    }

    // ---- メインループ（回転中と当たり演出中だけ回す） ----
    let raf = 0
    let running = false
    let last = 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      let active = now < fxUntil
      for (let r = 0; r < 3; r++) {
        const reel = reels[r]!
        if (reel.phase === 'spin') {
          const elapsed = (now - reel.startAt) / 1000
          if (elapsed >= 0 && elapsed < PULL_BACK) {
            reel.pos += dt * 1.8
          } else if (elapsed >= PULL_BACK) {
            reel.vel = speed * Math.min(1, (elapsed - PULL_BACK) / SPIN_UP)
            reel.pos -= reel.vel * dt
          }
          active = true
        } else if (reel.phase === 'stop') {
          const elapsed = (now - reel.t0) / 1000
          if (elapsed < reel.dur) {
            reel.pos = reel.from + (reel.to - reel.from) * (elapsed / reel.dur)
          } else {
            if (!reel.landed) {
              reel.landed = true
              audio.play('stop')
              onLand()
            }
            const u = (elapsed - reel.dur) / BOUNCE
            if (u >= 1) {
              reel.pos = mod(reel.to)
              reel.vel = 0
              reel.phase = 'idle'
            } else {
              reel.pos = reel.to - 0.1 * Math.sin(u * Math.PI) * (1 - u)
            }
          }
          active = true
        }
      }
      draw(now)
      if (active && !disposed) raf = requestAnimationFrame(tick)
      else running = false
    }

    const ensureLoop = () => {
      if (running || disposed) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }

    // ---- 紙吹雪（ボーナスでは小さい俺が降る） ----
    let particles: Particle[] = []
    let fxRaf = 0
    let fxLast = 0
    let fxW = 0
    let fxH = 0
    let fxDpr = 1

    const fxTick = (now: number) => {
      const dt = Math.min(0.05, (now - fxLast) / 1000)
      fxLast = now
      fx.clearRect(0, 0, fxW, fxH)
      particles = particles.filter((p) => p.y < fxH + p.size * 2)
      for (const p of particles) {
        p.vy += 1100 * fxDpr * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        fx.save()
        fx.translate(p.x, p.y)
        fx.rotate(p.rot)
        if (p.img) {
          const w = (p.size * p.img.naturalWidth) / p.img.naturalHeight
          fx.drawImage(p.img, -w / 2, -p.size / 2, w, p.size)
        } else {
          fx.fillStyle = p.color
          fx.beginPath()
          fx.ellipse(0, 0, p.size / 2, (p.size / 2) * Math.abs(Math.cos(p.rot * 2)) + 1, 0, 0, Math.PI * 2)
          fx.fill()
        }
        fx.restore()
      }
      if (particles.length > 0 && !disposed) fxRaf = requestAnimationFrame(fxTick)
      else {
        fx.clearRect(0, 0, fxW, fxH)
        fxRaf = 0
      }
    }

    const burst = (count: number, withFigures: boolean) => {
      if (reducedMotion() || fxW === 0) return
      const figures = [...images.values()]
      for (let i = 0; i < count; i++) {
        const figure = withFigures && i % 2 === 0 && figures.length > 0
        particles.push({
          x: Math.random() * fxW,
          y: -Math.random() * fxH * (withFigures ? 1.5 : 0.6) - 20,
          vx: (Math.random() - 0.5) * 140 * fxDpr,
          vy: Math.random() * 200 * fxDpr,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 6,
          size: (figure ? 44 + Math.random() * 30 : 9 + Math.random() * 7) * fxDpr,
          img: figure ? figures[Math.floor(Math.random() * figures.length)]! : null,
          color: ['#f0bb33', '#ffd76a', '#ea5a3c', '#fff3c4'][i % 4]!,
        })
      }
      if (!fxRaf) {
        fxLast = performance.now()
        fxRaf = requestAnimationFrame(fxTick)
      }
    }

    // ---- メダルのカウントアップ ----
    let countTimer: number | undefined
    let countTo = machineRef.current.coins

    const finishCount = () => {
      window.clearInterval(countTimer)
      countTimer = undefined
      setShownCoins(countTo)
    }

    const countUp = (from: number, to: number) => {
      window.clearInterval(countTimer)
      countTo = to
      let shown = from
      const step = Math.max(1, Math.ceil((to - from) / 24))
      let n = 0
      setShownCoins(from)
      countTimer = window.setInterval(() => {
        shown = Math.min(to, shown + step)
        setShownCoins(shown)
        audio.play('coin', n++)
        if (shown >= to) {
          window.clearInterval(countTimer)
          countTimer = undefined
        }
      }, 42)
    }

    // ---- ゲームの進行 ----
    let speed = SPEED
    let pendingOutcome: SpinOutcome | null = null
    let busyUntil = 0 // ボーナス開始の演出中は、連打で飛ばさないよう少しだけ入力を止める
    let bannerTimer: number | undefined
    let lampTimer: number | undefined

    const showBanner = (b: Banner, ms: number) => {
      window.clearTimeout(bannerTimer)
      setBanner(b)
      bannerTimer = window.setTimeout(() => setBanner(null), ms)
    }

    const doRefill = () => {
      const m = machineRef.current
      if (!canRefill(m)) return
      const next = refill(m)
      machineRef.current = next
      saveMachine(next)
      setMachine(next)
      setResult(null)
      countUp(m.coins, next.coins)
      audio.play('refill')
    }

    const doLever = () => {
      const m = machineRef.current
      const now = performance.now()
      if (m.spin || now < busyUntil || tiles.size < SYMBOLS.length) return
      if (reels.some((r) => r.phase !== 'idle')) return
      if (!canSpin(m)) {
        doRefill()
        return
      }
      finishCount()
      const r = lever(m)
      const next = r.machine
      machineRef.current = next
      saveMachine(next)
      countTo = next.coins
      // 狙う図柄があるゲーム: ボーナス確定中（ランプ点灯）か、このゲームで成立したチャンス役（コート）
      const chance = r.role === 'coat'
      aim = chance ? ROLE_SYMBOL.coat : next.lamp && next.pending ? ROLE_SYMBOL[next.pending] : null
      speed = aim ? SPEED_SLOW : SPEED
      if (next.bonus) audio.ensureBgm()
      pendingOutcome = null
      winCells = null
      fxUntil = 0
      for (let i = 0; i < 3; i++) {
        const reel = reels[i]!
        reel.phase = 'spin'
        reel.vel = 0
        reel.startAt = now + i * 70
        reel.landed = false
      }
      window.clearTimeout(bannerTimer)
      window.clearTimeout(lampTimer)
      setBanner(null)
      setMachine(next)
      setShownCoins(next.coins)
      setWin(next.bonus ? next.bonus.gained : 0)
      setResult(null)
      setTenpai(false)
      setSpinning(true)
      setStopped([false, false, false])
      setChance(chance)
      audio.play('lever')
      if (chance) audio.play('chance')
      if (r.earlyLamp) {
        audio.play('lamp')
        vibrate(200)
      }
      ensureLoop()
    }

    const doStop = (i: number) => {
      const m = machineRef.current
      const reel = reels[i]
      if (!reel || !m.spin || m.spin.pos[i] != null || reel.phase !== 'spin') return
      const now = performance.now()
      if (now - reel.startAt < STOP_READY * 1000) return
      // 押した瞬間に中段へ来ているコマ。通り過ぎた直後のコマも少しだけ拾う
      const pressed = Math.floor(reel.pos + PRESS_TOLERANCE)
      const r = stop(m, i, mod(pressed))
      machineRef.current = r.machine
      const slip = mod(pressed - r.pos)
      reel.phase = 'stop'
      reel.t0 = now
      reel.from = reel.pos
      reel.to = pressed - slip
      reel.dur = Math.max(0.05, Math.abs(reel.from - reel.to) / Math.max(reel.vel, SPEED_SLOW))
      reel.landed = false
      if (r.outcome) pendingOutcome = r.outcome
      setStopped((prev) => prev.map((v, k) => (k === i ? true : v)))
    }

    // レア図柄が2リールで同じライン上に止まったか（テンパイ）
    const isTenpai = (pos: readonly (number | null)[]) => {
      const done = [0, 1, 2].filter((r) => pos[r] != null)
      if (done.length !== 2) return false
      return LINES.some((line) => {
        const a = symbolAt(done[0]!, pos[done[0]!]!, line[done[0]!]!)
        const b = symbolAt(done[1]!, pos[done[1]!]!, line[done[1]!]!)
        return a === b && (a === 'new' || a === 'blond' || a === 'coat')
      })
    }

    const onLand = () => {
      const landed = reels.filter((r) => r.landed).length
      const m = machineRef.current
      if (landed === 2 && m.spin && isTenpai(m.spin.pos)) {
        audio.play('tenpai')
        setTenpai(true)
      }
      if (landed === 3 && pendingOutcome) {
        const outcome = pendingOutcome
        pendingOutcome = null
        applyOutcome(outcome)
      }
    }

    const applyOutcome = (o: SpinOutcome) => {
      const m = machineRef.current
      const now = performance.now()
      saveMachine(m)
      setMachine(m)
      setSpinning(false)
      setTenpai(false)
      setChance(false)
      setResult({
        symbol: o.symbol,
        payout: o.payout,
        replay: o.replay,
        bonusGained: o.bonusEnd ? o.bonusEnd.gained : null,
        missedChance: aim === ROLE_SYMBOL.coat && o.lines.length === 0,
      })
      setWin(o.bonusEnd ? o.bonusEnd.gained : m.bonus ? m.bonus.gained : o.payout)

      if (o.lines.length > 0) {
        winCells = [0, 1, 2].map((r) => [-1, 0, 1].map((row) => o.lines.some((l) => LINES[l.line]![r] === row)))
        fxUntil = now + WIN_FX_MS
      }

      if (o.payout > 0) countUp(m.coins - o.payout, m.coins)
      else {
        countTo = m.coins
        setShownCoins(m.coins)
      }

      if (o.bonusStart) {
        busyUntil = now + 1100
        showBanner({ kind: o.bonusStart, gained: 0 }, BANNER_MS)
        audio.play('bonus')
        audio.startBgm(1.25)
        burst(o.bonusStart === 'big' ? 48 : 24, true)
        vibrate([70, 40, 70, 40, 180])
      } else if (o.bonusEnd) {
        audio.stopBgm()
        audio.play('bonusEnd')
        showBanner({ kind: 'end', gained: o.bonusEnd.gained }, BANNER_MS)
        burst(26, false)
      } else if (o.payout >= 15) {
        audio.play('bigwin')
        burst(22, false)
      } else if (o.payout > 0) {
        audio.play('win', o.payout)
      } else if (o.replay) {
        audio.play('replay')
      }

      if (o.lampOn) {
        // 後告知: 止まって一拍おいてからランプが光る
        window.clearTimeout(lampTimer)
        lampTimer = window.setTimeout(() => {
          audio.play('lamp')
          vibrate(220)
        }, 260)
      }
    }

    engineRef.current = {
      main: () => {
        const m = machineRef.current
        if (m.spin) {
          const next = m.spin.pos.findIndex((p) => p == null)
          if (next >= 0) doStop(next)
        } else {
          doLever()
        }
      },
      stopReel: doStop,
      refill: doRefill,
    }

    // ---- サイズ追従 ----
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const nextW = Math.round(rect.width * dpr)
      const nextH = Math.round(rect.height * dpr)
      if (nextW > 0 && nextH > 0 && (nextW !== W || nextH !== H)) {
        W = nextW
        H = nextH
        canvas.width = W
        canvas.height = H
        gap = Math.round(W * 0.02)
        tw = Math.floor((W - gap * 2) / 3)
        th = H / 3
        buildTiles()
        draw(performance.now())
      }
      const fxRect = fxCanvas.getBoundingClientRect()
      fxDpr = Math.min(2, window.devicePixelRatio || 1)
      fxW = Math.round(fxRect.width * fxDpr)
      fxH = Math.round(fxRect.height * fxDpr)
      if (fxCanvas.width !== fxW || fxCanvas.height !== fxH) {
        fxCanvas.width = fxW
        fxCanvas.height = fxH
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    observer.observe(fxCanvas)
    resize()

    // ---- 画像の読み込み ----
    setReady(false)
    void Promise.all(
      SYMBOLS.map(async (sym) => {
        const img = new Image()
        img.src = spriteUrl(lineup[sym].key)
        await img.decode()
        images.set(sym, img)
      }),
    )
      .then(() => {
        if (disposed) return
        buildTiles()
        draw(performance.now())
        setReady(true)
      })
      .catch(() => {
        // 画像が取れないときは「読み込み中」のままにする（リロードで復帰できる）
      })

    // 初回ストップで計算待ちが出ないよう、リール制御の評価を先に済ませておく
    const warm = window.setTimeout(() => control.warmUp(), 60)

    setSpinning(false)
    setStopped([true, true, true])
    setShownCoins(machineRef.current.coins)

    // ---- 入力 ----
    const onPointer = (e: PointerEvent) => {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const reel = Math.min(2, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 3)))
      doStop(reel)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const onControl = target?.closest('button, a, input, select, textarea') != null
      if (e.key === ' ' || e.key === 'Enter') {
        // ボタンにフォーカスがあるときは、そのボタン自身の動作に任せる
        if (onControl) return
        e.preventDefault()
        engineRef.current?.main()
      } else if (e.key === 'ArrowLeft' || e.key === '1') {
        e.preventDefault()
        doStop(0)
      } else if (e.key === 'ArrowDown' || e.key === '2') {
        e.preventDefault()
        doStop(1)
      } else if (e.key === 'ArrowRight' || e.key === '3') {
        e.preventDefault()
        doStop(2)
      }
    }
    canvas.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    return () => {
      disposed = true
      engineRef.current = null
      cancelAnimationFrame(raf)
      cancelAnimationFrame(fxRaf)
      window.clearInterval(countTimer)
      window.clearTimeout(bannerTimer)
      window.clearTimeout(lampTimer)
      window.clearTimeout(warm)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      audio.stopBgm()
      // 回転中に離れたゲームは無かったことにする（掛け枚数は戻さない。保存データと同じ扱い）
      setChance(false)
      if (machineRef.current.spin) {
        const settled = { ...machineRef.current, spin: null }
        machineRef.current = settled
        setMachine(settled)
      }
    }
  }, [lineup])

  // ---- 台移動: 新しい台番号で最初から（顔ぶれも設定も変わる） ----
  const changeMachine = () => {
    if (machineRef.current.spin) return
    const next = freshMachine(machineRef.current.no)
    machineRef.current = next
    saveMachine(next)
    setMachine(next)
    setShownCoins(next.coins)
    setWin(0)
    setResult(null)
    setBanner(null)
    setReveal(false)
    setChance(false)
    audioRef.current?.play('move')
  }

  // タッチした瞬間（pointerdown）に反応させる。その直後に来る click は二重に動かないよう捨てるが、
  // pointerdown を伴わない click（キーボードの Enter/Space、スクリーンリーダーの操作）は拾う
  const press = (action: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      pointerActed.current = true
      action()
    },
    onPointerLeave: () => {
      pointerActed.current = false
    },
    onPointerCancel: () => {
      pointerActed.current = false
    },
    onClick: () => {
      if (pointerActed.current) pointerActed.current = false
      else action()
    },
  })

  if (!lineup) {
    return (
      <main className="slot">
        <div className="slot-inner">
          <div className="slot-head">
            <button className="slot-back jp" onClick={onBack}>
              ← {t('ゲーム')}
            </button>
          </div>
          <p className="slot-empty jp">{t('図柄にできるくり抜き画像が足りません。')}</p>
        </div>
      </main>
    )
  }

  const pendingSymbol = machine.lamp && machine.pending ? ROLE_SYMBOL[machine.pending] : null
  const needRefill = !spinning && canRefill(machine)
  const diff = machine.coins - machine.invested

  let message: string
  if (!ready) message = t('読み込み中…')
  else if (chance) message = t('チャンス！「{name}」を狙え', { name: t(SYMBOL_META.coat.name) })
  else if (pendingSymbol)
    message = t('ボーナス確定！「{name}」を狙え', { name: t(SYMBOL_META[pendingSymbol].name) })
  else if (machine.bonus)
    message = t('ボーナスゲーム 残り{count}回', { count: machine.bonus.left })
  else if (result?.bonusGained != null)
    message = t('ボーナス終了。{count}枚 獲得', { count: result.bonusGained })
  else if (result?.replay) message = t('リプレイ。もう1回、ただで回せる')
  else if (result?.symbol && result.payout > 0)
    message = t('{name}が揃った！ +{count}枚', {
      name: t(SYMBOL_META[result.symbol].name),
      count: result.payout,
    })
  else if (needRefill) message = t('メダル切れ。おかわりできます')
  else if (result?.missedChance) message = t('惜しい。チャンスを逃した')
  else if (spinning) message = t('止めろ。俺を揃えろ。')
  else message = t('同じ俺を3人、揃えろ。')

  const mainLabel = spinning
    ? 'STOP'
    : needRefill
      ? t('おかわり +{count}', { count: REFILL })
      : machine.replay
        ? 'REPLAY'
        : 'START'
  const mainSub = spinning
    ? t('左から順に止まる')
    : needRefill
      ? t('メダルを借りる')
      : machine.bonus || machine.replay
        ? 'FREE'
        : `${BET} BET`

  const payoutLabel = (sym: SymbolId) => {
    if (sym === 'new') return t('BIG（{pay}枚×{games}回）', { pay: BONUS_PAY, games: BONUS_GAMES.big })
    if (sym === 'blond') return t('REG（{pay}枚×{games}回）', { pay: BONUS_PAY, games: BONUS_GAMES.reg })
    if (sym === 'usual') return t('リプレイ')
    return t('{count}枚', { count: PAYOUT[sym] })
  }

  // スランプグラフ（差枚の推移）
  const history = machine.history
  // 振れ幅が小さいうちは上下に余白を取り、0の線が端に張り付かないようにする
  const hPad = Math.max(0, 40 - (Math.max(0, ...history) - Math.min(0, ...history))) / 2
  const hMin = Math.min(0, ...history) - hPad
  const hMax = Math.max(0, ...history) + hPad
  const hSpan = hMax - hMin
  const gx = (i: number) => (history.length > 1 ? (i / (history.length - 1)) * 240 : 0)
  const gy = (v: number) => 4 + (1 - (v - hMin) / hSpan) * 56
  const graphPoints = history.map((v, i) => `${gx(i).toFixed(1)},${gy(v).toFixed(1)}`).join(' ')

  const cabinetClass =
    'slot-cabinet' +
    (machine.bonus ? ' is-bonus' : '') +
    (pendingSymbol || chance ? ' is-pending' : '') +
    (tenpai ? ' is-tenpai' : '')

  return (
    <main className="slot">
      <div className="slot-inner">
        <div className="slot-head">
          <button className="slot-back jp" onClick={onBack}>
            ← {t('ゲーム')}
          </button>
          <h2 className="slot-title jp">{t('俺スロ')}</h2>
          <button
            className="slot-sound mono"
            aria-pressed={!muted}
            onClick={() => setMuted(audioRef.current!.toggle())}
            title={t(muted ? 'サウンドをオン' : 'サウンドをオフ')}
          >
            {muted ? 'SOUND OFF' : 'SOUND ON'}
          </button>
          <GameShareButton game="slot" title="俺スロ" />
        </div>

        <div className="slot-stage">
          {/* iOS は指を離したとき（pointerup）でないと音を鳴らし始められないので、ここで起こしておく */}
          <div className={cabinetClass} onPointerUp={() => audioRef.current?.unlock()}>
            <div className="slot-top">
              <span className={'slot-lamp jp' + (machine.lamp ? ' on' : '')} aria-hidden>
                俺
              </span>
              <span className="slot-led">
                <small className="mono">CREDIT</small>
                <b className="mono">{String(shownCoins).padStart(4, '0')}</b>
              </span>
              <span className="slot-led">
                <small className="mono">WIN</small>
                <b className="mono">{String(win).padStart(3, '0')}</b>
              </span>
              <span className="slot-led slot-led-game">
                <small className="mono">{machine.bonus ? 'BONUS' : 'GAME'}</small>
                <b className="mono">
                  {machine.bonus
                    ? `${BONUS_GAMES[machine.bonus.kind] - machine.bonus.left}/${BONUS_GAMES[machine.bonus.kind]}`
                    : String(machine.sinceBonus).padStart(3, '0')}
                </b>
              </span>
            </div>

            <div className="slot-window">
              <canvas
                ref={canvasRef}
                className="slot-canvas"
                role="img"
                aria-label={t('リール。回転中にタップすると、そのリールが止まります')}
              />
              {banner && (
                <div className={'slot-banner ' + banner.kind} role="status">
                  {banner.kind === 'end' ? (
                    <>
                      <span className="slot-banner-tag mono">BONUS END</span>
                      <b className="mono">+{banner.gained}</b>
                      <span className="jp">{t('{count}枚 獲得', { count: banner.gained })}</span>
                    </>
                  ) : (
                    <>
                      <span className="slot-banner-tag mono">
                        {banner.kind === 'big' ? 'BIG BONUS' : 'REG BONUS'}
                      </span>
                      <b className="jp">{t('俺、揃う。')}</b>
                      <span className="jp">
                        {t('{pay}枚×{games}回', { pay: BONUS_PAY, games: BONUS_GAMES[banner.kind] })}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <p className="slot-message jp" aria-live="polite">
              {message}
            </p>

            {/* 横長レイアウトで空く右側に出す、図柄と配当の早見表（詳細は情報パネルにある） */}
            <ul className="slot-mini" aria-hidden>
              {SYMBOLS.map((sym) => (
                <li key={sym}>
                  <span
                    className="slot-mini-plate"
                    style={
                      { '--c': SYMBOL_META[sym].color, '--d': SYMBOL_META[sym].deep } as CSSProperties
                    }
                  >
                    <img src={spriteUrl(lineup[sym].key)} alt="" />
                  </span>
                  <span className="mono">{MINI_PRIZE[sym]}</span>
                </li>
              ))}
            </ul>

            <div className="slot-deck">
              <div className="slot-stops">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    className={'slot-stop' + (spinning && !stopped[i] ? ' live' : '')}
                    aria-label={t('{reel}リールを止める', { reel: t(['左', '中', '右'][i]!) })}
                    aria-disabled={!spinning || stopped[i]}
                    {...press(() => engineRef.current?.stopReel(i))}
                  >
                    <span className="mono">STOP</span>
                  </button>
                ))}
              </div>
              <button
                className={'slot-main' + (spinning ? ' stop' : '') + (needRefill ? ' refill' : '')}
                disabled={!ready}
                {...press(() => engineRef.current?.main())}
              >
                <b className="mono">{mainLabel}</b>
                <small className="jp">{mainSub}</small>
              </button>
            </div>
            <canvas ref={fxRef} className="slot-fx" aria-hidden />
          </div>

          <aside className="slot-side">
            <section className="slot-panel">
              <h3 className="slot-panel-title jp">
                {t('今日の顔ぶれ')}
                <small className="mono">No.{String(machine.no).padStart(3, '0')}</small>
              </h3>
              <ul className="slot-pays">
                {SYMBOLS.map((sym) => {
                  const o = lineup[sym]
                  const meta = SYMBOL_META[sym]
                  return (
                    <li key={sym}>
                      <button
                        className="slot-pay"
                        onClick={() => onOpenOutfit(o.key)}
                        title={t('このコーデを見る')}
                      >
                        <span
                          className="slot-pay-plate"
                          style={{ '--c': meta.color, '--d': meta.deep } as CSSProperties}
                        >
                          <img src={spriteUrl(o.key)} alt="" loading="lazy" />
                        </span>
                        <span className="slot-pay-text">
                          <span className="slot-pay-name jp">{t(meta.name)}</span>
                          <span className="slot-pay-meta mono">
                            {o.no ? `#${o.no} · ` : ''}
                            {fmtDate(o.date)}
                          </span>
                        </span>
                        <span className="slot-pay-prize jp">{payoutLabel(sym)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="slot-panel">
              <h3 className="slot-panel-title jp">{t('データ')}</h3>
              <dl className="slot-stats">
                <div>
                  <dt className="jp">{t('総回転')}</dt>
                  <dd className="mono">{machine.spins}</dd>
                </div>
                <div>
                  <dt className="mono">BIG</dt>
                  <dd className="mono">{machine.big}</dd>
                </div>
                <div>
                  <dt className="mono">REG</dt>
                  <dd className="mono">{machine.reg}</dd>
                </div>
                <div>
                  <dt className="jp">{t('差枚')}</dt>
                  <dd className={'mono' + (diff < 0 ? ' minus' : diff > 0 ? ' plus' : '')}>
                    {diff > 0 ? '+' : ''}
                    {diff}
                  </dd>
                </div>
              </dl>
              <svg
                className="slot-graph"
                viewBox="0 0 240 64"
                preserveAspectRatio="none"
                role="img"
                aria-label={t('差枚の推移')}
              >
                <line className="slot-graph-zero" x1="0" x2="240" y1={gy(0)} y2={gy(0)} />
                {history.length > 1 && <polyline className="slot-graph-line" points={graphPoints} />}
              </svg>
              <div className="slot-actions">
                <button className="chip jp" onClick={changeMachine} disabled={spinning}>
                  {t('台を変える')}
                </button>
                <button className="chip jp" onClick={() => setReveal((v) => !v)}>
                  {reveal ? t('設定{n}', { n: machine.setting }) : t('設定を見る')}
                </button>
              </div>
            </section>

            <section className="slot-panel slot-howto jp">
              <h3 className="slot-panel-title">{t('あそびかた')}</h3>
              <ul>
                <li>{t('STARTで回して、STOPを3回。同じ俺が3人揃えば当たり。')}</li>
                <li>
                  {t(
                    '「俺」ランプが光ったらボーナス確定。リールがゆっくりになるので、赤の「最新の俺」か黄の「金髪の俺」を狙って止める。',
                  )}
                </li>
                <li>
                  {t('「チャンス！」が出たら、紺の「コートの俺」を狙って止める。チャンスはその1回きり。')}
                </li>
                <li>{t('顔ぶれは日替わり。「最新の俺」は、いつもいちばん新しい出勤服。')}</li>
                <li className="slot-howto-keys">
                  {t('キーボード: Space で回す／止める、← ↓ → で左・中・右を止める。')}
                </li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}
