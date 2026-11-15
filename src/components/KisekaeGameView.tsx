import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import cutoutsJson from '../data/cutouts.json'
import GameShareButton from './GameShareButton'
import { useI18n } from '../lib/i18n'
import {
  analyzeSprite,
  anchorOf,
  BANDS,
  buildLanes,
  buildSources,
  cellOffset,
  judge,
  LANE_DIR,
  LANE_SIZE,
  LANES,
  laneSpeed,
  loadBest,
  NEEDED,
  PAIR_POINTS,
  pickCandidates,
  rankOf,
  ROUNDS,
  saveBest,
  stopTarget,
  wrapIndex,
  type Anchors,
  type Judgement,
  type LaneId,
  type Lanes,
  type PairId,
  type Pick,
  type Source,
} from '../lib/kisekae'
import type { CutoutsFile } from '../lib/platform'
import { saveImageFile } from '../lib/share'
import { fmtDate, outfits } from '../lib/useData'
import type { Data } from '../lib/useData'
import { weather } from '../lib/weather'

// きせかえ: 顔は固定。トップス・ボトムス・靴が横に流れてくるので、上から1つずつ止めてコーデを作る。
// ルールと採点は lib/kisekae.ts（純粋ロジック）。ここは描画（DOM + transform）と入力とUI。
//
// パーツは1枚のくり抜きスプライトを帯ごとの窓からのぞかせているだけで、画像は切り分けていない。
// レーンの位置は毎フレーム変わるので React の state には載せず、ref に持って transform を直接書く。
// 目押しのタイミングが大事なので、ストップは click（指を離したとき）ではなく
// pointerdown（触れた瞬間）で反応させる。

const cutouts = cutoutsJson as CutoutsFile

type Props = {
  data: Data
  onBack: () => void
}

type Phase = 'loading' | 'play' | 'result' | 'final' | 'empty'
type Band = 'head' | LaneId
type Made = { faceKey: string; pick: Pick; judgement: Judgement }
type Motion = {
  pos: number // 中央にあるコマ番号（小数）
  mode: 'spin' | 'settle' | 'still'
  speed: number
  from: number
  to: number
  t0: number
}

const BAND_ORDER: readonly Band[] = ['head', ...LANES]
const LANE_LABEL: Record<LaneId, string> = { top: 'トップス', bottom: 'ボトムス', shoes: '靴' }
const LANE_TAG: Record<LaneId, string> = { top: 'TOPS', bottom: 'BOTTOMS', shoes: 'SHOES' }

const PITCH_RATIO = 0.5 // コマの幅（身長に対する割合）
const MIN_VISIBLE = 2 // 狭い画面でも、流れてくる次のパーツが見えるだけのコマ数を確保する
const MAX_FIGURE_H = 460
const MIN_FIGURE_H = 220
const BELOW_STAGE = 196 // ステージの下に残しておく高さ（ストップボタンと余白）
const START_GUARD_MS = 300 // 流れ始めた直後の押し間違いを拾わない
const SETTLE_MS = 240 // 止まるときにコマの中心へ寄る時間
const RESULT_DELAY_MS = 560 // 靴が止まってから判定を出すまでの間

const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

// ---- スプライトの読み込みと解析（画像ごとに1回だけ） ----

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()
const anchorCache = new Map<string, Promise<Anchors | null>>()
/** 解析が済んだスプライトの軸。描画時に同期で引く */
const anchors = new Map<string, Anchors>()

function loadImage(key: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(key)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = spriteUrl(key)
    })
    imageCache.set(key, p)
  }
  return p
}

function loadAnchors(key: string): Promise<Anchors | null> {
  let p = anchorCache.get(key)
  if (!p) {
    p = loadImage(key).then((img) => {
      if (!img) return null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const g = canvas.getContext('2d', { willReadFrequently: true })
        if (!g) return null
        g.drawImage(img, 0, 0)
        const px = g.getImageData(0, 0, canvas.width, canvas.height)
        const a = analyzeSprite(px.data, px.width, px.height)
        anchors.set(key, a)
        return a
      } catch {
        return null
      }
    })
    anchorCache.set(key, p)
  }
  return p
}

/** 帯の境目（px）。端数で継ぎ目にすき間が出ないよう整数にそろえる */
function bandEdges(h: number): number[] {
  return [0, Math.round(BANDS.top[0] * h), Math.round(BANDS.bottom[0] * h), Math.round(BANDS.shoes[0] * h), h]
}

const easeOutBack = (k: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // 振動に対応していない端末では何もしない
  }
}

/** 帯の窓からのぞかせるスプライト。centerX は窓の中での体の中心 */
function PartImg({ id, band, h, centerX }: { id: string; band: Band; h: number; centerX: number }) {
  const a = anchors.get(id)
  const top = bandEdges(h)[BAND_ORDER.indexOf(band)]
  const scale = h / cutouts.spriteHeight
  const style: CSSProperties = {
    height: h,
    top: -top,
    left: a ? centerX - anchorOf(a, band) * scale : 0,
    visibility: a ? 'visible' : 'hidden',
  }
  return <img className="kk-img" src={spriteUrl(id)} alt="" draggable={false} style={style} />
}

/** できあがったコーデの立ち姿（結果一覧用の小さい版） */
function Figure({ faceKey, pick, h }: { faceKey: string; pick: Pick; h: number }) {
  const edges = bandEdges(h)
  const w = Math.round(h * 0.52)
  return (
    <div className="kk-figure" style={{ width: w, height: h }}>
      {BAND_ORDER.map((band, k) => (
        <div key={band} className="kk-figure-band" style={{ top: edges[k], height: edges[k + 1] - edges[k] }}>
          <PartImg id={band === 'head' ? faceKey : pick[band].key} band={band} h={h} centerX={w / 2} />
        </div>
      ))}
    </div>
  )
}

/** できたコーデを1枚の画像にする */
async function outfitImage(made: Made, caption: string, sub: string): Promise<File | null> {
  const W = 720
  const H = 1040
  const FIG_H = 800
  const TOP = 56
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#f3f0e8'
  g.fillRect(0, 0, W, H)
  g.fillStyle = 'rgba(0, 0, 0, 0.1)'
  g.beginPath()
  g.ellipse(W / 2, TOP + FIG_H - 6, 150, 16, 0, 0, Math.PI * 2)
  g.fill()
  const scale = FIG_H / cutouts.spriteHeight
  const edges = bandEdges(cutouts.spriteHeight)
  for (const [k, band] of BAND_ORDER.entries()) {
    const key = band === 'head' ? made.faceKey : made.pick[band].key
    const img = await loadImage(key)
    const a = anchors.get(key)
    if (!img || !a) return null
    const sy = edges[k]
    const sh = edges[k + 1] - sy
    g.drawImage(
      img,
      0,
      sy,
      img.naturalWidth,
      sh,
      W / 2 - anchorOf(a, band) * scale,
      TOP + sy * scale,
      img.naturalWidth * scale,
      sh * scale,
    )
  }
  const sans = '"Outfit", "Hiragino Sans", "Noto Sans JP", sans-serif'
  g.textAlign = 'center'
  g.fillStyle = '#161616'
  g.font = `600 46px ${sans}`
  g.fillText(caption, W / 2, 944)
  g.fillStyle = '#7d7a72'
  g.font = `400 22px ${sans}`
  g.fillText(sub, W / 2, 990)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], 'kisekae.png', { type: 'image/png' }) : null
}

export default function KisekaeGameView({ data, onBack }: Props) {
  const { t } = useI18n()

  const sources = useMemo(
    () =>
      buildSources(
        outfits,
        data.outfitItemIds,
        (id) => data.itemMap.get(id)?.category,
        (date) => weather[date]?.max,
        cutouts.sprites,
        cutouts.spriteHeight,
      ),
    [data],
  )
  const itemSets = useMemo(() => [...data.outfitItemIds.values()], [data])

  const [phase, setPhase] = useState<Phase>('loading')
  const [round, setRound] = useState(0)
  const [lanes, setLanes] = useState<Lanes | null>(null)
  const [faceKey, setFaceKey] = useState<string | null>(null)
  const [picks, setPicks] = useState<Partial<Pick>>({})
  const [made, setMade] = useState<Made[]>([])
  const [best, setBest] = useState(loadBest)
  const [newBest, setNewBest] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [size, setSize] = useState({ h: 320, pitch: 160 })

  const stageRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Record<LaneId, (HTMLDivElement | null)[]>>({ top: [], bottom: [], shoes: [] })
  const motion = useRef<Record<LaneId, Motion>>({
    top: { pos: 0, mode: 'still', speed: 0, from: 0, to: 0, t0: 0 },
    bottom: { pos: 0, mode: 'still', speed: 0, from: 0, to: 0, t0: 0 },
    shoes: { pos: 0, mode: 'still', speed: 0, from: 0, to: 0, t0: 0 },
  })
  const pitchRef = useRef(size.pitch)
  const token = useRef(0) // 進行中の読み込みを、あとから始めた読み込みで打ち切るための番号
  const startedAt = useRef(0)
  const resultTimer = useRef<number>()
  const stopped = LANES.filter((lane) => picks[lane]).length

  // ---- 大きさ: 画面の高さと幅から身長を決める ----
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const byHeight = window.innerHeight - top - BELOW_STAGE
      const byWidth = el.clientWidth / (PITCH_RATIO * MIN_VISIBLE)
      const h = Math.round(Math.max(MIN_FIGURE_H, Math.min(MAX_FIGURE_H, byHeight, byWidth)))
      const pitch = Math.round(h * PITCH_RATIO)
      setSize((cur) => (cur.h === h && cur.pitch === pitch ? cur : { h, pitch }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [phase === 'empty' || phase === 'final'])

  // ---- レーンの位置を DOM に書く ----
  const place = useCallback((lane: LaneId) => {
    const cells = cellRefs.current[lane]
    const pos = motion.current[lane].pos
    for (let i = 0; i < cells.length; i++) {
      const el = cells[i]
      if (el) el.style.transform = `translate3d(${(cellOffset(i, pos, cells.length) * pitchRef.current).toFixed(1)}px,0,0)`
    }
  }, [])

  useLayoutEffect(() => {
    pitchRef.current = size.pitch
    for (const lane of LANES) place(lane)
  }, [lanes, size, place])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      for (const lane of LANES) {
        const m = motion.current[lane]
        if (m.mode === 'still') continue
        if (m.mode === 'spin') {
          m.pos += LANE_DIR[lane] * m.speed * dt
        } else {
          const k = Math.min(1, (now - m.t0) / SETTLE_MS)
          m.pos = m.from + (m.to - m.from) * easeOutBack(k)
          if (k >= 1) {
            m.pos = m.to
            m.mode = 'still'
          }
        }
        place(lane)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [place])

  // ---- ラウンドの開始: 候補をひいて画像を解析し、使えるものでレーンを組む ----
  const startRound = useCallback(
    async (index: number) => {
      const my = ++token.current
      window.clearTimeout(resultTimer.current)
      setPhase('loading')
      setRound(index)
      setPicks({})
      setSaveMsg('idle')
      let usable: Source[] = []
      for (let attempt = 0; attempt < 4 && usable.length < NEEDED; attempt++) {
        const cands = pickCandidates(sources, Math.random, NEEDED + 9)
        const analyzed = await Promise.all(cands.map((c) => loadAnchors(c.key)))
        if (my !== token.current) return
        usable = cands.filter((_, i) => analyzed[i]?.ok)
      }
      const built = buildLanes(usable, Math.random)
      if (!built) {
        setPhase('empty')
        return
      }
      for (const lane of LANES) {
        motion.current[lane] = {
          pos: Math.random() * LANE_SIZE,
          mode: 'spin',
          speed: laneSpeed(index, lane),
          from: 0,
          to: 0,
          t0: 0,
        }
      }
      startedAt.current = performance.now()
      setLanes(built)
      setPhase('play')
    },
    [sources],
  )

  // 顔はいちばん新しい出勤服から。使えない絵（傘など）なら次に新しいものへ
  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const s of sources.slice(0, 40)) {
        const a = await loadAnchors(s.key)
        if (!alive) return
        if (a?.ok) {
          setFaceKey(s.key)
          return
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [sources])

  useEffect(() => {
    if (sources.length < NEEDED) {
      setPhase('empty')
      return
    }
    void startRound(0)
    return () => {
      token.current++
      window.clearTimeout(resultTimer.current)
    }
  }, [sources, startRound])

  const changeFace = async () => {
    for (let i = 0; i < 12; i++) {
      const s = sources[Math.floor(Math.random() * sources.length)]
      if (s.key === faceKey) continue
      const a = await loadAnchors(s.key)
      if (a?.ok) {
        setFaceKey(s.key)
        return
      }
    }
  }

  // ---- ストップ ----
  const press = () => {
    if (phase !== 'play' || !lanes || !faceKey) return
    const lane = LANES[stopped]
    if (!lane) return
    const now = performance.now()
    if (now - startedAt.current < START_GUARD_MS) return
    const m = motion.current[lane]
    if (m.mode !== 'spin') return
    m.mode = 'settle'
    m.from = m.pos
    m.to = stopTarget(m.pos)
    m.t0 = now
    const next = { ...picks, [lane]: lanes[lane][wrapIndex(m.to, LANE_SIZE)] }
    setPicks(next)
    vibrate(12)
    if (stopped + 1 < LANES.length) return
    const pick = next as Pick
    const judgement = judge(pick, itemSets)
    resultTimer.current = window.setTimeout(() => {
      setMade((list) => [...list, { faceKey, pick, judgement }])
      setPhase('result')
      if (judgement.perfect) vibrate([30, 40, 30, 40, 80])
    }, RESULT_DELAY_MS)
  }
  const pressRef = useRef(press)
  pressRef.current = press

  // キーボード: Space / Enter でストップ。判定が出たあとはボタンにフォーカスが移るので任せる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'A') {
        // ストップボタン自身は pointerdown でしか反応しないので、キーはここで拾う
        if (!(e.target as HTMLElement).classList.contains('kk-stop')) return
      }
      e.preventDefault()
      pressRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = made.reduce((sum, m) => sum + m.judgement.score, 0)
  const current = phase === 'result' ? made[made.length - 1] : null

  const next = () => {
    if (made.length >= ROUNDS) {
      if (total > best) {
        saveBest(total)
        setBest(total)
        setNewBest(true)
      }
      setPhase('final')
      return
    }
    void startRound(made.length)
  }

  const restart = () => {
    setMade([])
    setNewBest(false)
    void startRound(0)
  }

  const headlineOf = (j: Judgement) =>
    j.perfect
      ? '完全再現！'
      : j.score >= 70
        ? 'これは着てる'
        : j.score >= 45
          ? '着そう'
          : j.score >= 25
            ? '着るかもしれない'
            : 'たぶん着ない'

  const save = async () => {
    if (!current || saveMsg === 'saving') return
    setSaveMsg('saving')
    try {
      const file = await outfitImage(
        current,
        `${t('着そう度')} ${current.judgement.score}%`,
        `${t(headlineOf(current.judgement))} — ${t('きせかえ')} / ${t('出勤服アーカイブ')}`,
      )
      if (!file) throw new Error('no image')
      const result = await saveImageFile(file, { title: t('きせかえ') })
      setSaveMsg(result === 'cancelled' ? 'idle' : 'saved')
    } catch {
      setSaveMsg('error')
    }
  }

  const head = (
    <div className="kk-head">
      <button className="kk-back jp" onClick={onBack}>
        ← {t('ゲーム')}
      </button>
      <h2 className="kk-title jp">{t('きせかえ')}</h2>
      <GameShareButton game="kisekae" title="きせかえ" />
    </div>
  )

  if (phase === 'empty') {
    return (
      <main className="kk">
        <div className="kk-inner">
          {head}
          <p className="kk-empty jp">{t('パーツにできるくり抜き画像が足りません。')}</p>
        </div>
      </main>
    )
  }

  const edges = bandEdges(size.h)
  const stageStyle = { '--kk-h': `${size.h}px`, '--kk-pitch': `${size.pitch}px` } as CSSProperties
  const activeLane = phase === 'play' ? LANES[stopped] : undefined
  const ready = lanes != null && faceKey != null

  const itemLine = (src: Source, lane: LaneId) => {
    const item = data.itemMap.get(src.main[lane])
    return item ? `${item.category}: ${item.label}` : src.main[lane]
  }

  const PAIR_TEXT: Record<PairId, string> = {
    topBottom: 'この上下は、実際に{n}回着た組み合わせ',
    bottomShoes: 'このボトムスと靴は、実際に{n}回着た組み合わせ',
    topShoes: 'このトップスと靴は、実際に{n}回着た組み合わせ',
  }

  const facts = (m: Made): { text: string; points: string }[] => {
    const j = m.judgement
    if (j.perfect) {
      return [
        {
          text: t('3つとも {date} の出勤服。あの日の俺がそのまま立っている。', {
            date: fmtDate(m.pick.top.date),
          }),
          points: '100',
        },
      ]
    }
    const rows: { text: string; points: string }[] = []
    for (const id of Object.keys(PAIR_POINTS) as PairId[]) {
      if (j.pairs[id] > 0) rows.push({ text: t(PAIR_TEXT[id], { n: j.pairs[id] }), points: `+${PAIR_POINTS[id]}` })
    }
    if (rows.length === 0) rows.push({ text: t('どの組み合わせも、まだ一度も着ていない'), points: '+0' })
    const temps = LANES.map((lane) => m.pick[lane].tmax).filter((v): v is number => v != null)
    if (temps.length >= 2) {
      rows.push({
        text: t('着ていた日の最高気温は {min}℃〜{max}℃', {
          min: Math.round(Math.min(...temps)),
          max: Math.round(Math.max(...temps)),
        }),
        points: `+${j.season}`,
      })
    }
    return rows
  }

  return (
    <main className="kk">
      <div className="kk-inner">
        {head}

        <div className="kk-status">
          <span className="kk-round mono">
            ROUND {Math.min(round + 1, ROUNDS)}/{ROUNDS}
          </span>
          <span className="kk-pips" aria-hidden>
            {Array.from({ length: ROUNDS }, (_, i) => (
              <span key={i} className={'kk-pip mono' + (made[i] ? ' done' : i === round && phase !== 'final' ? ' now' : '')}>
                {made[i] ? made[i].judgement.score : '·'}
              </span>
            ))}
          </span>
          <span className="kk-total mono">
            {total}
            <small>/{ROUNDS * 100}</small>
          </span>
        </div>

        {phase === 'final' ? (
          <section className="kk-final">
            <p className="kk-final-label mono">TOTAL</p>
            <p className="kk-final-score mono">
              {total}
              <small>/{ROUNDS * 100}</small>
            </p>
            <h3 className="kk-rank jp">{t(rankOf(total).name)}</h3>
            <p className="kk-rank-note jp">{t(rankOf(total).note)}</p>
            <p className="kk-best mono">
              {newBest ? 'NEW BEST' : `BEST ${best}`}
            </p>
            <div className="kk-gallery">
              {made.map((m, i) => (
                <div key={i} className={'kk-gallery-item' + (m.judgement.perfect ? ' perfect' : '')}>
                  <Figure faceKey={m.faceKey} pick={m.pick} h={132} />
                  <span className="mono">{m.judgement.score}%</span>
                </div>
              ))}
            </div>
            <button className="kk-btn primary jp" onClick={restart} autoFocus>
              {t('もういちど')}
            </button>
          </section>
        ) : (
          <>
            <div
              ref={stageRef}
              className={'kk-stage' + (phase === 'result' ? ' is-result' : '') + (current?.judgement.perfect ? ' is-perfect' : '')}
              style={stageStyle}
            >
              {ready ? (
                <div className="kk-belt">
                  <div className="kk-column" aria-hidden />
                  <div className="kk-face" style={{ height: edges[1] }}>
                    <PartImg id={faceKey} band="head" h={size.h} centerX={size.pitch / 2} />
                  </div>
                  {LANES.map((lane, k) => (
                    <div
                      key={lane}
                      className={
                        'kk-lane' + (lane === activeLane ? ' is-active' : '') + (picks[lane] ? ' is-stopped' : '')
                      }
                      style={{ height: edges[k + 2] - edges[k + 1] }}
                    >
                      {lanes[lane].map((src, i) => (
                        <div
                          key={src.key}
                          ref={(el) => {
                            cellRefs.current[lane][i] = el
                          }}
                          className={'kk-cell' + (picks[lane]?.key === src.key ? ' is-picked' : '')}
                        >
                          <PartImg id={src.key} band={lane} h={size.h} centerX={size.pitch / 2} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="kk-loading jp">{t('読み込み中…')}</p>
              )}
              {ready && phase !== 'result' && (
                <button className="kk-face-btn jp" onClick={changeFace}>
                  {t('顔をかえる')}
                </button>
              )}
            </div>

            {current ? (
              <section className={'kk-result' + (current.judgement.perfect ? ' perfect' : '')} aria-live="polite">
                <div className="kk-result-top">
                  <p className="kk-score mono">
                    <small className="jp">{t('着そう度')}</small>
                    {current.judgement.score}
                    <span>%</span>
                  </p>
                  <p className="kk-headline jp">{t(headlineOf(current.judgement))}</p>
                </div>
                <ul className="kk-facts jp">
                  {facts(current).map((f) => (
                    <li key={f.text}>
                      <span>{f.text}</span>
                      <b className="mono">{f.points}</b>
                    </li>
                  ))}
                </ul>
                <ul className="kk-parts">
                  {LANES.map((lane) => (
                    <li key={lane}>
                      <span className="kk-part-tag mono">{LANE_TAG[lane]}</span>
                      <span className="kk-part-name">{itemLine(current.pick[lane], lane)}</span>
                      <span className="kk-part-date mono">{fmtDate(current.pick[lane].date)}</span>
                    </li>
                  ))}
                </ul>
                <div className="kk-actions">
                  <button className="kk-btn jp" onClick={save} disabled={saveMsg === 'saving'}>
                    {t(
                      saveMsg === 'saved'
                        ? '保存しました'
                        : saveMsg === 'error'
                          ? '保存できませんでした'
                          : '画像を保存',
                    )}
                  </button>
                  <button className="kk-btn primary jp" onClick={next} autoFocus>
                    {t(made.length >= ROUNDS ? '結果を見る →' : 'つぎのコーデ →')}
                  </button>
                </div>
              </section>
            ) : (
              <div className="kk-controls">
                <button
                  className="kk-stop jp"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    press()
                  }}
                  disabled={phase !== 'play' || !activeLane}
                >
                  <b>{activeLane ? t('{part}をとめる', { part: t(LANE_LABEL[activeLane]) }) : '…'}</b>
                  <small className="mono">STOP · SPACE</small>
                </button>
                <p className="kk-help jp">
                  {t('流れてくる服を上から順にとめて、kokiが着そうなコーデをつくる。同じ日の3つがそろえば完全再現。')}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
