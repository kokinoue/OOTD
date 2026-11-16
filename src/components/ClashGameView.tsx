import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  ARENA,
  createClashMatch,
  emptyClashInput,
  stepClashMatch,
  type ClashEvent,
  type ClashInput,
  type ClashKit,
  type FighterStats,
} from '../lib/clash'
import { createClashAudio, type ClashAudio } from '../lib/clashAudio'
import { CPU_LEVELS, CPU_PROFILES, createClashCpu, predictKo, type CpuLevel } from '../lib/clashCpu'
import { createClashRenderer, type ClashLook } from '../lib/clashRender'
import {
  CLASH_KITS,
  KIT_INFO,
  clashStats,
  clashType,
  pickClashRoster,
  type ClashType,
} from '../lib/clashRoster'
import { SEASON_COLOR, SEASON_LABEL, seasonOf } from '../lib/duel'
import { useI18n } from '../lib/i18n'
import { dominantColor, type CutoutsFile } from '../lib/platform'
import { colorBuckets, fmtDate, outfits, type Data } from '../lib/useData'
import GameShareButton from './GameShareButton'

type Props = {
  data: Data
  onBack: () => void
}

type Mode = 'cpu' | 'watch' | 'local'
type Screen = 'select' | 'play'

type ClashChara = ClashLook & {
  date: string
  color?: string
  stats: FighterStats
  type: ClashType
}

type SideStats = { damage: number; kos: number; combo: number; parries: number }
type MatchResult = {
  winner: 0 | 1
  timeUp: boolean
  seconds: number
  sides: [SideStats, SideStats]
}

const cutouts = cutoutsJson as CutoutsFile
const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`
const LEVEL_KEY = 'clash.level'
const BEST_KEY = 'clash.best'
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const LEVEL_LABEL: Record<CpuLevel, string> = {
  easy: 'EASY',
  normal: 'NORMAL',
  hard: 'HARD',
  oni: 'ONI',
}

const LEVEL_LEAD: Record<CpuLevel, string> = {
  easy: 'よく手が止まる。まずは操作に慣れたい人向け。',
  normal: '反撃を少しだけ読んでくる。ふつうに強い。',
  hard: '回避・ジャストガード・メテオまで使う。',
  oni: 'こちらの次の一手まで読んでくる。',
}

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

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できなくても遊べる。
  }
}

function buildRoster(data: Data): ClashChara[] {
  // outfits は新しい順。季節×代表色ごとに、いちばん新しい1着をファイターにする。
  const candidates = outfits
    .filter((outfit) => cutouts.sprites[outfit.key])
    .map((outfit) => {
      const ids = data.outfitItemIds.get(outfit.key)
      const sprite = cutouts.sprites[outfit.key]
      return {
        key: outfit.key,
        no: outfit.no,
        date: outfit.date,
        season: seasonOf(outfit.date),
        color: dominantColor([...(ids ?? [])].map((id) => data.itemMap.get(id)?.color)),
        ratio: sprite.w / sprite.h,
      }
    })
  return pickClashRoster(candidates).map((entry) => {
    const bucket = colorBuckets.find((item) => item.name === entry.color)
    const stats = clashStats(entry.season, entry.color)
    return {
      ...entry,
      accent: bucket?.swatch ?? SEASON_COLOR[entry.season],
      accentSoft: COLOR_SOFT[entry.color ?? ''] ?? '#ffffff',
      stats,
      type: clashType(stats),
    }
  })
}

export default function ClashGameView({ data, onBack }: Props) {
  const roster = useMemo(() => buildRoster(data), [data])
  const [screen, setScreen] = useState<Screen>('select')
  const [mode, setMode] = useState<Mode>('cpu')
  const [level, setLevel] = useState<CpuLevel>(() => {
    const stored = readStored<string>(LEVEL_KEY, 'normal')
    return CPU_LEVELS.includes(stored as CpuLevel) ? (stored as CpuLevel) : 'normal'
  })
  const [selected, setSelected] = useState<[number, number]>(() => {
    const rival = roster.findIndex((chara) => chara.season !== roster[0]?.season)
    return [0, rival > 0 ? rival : Math.min(1, roster.length - 1)]
  })
  const [picking, setPicking] = useState<0 | 1>(0)
  // CPU戦の相手は、選ばなければ毎試合おまかせ。
  const [foeAuto, setFoeAuto] = useState(true)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState<Partial<Record<CpuLevel, number>>>(() => readStored(BEST_KEY, {}))
  const [matchKey, setMatchKey] = useState(0)

  const randomFoe = useCallback(
    (first: number, avoid: number) => {
      if (roster.length < 2) return first
      const pool = roster.map((_, index) => index).filter((index) => index !== first && index !== avoid)
      const from = pool.length > 0 ? pool : roster.map((_, index) => index).filter((index) => index !== first)
      return from[Math.floor(Math.random() * from.length)]
    },
    [roster],
  )

  const changeLevel = (next: CpuLevel) => {
    setLevel(next)
    setStreak(0)
    writeStored(LEVEL_KEY, next)
  }

  const pick = (index: number) => {
    setSelected((current) => {
      const next: [number, number] = [...current]
      next[picking] = index
      return next
    })
    if (picking === 1) setFoeAuto(false)
    if (mode === 'local' && picking === 0) setPicking(1)
  }

  const start = () => {
    if (mode !== 'local' && foeAuto) {
      setSelected(([first, second]) => [first, randomFoe(first, second)])
    }
    setStreak(0)
    setMatchKey((key) => key + 1)
    setScreen('play')
  }

  const onResult = useCallback(
    (winner: 0 | 1) => {
      if (mode !== 'cpu') return
      if (winner !== 0) {
        setStreak(0)
        return
      }
      setStreak((current) => {
        const next = current + 1
        setBest((record) => {
          if ((record[level] ?? 0) >= next) return record
          const updated = { ...record, [level]: next }
          writeStored(BEST_KEY, updated)
          return updated
        })
        return next
      })
    },
    [level, mode],
  )

  // 対戦ループの effect はこの配列に依存する。毎回作り直すと、連勝数や表示言語が変わるたびに
  // 結果画面の裏で試合が最初から始まってしまうので、選択が変わったときだけ作り直す。
  const charas = useMemo<[ClashChara, ClashChara]>(
    () => [roster[selected[0]], roster[selected[1]]],
    [roster, selected],
  )

  if (roster.length < 2) {
    return (
      <main className="clash">
        <div className="clash-select">
          <button className="game-back jp" onClick={onBack}>
            ←
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="clash">
      {screen === 'select' ? (
        <ClashSelect
          roster={roster}
          selected={selected}
          picking={picking}
          mode={mode}
          level={level}
          foeAuto={foeAuto}
          best={best[level] ?? 0}
          onPick={pick}
          onPicking={setPicking}
          onMode={(next) => {
            setMode(next)
            setPicking(0)
          }}
          onLevel={changeLevel}
          onRandom={() => {
            if (mode === 'local') {
              const first = Math.floor(Math.random() * roster.length)
              setSelected([first, randomFoe(first, first)])
            } else {
              setFoeAuto(true)
              setPicking(0)
            }
          }}
          onStart={start}
          onBack={onBack}
        />
      ) : (
        <ClashPlay
          key={matchKey}
          charas={charas}
          mode={mode}
          level={level}
          streak={streak}
          best={best[level] ?? 0}
          onResult={onResult}
          onRematch={() => setMatchKey((key) => key + 1)}
          onNext={() => {
            setSelected(([first, second]) => [first, randomFoe(first, second)])
            setMatchKey((key) => key + 1)
          }}
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
  level,
  foeAuto,
  best,
  onPick,
  onPicking,
  onMode,
  onLevel,
  onRandom,
  onStart,
  onBack,
}: {
  roster: ClashChara[]
  selected: [number, number]
  picking: 0 | 1
  mode: Mode
  level: CpuLevel
  foeAuto: boolean
  best: number
  onPick: (index: number) => void
  onPicking: (slot: 0 | 1) => void
  onMode: (mode: Mode) => void
  onLevel: (level: CpuLevel) => void
  onRandom: () => void
  onStart: () => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [season, setSeason] = useState<ClashKit | 'all'>('all')
  const first = roster[selected[0]]
  const second = roster[selected[1]]
  const sides: [string, string] =
    mode === 'local' ? ['P1', 'P2'] : mode === 'watch' ? ['CPU 1', 'CPU 2'] : ['P1', 'CPU']
  const hiddenFoe = mode !== 'local' && foeAuto
  return (
    <div className="clash-select">
      <div className="game-nav clash-nav">
        <button className="game-back jp" onClick={onBack}>
          {t('← ゲーム選択にもどる')}
        </button>
        <GameShareButton game="clash" title={t('着戦 KISEKAE CLASH')} />
      </div>

      <div className="clash-title-lockup">
        <span className="clash-kicker mono">OUTFIT PLATFORM FIGHTER</span>
        <h2 className="clash-title">
          <span className="jp">着戦</span>
          <span>KISEKAE CLASH</span>
        </h2>
        <p className="clash-lead jp">
          {t('ダメージをためて、ステージの外へ吹っ飛ばせ。先読みするCPUと戦う、3ストックの出勤服バトル。')}
        </p>
      </div>

      <div className="clash-match-options">
        <div className="clash-segment" role="group" aria-label={t('対戦モード')}>
          <button className={mode === 'cpu' ? 'active' : ''} onClick={() => onMode('cpu')}>
            <span className="mono">1P</span>
            <span className="jp">{t('CPU戦')}</span>
          </button>
          <button className={mode === 'watch' ? 'active' : ''} onClick={() => onMode('watch')}>
            <span className="mono">0P</span>
            <span className="jp">{t('観戦')}</span>
          </button>
          <button className={mode === 'local' ? 'active' : ''} onClick={() => onMode('local')}>
            <span className="mono">2P</span>
            <span className="jp">{t('2人で対戦')}</span>
          </button>
        </div>
        {mode !== 'local' && (
          <div className="clash-difficulty" role="group" aria-label={t('CPUの強さ')}>
            <span className="jp">CPU</span>
            {CPU_LEVELS.map((entry) => (
              <button
                key={entry}
                className={`${level === entry ? 'active' : ''}${entry === 'oni' ? ' oni' : ''}`}
                onClick={() => onLevel(entry)}
              >
                {LEVEL_LABEL[entry]}
              </button>
            ))}
          </div>
        )}
        <button className="clash-random jp" onClick={onRandom}>
          {mode === 'local' ? t('↻ おまかせ') : t('↻ 相手はおまかせ')}
        </button>
      </div>
      {mode !== 'local' && (
        <p className="clash-level-lead jp">
          <b className="mono">{LEVEL_LABEL[level]}</b>
          {t(LEVEL_LEAD[level])}
          {mode === 'cpu' && best > 0 && (
            <span className="clash-best mono">
              BEST {t('{count}連勝', { count: best })}
            </span>
          )}
        </p>
      )}

      <div className="clash-versus">
        <ChosenFighter chara={first} side={sides[0]} active={picking === 0} onClick={() => onPicking(0)} />
        <span className="clash-vs mono">VS</span>
        <ChosenFighter
          chara={second}
          side={sides[1]}
          active={picking === 1}
          hidden={hiddenFoe}
          right
          onClick={() => onPicking(1)}
        />
      </div>

      <div className="clash-roster-head">
        <span className="mono">{sides[picking]} SELECT</span>
        <span className="jp">{t('ファイターを選ぶ（全{count}着）', { count: roster.length })}</span>
        <span className="clash-roster-filter" role="group" aria-label={t('季節でしぼる')}>
          {(['all', ...CLASH_KITS] as const).map((entry) => (
            <button
              key={entry}
              className={`jp${season === entry ? ' active' : ''}`}
              onClick={() => setSeason(entry)}
            >
              {entry === 'all' ? t('すべて') : t(SEASON_LABEL[entry])}
            </button>
          ))}
        </span>
      </div>
      <div className="clash-roster">
        {roster.map((chara, index) => {
          if (season !== 'all' && chara.season !== season) return null
          const isFirst = selected[0] === index
          const isSecond = selected[1] === index && !hiddenFoe
          return (
            <button
              key={chara.key}
              className={`clash-roster-card${isFirst ? ' p1' : ''}${isSecond ? ' p2' : ''}`}
              style={{ '--fighter-color': chara.accent } as React.CSSProperties}
              onClick={() => onPick(index)}
            >
              <span className="clash-roster-season mono">{t(SEASON_LABEL[chara.season])}</span>
              <span className="clash-roster-figure">
                <img src={spriteUrl(chara.key)} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="clash-roster-no mono">LOOK #{chara.no ?? '—'}</span>
              <span className="clash-roster-type mono">{chara.type}</span>
              {(isFirst || isSecond) && (
                <span className="clash-roster-pick mono">
                  {isFirst ? sides[0] : ''}
                  {isFirst && isSecond ? ' · ' : ''}
                  {isSecond ? sides[1] : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <button className="clash-ready" onClick={onStart}>
        <span className="mono">READY TO CLASH</span>
        <span className="jp">{mode === 'watch' ? t('観戦をはじめる') : t('対戦をはじめる')}</span>
        <span aria-hidden="true">→</span>
      </button>

      <details className="clash-howto">
        <summary className="jp">{t('あそびかたと小技')}</summary>
        <ul className="jp">
          <li>
            <b>{t('吹っ飛ばし')}</b>
            {t('ダメージ（%）がたまるほど遠くへ飛ぶ。画面の外まで飛ばすと1ストック。')}
          </li>
          <li>
            <b>{t('攻撃')}</b>
            {t('方向を入れずに弱、左右で強、↑で打ち上げ、↓で足払い。空中の↓はメテオ（叩き落とし）。')}
          </li>
          <li>
            <b>{t('必殺技')}</b>
            {t('そのままで季節の技、左右で突進、↑で復帰。↑は着地するまで1回だけ。')}
          </li>
          <li>
            <b>{t('ガード')}</b>
            {t('押しっぱなしで盾。当たる直前に張るとジャストガードで相手がのけぞり、飛び道具は跳ね返る。')}
          </li>
          <li>
            <b>{t('回避')}</b>
            {t('ガード中に左右で転がり、↓でその場回避。空中ではガードボタンで空中回避。')}
          </li>
          <li>
            <b>{t('崖')}</b>
            {t('ステージの角には手がかかる。↑か内側でのぼり、ジャンプで跳びのり、攻撃でのぼり払い。')}
          </li>
        </ul>
      </details>
    </div>
  )
}

function ChosenFighter({
  chara,
  side,
  active,
  hidden = false,
  right = false,
  onClick,
}: {
  chara: ClashChara
  side: string
  active: boolean
  hidden?: boolean
  right?: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const kit = KIT_INFO[chara.season]
  return (
    <button
      className={`clash-chosen${right ? ' right' : ''}${active ? ' active' : ''}${hidden ? ' mystery' : ''}`}
      style={{ '--fighter-color': hidden ? '#9e7bff' : chara.accent } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="clash-chosen-side mono">{side}</span>
      <span className="clash-chosen-figure">
        {hidden ? (
          <span className="clash-chosen-unknown mono" aria-hidden="true">
            ?
          </span>
        ) : (
          <img src={spriteUrl(chara.key)} alt="" />
        )}
      </span>
      {hidden ? (
        <span className="clash-chosen-info">
          <span className="clash-chosen-name mono">RANDOM</span>
          <span className="clash-chosen-note jp">
            {t('相手は毎試合おまかせ。ここを押すと自分で選べる。')}
          </span>
        </span>
      ) : (
        <span className="clash-chosen-info">
          <span className="clash-chosen-name mono">LOOK #{chara.no ?? '—'}</span>
          <span className="clash-chosen-date mono">
            {fmtDate(chara.date)} · {t(SEASON_LABEL[chara.season])}
          </span>
          <span className="clash-chosen-type mono">{chara.type} TYPE</span>
          <span className="clash-chosen-special mono">SPECIAL · {kit.name}</span>
          <span className="clash-chosen-note jp">{t(kit.lead)}</span>
          <span className="clash-stat-list">
            <StatMeter label="SPD" value={chara.stats.speed} />
            <StatMeter label="JMP" value={chara.stats.jump + (chara.stats.airJumps - 1) * 0.12} />
            <StatMeter label="PWR" value={chara.stats.power} />
            <StatMeter label="WGT" value={chara.stats.weight} />
          </span>
        </span>
      )}
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
  shield: false,
  jumpEdge: false,
  attackEdge: false,
  specialEdge: false,
  shieldEdge: false,
})

/** 指が要素の外へ滑っても追い続ける。取れなくても操作そのものは通す。 */
function capturePointer(event: React.PointerEvent<HTMLElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // すでに離れたポインターなど。捕まえられなくても入力は受け付ける。
  }
}

/** 親指を置いたまま滑らせて向きを変えられるスティック。 */
function TouchStick({ touch, label }: { touch: React.MutableRefObject<TouchState>; label: string }) {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLSpanElement>(null)
  const pointer = useRef<number | null>(null)

  const apply = (event: React.PointerEvent) => {
    const base = baseRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const radius = rect.width / 2
    let dx = (event.clientX - (rect.left + radius)) / radius
    let dy = (event.clientY - (rect.top + radius)) / radius
    const length = Math.hypot(dx, dy)
    if (length > 1) {
      dx /= length
      dy /= length
    }
    const state = touch.current
    state.left = dx < -0.34
    state.right = dx > 0.34
    state.up = dy < -0.5
    state.down = dy > 0.5
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`
    }
  }
  const release = () => {
    pointer.current = null
    const state = touch.current
    state.left = state.right = state.up = state.down = false
    if (knobRef.current) knobRef.current.style.transform = ''
  }

  return (
    <div
      ref={baseRef}
      className="clash-stick"
      role="group"
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault()
        pointer.current = event.pointerId
        capturePointer(event)
        apply(event)
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId) apply(event)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span ref={knobRef} className="clash-stick-knob" />
    </div>
  )
}

function ClashPlay({
  charas,
  mode,
  level,
  streak,
  best,
  onResult,
  onRematch,
  onNext,
  onRoster,
}: {
  charas: [ClashChara, ClashChara]
  mode: Mode
  level: CpuLevel
  streak: number
  best: number
  onResult: (winner: 0 | 1) => void
  onRematch: () => void
  onNext: () => void
  onRoster: () => void
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const touchRef = useRef<TouchState>(emptyTouch())
  const audioRef = useRef<ClashAudio | null>(null)
  if (!audioRef.current) audioRef.current = createClashAudio()
  const [muted, setMuted] = useState(() => audioRef.current!.isMuted())
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const labels = useMemo<[string, string]>(
    () => (mode === 'local' ? ['P1', 'P2'] : mode === 'watch' ? ['CPU 1', 'CPU 2'] : ['P1', 'CPU']),
    [mode],
  )

  useEffect(() => {
    pausedRef.current = paused
    if (paused) audioRef.current?.pauseMusic()
    else audioRef.current?.resumeMusic()
  }, [paused])
  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement != null)
    // 画面を離れたら止める（戻ってきたら吹っ飛ばされていた、を防ぐ）。
    const onHidden = () => {
      if (document.hidden) setPaused(true)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])
  useEffect(() => () => audioRef.current?.close(), [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let scale = 1
    let viewHeight: number = ARENA.height

    const images = charas.map((chara) => {
      const image = new Image()
      image.src = spriteUrl(chara.key)
      return image
    }) as [HTMLImageElement, HTMLImageElement]
    const match = createClashMatch(charas[0].stats, charas[1].stats)
    const renderer = createClashRenderer({
      looks: charas,
      images,
      labels,
      // 相手のホームで戦う。
      stage: charas[1].season,
      calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    // 表示枠の縦横比に合わせて、論理的な縦の広さと解像度を決める。
    const fit = () => {
      const width = canvas.clientWidth || ARENA.width
      const height = canvas.clientHeight || ARENA.height
      viewHeight = clamp(Math.round((ARENA.width * height) / width), ARENA.height, 1100)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      scale = clamp((width * dpr) / ARENA.width, 0.5, 2)
      canvas.width = Math.round(ARENA.width * scale)
      canvas.height = Math.round(viewHeight * scale)
      renderer.resize(viewHeight, width < 520 ? 1.75 : width < 760 ? 1.3 : 1)
      // 解像度を変えるとキャンバスが消えるので、その場で描き直す。
      redraw?.()
    }
    let redraw: (() => void) | null = null
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    const profile = CPU_PROFILES[level]
    const cpus = [createClashCpu(0, profile), createClashCpu(1, profile)] as const
    const held: [ClashInput, ClashInput] = [emptyClashInput(), emptyClashInput()]
    const sides: [SideStats, SideStats] = [
      { damage: 0, kos: 0, combo: 0, parries: 0 },
      { damage: 0, kos: 0, combo: 0, parries: 0 },
    ]
    let lastEventId = 0
    let fightFrames = 0
    let raf = 0
    let resultTimer = 0
    let previous = performance.now()
    let accumulator = 0
    let time = 0
    const STEP = 1 / 60
    const audio = audioRef.current!

    const solo = mode !== 'local'
    const targetForKey = (event: KeyboardEvent): [0 | 1, keyof ClashInput | 'jumpOnly'] | null => {
      const key = event.key
      const lower = key.toLowerCase()
      if (lower === 'a') return [0, 'left']
      if (lower === 'd') return [0, 'right']
      if (lower === 'w') return [0, 'jumpHeld']
      if (key === ' ') return [0, 'jumpOnly']
      if (lower === 's') return [0, 'down']
      if (lower === 'j' || lower === 'z') return [0, 'attackPressed']
      if (lower === 'k' || lower === 'x') return [0, 'specialPressed']
      if (lower === 'l' || lower === 'c') return [0, 'shield']
      if (key === 'Shift' && solo) return [0, 'shield']
      // 1人で遊ぶときは矢印キーも P1 の移動に使える。
      const arrowPlayer: 0 | 1 = solo ? 0 : 1
      if (key === 'ArrowLeft') return [arrowPlayer, 'left']
      if (key === 'ArrowRight') return [arrowPlayer, 'right']
      if (key === 'ArrowUp') return [arrowPlayer, 'jumpHeld']
      if (key === 'ArrowDown') return [arrowPlayer, 'down']
      if (key === ',') return [1, 'attackPressed']
      if (key === '.') return [1, 'specialPressed']
      if (key === '/') return [1, 'shield']
      return null
    }
    const humanControls = (id: 0 | 1) => mode === 'local' || (mode === 'cpu' && id === 0)
    const onKeyDown = (event: KeyboardEvent) => {
      // ブラウザのショートカット（Cmd+L など）は奪わない。macOS は Cmd 中のキーの keyup を
      // 送らないので、拾ってしまうと押しっぱなしにもなる。
      if (event.metaKey || event.ctrlKey || event.altKey) return
      audio.unlock()
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
        if (!event.repeat) setPaused((current) => !current)
        event.preventDefault()
        return
      }
      const target = targetForKey(event)
      if (!target) return
      const [id, action] = target
      if (!humanControls(id)) return
      event.preventDefault()
      const input = held[id]
      if (action === 'jumpOnly') {
        input.jumpHeld = true
        if (!event.repeat) input.jumpPressed = true
      } else if (action === 'jumpHeld') {
        // ↑ はジャンプと上入力を兼ねる。踏み切り中に攻撃を押せば上攻撃になる。
        input.jumpHeld = true
        input.up = true
        if (!event.repeat) input.jumpPressed = true
      } else if (action === 'left' || action === 'right' || action === 'down') {
        input[action] = true
      } else if (action === 'shield') {
        input.shield = true
        if (!event.repeat) input.shieldPressed = true
      } else if (!event.repeat && (action === 'attackPressed' || action === 'specialPressed')) {
        input[action] = true
      }
    }
    const jumpKeys: [Set<string>, Set<string>] = [new Set(), new Set()]
    const trackJump = (event: KeyboardEvent, down: boolean) => {
      const target = targetForKey(event)
      if (!target) return
      const [id, action] = target
      if (action !== 'jumpOnly' && action !== 'jumpHeld') return
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
      if (down) jumpKeys[id].add(key)
      else jumpKeys[id].delete(key)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      trackJump(event, false)
      const target = targetForKey(event)
      if (!target) return
      const [id, action] = target
      // フォーカスの残ったボタンが、スペースを離した拍子に押されるのを防ぐ。
      if (humanControls(id)) event.preventDefault()
      const input = held[id]
      if (action === 'jumpOnly' || action === 'jumpHeld') {
        if (action === 'jumpHeld') input.up = false
        input.jumpHeld = jumpKeys[id].size > 0
      } else if (action === 'left' || action === 'right' || action === 'down' || action === 'shield') {
        input[action] = false
      }
    }
    const onKeyDownTracked = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) trackJump(event, true)
      onKeyDown(event)
    }
    const onBlur = () => {
      for (const input of held) Object.assign(input, emptyClashInput())
      jumpKeys[0].clear()
      jumpKeys[1].clear()
    }
    window.addEventListener('keydown', onKeyDownTracked)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

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

    const processEvent = (event: ClashEvent) => {
      audio.play(event)
      if (event.type === 'hit') {
        sides[event.attacker].damage += event.damage
        sides[event.attacker].combo = Math.max(sides[event.attacker].combo, event.combo)
        // 決まる一撃かどうかは、当たった瞬間に先読みで分かる。
        const lethal = predictKo(match, event.target)
        const final = lethal && match.fighters[event.target].stocks === 1
        renderer.onEvent(event, match, { lethal, final })
        if (lethal) audio.cue(final ? 'finish' : 'lethal')
        return
      }
      if (event.type === 'ko' && event.by != null) sides[event.by].kos += 1
      if (event.type === 'parry') sides[event.target].parries += 1
      renderer.onEvent(event, match)
      if (event.type === 'gameOver') {
        const playerWon = mode !== 'cpu' || event.winner === 0
        resultTimer = window.setTimeout(() => {
          audio.cue(playerWon ? 'win' : 'lose')
          onResultRef.current(event.winner)
          setResult({
            winner: event.winner,
            timeUp: event.timeUp,
            seconds: fightFrames / 60,
            sides,
          })
        }, 1900)
      }
    }

    const tick = () => {
      const firstInput = mode === 'watch' ? cpus[0].next(match) : readHuman(0)
      const secondInput = mode === 'local' ? readHuman(1) : cpus[1].next(match)
      stepClashMatch(match, [firstInput, secondInput], STEP)
      if (match.phase === 'fight') fightFrames += 1
      for (const event of match.events) {
        if (event.id <= lastEventId) continue
        lastEventId = event.id
        processEvent(event)
      }
    }

    const draw = () => {
      context.setTransform(scale, 0, 0, scale, 0, 0)
      renderer.render(context, match, time)
    }
    redraw = draw
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const frameDt = Math.min(0.08, (now - previous) / 1000)
      previous = now
      if (!pausedRef.current) {
        time += frameDt
        let simDt = 0
        if (!renderer.holding()) {
          accumulator += frameDt * renderer.timeScale()
          while (accumulator >= STEP) {
            tick()
            accumulator -= STEP
            simDt += STEP
            if (renderer.holding()) {
              accumulator = 0
              break
            }
          }
        }
        renderer.update(match, frameDt, simDt)
      }
      draw()
    }
    raf = requestAnimationFrame(frame)

    if (import.meta.env.DEV) {
      // 開発時の確認用。コンソールから試合を早送りして状態を読める。
      ;(window as unknown as { __clash?: unknown }).__clash = {
        match,
        renderer,
        step: (frames: number) => {
          for (let i = 0; i < frames; i++) {
            tick()
            renderer.update(match, STEP, STEP)
            time += STEP
          }
          draw()
        },
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.clearTimeout(resultTimer)
      window.removeEventListener('keydown', onKeyDownTracked)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [charas, labels, level, mode])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void shellRef.current?.requestFullscreen?.()
  }

  const touchButton = (key: 'jump' | 'attack' | 'special' | 'shield') => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      capturePointer(event)
      audioRef.current?.unlock()
      const touch = touchRef.current
      if (key === 'jump') {
        touch.jump = true
        touch.jumpEdge = true
      } else if (key === 'shield') {
        touch.shield = true
        touch.shieldEdge = true
      } else if (key === 'attack') touch.attackEdge = true
      else touch.specialEdge = true
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      if (key === 'jump') touchRef.current.jump = false
      if (key === 'shield') touchRef.current.shield = false
    },
    onPointerCancel: () => {
      if (key === 'jump') touchRef.current.jump = false
      if (key === 'shield') touchRef.current.shield = false
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  })

  const winnerChara = result ? charas[result.winner] : null
  const playerWon = result != null && (mode !== 'cpu' || result.winner === 0)
  const statRows: [string, (side: SideStats) => string | number][] = [
    [t('与えたダメージ'), (side) => `${side.damage}%`],
    [t('撃墜'), (side) => side.kos],
    [t('最大コンボ'), (side) => side.combo],
    [t('ジャストガード'), (side) => side.parries],
  ]

  return (
    <div
      ref={shellRef}
      className={`clash-play${fullscreen ? ' is-fullscreen' : ''}${mode === 'watch' ? ' is-watch' : ''}`}
      onPointerDownCapture={() => audioRef.current?.unlock()}
    >
      <div className="clash-playbar">
        <button className="clash-playbar-back jp" onClick={onRoster}>
          {t('← ファイター選択')}
        </button>
        <span className="clash-playbar-title mono">
          KISEKAE CLASH · {mode === 'local' ? '2P' : `CPU ${LEVEL_LABEL[level]}`}
          {mode === 'cpu' && streak > 0 ? ` · ${t('{count}連勝中', { count: streak })}` : ''}
        </span>
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
        {paused && result == null && (
          <div className="clash-pause">
            <span className="mono">PAUSED</span>
            <button className="jp" onClick={() => setPaused(false)}>
              {t('つづける')}
            </button>
          </div>
        )}
      </div>
      {result != null && winnerChara && (
        <div
          className={`clash-result${playerWon ? ' win' : ''}`}
          style={{ '--fighter-color': winnerChara.accent } as React.CSSProperties}
        >
          <div className="clash-result-hero">
            <img src={spriteUrl(winnerChara.key)} alt="" />
          </div>
          <div className="clash-result-body">
            <span className="clash-result-kicker mono">
              {result.timeUp ? 'TIME UP' : playerWon ? 'RUNWAY DOMINATED' : 'NEXT LOOK, NEXT FIGHT'}
            </span>
            <span className="clash-result-winner mono">{labels[result.winner]} WINS</span>
            <span className="clash-result-look mono">
              LOOK #{winnerChara.no ?? '—'} · {Math.round(result.seconds)}s
              {mode === 'cpu' && streak > 0 ? ` · ${t('{count}連勝中', { count: streak })}` : ''}
              {mode === 'cpu' && best > 0 ? ` · BEST ${best}` : ''}
            </span>
            <table className="clash-result-stats">
              <thead>
                <tr>
                  <th />
                  <th className="mono">{labels[0]}</th>
                  <th className="mono">{labels[1]}</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map(([name, read]) => (
                  <tr key={name}>
                    <th className="jp">{name}</th>
                    <td className="mono">{read(result.sides[0])}</td>
                    <td className="mono">{read(result.sides[1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="clash-result-actions">
              {mode === 'cpu' && result.winner === 0 ? (
                <button className="primary jp" onClick={onNext}>
                  {t('次の相手へ')}
                </button>
              ) : (
                <button className="primary jp" onClick={onRematch}>
                  {t('もう一戦')}
                </button>
              )}
              {mode === 'cpu' && result.winner === 0 && (
                <button className="jp" onClick={onRematch}>
                  {t('同じ相手ともう一戦')}
                </button>
              )}
              <button className="jp" onClick={onRoster}>
                {t('ファイター選択')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode !== 'watch' && (
        <div className="clash-touch">
          <TouchStick touch={touchRef} label={t('移動スティック')} />
          <div className="clash-pad">
            <button className="guard mono" aria-label={t('ガード')} {...touchButton('shield')}>
              <b>G</b>
              <small>GUARD</small>
            </button>
            <button className="special mono" aria-label={t('必殺技')} {...touchButton('special')}>
              <b>B</b>
              <small>SPECIAL</small>
            </button>
            <button className="jump mono" aria-label={t('ジャンプ')} {...touchButton('jump')}>
              <b>J</b>
              <small>JUMP</small>
            </button>
            <button className="attack mono" aria-label={t('攻撃')} {...touchButton('attack')}>
              <b>A</b>
              <small>ATTACK</small>
            </button>
          </div>
        </div>
      )}

      {mode !== 'watch' && (
        <div className="clash-controls">
          <span>
            <b className="mono">P1</b>
            <span className="jp">
              {mode === 'cpu'
                ? t('A D / ← → 移動 · W / ↑ / SPACE ジャンプ · S / ↓ しゃがみ · J 攻撃 · K 必殺 · L ガード')
                : t('A D 移動 · W / SPACE ジャンプ · S しゃがみ · J 攻撃 · K 必殺 · L ガード')}
            </span>
          </span>
          <span>
            <b className="mono">{mode === 'cpu' ? 'TECH' : 'P2'}</b>
            <span className="jp">
              {mode === 'cpu'
                ? t('直前ガードでジャストガード · ガード＋左右で回避 · 空中↓＋攻撃でメテオ · 崖はつかめる')
                : t('← → 移動 · ↑ ジャンプ · ↓ しゃがみ · , 攻撃 · . 必殺 · / ガード')}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
