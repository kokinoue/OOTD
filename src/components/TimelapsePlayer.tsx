import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtDate, thumb } from '../lib/useData'

export type TimelapseFrame = {
  key: string
  no: number | null
  date: string // YYYY-MM-DD
  url: string
  items: string
  like: number
}

const SPEEDS = [
  { label: 'ゆっくり', ms: 400 },
  { label: 'ふつう', ms: 140 },
  { label: 'はやい', ms: 70 },
] as const

const IMG_WIDTH = 900
const PRELOAD_AHEAD = 12
const KEEP_BEHIND = 20

const seasonColor = (month: number) =>
  month === 12 || month <= 2
    ? '#8fb8e8' // 冬
    : month <= 5
      ? '#f0b3c9' // 春
      : month <= 8
        ? '#8ecf9a' // 夏
        : '#eab57e' // 秋

type Props = {
  frames: TimelapseFrame[] // 時系列昇順
  onClose: () => void
}

export default function TimelapsePlayer({ frames, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [msPerFrame, setMsPerFrame] = useState<number>(SPEEDS[1].ms)
  const cache = useRef(new Map<number, HTMLImageElement>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const load = useCallback(
    (i: number) => {
      if (i < 0 || i >= frames.length || cache.current.has(i)) return
      const img = new Image()
      img.src = thumb(frames[i].url, IMG_WIDTH)
      cache.current.set(i, img)
    },
    [frames],
  )

  // 先読みと後方の解放
  useEffect(() => {
    for (let i = index; i <= index + PRELOAD_AHEAD; i++) load(i)
    for (const k of cache.current.keys()) {
      if (k < index - KEEP_BEHIND || k > index + PRELOAD_AHEAD * 4) cache.current.delete(k)
    }
  }, [index, load])

  // 再生ループ。次フレームが未ロードなら進めずに待つ
  useEffect(() => {
    if (!playing) return
    const tick = () => {
      setIndex((cur) => {
        if (cur >= frames.length - 1) {
          setPlaying(false)
          return cur
        }
        const next = cache.current.get(cur + 1)
        if (next && !next.complete) {
          timer.current = setTimeout(tick, 60) // ロード待ち
          return cur
        }
        timer.current = setTimeout(tick, msPerFrame)
        return cur + 1
      })
    }
    timer.current = setTimeout(tick, msPerFrame)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [playing, msPerFrame, frames.length])

  // キーボード操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => (index >= frames.length - 1 && !p ? (setIndex(0), true) : !p))
      }
      if (e.key === 'ArrowLeft') {
        setPlaying(false)
        setIndex((i) => Math.max(0, i - 1))
      }
      if (e.key === 'ArrowRight') {
        setPlaying(false)
        setIndex((i) => Math.min(frames.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frames.length, index])

  // 季節グラデーションのタイムライン背景
  const gradient = useMemo(() => {
    if (frames.length === 0) return ''
    const stops: string[] = []
    let prevColor = ''
    frames.forEach((f, i) => {
      const color = seasonColor(Number(f.date.slice(5, 7)))
      const pct = (i / (frames.length - 1 || 1)) * 100
      if (color !== prevColor) {
        if (prevColor) stops.push(`${prevColor} ${pct.toFixed(2)}%`)
        stops.push(`${color} ${pct.toFixed(2)}%`)
        prevColor = color
      }
    })
    stops.push(`${prevColor} 100%`)
    return `linear-gradient(to right, ${stops.join(', ')})`
  }, [frames])

  // 年の境界マーカー
  const yearMarks = useMemo(() => {
    const marks: { year: string; pct: number }[] = []
    let prev = ''
    frames.forEach((f, i) => {
      const y = f.date.slice(0, 4)
      if (y !== prev) {
        marks.push({ year: y, pct: (i / (frames.length - 1 || 1)) * 100 })
        prev = y
      }
    })
    return marks
  }, [frames])

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setIndex(Math.round(ratio * (frames.length - 1)))
  }

  const frame = frames[index]
  const prevFrame = index > 0 ? frames[index - 1] : null
  const totalSec = Math.round((frames.length * msPerFrame) / 1000)

  return (
    <dialog ref={ref} className="tl" onClose={onClose}>
      <div className="tl-stage" onClick={() => setPlaying((p) => !p)}>
        {prevFrame && (
          <img className="tl-img" src={thumb(prevFrame.url, IMG_WIDTH)} alt="" draggable={false} />
        )}
        <img
          key={frame.key}
          className="tl-img tl-fade"
          src={thumb(frame.url, IMG_WIDTH)}
          alt={frame.date}
          draggable={false}
        />
      </div>

      <header className="tl-hud-top">
        <div>
          <div className="tl-date mono">{fmtDate(frame.date)}</div>
          {frame.no != null && <div className="tl-no mono">#{frame.no}</div>}
        </div>
        <div className="tl-hud-right">
          <span className="tl-like mono">♡ {frame.like}</span>
          <button className="icon-btn tl-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
      </header>

      <footer className="tl-hud-bottom">
        <p className="tl-items mono">{frame.items}</p>
        <div className="tl-controls">
          <button
            className="tl-play"
            onClick={() => {
              if (!playing && index >= frames.length - 1) setIndex(0)
              setPlaying((p) => !p)
            }}
            aria-label={playing ? '一時停止' : '再生'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="tl-speeds">
            {SPEEDS.map((s) => (
              <button
                key={s.ms}
                className={msPerFrame === s.ms ? 'chip sm active' : 'chip sm'}
                onClick={() => setMsPerFrame(s.ms)}
              >
                <span className="jp">{s.label}</span>
              </button>
            ))}
          </span>
          <span className="tl-counter mono">
            {index + 1} / {frames.length}
            <span className="tl-total jp">（全{totalSec}秒）</span>
          </span>
        </div>
        <div
          className="tl-timeline"
          style={{ background: gradient }}
          onPointerDown={(e) => {
            setPlaying(false)
            e.currentTarget.setPointerCapture(e.pointerId)
            seek(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) seek(e)
          }}
        >
          {yearMarks.map((m) => (
            <span key={m.year} className="tl-year mono" style={{ left: `${m.pct}%` }}>
              {m.year}
            </span>
          ))}
          <span
            className="tl-cursor"
            style={{ left: `${(index / (frames.length - 1 || 1)) * 100}%` }}
          />
        </div>
      </footer>
    </dialog>
  )
}
