import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import GameShareButton from './GameShareButton'
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  GRID,
  applyMove,
  generate,
  isSolved,
  legalMoves,
  pickDailyOutfit,
  todaySeedJST,
  type Board,
  type Difficulty,
  type Piece,
  type Puzzle,
} from '../lib/jam'
import { fmtDate, outfits, thumb } from '../lib/useData'

// 満員クローゼット: Rush Hour型スライドパズル。
// パズルロジックは lib/jam.ts に完全分離。ここは描画とドラッグ入力とUIの状態遷移のみを担当する。
// デイリー(今日の日付がシード。難易度は「ふつう」固定・実在の一着を出す) と
// フリー(難易度を選び、「次の問題」でシードを進めて無限に遊べる)の2モード。

type Mode = 'daily' | 'free'
type Phase = 'setup' | 'playing' | 'cleared'

const DAILY_DIFFICULTY: Difficulty = 'normal'
// 難易度ごとにseed空間を分けて衝突しないようにする(freeIndexは0から増える想定)
const FREE_SEED_BASE: Record<Difficulty, number> = {
  easy: 1_000_000,
  normal: 2_000_000,
  hard: 3_000_000,
}

const outfitsWithImage = outfits.filter((o) => o.images[0]?.url)

type DragState = {
  id: string
  axis: 'row' | 'col'
  origin: number
  min: number
  max: number
  cellPx: number
  startClientX: number
  startClientY: number
  current: number // クランプ済みの現在位置(セル単位、小数)
}

export default function JamGameView({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('daily')
  const [freeDifficulty, setFreeDifficulty] = useState<Difficulty>('easy')
  const [freeIndex, setFreeIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('setup')

  const dailySeed = useMemo(() => todaySeedJST(), [])
  const dailyOutfit = useMemo(() => pickDailyOutfit(outfits), [])
  const dailyDateLabel = useMemo(() => {
    const s = String(dailySeed)
    return fmtDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  }, [dailySeed])

  const difficulty = mode === 'daily' ? DAILY_DIFFICULTY : freeDifficulty
  const seed = mode === 'daily' ? dailySeed : FREE_SEED_BASE[freeDifficulty] + freeIndex

  const [history, setHistory] = useState<Board[] | null>(null)
  const [exiting, setExiting] = useState(false)

  // むずかしい(15手以上)は採掘済みテーブルから即時に引けるが、easy/normalのライブ探索は
  // 最大2秒程度かかりうる。生成を1tick遅らせて「生成中」の表示を確実に描画してから
  // CPUバウンドな計算に入る(UIが固まって見えるのを避ける)。
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  useEffect(() => {
    // 生成前(または生成中)は history も破棄する。そうしないと切り替え直後の一瞬、
    // 前の問題の「クリア済みの盤面」がそのまま表示され、isSolved判定で即クリア扱いになってしまう
    setPuzzle(null)
    setHistory(null)
    const id = window.setTimeout(() => setPuzzle(generate(seed, difficulty)), 30)
    return () => window.clearTimeout(id)
  }, [seed, difficulty])

  // 生成が終わったら履歴を初期化してプレイ可能にする
  useEffect(() => {
    if (!puzzle) return
    setHistory([puzzle.board])
    setExiting(false)
    // puzzle は seed/difficulty から決定的に導出されるオブジェクトなので、そのものを依存にする
  }, [puzzle])

  // ターゲットの見た目に敷く写真。デイリーは実在の一着、フリーはseedから決定的に選ぶ(演出用)
  const displayOutfit = useMemo(() => {
    if (mode === 'daily' && dailyOutfit) return dailyOutfit
    const idx = Math.abs(seed) % outfitsWithImage.length
    return outfitsWithImage[idx]
  }, [mode, dailyOutfit, seed])

  const board = history?.[history.length - 1]
  const moveCount = history ? history.length - 1 : 0
  const par = puzzle?.par ?? 0
  const withinPar = moveCount <= par

  const boardRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const commitMove = useCallback((id: string, to: number) => {
    setHistory((h) => (h ? [...h, applyMove(h[h.length - 1], { id, to })] : h))
  }, [])

  const undo = useCallback(() => {
    setExiting(false)
    setHistory((h) => (h && h.length > 1 ? h.slice(0, -1) : h))
  }, [])

  const resetBoard = useCallback(() => {
    setExiting(false)
    setHistory((h) => (h ? [h[0]] : h))
  }, [])

  // クリア判定: ターゲットが出口に到達したら、スライドアウト演出のぶんだけ待ってから結果画面へ。
  // 注意: 依存配列に exiting を入れてはいけない。入れると setExiting(true) 直後に
  // このeffect自身が再実行され、クリーンアップが420msタイマーを解除してしまい
  // 永遠に 'cleared' へ進まなくなる（undo/離脱時のキャンセルは board/phase の変化で効く）。
  useEffect(() => {
    if (phase !== 'playing' || !board) return
    if (isSolved(board)) {
      setExiting(true)
      const t = window.setTimeout(() => setPhase('cleared'), 420)
      return () => window.clearTimeout(t)
    }
  }, [board, phase])

  const startPlaying = () => {
    if (puzzle) setHistory([puzzle.board])
    setExiting(false)
    setPhase('playing')
  }

  const retrySame = () => {
    if (puzzle) setHistory([puzzle.board])
    setExiting(false)
    setPhase('playing')
  }

  const nextFreePuzzle = () => {
    // history を同じレンダーで即座に破棄しておく。そうしないと次のパズルの生成が
    // 終わるまでの一瞬「前の問題のクリア済み盤面」が board として見え、
    // クリア判定のuseEffectが誤発火して即座に結果画面へ戻ってしまう。
    setHistory(null)
    setFreeIndex((i) => i + 1)
    setPhase('playing')
  }

  // ---------------- ドラッグ操作 ----------------
  const onPieceDown = useCallback(
    (piece: Piece, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (phase !== 'playing' || exiting || !board) return
      const rect = boardRef.current?.getBoundingClientRect()
      if (!rect) return
      const cellPx = rect.width / GRID
      const origin = piece.dir === 'h' ? piece.col : piece.row
      const positions = [origin, ...legalMoves(board).filter((m) => m.id === piece.id).map((m) => m.to)]
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({
        id: piece.id,
        axis: piece.dir === 'h' ? 'col' : 'row',
        origin,
        min: Math.min(...positions),
        max: Math.max(...positions),
        cellPx,
        startClientX: e.clientX,
        startClientY: e.clientY,
        current: origin,
      })
    },
    [board, phase, exiting],
  )

  const onPieceMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d
      const deltaPx = d.axis === 'col' ? e.clientX - d.startClientX : e.clientY - d.startClientY
      const deltaCells = deltaPx / d.cellPx
      const current = Math.min(Math.max(d.origin + deltaCells, d.min), d.max)
      return { ...d, current }
    })
  }, [])

  const onPieceUp = useCallback(() => {
    setDrag((d) => {
      if (!d) return null
      const to = Math.round(d.current)
      if (to !== d.origin) commitMove(d.id, to)
      return null
    })
  }, [commitMove])

  const renderBoard = (interactive: boolean) => (
    <>
      {/* 出口の矢印は盤面の外側(overflow:hiddenの外)に置き、クリア演出で切り抜かれないようにする */}
      <div className="g-jam-exit-slot" aria-hidden />
      <div className="g-jam-board" ref={boardRef}>
        {(board ?? []).map((p) => {
          const isDragging = drag?.id === p.id
          const dragOffsetPx = isDragging ? (drag!.current - drag!.origin) * drag!.cellPx : 0
          const style = {
            '--r': p.row,
            '--c': p.col,
            '--len': p.len,
            transform: isDragging
              ? p.dir === 'h'
                ? `translateX(${dragOffsetPx}px)`
                : `translateY(${dragOffsetPx}px)`
              : undefined,
          } as CSSProperties
          return (
            <button
              key={p.id}
              type="button"
              className={
                'g-jam-piece' +
                ` g-jam-piece-${p.dir}` +
                ` g-jam-piece-len${p.len}` +
                (p.isTarget ? ' target' : '') +
                (isDragging ? ' dragging' : '') +
                (exiting && p.isTarget ? ' exit' : '')
              }
              style={style}
              onPointerDown={interactive ? (e) => onPieceDown(p, e) : undefined}
              onPointerMove={interactive ? onPieceMove : undefined}
              onPointerUp={interactive ? onPieceUp : undefined}
              onPointerCancel={interactive ? onPieceUp : undefined}
              disabled={!interactive}
              aria-label={p.isTarget ? '今日の一着(ターゲット)' : '服の束'}
            >
              {p.isTarget && displayOutfit && (
                <img className="g-jam-piece-photo" src={thumb(displayOutfit.images[0].url, 200)} alt="" />
              )}
            </button>
          )
        })}
      </div>
    </>
  )

  // ---------------- setup ----------------
  if (phase === 'setup') {
    return (
      <main className="g-setup">
        <div className="g-setup-card">
          <div className="game-nav">
            <button className="game-back jp" onClick={onBack}>
              ← ゲームを選ぶ
            </button>
            <GameShareButton game="jam" title="満員クローゼット" />
          </div>
          <h2 className="g-setup-title jp">満員クローゼット</h2>
          <p className="g-setup-lead jp">
            ぎゅうぎゅうのクローゼットから、<b>今日の一着</b>をスライドさせて取り出そう。
            横向きの束は左右、縦向きの束は上下にしか動かせない。
          </p>
          <ul className="g-rules jp">
            <li>ピースをドラッグしてスライド。1つ動かすごとに1手</li>
            <li>ターゲット(写真つき)を右端の出口まで出せたらクリア</li>
            <li>
              最短手数(パー)<b className="g-pt">以内</b>でクリアすると★
            </li>
          </ul>

          <div className="g-jam-mode-tabs">
            <button
              className={mode === 'daily' ? 'chip active' : 'chip'}
              onClick={() => setMode('daily')}
            >
              デイリー
            </button>
            <button className={mode === 'free' ? 'chip active' : 'chip'} onClick={() => setMode('free')}>
              フリー
            </button>
          </div>

          {mode === 'daily' ? (
            <p className="g-jam-daily-info jp">
              今日 <span className="mono">{dailyDateLabel}</span> の1問。むずかしさは「
              {DIFFICULTY_LABEL[DAILY_DIFFICULTY]}」固定。
              {dailyOutfit
                ? ' クリアすると、この日実際に着ていた一着がわかります。'
                : ' この日と同じ月日の記録はまだありません。'}
            </p>
          ) : (
            <div className="g-setup-row">
              <span className="g-setup-label jp">むずかしさ</span>
              <div className="g-num-pick">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    className={freeDifficulty === d ? 'chip active' : 'chip'}
                    onClick={() => {
                      setFreeDifficulty(d)
                      setFreeIndex(0)
                    }}
                  >
                    <span className="jp">{DIFFICULTY_LABEL[d]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="g-start jp" onClick={startPlaying} disabled={!puzzle}>
            {puzzle ? 'ゲーム開始' : '準備中…'}
          </button>
        </div>
      </main>
    )
  }

  // ---------------- cleared ----------------
  if (phase === 'cleared') {
    const showReveal = mode === 'daily' && dailyOutfit != null
    return (
      <main className="g-finished">
        <div className="g-setup-card">
          <h2 className="g-setup-title jp">クリア！</h2>
          <p className="g-jam-clear-summary jp">
            手数 <span className="mono">{moveCount}</span> ／ パー <span className="mono">{par}</span>
            {withinPar && (
              <span className="g-jam-star mono" aria-label="パー以内クリア">
                {' '}
                ★
              </span>
            )}
          </p>
          {withinPar && <p className="g-jam-clear-note jp">パー以内クリア！</p>}

          {showReveal && dailyOutfit && (
            <>
              <h3 className="g-quiz-result-heading jp">この日kokiはこれで出勤しました</h3>
              <div className="g-jam-reveal-card">
                <img
                  className="g-jam-reveal-img"
                  src={thumb(dailyOutfit.images[0].url, 400)}
                  alt={dailyOutfit.title}
                />
                <div className="g-jam-reveal-body">
                  <div className="g-jam-reveal-title jp">{dailyOutfit.title}</div>
                  <div className="g-jam-reveal-date mono">{fmtDate(dailyOutfit.date)}</div>
                  <a
                    className="g-jam-reveal-link jp"
                    href={dailyOutfit.noteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    noteで見る →
                  </a>
                </div>
              </div>
            </>
          )}

          <div className="g-finished-actions">
            {mode === 'free' ? (
              <>
                <button className="g-start jp" onClick={nextFreePuzzle}>
                  次の問題
                </button>
                <button className="chip jp" onClick={retrySame}>
                  もう一度
                </button>
              </>
            ) : (
              <button className="g-start jp" onClick={retrySame}>
                もう一度
              </button>
            )}
            <button className="chip jp" onClick={onBack}>
              ゲームを選ぶ
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ---------------- playing ----------------
  return (
    <main className="g-play g-jam-play">
      <div className="game-nav">
        <button className="game-back jp" onClick={() => setPhase('setup')}>
          ← やめる
        </button>
        <GameShareButton game="jam" title="満員クローゼット" />
      </div>

      {!board ? (
        <div className="g-jam-board-wrap">
          <p className="g-jam-generating jp">
            盤面を準備中…
            <br />
            むずかしい問題は数秒かかることがあります
          </p>
        </div>
      ) : (
        <>
          <div className="g-jam-info-bar">
            <span className="g-jam-mode-tag mono">{mode === 'daily' ? 'DAILY' : 'FREE'}</span>
            <span className="g-jam-diff-tag jp">{DIFFICULTY_LABEL[difficulty]}</span>
            <span className="g-jam-moves jp">
              手数 <span className="mono">{moveCount}</span>
              <span className="g-jam-moves-sep">／</span>パー <span className="mono">{par}</span>
            </span>
          </div>

          <div className="g-jam-board-wrap">{renderBoard(true)}</div>

          <div className="g-jam-controls">
            <button className="chip jp" onClick={resetBoard} disabled={moveCount === 0}>
              はじめから
            </button>
            <button className="chip jp" onClick={undo} disabled={moveCount === 0}>
              1手戻す
            </button>
          </div>
        </>
      )}
    </main>
  )
}
