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

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number }

function drawLevel(ctx: CanvasRenderingContext2D, run: Run, t: number, camX: number, camY: number) {
  const lv = run.level
  // 背景＋薄い方眼（動画の雰囲気）
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  ctx.strokeStyle = COL.grid
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
          ctx.fillStyle = COL.spikeBase
          ctx.fillRect(px, py + TILE - 5, TILE, 5)
          ctx.fillStyle = COL.tile
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
        ctx.fillStyle = COL.tile
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
        ctx.fillStyle = COL.tile
        ctx.fillRect(px, py + 12, TILE, TILE - 12)
        ctx.fillStyle = COL.spring
        ctx.fillRect(px + 3, py, TILE - 6, 8)
        ctx.strokeStyle = COL.tileTop
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px + 8, py + 12)
        ctx.lineTo(px + TILE - 8, py + 12)
        ctx.stroke()
      } else {
        ctx.fillStyle = COL.tile
        ctx.fillRect(px, py, TILE, TILE)
        if (aboveEmpty) {
          ctx.fillStyle = COL.tileTop
          ctx.fillRect(px, py, TILE, 3)
        }
      }
    }
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
  ctx.fillStyle = COL.door
  ctx.beginPath()
  ctx.roundRect(gx, gy, g.w, g.h, [10, 10, 0, 0])
  ctx.fill()
  ctx.fillStyle = COL.doorDark
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
  const [cleared, setCleared] = useState<Best | null>(null)
  const [showTip, setShowTip] = useState(true)
  const [restartTick, setRestartTick] = useState(0)
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
    const DT = 1 / 60

    const onKeyDown = (e: KeyboardEvent) => {
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

    const spawnFx = () => {
      for (const ev of run.events) {
        if (ev.type === 'coin') {
          for (let i = 0; i < 6; i++)
            particles.push({
              x: ev.x,
              y: ev.y,
              vx: Math.cos((i / 6) * Math.PI * 2) * 90,
              vy: Math.sin((i / 6) * Math.PI * 2) * 90,
              life: 0.35,
              color: COL.coin,
              r: 3,
            })
        } else if (ev.type === 'land' || ev.type === 'jump') {
          squashT = ev.type === 'land' ? 0.14 : 0
          for (let i = 0; i < 4; i++)
            particles.push({
              x: ev.x + (i - 1.5) * 6,
              y: ev.y,
              vx: (i - 1.5) * 40,
              vy: -40 - Math.random() * 30,
              life: 0.3,
              color: 'rgba(0,0,0,0.18)',
              r: 2.5,
            })
        } else if (ev.type === 'stomp' || ev.type === 'spring') {
          for (let i = 0; i < 8; i++)
            particles.push({
              x: ev.x,
              y: ev.y,
              vx: (Math.random() - 0.5) * 200,
              vy: -Math.random() * 160,
              life: 0.4,
              color: ev.type === 'stomp' ? COL.walker : COL.spring,
              r: 3,
            })
        } else if (ev.type === 'miss') {
          camShake = 0.25
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
        if (run.status === 'clear' && !wasClear && !reported) {
          reported = true
          const b: Best = { time: run.time, coins: run.coinCount, total: totalCoins, miss: run.miss }
          onClearBest(stageIdx, b)
          setCleared(b)
        }
        for (const p of particles) {
          p.life -= DT
          p.x += p.vx * DT
          p.y += p.vy * DT
          p.vy += 500 * DT
        }
        particles = particles.filter((p) => p.life > 0)
        squashT = Math.max(0, squashT - DT)
        camShake = Math.max(0, camShake - DT)
      }

      // HUD
      if (hudCoinRef.current) hudCoinRef.current.textContent = `${run.coinCount}/${totalCoins}`
      if (hudMissRef.current) hudMissRef.current.textContent = String(run.miss)
      if (hudTimeRef.current) hudTimeRef.current.textContent = fmtTime(run.time)

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

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawLevel(ctx, run, t, camX, camY)
      drawEnemies(ctx, run, t, camX, camY)

      // パーティクル
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / 0.4)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x - camX, p.y - camY, p.r, 0, Math.PI * 2)
        ctx.fill()
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
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(tipTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [chara, level, stageIdx, restartTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLast = stageIdx === LEVELS.length - 1
  const press = (k: 'left' | 'right', v: boolean) => () => {
    touchKeys.current[k] = v
  }

  return (
    <div className={`plat-inner plat-playwrap${pseudoFs ? ' plat-fs-mode' : ''}`} ref={wrapRef}>
      <div className="plat-hud mono">
        <span className="plat-hud-stage">
          STAGE {stageIdx + 1}/{LEVELS.length} {level.title}
        </span>
        <span className="plat-hud-stats">
          コイン <span ref={hudCoinRef}>0/{totalCoins}</span> ミス <span ref={hudMissRef}>0</span> タイム{' '}
          <span ref={hudTimeRef}>0.0</span>
        </span>
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
