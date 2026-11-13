import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import {
  DAYS_PER_SEASON,
  PERKS,
  RANK_BORDERS,
  SEASONS,
  SEASON_LABEL,
  START_HP,
  availableKeys,
  availableYears,
  bandOf,
  createPlan,
  dailyChallenge,
  draftRack,
  finalScore,
  forecastOf,
  loadBest,
  loadSave,
  lockOf,
  locksCausedBy,
  missOf,
  nextPhase,
  pickPerk,
  rackSizeOf,
  saveBest,
  startRun,
  summarize,
  wear,
  worldFromData,
  writeSave,
  type Card,
  type DayEvent,
  type DayPlan,
  type DayWeather,
  type Forecast,
  type PerkId,
  type RunPlan,
  type RunState,
  type ShikiSeason,
} from '../lib/shiki'
import { createShikiAudio, type Ambience, type Sfx, type ShikiAudio } from '../lib/shikiAudio'
import type { SceneEnv, ShikiSceneController, SpriteSpec } from '../lib/shikiScene'
import type { CutoutsFile } from '../lib/platform'
import { fmtDate, outfits, thumb, type Data } from '../lib/useData'
import { latestWeatherDate, weather } from '../lib/weather'
import { useI18n } from '../lib/i18n'
import GameShareButton from './GameShareButton'
import {
  BandBar,
  ForecastStrip,
  HeartIcon,
  OutfitCard,
  RestIcon,
  SkyIcon,
  TempReveal,
  UmbrellaIcon,
  spriteUrl,
  type Axis,
  type ForecastCell,
  type Verdict,
} from './ShikiParts'

// 四季通勤: 実在の毎日を、手持ちのラックで着回すストラテジー。
// ルールは lib/shiki.ts、3Dの街は lib/shikiScene.ts、音は lib/shikiAudio.ts。
// ここは進行（衣替え→朝→出勤→夜の答え合わせ→季節の変わり目→年間レポート）と画面を扱う。

const cutouts = cutoutsJson as CutoutsFile
const hasSprite = (key: string) => key in cutouts.sprites
const spriteOf = (key: string): SpriteSpec | null => {
  const s = cutouts.sprites[key]
  return s ? { url: spriteUrl(key), aspect: s.w / s.h } : null
}
const WALK_MS = 3400
const HOME = 0.07
const STATION = 0.8

type Props = { data: Data; onBack: () => void }
type Session = { plan: RunPlan; state: RunState; daily: string | null }

const yearPosOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000 / 365
}
const seasonOfDate = (date: string): ShikiSeason => {
  const m = Number(date.slice(5, 7))
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'
}
const precipOf = (w: DayWeather) => (w.snow ? 0.8 : w.heavyRain ? 1 : w.rain ? 0.65 : 0)

/** その日の「朝・午後・夕方」それぞれの街の様子 */
function envOf(day: DayPlan, season: ShikiSeason, moment: 'eve' | 'morning' | 'afternoon' | 'evening', rainPct = 0): SceneEnv {
  const w = day.weather
  const yearPos = yearPosOf(day.date)
  if (moment === 'eve') return { season, yearPos, hour: 19.6, sky: 'cloudy', precip: 0, temp: w.morning }
  if (moment === 'morning') {
    // 朝のうちは、降りそうな日でもまだ降っていないことが多い。確率が高い日だけ朝から降らせる
    const wetAlready = (w.rain || w.snow) && rainPct >= 70
    return {
      season,
      yearPos,
      hour: 7.9,
      sky: wetAlready ? w.sky : w.rain || w.snow ? 'cloudy' : w.sky,
      precip: wetAlready ? precipOf(w) * 0.7 : 0,
      temp: w.morning,
    }
  }
  return { season, yearPos, hour: moment === 'afternoon' ? 13.6 : 17.9, sky: w.sky, precip: precipOf(w), temp: w.max }
}

const EVENT_LABEL: Record<DayEvent, string> = {
  heatwave: '猛暑日',
  frost: '冬日',
  drop: '急な冷え込み',
  jump: '急に暖かい',
  swing: '寒暖差が大きい',
  heavyRain: '大雨',
  snow: '雪',
}

export default function ShikiGameView({ data, onBack }: Props) {
  const { t, locale } = useI18n()
  const world = useMemo(() => worldFromData(data, outfits, weather, hasSprite), [data])
  const years = useMemo(() => availableYears(world), [world])
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [session, setSession] = useState<Session | null>(null)
  const [saved, setSaved] = useState(() => loadSave(localStorage))
  const [best, setBest] = useState(() => loadBest(localStorage))
  const [newBest, setNewBest] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<{ from: number; to: number; lo: number; hi: number } | null>(null)
  // 3Dの街は state で持つ（作り直されたら、街を局面に合わせる effect も走り直すように）
  const [scene, setScene] = useState<ShikiSceneController | null>(null)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [muted, setMuted] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ShikiSceneController | null>(null)
  sceneRef.current = scene
  const audioRef = useRef<ShikiAudio | null>(null)
  const alive = useRef(true)
  const panelRef = useRef<HTMLDivElement>(null)

  const weekday = useCallback(
    (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short' }),
    [locale],
  )
  const dayLabel = useCallback(
    (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${weekday(date)}`,
    [weekday],
  )
  const sfx = (kind: Sfx) => audioRef.current?.sfx(kind)

  // ---- 音と3Dの起動・後始末 ----
  useEffect(() => {
    alive.current = true
    const audio = createShikiAudio()
    audioRef.current = audio
    setMuted(audio.muted())
    return () => {
      alive.current = false
      audio.close()
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let cancelled = false
    let created: ShikiSceneController | null = null
    // three.js は重いので、ゲームを開いたときだけ読み込む。WebGLが使えない端末では平面の背景で遊べる
    import('../lib/shikiScene')
      .then(({ createShikiScene }) => {
        if (cancelled) return
        created = createShikiScene(el)
        const keys = Object.keys(cutouts.sprites)
        created.setCrowd(
          Array.from({ length: 4 }, () => spriteOf(keys[Math.floor(Math.random() * keys.length)])).filter(
            (s): s is SpriteSpec => s != null,
          ),
        )
        setScene(created)
      })
      .catch(() => {
        if (!cancelled) setSceneFailed(true)
      })
    return () => {
      cancelled = true
      created?.dispose()
      setScene(null)
    }
  }, [])

  // ---- いまの局面から読み出すもの ----
  const plan = session?.plan ?? null
  const state = session?.state ?? null
  const seasonPlan = plan && state ? plan.seasons[Math.min(state.season, SEASONS.length - 1)] : null
  const dayPlan = seasonPlan && state ? seasonPlan.days[Math.min(state.day, DAYS_PER_SEASON - 1)] : null
  const lastLog = state && state.log.length > 0 ? state.log[state.log.length - 1] : null
  const titleHero = useMemo(() => {
    const keys = Object.keys(cutouts.sprites)
    return keys[Math.floor(Math.random() * keys.length)]
  }, [])

  // 快適帯のバーの目盛り。その季節の候補すべてと予報が収まる範囲にそろえる
  const axis: Axis = useMemo(() => {
    if (!seasonPlan || !state) return { min: 0, max: 30 }
    let min = Infinity
    let max = -Infinity
    for (const key of seasonPlan.pool) {
      const b = bandOf(world.cards.get(key)!, state.perks)
      min = Math.min(min, b.lo)
      max = Math.max(max, b.hi)
    }
    seasonPlan.days.forEach((d, i) => {
      const f = forecastOf(d, i + 1, state.perks)
      min = Math.min(min, f.amLo)
      max = Math.max(max, f.pmHi)
    })
    return { min: Math.floor(min) - 1, max: Math.ceil(max) + 1 }
  }, [seasonPlan, state, world])

  const todayForecast: Forecast | null =
    dayPlan && state && state.phase === 'morning' ? forecastOf(dayPlan, 0, state.perks) : null

  // ---- 街と音を、いまの局面に合わせる ----
  useEffect(() => {
    const audio = audioRef.current
    if (busy) return
    let env: SceneEnv
    let hero: string | null = null
    let companion: string | null = null
    let at = HOME
    if (!plan || !state || !seasonPlan || !dayPlan) {
      const date = latestWeatherDate()
      env = { season: seasonOfDate(date), yearPos: yearPosOf(date), hour: 10.5, sky: 'sunny', precip: 0, temp: 18 }
      hero = titleHero
      at = 0.5
    } else if (state.phase === 'draft') {
      env = envOf(seasonPlan.days[0], seasonPlan.season, 'eve')
    } else if (state.phase === 'morning') {
      env = envOf(dayPlan, seasonPlan.season, 'morning', todayForecast?.rainPct ?? 0)
      hero = selected
    } else if (state.phase === 'report') {
      const log = summarize(plan, state).best
      const d = log ? plan.seasons[log.season].days[log.day] : dayPlan
      env = { ...envOf(d, plan.seasons[log?.season ?? 0].season, 'evening'), hour: 16.4, sky: 'sunny', precip: 0 }
      hero = log?.cardKey ?? null
      at = 0.5
    } else {
      // 夜の答え合わせと、季節の変わり目
      const log = lastLog
      const d = log ? plan.seasons[log.season].days[log.day] : dayPlan
      env = envOf(d, plan.seasons[log?.season ?? state.season].season, 'evening')
      hero = log?.cardKey ?? null
      companion = state.phase === 'night' ? (log?.kokiKey ?? null) : null
      at = STATION
    }
    if (scene) {
      scene.setEnv(env)
      scene.setHero(hero ? spriteOf(hero) : null)
      scene.setCompanion(companion ? spriteOf(companion) : null)
      void scene.walkTo(at, 0)
    }
    const amb: Ambience = { season: env.season, sky: env.sky, precip: env.precip, hour: env.hour }
    audio?.setAmbience(amb)
  }, [scene, plan, state, seasonPlan, dayPlan, lastLog, selected, busy, titleHero, todayForecast?.rainPct])

  // ---- 進行 ----
  const commit = useCallback((next: Session | null) => {
    setSession(next)
    if (next && !next.state.finished) {
      const save = { year: next.plan.year, seed: next.plan.seed, daily: next.daily, state: next.state }
      writeSave(localStorage, save)
      setSaved(save)
    } else {
      writeSave(localStorage, null)
      setSaved(null)
    }
  }, [])

  const begin = (year: number, seed: number, daily: string | null) => {
    audioRef.current?.unlock()
    sfx('season')
    setDraft([])
    setSelected(null)
    setNewBest(false)
    commit({ plan: createPlan(world, year, seed), state: startRun(), daily })
  }

  const resume = () => {
    if (!saved || !years.includes(saved.year)) return
    audioRef.current?.unlock()
    sfx('pick')
    setDraft([])
    setSelected(null)
    setNewBest(false)
    setSession({ plan: createPlan(world, saved.year, saved.seed), state: saved.state, daily: saved.daily })
  }

  const toTitle = () => {
    setSession(null)
    setSelected(null)
    setDraft([])
  }

  const toggleDraft = (key: string) => {
    if (!state) return
    setDraft((cur) => {
      if (cur.includes(key)) {
        sfx('unpick')
        return cur.filter((k) => k !== key)
      }
      if (cur.length >= rackSizeOf(state)) return cur
      sfx('pick')
      return [...cur, key]
    })
  }

  const confirmDraft = () => {
    if (!session) return
    const next = draftRack(session.plan, session.state, draft)
    if (next === session.state) return
    sfx('go')
    setDraft([])
    setSelected(null)
    commit({ ...session, state: next })
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const go = async () => {
    if (!session || !selected || busy) return
    const { plan: p, state: s } = session
    const day = p.seasons[s.season].days[s.day]
    const card = world.cards.get(selected)
    const after = wear(world, p, s, selected)
    if (!card || after === s) return
    const log = after.log[after.log.length - 1]
    const band = bandOf(card, s.perks)
    audioRef.current?.unlock()
    sfx('go')
    setBusy(true)
    setReveal({ from: day.weather.morning, to: day.weather.max, lo: band.lo, hi: band.hi })
    const env = envOf(day, p.seasons[s.season].season, 'afternoon')
    sceneRef.current?.setEnv(env)
    audioRef.current?.setAmbience({ season: env.season, sky: env.sky, precip: env.precip, hour: env.hour })
    stageRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    await Promise.all([
      sceneRef.current ? sceneRef.current.walkTo(STATION, WALK_MS) : Promise.resolve(),
      new Promise((resolve) => window.setTimeout(resolve, WALK_MS + 250)),
    ])
    if (!alive.current) return
    setReveal(null)
    setBusy(false)
    setSelected(null)
    commit({ ...session, state: after })
    const miss = log.cold + log.hot
    sfx(after.failed ? 'fail' : log.exact ? 'sync' : log.wet ? 'wet' : miss <= 0 ? 'comfy' : miss <= 2 ? 'soso' : 'bad')
  }

  const advance = () => {
    if (!session) return
    const next = nextPhase(session.plan, session.state)
    if (next === session.state) return
    if (next.phase === 'report') {
      const updated = !next.failed && saveBest(localStorage, session.plan.year, finalScore(next))
      setNewBest(updated)
      setBest(loadBest(localStorage))
      sfx(next.failed ? 'fail' : 'clear')
    } else if (next.phase === 'perk') sfx('season')
    else sfx('tap')
    commit({ ...session, state: next })
  }

  const choosePerk = (perk: PerkId) => {
    if (!session) return
    const next = pickPerk(session.state, perk)
    if (next === session.state) return
    sfx('perk')
    setDraft([])
    commit({ ...session, state: next })
  }

  // ---- 朝: 服ごとの見立て ----
  const verdictOf = (card: Card, fc: Forecast): Verdict => {
    const b = bandOf(card, state?.perks ?? [])
    const cold = Math.round((b.lo - fc.amLo) * 10) / 10
    if (cold > 0) return { kind: 'cold', text: t('朝が{n}℃寒い', { n: cold }) }
    if (fc.pmLo > b.hi) return { kind: 'hot', text: t('午後が{n}℃以上暑い', { n: fc.pmLo - b.hi }) }
    if (fc.pmHi > b.hi) return { kind: 'risk', text: t('午後、暑くなるかも') }
    return { kind: 'safe', text: t('快適圏') }
  }

  const share = () => {
    if (!plan || !state) return
    const sum = summarize(plan, state)
    const url = `${location.origin}${import.meta.env.BASE_URL}game/shiki/`
    const text = state.failed
      ? t('出勤服アーカイブの「四季通勤」で{year}年に挑戦。{days}日目で風邪をひきました… #出勤服アーカイブ', {
          year: plan.year,
          days: sum.days,
        })
      : t('出勤服アーカイブの「四季通勤」で{year}年を完走！ ランク{rank}・{score}点（快適{comfy}日／シンクロ{sync}回） #出勤服アーカイブ', {
          year: plan.year,
          rank: sum.rank,
          score: sum.score,
          comfy: sum.comfortDays,
          sync: sum.exactSyncs,
        })
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  // ---- 画面 ----
  const hp = state?.hp ?? START_HP
  const seasonName = seasonPlan ? t(SEASON_LABEL[seasonPlan.season]) : ''
  const stageDate = !state || !dayPlan ? null : state.phase === 'draft' ? null : (lastLog && state.phase !== 'morning' ? lastLog.date : dayPlan.date)

  return (
    <main className="shiki">
      <div className="shiki-inner">
        <div className="shiki-head">
          <button className="shiki-back jp" onClick={session ? toTitle : onBack}>
            ← {t(session ? '年を選びなおす' : 'ゲームを選ぶ')}
          </button>
          <h2 className="shiki-title jp">{t('四季通勤')}</h2>
          <span className="shiki-head-right">
            <button
              className="shiki-sound mono"
              onClick={() => setMuted(audioRef.current?.toggle() ?? muted)}
              aria-label={t(muted ? 'サウンドをオン' : 'サウンドをオフ')}
            >
              {t(muted ? '音 OFF' : '音 ON')}
            </button>
            <GameShareButton game="shiki" title="四季通勤" />
          </span>
        </div>

        <div className={sceneFailed ? `shiki-stage flat season-${seasonPlan?.season ?? 'spring'}` : 'shiki-stage'} ref={stageRef}>
          {sceneFailed && (selected ?? lastLog?.cardKey) && (
            <img className="shiki-flat-hero" src={spriteUrl((selected ?? lastLog?.cardKey)!)} alt="" />
          )}
          {state && seasonPlan && state.phase !== 'report' && (
            <div className="shiki-hud">
              <span className="shiki-chip jp">
                <b>{seasonName}</b>
                {stageDate ? (
                  <span className="mono">
                    {fmtDate(stageDate)} {weekday(stageDate)}
                  </span>
                ) : (
                  <span>{t('衣替え')}</span>
                )}
              </span>
              <span className="shiki-progress" aria-label={t('{season} {day}日目 / 全{total}日', { season: seasonName, day: state.day + 1, total: DAYS_PER_SEASON })}>
                {SEASONS.map((s, si) => (
                  <span key={s} className="shiki-progress-season">
                    {Array.from({ length: DAYS_PER_SEASON }, (_, di) => {
                      const done = state.log.some((l) => l.season === si && l.day === di)
                      const now = si === state.season && di === state.day && state.phase === 'morning'
                      return <i key={di} className={done ? 'done' : now ? 'now' : ''} />
                    })}
                  </span>
                ))}
              </span>
              <span className="shiki-chip score mono">{state.score.toLocaleString()}</span>
            </div>
          )}
          {state && state.phase !== 'report' && (
            <div className={`shiki-hp ${hp <= 25 ? 'danger' : hp <= 50 ? 'warn' : ''}`}>
              <span className="shiki-hp-k jp">{t('体調')}</span>
              <span className="shiki-hp-track">
                <i style={{ width: `${hp}%` }} />
              </span>
              <span className="shiki-hp-v mono">{hp}</span>
            </div>
          )}
          {todayForecast && dayPlan && !busy && (
            <div className="shiki-now">
              <span className="shiki-now-item">
                <span className="jp">{t('朝')}</span>
                <b className="mono">{dayPlan.weather.morning.toFixed(1)}℃</b>
              </span>
              <span className="shiki-now-item">
                <span className="jp">{t('午後の予報')}</span>
                <b className="mono">
                  {todayForecast.pmLo}–{todayForecast.pmHi}℃
                </b>
              </span>
              <span className={todayForecast.rainPct >= 50 ? 'shiki-now-item wet' : 'shiki-now-item'}>
                <UmbrellaIcon />
                <b className="mono">{todayForecast.rainPct}%</b>
              </span>
            </div>
          )}
          {reveal && <TempReveal {...reveal} ms={WALK_MS} />}
          {!session && (
            <div className="shiki-stage-title">
              <span className="mono">WARDROBE STRATEGY</span>
              <strong className="jp">{t('四季通勤')}</strong>
              <span className="jp">{t('ほんとうにあった毎日を、7着で着回す。')}</span>
            </div>
          )}
        </div>

        <div className="shiki-panel" ref={panelRef}>
          {!session && (
            <TitlePanel
              years={years}
              best={best}
              canResume={saved != null && years.includes(saved.year)}
              resumeLabel={
                saved
                  ? t('つづきから（{year}年・{season}）', {
                      year: saved.year,
                      season: t(SEASON_LABEL[SEASONS[Math.min(saved.state.season, 3)]]),
                    })
                  : ''
              }
              onResume={resume}
              onDaily={() => {
                const d = dailyChallenge(world, today)
                begin(d.year, d.seed, today)
              }}
              onYear={(y) => begin(y, 0, null)}
              onRandom={() => begin(years[Math.floor(Math.random() * years.length)], 1 + Math.floor(Math.random() * 90000), null)}
            />
          )}

          {plan && state && seasonPlan && state.phase === 'draft' && (
            <section className="shiki-section">
              <header className="shiki-section-head">
                <h3 className="jp">{t('{season}の衣替え', { season: seasonName })}</h3>
                <p className="jp">
                  {t('この先6日の予報を見て、候補から{n}着をラックに出す。着た服は休ませるので、アイテムのかぶりにも注意。', {
                    n: rackSizeOf(state),
                  })}
                </p>
              </header>
              <ForecastStrip
                cells={seasonPlan.days.map((d, i): ForecastCell => {
                  const f = forecastOf(d, i + 1, state.perks)
                  const am = (f.amLo + f.amHi) / 2
                  const pm = (f.pmLo + f.pmHi) / 2
                  return {
                    key: d.date,
                    label: dayLabel(d.date),
                    forecast: f,
                    fits:
                      draft.length === 0
                        ? undefined
                        : draft.filter((k) => {
                            const m = missOf(world.cards.get(k)!, am, pm, state.perks)
                            return m.cold + m.hot <= 0
                          }).length,
                  }
                })}
              />
              <div className="shiki-grid">
                {[...seasonPlan.pool]
                  .map((k) => world.cards.get(k)!)
                  .sort((a, b) => a.lo + a.hi - (b.lo + b.hi) || (a.key < b.key ? -1 : 1))
                  .map((card) => {
                    const picked = draft.includes(card.key)
                    const mine = new Set(card.items.filter((it) => it.rest > 0).map((it) => it.id))
                    const overlap = picked
                      ? draft.filter(
                          (k) => k !== card.key && world.cards.get(k)!.items.some((it) => mine.has(it.id)),
                        ).length
                      : 0
                    return (
                      <OutfitCard
                        key={card.key}
                        card={card}
                        band={bandOf(card, state.perks)}
                        axis={axis}
                        selected={picked}
                        overlap={overlap}
                        disabled={!picked && draft.length >= rackSizeOf(state)}
                        onClick={() => toggleDraft(card.key)}
                      />
                    )
                  })}
              </div>
              <footer className="shiki-actions">
                <span className="shiki-count mono">
                  {draft.length} / {rackSizeOf(state)}
                </span>
                <button className="shiki-btn primary jp" disabled={draft.length !== rackSizeOf(state)} onClick={confirmDraft}>
                  {t('この{n}着で始める', { n: rackSizeOf(state) })}
                </button>
              </footer>
            </section>
          )}

          {plan && state && seasonPlan && dayPlan && state.phase === 'morning' && todayForecast && (
            <MorningPanel
              world={world}
              state={state}
              seasonPlan={seasonPlan}
              forecast={todayForecast}
              axis={axis}
              selected={selected}
              busy={busy}
              dayLabel={dayLabel}
              verdictOf={verdictOf}
              onSelect={(key) => {
                audioRef.current?.unlock()
                sfx('tap')
                setSelected(key)
              }}
              onGo={go}
              kokiHint={
                state.perks.includes('telepathy') ? (world.cards.get(dayPlan.kokiKey)?.primary ?? null) : null
              }
            />
          )}

          {plan && state && state.phase === 'night' && lastLog && (
            <NightPanel
              world={world}
              plan={plan}
              state={state}
              axis={axis}
              onNext={advance}
              nextLabel={
                state.failed
                  ? t('結果を見る')
                  : state.day < DAYS_PER_SEASON - 1
                    ? t('次の朝へ')
                    : state.season < SEASONS.length - 1
                      ? t('{season}を終える', { season: seasonName })
                      : t('1年の結果を見る')
              }
            />
          )}

          {plan && state && state.phase === 'perk' && (
            <section className="shiki-section">
              <header className="shiki-section-head">
                <h3 className="jp">{t('{season}が終わった', { season: seasonName })}</h3>
                <p className="jp">
                  {t('この季節は {score} 点。ひと休みして体調が少し戻る。次の季節へ持っていく習慣を1つ選ぼう。', {
                    score: summarize(plan, state).bySeason[state.season].toLocaleString(),
                  })}
                </p>
              </header>
              <div className="shiki-perks">
                {state.perkOffer.map((id) => (
                  <button key={id} className="shiki-perk" onClick={() => choosePerk(id)}>
                    <span className="shiki-perk-name jp">{t(PERKS[id].name)}</span>
                    <span className="shiki-perk-text jp">{t(PERKS[id].text)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {plan && state && state.phase === 'report' && (
            <ReportPanel
              world={world}
              plan={plan}
              state={state}
              newBest={newBest}
              dayLabel={dayLabel}
              onRetry={() => begin(plan.year, plan.seed, session?.daily ?? null)}
              onTitle={toTitle}
              onShare={share}
            />
          )}
        </div>
      </div>
    </main>
  )
}

// ----------------------------------------------------------------------------
// タイトル
// ----------------------------------------------------------------------------
function TitlePanel({
  years,
  best,
  canResume,
  resumeLabel,
  onResume,
  onDaily,
  onYear,
  onRandom,
}: {
  years: number[]
  best: Record<string, number>
  canResume: boolean
  resumeLabel: string
  onResume: () => void
  onDaily: () => void
  onYear: (year: number) => void
  onRandom: () => void
}) {
  const { t } = useI18n()
  const rankFor = (score: number) => RANK_BORDERS.find((b) => score >= b.min)?.rank ?? 'D'
  return (
    <section className="shiki-section">
      <p className="shiki-lead jp">
        {t('舞台は、じっさいに出勤服を投稿した日と、その日の東京の気温。朝の気温と午後の予報を読み、ラックの7着から今日の1着を選ぶ。夜には、本物のkokiが着た服と答え合わせ。')}
      </p>
      {canResume && (
        <button className="shiki-btn primary wide jp" onClick={onResume}>
          {resumeLabel}
        </button>
      )}
      <div className="shiki-modes">
        <button className="shiki-mode daily" onClick={onDaily}>
          <span className="shiki-mode-tag mono">DAILY</span>
          <span className="shiki-mode-name jp">{t('今日のお題')}</span>
          <span className="shiki-mode-text jp">{t('日替わりの1年。今日は全員が同じ展開になる。')}</span>
        </button>
        {years.map((y) => (
          <button key={y} className="shiki-mode" onClick={() => onYear(y)}>
            <span className="shiki-mode-tag mono">{y}</span>
            <span className="shiki-mode-name jp">{t('{year}年の名場面', { year: y })}</span>
            <span className="shiki-mode-text jp">
              {best[y] != null
                ? t('自己ベスト {score} 点（ランク{rank}）', { score: best[y].toLocaleString(), rank: rankFor(best[y]) })
                : t('気温の乱高下や雨がいちばん詰まった6日×4季節。')}
            </span>
          </button>
        ))}
        <button className="shiki-mode" onClick={onRandom}>
          <span className="shiki-mode-tag mono">RANDOM</span>
          <span className="shiki-mode-name jp">{t('おまかせ')}</span>
          <span className="shiki-mode-text jp">{t('年も日付もランダム。何度でも違う1年になる。')}</span>
        </button>
      </div>
      <ol className="shiki-howto jp">
        <li>
          <b>{t('衣替え')}</b>
          {t('季節のはじめに、候補14着から7着をラックへ。')}
        </li>
        <li>
          <b>{t('朝')}</b>
          {t('服の「快適帯」に、朝の気温と午後の最高気温が収まれば快適。外すと体調が減る。')}
        </li>
        <li>
          <b>{t('着回し')}</b>
          {t('着た服は休ませる（シャツ類は2日、パンツ・靴・ニットは1日）。同じアイテムを含む服も巻き添えになる。')}
        </li>
        <li>
          <b>{t('夜')}</b>
          {t('本物のkokiと同じ服ならシンクロ。見映えのいい服、初めて着るアイテムにも点が入る。')}
        </li>
      </ol>
    </section>
  )
}

// ----------------------------------------------------------------------------
// 朝
// ----------------------------------------------------------------------------
function MorningPanel({
  world,
  state,
  seasonPlan,
  forecast,
  axis,
  selected,
  busy,
  dayLabel,
  verdictOf,
  onSelect,
  onGo,
  kokiHint,
}: {
  world: ReturnType<typeof worldFromData>
  state: RunState
  seasonPlan: RunPlan['seasons'][number]
  forecast: Forecast
  axis: Axis
  selected: string | null
  busy: boolean
  dayLabel: (date: string) => string
  verdictOf: (card: Card, fc: Forecast) => Verdict
  onSelect: (key: string) => void
  onGo: () => void
  kokiHint: string | null
}) {
  const { t } = useI18n()
  const open = availableKeys(world, state)
  const stuck = open.length === 0
  const willRest = selected ? new Set(locksCausedBy(world, state, selected)) : new Set<string>()
  const card = selected ? world.cards.get(selected) : null
  const worn = new Set(state.wornItems)
  const noUmbrella = !state.perks.includes('umbrella')

  const cells: ForecastCell[] = seasonPlan.days.map((d, i) => ({
    key: d.date,
    label: dayLabel(d.date),
    forecast: forecastOf(d, Math.max(0, i - state.day), state.perks),
    today: i === state.day,
    past: i < state.day,
  }))

  return (
    <section className="shiki-section">
      <ForecastStrip cells={cells} />
      {kokiHint && <p className="shiki-hint jp">{t('以心伝心: 本物の今日の主役は「{category}」', { category: kokiHint })}</p>}
      {stuck && <p className="shiki-hint warn jp">{t('着られる服がない。休ませ中の服を無理に着るしかない（見映え0点・体調も少し減る）。')}</p>}
      <div className="shiki-grid rack">
        {state.rack.map((key) => {
          const c = world.cards.get(key)!
          const lock = lockOf(world, state, key)
          return (
            <OutfitCard
              key={key}
              card={c}
              band={bandOf(c, state.perks)}
              axis={axis}
              am={forecast.amLo}
              pm={[forecast.pmLo, forecast.pmHi]}
              verdict={verdictOf(c, forecast)}
              lock={lock}
              selected={selected === key}
              willRest={willRest.has(key)}
              rewear={(state.wornCards[key] ?? 0) > 0}
              rainRisk={forecast.rainPct >= 50 && !c.rainProof && noUmbrella}
              disabled={busy || (lock.locked && !stuck)}
              onClick={() => onSelect(key)}
            />
          )
        })}
      </div>
      <footer className="shiki-actions morning">
        {card ? (
          <div className="shiki-detail">
            <ul className="shiki-items">
              {card.items.map((it) => (
                <li key={it.id} className={worn.has(it.id) ? '' : 'fresh'}>
                  <span className="mono">{it.category}</span>
                  <span>{it.label}</span>
                  {it.rest > 0 && (
                    <span className="shiki-item-rest mono" title={t('着たあと休ませる日数')}>
                      <RestIcon />
                      {Math.max(0, it.rest - (state.perks.includes('quickdry') ? 1 : 0))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {willRest.size > 0 && (
              <p className="shiki-detail-note jp">{t('これを着ると、明日はラックの{n}着が休みになる。', { n: willRest.size })}</p>
            )}
          </div>
        ) : (
          <p className="shiki-detail-note jp">{t('縦線が朝の気温、斜線が午後の予報。どちらも塗りの中に収まる服なら、今日は快適。')}</p>
        )}
        <button className="shiki-btn primary jp" disabled={!selected || busy} onClick={onGo}>
          {busy ? t('出勤中…') : t('この服で出勤する')}
        </button>
      </footer>
    </section>
  )
}

// ----------------------------------------------------------------------------
// 夜（答え合わせ）
// ----------------------------------------------------------------------------
function NightPanel({
  world,
  plan,
  state,
  axis,
  onNext,
  nextLabel,
}: {
  world: ReturnType<typeof worldFromData>
  plan: RunPlan
  state: RunState
  axis: Axis
  onNext: () => void
  nextLabel: string
}) {
  const { t } = useI18n()
  const log = state.log[state.log.length - 1]
  const day = plan.seasons[log.season].days[log.day]
  const w = day.weather
  const card = world.cards.get(log.cardKey)!
  const koki = world.cards.get(log.kokiKey)
  const band = bandOf(card, state.perks)
  const miss = log.cold + log.hot
  const headline =
    state.failed
      ? t('風邪をひいてしまった…')
      : miss <= 0 && !log.wet
        ? t('快適な1日だった')
        : log.cold > 0 && log.hot > 0
          ? t('朝は寒く、午後は暑かった')
          : log.cold > 0
            ? t('朝が寒かった')
            : log.hot > 0
              ? t('午後が暑かった')
              : t('雨に濡れた')
  const kokiMiss = koki ? missOf(koki, w.morning, w.max, []) : null
  const kokiFeel = !kokiMiss
    ? ''
    : kokiMiss.cold + kokiMiss.hot <= 0
      ? t('本人もこの日は快適だったはず。')
      : kokiMiss.cold >= kokiMiss.hot
        ? t('本人もこの日は少し寒かったはず。')
        : t('本人もこの日は少し暑かったはず。')
  const rows: [string, number][] = [
    [t('快適'), log.comfortPts],
    [t('見映え'), log.stylePts],
    [t('初めてのアイテム'), log.freshPts],
    [t('シンクロ'), log.syncPts],
  ]
  return (
    <section className={`shiki-section night ${miss <= 0 && !log.wet ? 'good' : 'bad'}`}>
      <header className="shiki-section-head">
        <h3 className="jp">{headline}</h3>
        <p className="shiki-night-temps">
          <SkyIcon sky={w.sky} />
          <span className="jp">{t('朝')}</span>
          <b className="mono">{w.morning.toFixed(1)}℃</b>
          <span aria-hidden="true">→</span>
          <span className="jp">{t('午後')}</span>
          <b className="mono">{w.max.toFixed(1)}℃</b>
          {w.events.map((e) => (
            <span key={e} className="shiki-event jp">
              {t(EVENT_LABEL[e])}
            </span>
          ))}
        </p>
      </header>
      <div className="shiki-night-grid">
        <div className="shiki-night-you">
          <BandBar lo={band.lo} hi={band.hi} axis={axis} am={w.morning} pm={[w.max, w.max]} />
          <p className="shiki-night-miss jp">
            {log.cold > 0 && <span className="cold">{t('寒さ −{n}℃', { n: log.cold })}</span>}
            {log.hot > 0 && <span className="hot">{t('暑さ +{n}℃', { n: log.hot })}</span>}
            {log.wet && <span className="wet">{t('濡れた')}</span>}
            {log.forced && <span className="wet">{t('無理に着た')}</span>}
            {log.rewear && <span>{t('2回目')}</span>}
            {miss <= 0 && !log.wet && <span className="ok">{t('快適帯ぴったり')}</span>}
          </p>
          <dl className="shiki-points">
            {rows.map(([k, v]) => (
              <div key={k} className={v > 0 ? '' : 'zero'}>
                <dt className="jp">{k}</dt>
                <dd className="mono">+{v}</dd>
              </div>
            ))}
            <div className="total">
              <dt className="jp">{t('今日の合計')}</dt>
              <dd className="mono">+{log.total}</dd>
            </div>
            <div className={log.hpDelta < 0 ? 'hp minus' : 'hp'}>
              <dt className="jp">{t('体調')}</dt>
              <dd className="mono">
                {log.hpDelta >= 0 ? '+' : ''}
                {log.hpDelta}
              </dd>
            </div>
          </dl>
        </div>
        {koki && (
          <div className="shiki-night-koki">
            <span className="shiki-koki-tag mono">{log.exact ? 'PERFECT SYNC' : 'THE REAL ONE'}</span>
            <div className="shiki-koki-body">
              {koki.image && <img src={thumb(koki.image, 320)} alt={t('本物のkokiがこの日に着た服')} loading="lazy" />}
              <div>
                <p className="shiki-koki-sync jp">
                  {log.exact
                    ? t('完全一致！ 本物と同じ服だった')
                    : log.shared > 0
                      ? t('アイテムが{n}点いっしょ', { n: log.shared })
                      : t('今日はかぶりなし')}
                </p>
                <ul className="shiki-items small">
                  {koki.items.map((it) => (
                    <li key={it.id} className={card.items.some((c) => c.id === it.id) ? 'match' : ''}>
                      <span className="mono">{it.category}</span>
                      <span>{it.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="shiki-koki-feel jp">
                  {kokiFeel}{' '}
                  <a href={koki.noteUrl} target="_blank" rel="noreferrer">
                    {t('noteで見る')}
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      <footer className="shiki-actions">
        <span />
        <button className="shiki-btn primary jp" onClick={onNext}>
          {nextLabel}
        </button>
      </footer>
    </section>
  )
}

// ----------------------------------------------------------------------------
// 年間レポート
// ----------------------------------------------------------------------------
function ReportPanel({
  world,
  plan,
  state,
  newBest,
  dayLabel,
  onRetry,
  onTitle,
  onShare,
}: {
  world: ReturnType<typeof worldFromData>
  plan: RunPlan
  state: RunState
  newBest: boolean
  dayLabel: (date: string) => string
  onRetry: () => void
  onTitle: () => void
  onShare: () => void
}) {
  const { t } = useI18n()
  const sum = summarize(plan, state)
  const total = DAYS_PER_SEASON * SEASONS.length
  const maxSeason = Math.max(1, ...sum.bySeason)
  const weatherOf = (l: { season: number; day: number }) => plan.seasons[l.season].days[l.day].weather
  return (
    <section className="shiki-section report">
      <div className="shiki-report-top">
        <span className={`shiki-rank rank-${sum.rank}`}>{sum.rank}</span>
        <div>
          <p className="shiki-report-kicker jp">
            {state.failed
              ? t('{year}年 — {date} に風邪でダウン', { year: plan.year, date: dayLabel(state.log[state.log.length - 1].date) })
              : t('{year}年を完走', { year: plan.year })}
          </p>
          <p className="shiki-report-score mono">
            {sum.score.toLocaleString()}
            <small className="jp">{t('点')}</small>
          </p>
          {newBest && <p className="shiki-report-best jp">{t('自己ベスト更新！')}</p>}
        </div>
      </div>
      <dl className="shiki-stats">
        <div>
          <dt className="jp">{t('快適に過ごせた日')}</dt>
          <dd className="mono">
            {sum.comfortDays}
            <small> / {total}</small>
          </dd>
        </div>
        <div>
          <dt className="jp">{t('本物と完全一致')}</dt>
          <dd className="mono">{sum.exactSyncs}</dd>
        </div>
        <div>
          <dt className="jp">{t('アイテムが一致')}</dt>
          <dd className="mono">{sum.partialSyncs}</dd>
        </div>
        <div>
          <dt className="jp">{t('雨に濡れた日')}</dt>
          <dd className="mono">{sum.wetDays}</dd>
        </div>
        {sum.coldest && (
          <div>
            <dt className="jp">{t('いちばん寒かった朝')}</dt>
            <dd className="mono">
              {weatherOf(sum.coldest).morning.toFixed(1)}℃<small> {dayLabel(sum.coldest.date)}</small>
            </dd>
          </div>
        )}
        {sum.hottest && (
          <div>
            <dt className="jp">{t('いちばん暑かった午後')}</dt>
            <dd className="mono">
              {weatherOf(sum.hottest).max.toFixed(1)}℃<small> {dayLabel(sum.hottest.date)}</small>
            </dd>
          </div>
        )}
      </dl>
      <div className="shiki-season-bars">
        {SEASONS.map((s, i) => (
          <div key={s}>
            <span className="jp">{t(SEASON_LABEL[s])}</span>
            <span className="shiki-season-bar">
              <i style={{ width: `${(sum.bySeason[i] / maxSeason) * 100}%` }} />
            </span>
            <span className="mono">{sum.bySeason[i].toLocaleString()}</span>
          </div>
        ))}
      </div>
      {state.perks.length > 0 && (
        <p className="shiki-report-perks jp">
          {t('身につけた習慣')}: {state.perks.map((p) => t(PERKS[p].name)).join(' / ')}
        </p>
      )}
      <h4 className="shiki-report-h jp">{t('あなたの1年と、本物の1年')}</h4>
      <div className="shiki-year">
        {state.log.map((l) => {
          const miss = l.cold + l.hot
          return (
            <div key={`${l.season}-${l.day}`} className={l.exact ? 'shiki-year-day exact' : 'shiki-year-day'}>
              <span className="mono">{dayLabel(l.date)}</span>
              <span className="shiki-year-pair">
                <img src={spriteUrl(l.cardKey)} alt={t('あなたが着た服')} loading="lazy" />
                <img src={spriteUrl(l.kokiKey)} alt={t('本物が着た服')} loading="lazy" className="real" />
              </span>
              <span className={miss <= 0 && !l.wet ? 'mono ok' : 'mono'}>
                {weatherOf(l).morning.toFixed(0)}→{weatherOf(l).max.toFixed(0)}℃
              </span>
              <span className="mono pts">
                {l.exact && <HeartIcon />}+{l.total}
              </span>
              <span className="sr-only">{world.cards.get(l.cardKey)?.items.map((it) => it.label).join(', ')}</span>
            </div>
          )
        })}
      </div>
      <p className="shiki-year-legend jp">{t('左があなた、右が本物のkoki。')}</p>
      <footer className="shiki-actions wrap">
        <button className="shiki-btn primary jp" onClick={onRetry}>
          {t('同じ1年にもう一度挑む')}
        </button>
        <button className="shiki-btn jp" onClick={onTitle}>
          {t('別の年を選ぶ')}
        </button>
        <button className="shiki-btn jp" onClick={onShare}>
          {t('Xでポスト')}
        </button>
      </footer>
    </section>
  )
}
