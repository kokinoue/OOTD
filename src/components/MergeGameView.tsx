import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Circle, Vec2, World, type Body } from 'planck'
import GameShareButton from './GameShareButton'
import {
  DENSITY,
  FINAL_BONUS,
  findMergePairs,
  FRICTION,
  GRAVITY,
  loadBest,
  mergeScore,
  pickRankOutfits,
  PPM,
  RANK_COUNT,
  RANK_RADII,
  RESTITUTION,
  saveBest,
  spawnRank,
  type BallSnapshot,
} from '../lib/merge'
import { outfits, thumb } from '../lib/useData'

// クローゼット・マージ: 同じ出勤服どうしをぶつけると、より人気の一着に進化する（スイカゲーム風）。
// 進化チェーンは lib/merge.ts が実データ（いいね数）から決定的に選ぶ。
// ここは物理（planck）と描画（Canvas 2D）と入力。作法は TowerGameView に合わせている。

type Props = {
  onBack: () => void
}

const VIEW_W = 480
const VIEW_H = 720

// 箱（クローゼット）のジオメトリ（表示px）
const BOX_LEFT = 52
const BOX_RIGHT = 428
const BOX_FLOOR = 660
const WALL_T = 14
const DROP_Y = 104 // 玉を落とす高さ
const DEADLINE_Y = 172 // この線より上に玉が積み上がったら危険 → ゲームオーバー
const DROP_COOLDOWN = 24 // 連投防止（フレーム）
const OVER_GRACE_FRAMES = 90 // 落下直後の玉はゲームオーバー判定から除外する猶予
const OVER_FRAMES = 60 // 線超えがこのフレーム数続いたら終了

const COL = {
  bg: '#f1eee3',
  grid: 'rgba(0, 0, 0, 0.04)',
  wall: '#3a3a41',
  wallTop: '#4d4d57',
  deadline: 'rgba(214, 69, 69, 0.55)',
  guide: 'rgba(0, 0, 0, 0.18)',
}

// ランクごとのリング色。小さいほど淡く、大きいほど濃く鮮やかに（遠目でもランクが分かる）
const RANK_RING = [
  '#c3bdae',
  '#a8b0be',
  '#94b8a2',
  '#c9b06a',
  '#c98a6a',
  '#8a7ec2',
  '#5f8fc9',
  '#4db3a0',
  '#c95f8a',
  '#e0a52e',
  '#d64545',
]

type Ball = {
  id: number
  rank: number
  body: Body
  age: number // 生成からのフレーム数（ゲームオーバー猶予に使う）
}

export default function MergeGameView({ onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(loadBest)
  const [over, setOver] = useState(false)
  const [maxRank, setMaxRank] = useState(0) // 到達した最高ランク（結果表示用）
  const [nextRank, setNextRank] = useState(0)
  const [resetTick, setResetTick] = useState(0)

  // 進化チェーン（いいね上位11着、昇順）。データ由来で決定的
  const chain = useMemo(() => pickRankOutfits(outfits), [])

  // ランクごとの玉画像（円にクリップして描く元画像）。11枚だけなので先読みする
  const rankImages = useMemo(() => {
    return chain.map((o) => {
      const img = new Image()
      img.src = thumb(o.images[0].url, 200)
      return img
    })
  }, [chain])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr
    ctx.scale(dpr, dpr)

    // --- 物理世界（座標は px / PPM の m、y 下向き正） ---
    const world = new World({ gravity: new Vec2(0, GRAVITY) })
    const stat = (cx: number, cy: number, hw: number, hh: number) => {
      const b = world.createBody({ type: 'static', position: new Vec2(cx / PPM, cy / PPM) })
      b.createFixture({
        shape: new Box(hw / PPM, hh / PPM),
        friction: FRICTION,
        restitution: RESTITUTION,
      })
    }
    // 床と左右の壁。上は開いている
    stat((BOX_LEFT + BOX_RIGHT) / 2, BOX_FLOOR + WALL_T, (BOX_RIGHT - BOX_LEFT) / 2 + WALL_T * 2, WALL_T)
    stat(BOX_LEFT - WALL_T, (DROP_Y + BOX_FLOOR) / 2, WALL_T, (BOX_FLOOR - DROP_Y) / 2 + WALL_T)
    stat(BOX_RIGHT + WALL_T, (DROP_Y + BOX_FLOOR) / 2, WALL_T, (BOX_FLOOR - DROP_Y) / 2 + WALL_T)

    // --- ゲーム状態（React state は HUD のみ） ---
    const balls: Ball[] = []
    let nextId = 1
    let currentRank = spawnRank(Math.random)
    let queuedRank = spawnRank(Math.random)
    let aimX = VIEW_W / 2
    let cooldown = 0
    let overCount = 0
    let gameOver = false
    let scoreLocal = 0
    let maxRankLocal = 0
    let raf = 0
    setNextRank(queuedRank)

    const clampAim = () => {
      const r = RANK_RADII[currentRank]
      aimX = Math.min(Math.max(aimX, BOX_LEFT + r + 2), BOX_RIGHT - r - 2)
    }
    clampAim()

    const createBall = (rank: number, x: number, y: number, vy = 0): Ball => {
      const body = world.createBody({
        type: 'dynamic',
        position: new Vec2(x / PPM, y / PPM),
        linearVelocity: new Vec2(0, vy),
        bullet: true,
      })
      body.createFixture({
        shape: new Circle(RANK_RADII[rank] / PPM),
        density: DENSITY,
        friction: FRICTION,
        restitution: RESTITUTION,
      })
      const ball = { id: nextId++, rank, body, age: 0 }
      balls.push(ball)
      if (rank > maxRankLocal) {
        maxRankLocal = rank
        setMaxRank(rank)
      }
      return ball
    }

    const removeBall = (ball: Ball) => {
      world.destroyBody(ball.body)
      const i = balls.indexOf(ball)
      if (i >= 0) balls.splice(i, 1)
    }

    const drop = () => {
      if (gameOver || cooldown > 0) return
      clampAim()
      createBall(currentRank, aimX, DROP_Y)
      currentRank = queuedRank
      queuedRank = spawnRank(Math.random)
      setNextRank(queuedRank)
      cooldown = DROP_COOLDOWN
      clampAim()
    }

    const finishGame = () => {
      if (gameOver) return
      gameOver = true
      saveBest(scoreLocal)
      setBest(loadBest())
      setOver(true)
    }

    // --- 入力: ドラッグ/移動で照準、離すと落下（タップでもその位置に落下） ---
    const toLocalX = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return ((e.clientX - rect.left) / rect.width) * VIEW_W
    }
    let pointerActive = false
    const onDown = (e: PointerEvent) => {
      if (gameOver) return
      canvas.setPointerCapture(e.pointerId)
      pointerActive = true
      aimX = toLocalX(e)
      clampAim()
    }
    const onMove = (e: PointerEvent) => {
      if (!pointerActive || gameOver) return
      aimX = toLocalX(e)
      clampAim()
    }
    const onUp = () => {
      if (!pointerActive) return
      pointerActive = false
      drop()
    }
    const onKey = (e: KeyboardEvent) => {
      if (gameOver) return
      if (e.key === 'ArrowLeft') {
        aimX -= 14
        clampAim()
      } else if (e.key === 'ArrowRight') {
        aimX += 14
        clampAim()
      } else if (e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        drop()
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)

    // --- メインループ ---
    const step = () => {
      world.step(1 / 60, 8, 3)
      if (cooldown > 0) cooldown--
      for (const b of balls) b.age++

      // 合体判定（純粋関数）。ペアごとに: 両方消して1ランク上を中点に生成
      if (!gameOver) {
        const snapshot: BallSnapshot[] = balls.map((b) => ({
          id: b.id,
          rank: b.rank,
          x: b.body.getPosition().x * PPM,
          y: b.body.getPosition().y * PPM,
        }))
        const pairs = findMergePairs(snapshot)
        for (const [idA, idB] of pairs) {
          const a = balls.find((b) => b.id === idA)
          const b = balls.find((bb) => bb.id === idB)
          if (!a || !b) continue
          const pa = a.body.getPosition()
          const pb = b.body.getPosition()
          const mx = ((pa.x + pb.x) / 2) * PPM
          const my = ((pa.y + pb.y) / 2) * PPM
          const rank = a.rank
          removeBall(a)
          removeBall(b)
          scoreLocal += mergeScore(rank)
          if (rank + 1 < RANK_COUNT) {
            createBall(rank + 1, mx, Math.min(my, BOX_FLOOR - RANK_RADII[rank + 1]), -1.2)
          } else {
            scoreLocal += FINAL_BONUS // 最大ランクどうしは両方消滅の大量得点
          }
          setScore(scoreLocal)
        }
      }

      // ゲームオーバー判定: 猶予を過ぎた玉がデッドラインを超えたまま留まったら終了
      let overNow = false
      for (const b of balls) {
        if (b.age < OVER_GRACE_FRAMES) continue
        const top = b.body.getPosition().y * PPM - RANK_RADII[b.rank]
        if (top < DEADLINE_Y) {
          overNow = true
          break
        }
      }
      overCount = overNow ? overCount + 1 : 0
      if (overCount >= OVER_FRAMES) finishGame()

      draw()
      raf = requestAnimationFrame(step)
    }

    const drawBall = (rank: number, x: number, y: number, angle: number) => {
      const r = RANK_RADII[rank]
      const img = rankImages[rank]
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.closePath()
      if (img?.complete && img.naturalWidth > 0) {
        ctx.save()
        ctx.clip()
        ctx.drawImage(img, -r, -r, r * 2, r * 2)
        ctx.restore()
      } else {
        ctx.fillStyle = RANK_RING[rank]
        ctx.fill()
      }
      ctx.lineWidth = Math.max(2.5, r * 0.08)
      ctx.strokeStyle = RANK_RING[rank]
      ctx.stroke()
      ctx.restore()
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

      // 箱（床・左右の壁）
      ctx.fillStyle = COL.wall
      ctx.fillRect(BOX_LEFT - WALL_T * 2, BOX_FLOOR, BOX_RIGHT - BOX_LEFT + WALL_T * 4, VIEW_H - BOX_FLOOR)
      ctx.fillRect(BOX_LEFT - WALL_T * 2, DROP_Y + 40, WALL_T * 2, BOX_FLOOR - DROP_Y - 40)
      ctx.fillRect(BOX_RIGHT, DROP_Y + 40, WALL_T * 2, BOX_FLOOR - DROP_Y - 40)
      ctx.fillStyle = COL.wallTop
      ctx.fillRect(BOX_LEFT - WALL_T * 2, BOX_FLOOR, BOX_RIGHT - BOX_LEFT + WALL_T * 4, 6)

      // デッドライン（超えそうなときだけ濃く点滅）
      ctx.setLineDash([8, 8])
      ctx.strokeStyle = overCount > 0 ? COL.deadline : 'rgba(0,0,0,0.12)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(BOX_LEFT, DEADLINE_Y)
      ctx.lineTo(BOX_RIGHT, DEADLINE_Y)
      ctx.stroke()
      ctx.setLineDash([])

      // 置かれた玉
      for (const b of balls) {
        const pos = b.body.getPosition()
        drawBall(b.rank, pos.x * PPM, pos.y * PPM, b.body.getAngle())
      }

      // 照準中の玉 + 落下ガイド
      if (!gameOver && cooldown === 0) {
        ctx.strokeStyle = COL.guide
        ctx.setLineDash([6, 6])
        ctx.beginPath()
        ctx.moveTo(aimX, DROP_Y)
        ctx.lineTo(aimX, BOX_FLOOR)
        ctx.stroke()
        ctx.setLineDash([])
        drawBall(currentRank, aimX, DROP_Y, 0)
      }
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [resetTick, rankImages])

  const retry = () => {
    setScore(0)
    setOver(false)
    setMaxRank(0)
    setResetTick((t) => t + 1)
  }

  const maxOutfit = chain[maxRank]

  return (
    <main className="merge">
      <div className="merge-inner">
        <div className="merge-head">
          <button className="merge-back jp" onClick={onBack}>
            ← ゲーム
          </button>
          <h2 className="merge-title jp">クローゼット・マージ</h2>
          <span className="merge-stats mono">
            {score} <small>pt</small> / BEST {Math.max(best, score)}
          </span>
          <GameShareButton game="merge" title="クローゼット・マージ" />
        </div>
        <div className="merge-screen">
          <canvas ref={canvasRef} className="merge-canvas" />
          {over && (
            <div className="merge-overlay">
              <div className="merge-result jp">
                <b className="mono">{score} pt</b>
                <span>
                  {score > 0 && score >= best ? '自己ベスト更新！' : `BEST ${best} pt`}
                </span>
                {maxOutfit && (
                  <span className="merge-result-reach">
                    最高到達: {maxOutfit.title}（♡{maxOutfit.like}）
                  </span>
                )}
                <span className="merge-result-actions">
                  <button className="merge-btn primary jp" onClick={retry}>
                    もういちど
                  </button>
                  <button className="merge-btn jp" onClick={onBack}>
                    もどる
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="merge-foot jp">
          <span className="merge-hint">ドラッグで狙って、はなすと落下。同じ服がくっつくと人気の一着に進化</span>
          <span className="merge-next">
            つぎ
            <i
              className="merge-next-dot"
              style={{ borderColor: RANK_RING[nextRank] }}
            >
              <img src={thumb(chain[nextRank].images[0].url, 80)} alt="次の玉" />
            </i>
          </span>
        </div>
        <div className="merge-chain">
          {chain.map((o, i) => (
            <span className="merge-chain-item" key={o.key} title={`${o.title}（♡${o.like}）`}>
              <i
                className="merge-chain-dot"
                style={{ borderColor: RANK_RING[i], width: 14 + i * 2.2, height: 14 + i * 2.2 }}
              >
                <img src={thumb(o.images[0].url, 60)} alt={o.title} />
              </i>
              {i < chain.length - 1 && <em className="merge-chain-arrow">›</em>}
            </span>
          ))}
        </div>
      </div>
    </main>
  )
}
