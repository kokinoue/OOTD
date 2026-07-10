import { useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import type { CutoutsFile } from '../lib/platform'
import {
  applyGate,
  applyObstacle,
  distanceToScore,
  isGainGate,
  SEGMENT_M,
  segmentEvents,
  speedAt,
  type CourseEvent,
  type Gate,
  type Lane,
} from '../lib/runner'
import { fmtDate, outfits } from '../lib/useData'

// 通勤ランナー: kokiの群れを増やしながら通勤路を走る横スクロールエンドレスラン。
// ゲートで増殖し、障害物で減り、0人で終了。スコア = 到達距離(m)。
// コース生成・増減ロジックは lib/runner.ts（純粋・テスト対象）。ここは描画・入力・UI。

const cutouts = cutoutsJson as CutoutsFile
const SPRITE_KEYS = Object.keys(cutouts.sprites)
const outfitByKey = new Map(outfits.map((o) => [o.key, o]))
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

const BEST_KEY = 'runner.best'
const loadBest = (): number => {
  try {
    const n = Number(localStorage.getItem(BEST_KEY) ?? '0')
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}
const saveBest = (score: number): void => {
  try {
    if (score > loadBest()) localStorage.setItem(BEST_KEY, String(score))
  } catch {
    // localStorage が使えない環境では何もしない
  }
}

const randomKey = (): string => SPRITE_KEYS[Math.floor(Math.random() * SPRITE_KEYS.length)]

// ----------------------------------------------------------------------------
// 描画の定数
// ----------------------------------------------------------------------------
const VIEW_W = 880
const VIEW_H = 440
const GROUND_TOP = 232 // 地面の上端 y
const PLAYER_X = VIEW_W * 0.26 // 群れの画面上の x（ここが現在距離）
const PX_PER_M = 40 // 1m を何pxで描くか（横スクロール換算）
const CROWD_H = 82 // 群れスプライトの高さ(px)
const MAX_DRAWN = 60 // 群れの描画上限（超過分は ×N 表示）
const LANE_FEET = [GROUND_TOP + 96, GROUND_TOP + 172] as const // 各レーンの足元 y

const COL = {
  bg: '#f1eee3',
  sky: '#e7e3d6',
  building: '#d5d0c1',
  buildingFar: '#dfdacb',
  ground: '#3a3a41',
  groundTop: '#4d4d57',
  lane: 'rgba(255,255,255,0.28)',
  laneEdge: 'rgba(0,0,0,0.06)',
  gain: '#5a9e5f',
  gainSoft: 'rgba(90,158,95,0.16)',
  loss: '#b4534b',
  lossSoft: 'rgba(180,83,75,0.16)',
  train: '#2f3340',
  trainDoor: '#565c6e',
  puddle: 'rgba(90,120,150,0.5)',
  shadow: 'rgba(0,0,0,0.12)',
  text: '#17171a',
}

const gateLabel = (g: Gate): string => {
  switch (g.op) {
    case 'add':
      return `+${g.value}`
    case 'sub':
      return `-${g.value}`
    case 'mul':
      return `×${g.value}`
    case 'div':
      return `÷${g.value}`
  }
}

type FloatText = { x: number; y: number; text: string; color: string; life: number }

// 群れ各人の見た目の揺らぎ（決定的に散らす）。ワラワラ感を出す。
type Member = { ox: number; oy: number; phase: number; flip: number; scale: number }
function buildMembers(n: number): Member[] {
  const members: Member[] = []
  const golden = 2.399963
  for (let i = 0; i < n; i++) {
    const a = i * golden
    const r = Math.sqrt(i) * 7.2
    members.push({
      ox: -Math.cos(a) * r * 1.15 - (i === 0 ? 0 : 4), // だいたい後方へ広がる
      oy: Math.sin(a) * r * 0.42,
      phase: (i * 1.7) % (Math.PI * 2),
      flip: i % 2 === 0 ? 1 : -1,
      scale: 0.9 + ((i * 13) % 7) / 40,
    })
  }
  return members
}
const MEMBERS = buildMembers(MAX_DRAWN)

// 遠景の街並み（決定的なシルエット。白黒基調に合わせた線画/塊）
type Building = { x: number; w: number; h: number; far: boolean }
function buildSkyline(): Building[] {
  const list: Building[] = []
  let x = -40
  let s = 20240711
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) >>> 0) % 1000
    return s / 1000
  }
  while (x < 2400) {
    const far = rnd() < 0.5
    const w = 40 + Math.floor(rnd() * 70)
    const h = (far ? 40 : 70) + Math.floor(rnd() * (far ? 50 : 90))
    list.push({ x, w, h, far })
    x += w + 8 + Math.floor(rnd() * 22)
  }
  return list
}
const SKYLINE = buildSkyline()

type Props = {
  onBack: () => void
}

export default function RunnerGameView({ onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const distRef = useRef<HTMLSpanElement>(null)
  const crowdRef = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState<'ready' | 'playing' | 'over'>('ready')
  const [runId, setRunId] = useState(0)
  const [heroKey, setHeroKey] = useState<string>(() => randomKey())
  const [result, setResult] = useState<{ score: number; best: number; isBest: boolean } | null>(null)
  const [best, setBest] = useState<number>(loadBest)

  const touch = useMemo(
    () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    [],
  )
  const heroOutfit = outfitByKey.get(heroKey)

  const start = () => {
    setHeroKey(randomKey())
    setResult(null)
    setPhase('playing')
    setRunId((n) => n + 1)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    if (runId === 0) return // まだ開始していない
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr

    const sprite = new Image()
    sprite.src = spriteUrl(heroKey)
    const ratio = cutouts.sprites[heroKey] ? cutouts.sprites[heroKey].w / cutouts.sprites[heroKey].h : 0.4

    // --- 実行時の状態 ---
    let worldDist = 0 // 現在距離(m)。PLAYER_X がこの距離に対応する
    let count = 1
    let lane: Lane = 0
    let visualLane = 0 // レーン間を滑らかに補間
    let nextSegIndex = 0
    let pending: CourseEvent[] = [] // グローバル距離昇順の未処理イベント
    const seed = (runId * 2654435761) >>> 0 // ラン毎に別コース（決定的）
    let floats: FloatText[] = []
    let shake = 0
    let over = false
    let t = 0
    let raf = 0
    let last = performance.now()
    let acc = 0
    const DT = 1 / 60

    const ensureCourse = () => {
      // 画面右端より少し先まで生成しておく
      const ahead = worldDist + (VIEW_W - PLAYER_X) / PX_PER_M + 8
      while (nextSegIndex * SEGMENT_M < ahead) {
        pending.push(...segmentEvents(seed, nextSegIndex))
        nextSegIndex++
      }
      pending.sort((a, b) => a.dist - b.dist)
    }

    const feetYOf = (l: number) => LANE_FEET[0] + (LANE_FEET[1] - LANE_FEET[0]) * l

    const addFloat = (text: string, color: string, dy: number) => {
      floats.push({ x: PLAYER_X, y: feetYOf(visualLane) - CROWD_H - 14 - dy, text, color, life: 1 })
    }

    const processCrossed = () => {
      while (pending.length > 0 && pending[0].dist <= worldDist) {
        const ev = pending.shift()!
        if (ev.kind === 'gate') {
          const g = lane === 0 ? ev.top : ev.bottom
          const before = count
          count = applyGate(count, g)
          const delta = count - before
          addFloat(
            `${gateLabel(g)}${delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`,
            isGainGate(g) ? COL.gain : COL.loss,
            0,
          )
        } else if (ev.lane === lane) {
          const before = count
          count = applyObstacle(count, ev.obstacle)
          const delta = count - before
          addFloat(delta !== 0 ? `${delta}` : '無傷', COL.loss, 18)
          shake = Math.min(0.4, shake + (ev.obstacle === 'train' ? 0.32 : 0.18))
        }
        if (count <= 0) {
          count = 0
          finish()
          return
        }
      }
    }

    const finish = () => {
      if (over) return
      over = true
      const score = distanceToScore(worldDist)
      saveBest(score)
      const b = loadBest()
      setBest(b)
      setResult({ score, best: b, isBest: score > 0 && score >= b })
      setPhase('over')
    }

    const setLane = (l: Lane) => {
      if (!over) lane = l
    }
    const toggleLane = () => setLane(lane === 0 ? 1 : 0)

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') setLane(0)
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') setLane(1)
      else if (e.key === ' ') {
        e.preventDefault()
        toggleLane()
      } else if (e.key === 'r' || e.key === 'R') restart()
    }
    // ポインタ: スワイプ（上下）でレーン指定、タップで切替
    let downY = 0
    let downT = 0
    const toLocalY = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return ((e.clientY - rect.top) / rect.height) * VIEW_H
    }
    const onDown = (e: PointerEvent) => {
      downY = toLocalY(e)
      downT = performance.now()
    }
    const onUp = (e: PointerEvent) => {
      if (over) return
      const dy = toLocalY(e) - downY
      if (Math.abs(dy) > 26) setLane(dy < 0 ? 0 : 1)
      else if (performance.now() - downT < 400) toggleLane()
    }
    const restart = () => {
      // React 側の start と同じ入口へ（effect を貼り直す）
      cleanup()
      setResult(null)
      setPhase('playing')
      setRunId((n) => n + 1)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)

    // --- 背景（街並み）の描画。parallax でゆっくり流す ---
    const drawBackground = () => {
      ctx.fillStyle = COL.bg
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      // 空
      ctx.fillStyle = COL.sky
      ctx.fillRect(0, 0, VIEW_W, GROUND_TOP)
      // 街のシルエット（遠景=ゆっくり、近景=やや速く）
      for (const b of SKYLINE) {
        const par = b.far ? 0.25 : 0.45
        const sx = ((b.x - worldDist * PX_PER_M * par) % 2400 + 2400) % 2400 - 60
        const by = GROUND_TOP - b.h
        ctx.fillStyle = b.far ? COL.buildingFar : COL.building
        ctx.fillRect(sx, by, b.w, b.h)
        // 窓（数個・線画風）
        if (!b.far) {
          ctx.fillStyle = COL.sky
          for (let wy = by + 12; wy < GROUND_TOP - 10; wy += 20) {
            for (let wx = sx + 8; wx < sx + b.w - 8; wx += 18) {
              ctx.fillRect(wx, wy, 7, 9)
            }
          }
        }
      }
    }

    const drawGround = () => {
      ctx.fillStyle = COL.ground
      ctx.fillRect(0, GROUND_TOP, VIEW_W, VIEW_H - GROUND_TOP)
      ctx.fillStyle = COL.groundTop
      ctx.fillRect(0, GROUND_TOP, VIEW_W, 6)
      // レーンの走行線（流れる破線）
      const dashOff = (worldDist * PX_PER_M) % 60
      ctx.strokeStyle = COL.lane
      ctx.lineWidth = 3
      ctx.setLineDash([26, 34])
      for (const fy of LANE_FEET) {
        ctx.beginPath()
        ctx.lineDashOffset = dashOff
        ctx.moveTo(0, fy + 6)
        ctx.lineTo(VIEW_W, fy + 6)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    const screenXOf = (dist: number) => PLAYER_X + (dist - worldDist) * PX_PER_M

    const drawGate = (ev: Extract<CourseEvent, { kind: 'gate' }>) => {
      const gx = screenXOf(ev.dist)
      if (gx < -60 || gx > VIEW_W + 60) return
      const panels: [Lane, Gate][] = [
        [0, ev.top],
        [1, ev.bottom],
      ]
      for (const [l, g] of panels) {
        const feet = feetYOf(l)
        const top = feet - CROWD_H - 20
        const h = feet - top
        const gain = isGainGate(g)
        ctx.fillStyle = gain ? COL.gainSoft : COL.lossSoft
        ctx.fillRect(gx - 34, top, 68, h)
        ctx.strokeStyle = gain ? COL.gain : COL.loss
        ctx.lineWidth = 3
        ctx.strokeRect(gx - 34, top, 68, h)
        // ラベル
        ctx.fillStyle = gain ? COL.gain : COL.loss
        ctx.font = 'bold 26px Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(gateLabel(g), gx, top + h / 2)
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }

    const drawObstacle = (ev: Extract<CourseEvent, { kind: 'obstacle' }>) => {
      const ox = screenXOf(ev.dist)
      if (ox < -60 || ox > VIEW_W + 60) return
      const feet = feetYOf(ev.lane)
      if (ev.obstacle === 'train') {
        const w = 48
        const h = 96
        ctx.fillStyle = COL.train
        ctx.beginPath()
        ctx.roundRect(ox - w / 2, feet - h, w, h, 6)
        ctx.fill()
        ctx.fillStyle = COL.trainDoor
        ctx.fillRect(ox - w / 2 + 6, feet - h + 12, w - 12, h - 22)
        ctx.fillStyle = COL.train
        ctx.fillRect(ox - 1.5, feet - h + 12, 3, h - 22) // ドアの合わせ目
      } else {
        ctx.fillStyle = COL.puddle
        ctx.beginPath()
        ctx.ellipse(ox, feet + 2, 34, 9, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawCrowd = () => {
      const feet = feetYOf(visualLane)
      const shown = Math.min(count, MAX_DRAWN)
      const spread = Math.min(1, count / 40)
      // 後方（index大）から前方へ描いて重なりを自然に
      for (let i = shown - 1; i >= 0; i--) {
        const m = MEMBERS[i]
        const bob = Math.sin(t * 9 + m.phase) * 2.4
        const cx = PLAYER_X + m.ox * (0.5 + spread * 0.9)
        const cy = feet + m.oy * (0.5 + spread * 0.7) + bob
        const h = CROWD_H * m.scale
        const w = h * ratio
        // 影
        ctx.fillStyle = COL.shadow
        ctx.beginPath()
        ctx.ellipse(cx, cy + 1, w * 0.36, 3, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(m.flip, 1)
        if (sprite.complete && sprite.naturalWidth > 0) {
          ctx.drawImage(sprite, -w / 2, -h, w, h)
        } else {
          ctx.fillStyle = '#8a5fc0'
          ctx.beginPath()
          ctx.roundRect(-w / 2, -h, w, h, 6)
          ctx.fill()
        }
        ctx.restore()
      }
      // 超過分のカウント表示
      if (count > MAX_DRAWN) {
        ctx.fillStyle = COL.text
        ctx.font = 'bold 22px Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`×${count}`, PLAYER_X, feet - CROWD_H - 16)
        ctx.textAlign = 'left'
      }
    }

    const draw = () => {
      let sx = 0
      let sy = 0
      if (shake > 0) {
        sx = (Math.random() - 0.5) * shake * 20
        sy = (Math.random() - 0.5) * shake * 14
      }
      ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr)
      drawBackground()
      drawGround()
      for (const ev of pending) {
        if (ev.kind === 'gate') drawGate(ev)
        else drawObstacle(ev)
      }
      drawCrowd()
      // フロートテキスト
      ctx.textAlign = 'center'
      for (const f of floats) {
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life))
        ctx.fillStyle = f.color
        ctx.font = 'bold 20px Menlo, monospace'
        ctx.fillText(f.text, f.x, f.y - (1 - f.life) * 34)
      }
      ctx.globalAlpha = 1
      ctx.textAlign = 'left'
    }

    ensureCourse()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      acc += Math.min(0.1, (now - last) / 1000)
      last = now
      while (acc >= DT) {
        acc -= DT
        if (!over) {
          t += DT
          worldDist += speedAt(worldDist) * DT
          ensureCourse()
          processCrossed()
          visualLane += (lane - visualLane) * Math.min(1, DT * 12)
          shake = Math.max(0, shake - DT * 1.4)
          for (const f of floats) f.life -= DT * 0.9
          floats = floats.filter((f) => f.life > 0)
        }
      }
      // HUD（毎フレーム textContent で更新。再レンダーを避ける）
      if (distRef.current) distRef.current.textContent = String(distanceToScore(worldDist))
      if (crowdRef.current) crowdRef.current.textContent = String(count)
      draw()
      if (over) cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(frame)

    function cleanup() {
      cancelAnimationFrame(raf)
      canvas!.removeEventListener('pointerdown', onDown)
      canvas!.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
    return cleanup
  }, [runId, heroKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="g-runner">
      <div className="g-runner-inner">
        <div className="game-nav">
          <button className="game-back jp" onClick={onBack}>
            ← ゲーム選択にもどる
          </button>
          <GameShareButton game="runner" title="通勤ランナー" />
        </div>
        <div className="g-runner-head">
          <h2 className="g-runner-title jp">通勤ランナー</h2>
          <span className="g-runner-hud mono">
            <span className="g-runner-hud-item">
              距離 <b ref={distRef}>0</b>m
            </span>
            <span className="g-runner-hud-item">
              群れ <b ref={crowdRef}>1</b>人
            </span>
            <span className="g-runner-hud-item g-runner-hud-best">BEST {best}m</span>
          </span>
        </div>

        <div className="g-runner-screen">
          <canvas ref={canvasRef} className="g-runner-canvas" />

          {phase === 'ready' && (
            <div className="g-runner-overlay">
              <div className="g-runner-card jp">
                <b className="mono">通勤ランナー</b>
                <p className="g-runner-lead">
                  kokiの群れを増やしながら通勤路を走ろう。ゲートで増殖し、満員電車や水たまりで減る。0人になったら終了、走った距離がスコア。
                </p>
                <ul className="g-runner-rules">
                  <li>
                    <b className="g-runner-gain">緑のゲート</b>で群れが増える（+n・×2）
                  </li>
                  <li>
                    <b className="g-runner-loss">赤のゲート</b>と障害物で群れが減る（−n・÷2）
                  </li>
                  <li>{touch ? 'タップ / 上下スワイプ' : '↑↓キー / スペース'}で上下レーン切替</li>
                </ul>
                <button className="g-start jp" onClick={start}>
                  スタート
                </button>
              </div>
            </div>
          )}

          {phase === 'over' && result && (
            <div className="g-runner-overlay">
              <div className="g-runner-result jp">
                <b className="mono">{result.score}m</b>
                <span>{result.isBest ? '自己ベスト更新！' : `BEST ${result.best}m`}</span>
                <span className="g-runner-result-actions">
                  <button className="g-runner-btn primary jp" onClick={start}>
                    もう一度
                  </button>
                  <button className="g-runner-btn jp" onClick={onBack}>
                    ゲームを選ぶ
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="g-runner-foot jp">
          <span className="g-runner-caption mono">
            {heroOutfit ? `#${heroOutfit.no ?? '—'} ${fmtDate(heroOutfit.date)} の群れ` : ''}
          </span>
          <span className="g-runner-hint">
            {touch ? 'タップ / 上下スワイプでレーン切替' : '↑↓ / スペースでレーン切替 · R でやり直し'}
          </span>
        </div>
      </div>
    </main>
  )
}
