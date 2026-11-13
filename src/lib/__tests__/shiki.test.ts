import { describe, expect, it } from 'vitest'
import overridesJson from '../../data/overrides.json'
import splitsJson from '../../data/splits.json'
import weatherJson from '../../data/weather.json'
import type { Overrides, SplitsFile } from '../../types'
import {
  DAYS_PER_SEASON,
  MAX_DAILY_DAMAGE,
  PERK_IDS,
  POOL_SIZE,
  RACK_SIZE,
  SEASONS,
  SEASON_REST_HP,
  START_HP,
  availableKeys,
  availableYears,
  bandOf,
  buildWorld,
  comfortPoints,
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
  rankOf,
  saveBest,
  startRun,
  summarize,
  wear,
  worldFromData,
  writeSave,
  type RunPlan,
  type RunState,
} from '../shiki'
import { buildData, outfits } from '../useData'
import type { DayTemp } from '../weather'

const weather = weatherJson as Record<string, DayTemp>
const data = buildData(
  { renames: {}, categories: {}, merges: {}, hidden: [], colors: {}, ...(overridesJson as Partial<Overrides>) },
  splitsJson as SplitsFile,
)
const world = worldFromData(data, outfits, weather)
const years = availableYears(world)

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

/** ラックに先頭から詰めて朝まで進める */
function toMorning(plan: RunPlan, state: RunState = startRun()): RunState {
  return draftRack(plan, state, plan.seasons[state.season].pool.slice(0, rackSizeOf(state)))
}

/**
 * いちばん気温に合う服を着つづけて、指定のフェーズまで進める。
 * 流れだけを確かめたいので、毎朝体調を満タンに戻して風邪で終わらないようにする。
 */
function playUntil(plan: RunPlan, state: RunState, stop: (s: RunState) => boolean): RunState {
  let s = state
  for (let guard = 0; guard < 400 && !stop(s); guard++) {
    if (s.phase === 'draft') s = toMorning(plan, s)
    else if (s.phase === 'morning') {
      const healthy = { ...s, hp: START_HP }
      const w = plan.seasons[s.season].days[s.day].weather
      const miss = (k: string) => {
        const m = missOf(world.cards.get(k)!, w.morning, w.max, healthy.perks)
        return m.cold + m.hot
      }
      const open = availableKeys(world, healthy)
      const key = (open.length > 0 ? open : healthy.rack).reduce((a, b) => (miss(b) < miss(a) ? b : a))
      s = wear(world, plan, healthy, key)
    } else if (s.phase === 'night') s = nextPhase(plan, s)
    else if (s.phase === 'perk') s = pickPerk(s, s.perkOffer[0])
    else break
  }
  return s
}

describe('着用記録から学習した適温', () => {
  it('重ねるほど適温が下がる（コート < ジャケット < シャツ < Tシャツ）', () => {
    const w = world.warmth
    expect(w.coat).toBeLessThan(w.jacket)
    expect(w.jacket).toBeLessThan(w.shirt)
    expect(w.shirt).toBeLessThan(w['t-shirt'])
  })

  it('どのコーデにも6℃以上の幅の快適帯がある', () => {
    for (const card of world.cards.values()) {
      expect(card.hi - card.lo, card.key).toBeGreaterThanOrEqual(6)
      expect(card.style).toBeGreaterThanOrEqual(8)
      expect(card.style).toBeLessThanOrEqual(40)
    }
  })

  it('本人が実際に着た日は、快適帯に収まるか、外しても僅差になる', () => {
    let comfy = 0
    let near = 0
    for (const card of world.postedDays) {
      const w = world.weatherOf(card.date)!
      const m = missOf(card, w.morning, w.max, [])
      if (m.cold + m.hot <= 0) comfy++
      if (m.cold + m.hot <= 2) near++
    }
    // ぴったり快適だったのは半分強。残りも大半は2℃以内のズレで、大外しはほとんどない
    const days = world.postedDays.length
    expect(comfy / days).toBeGreaterThan(0.45)
    expect(comfy / days).toBeLessThan(0.98)
    expect(near / days).toBeGreaterThan(0.85)
  })

  it('着用アイテムのないコーデは使わない', () => {
    const w = buildWorld({
      outfits: [{ key: 'a', no: 1, date: '2024-01-10', like: 3, noteUrl: '', images: [] }],
      weather,
      itemsOf: () => [],
    })
    expect(w.cards.size).toBe(0)
  })
})

describe('1年の計画', () => {
  it('年とシードが同じなら、いつも同じ展開になる', () => {
    expect(createPlan(world, years[0], 7)).toEqual(createPlan(world, years[0], 7))
    expect(createPlan(world, years[0], 7)).not.toEqual(createPlan(world, years[0], 8))
  })

  it('各季節は日付順の6日で、候補には本物の6着が必ず入っている', () => {
    for (const year of years) {
      for (const seed of [0, 1, 2, 3]) {
        const plan = createPlan(world, year, seed)
        expect(plan.seasons.map((s) => s.season)).toEqual(SEASONS)
        for (const season of plan.seasons) {
          expect(season.days).toHaveLength(DAYS_PER_SEASON)
          const dates = season.days.map((d) => d.date)
          expect([...dates].sort()).toEqual(dates)
          expect(new Set(season.pool).size).toBe(POOL_SIZE)
          for (const day of season.days) expect(season.pool).toContain(day.kokiKey)
        }
      }
    }
  })

  it('今日のお題は日付で決まり、遊べる年を指す', () => {
    const a = dailyChallenge(world, '2026-11-12')
    expect(a).toEqual(dailyChallenge(world, '2026-11-12'))
    expect(years).toContain(a.year)
    expect(a.seed).toBeGreaterThan(0)
  })
})

describe('予報', () => {
  it('実際の気温は、何日前の予報でも必ず幅の中に入る', () => {
    for (const year of years) {
      for (const seed of [0, 1, 2, 3, 4]) {
        for (const season of createPlan(world, year, seed).seasons) {
          for (const day of season.days) {
            for (let lead = 0; lead <= DAYS_PER_SEASON; lead++) {
              for (const perks of [[], ['app'] as const]) {
                const fc = forecastOf(day, lead, perks)
                expect(day.weather.max).toBeGreaterThanOrEqual(fc.pmLo)
                expect(day.weather.max).toBeLessThanOrEqual(fc.pmHi)
                expect(day.weather.morning).toBeGreaterThanOrEqual(fc.amLo)
                expect(day.weather.morning).toBeLessThanOrEqual(fc.amHi)
              }
            }
          }
        }
      }
    }
  })

  it('当日の朝は気温を実測でき、予報は日が近づくほど絞られる', () => {
    const day = createPlan(world, years[0], 0).seasons[0].days[0]
    const today = forecastOf(day, 0, [])
    const far = forecastOf(day, 5, [])
    expect(today.amLo).toBe(day.weather.morning)
    expect(today.amHi).toBe(day.weather.morning)
    expect(far.pmHi - far.pmLo).toBeGreaterThan(today.pmHi - today.pmLo)
  })

  it('天気アプリ有料版は幅を狭め、降水確率をはっきりさせる', () => {
    for (const season of createPlan(world, years[1], 0).seasons) {
      for (const day of season.days) {
        const free = forecastOf(day, 3, [])
        const paid = forecastOf(day, 3, ['app'])
        expect(paid.pmHi - paid.pmLo).toBeLessThanOrEqual(free.pmHi - free.pmLo)
        if (day.weather.rain || day.weather.snow) expect(paid.rainPct).toBeGreaterThanOrEqual(80)
        else expect(paid.rainPct).toBeLessThanOrEqual(20)
      }
    }
  })
})

describe('衣替えと着回し', () => {
  const plan = createPlan(world, years[1], 0)

  it('ラックは候補の中からちょうど7着', () => {
    const start = startRun()
    const pool = plan.seasons[0].pool
    expect(draftRack(plan, start, pool.slice(0, RACK_SIZE - 1))).toBe(start)
    expect(draftRack(plan, start, [...pool.slice(0, RACK_SIZE - 1), 'unknown'])).toBe(start)
    expect(draftRack(plan, start, [...pool.slice(0, RACK_SIZE - 1), pool[0]])).toBe(start)
    const ok = draftRack(plan, start, pool.slice(0, RACK_SIZE))
    expect(ok.phase).toBe('morning')
    expect(ok.rack).toHaveLength(RACK_SIZE)
  })

  it('着た服は翌日休ませ中になり、同じアイテムを含む服も巻き添えになる', () => {
    const morning = toMorning(plan)
    const key = morning.rack[0]
    const caused = locksCausedBy(world, morning, key)
    const night = wear(world, plan, morning, key)
    expect(night.phase).toBe('night')
    expect(night.log).toHaveLength(1)
    const next = nextPhase(plan, night)
    expect(next.phase).toBe('morning')
    expect(next.day).toBe(1)
    const card = world.cards.get(key)!
    if (card.items.some((it) => it.rest > 0)) expect(lockOf(world, next, key).locked).toBe(true)
    // 事前のプレビューと、実際に翌朝着られない服が一致する
    const lockedOthers = next.rack.filter((k) => k !== key && lockOf(world, next, k).locked)
    expect(lockedOthers.sort()).toEqual([...caused].sort())
    for (const other of lockedOthers) {
      const shared = world.cards.get(other)!.items.filter((it) => card.items.some((c) => c.id === it.id))
      expect(shared.length).toBeGreaterThan(0)
    }
  })

  it('休ませ中の服は、ほかに着られる服があるうちは選べない', () => {
    const night = wear(world, plan, toMorning(plan), toMorning(plan).rack[0])
    const next = nextPhase(plan, night)
    const locked = next.rack.find((k) => lockOf(world, next, k).locked)
    if (locked) expect(wear(world, plan, next, locked)).toBe(next)
  })

  it('着られる服が1着もないときだけ、休ませ中の服を無理に着られる（見映えは0点）', () => {
    const morning = toMorning(plan)
    const stuck: RunState = {
      ...morning,
      restUntil: Object.fromEntries(
        morning.rack.flatMap((k) => world.cards.get(k)!.items.map((it) => [it.id, 99])),
      ),
    }
    expect(availableKeys(world, stuck)).toHaveLength(0)
    const after = wear(world, plan, stuck, stuck.rack[0])
    expect(after.phase).toBe('night')
    expect(after.log[0].forced).toBe(true)
    expect(after.log[0].stylePts).toBe(0)
  })

  it('朝以外・ラックにない服では何も起きない', () => {
    const start = startRun()
    expect(wear(world, plan, start, plan.seasons[0].pool[0])).toBe(start)
    const morning = toMorning(plan)
    const outside = plan.seasons[0].pool.find((k) => !morning.rack.includes(k))!
    expect(wear(world, plan, morning, outside)).toBe(morning)
    expect(nextPhase(plan, morning)).toBe(morning)
  })
})

describe('採点', () => {
  const plan = createPlan(world, years[1], 0)

  it('快適帯に収まれば60点、外すほど減って0点で止まる', () => {
    expect(comfortPoints(0)).toBe(60)
    expect(comfortPoints(1)).toBeLessThan(60)
    expect(comfortPoints(2)).toBeLessThan(comfortPoints(1))
    expect(comfortPoints(40)).toBe(0)
  })

  it('朝が帯より寒ければ寒さ、午後が帯より暑ければ暑さとして数える', () => {
    const card = world.cards.get(plan.seasons[0].pool[0])!
    expect(missOf(card, card.lo, card.hi, [])).toEqual({ cold: 0, hot: 0 })
    expect(missOf(card, card.lo - 3, card.hi + 2, [])).toEqual({ cold: 3, hot: 2 })
    expect(bandOf(card, ['layering', 'sleeves'])).toEqual({ lo: card.lo - 2, hi: card.hi + 2 })
    expect(missOf(card, card.lo - 3, card.hi + 2, ['layering', 'sleeves'])).toEqual({ cold: 1, hot: 0 })
  })

  it('本物と同じ服を着ると完全一致のシンクロになる', () => {
    const season = plan.seasons[0]
    const koki = season.days[0].kokiKey
    const rack = [koki, ...season.pool.filter((k) => k !== koki)].slice(0, RACK_SIZE)
    const night = wear(world, plan, draftRack(plan, startRun(), rack), koki)
    expect(night.log[0].exact).toBe(true)
    expect(night.log[0].syncPts).toBe(40)
    expect(night.score).toBe(night.log[0].total)
  })

  it('どれだけ外しても、1日で減る体調は半分まで', () => {
    const morning = toMorning(plan)
    const card = world.cards.get(morning.rack[0])!
    // 真冬の服で真夏日に出る、くらいの大外しを作る
    const extreme: RunPlan = {
      ...plan,
      seasons: plan.seasons.map((season) => ({
        ...season,
        days: season.days.map((d) => ({
          ...d,
          weather: { ...d.weather, morning: card.hi + 20, max: card.hi + 30, rain: true, snow: false },
        })),
      })),
    }
    const night = wear(world, extreme, morning, morning.rack[0])
    expect(night.log[0].hpDelta).toBe(-MAX_DAILY_DAMAGE)
    expect(night.failed).toBe(false)
  })

  it('体調が尽きると風邪で終了し、ランクはDになる', () => {
    const morning = { ...toMorning(plan), hp: 1 }
    const w = plan.seasons[0].days[0].weather
    const worst = [...morning.rack].sort((a, b) => {
      const miss = (k: string) => {
        const m = missOf(world.cards.get(k)!, w.morning, w.max, [])
        return m.cold + m.hot
      }
      return miss(b) - miss(a)
    })[0]
    const worstMiss = missOf(world.cards.get(worst)!, w.morning, w.max, [])
    if (worstMiss.cold + worstMiss.hot <= 0) return
    const night = wear(world, plan, morning, worst)
    expect(night.failed).toBe(true)
    const report = nextPhase(plan, night)
    expect(report.phase).toBe('report')
    expect(rankOf(report)).toBe('D')
    expect(finalScore(report)).toBe(report.score)
  })
})

describe('1年の流れ', () => {
  const plan = createPlan(world, years[1], 3)

  it('季節の終わりに習慣を3つから選び、体調が少し戻って次の衣替えへ進む', () => {
    const perk = playUntil(plan, startRun(), (s) => s.phase === 'perk')
    expect(perk.phase).toBe('perk')
    expect(perk.season).toBe(0)
    expect(new Set(perk.perkOffer).size).toBe(3)
    for (const p of perk.perkOffer) expect(PERK_IDS).toContain(p)
    expect(pickPerk(perk, PERK_IDS.find((p) => !perk.perkOffer.includes(p))!)).toBe(perk)
    const hurt = { ...perk, hp: 50 }
    const next = pickPerk(hurt, hurt.perkOffer[0])
    expect(next.phase).toBe('draft')
    expect(next.season).toBe(1)
    expect(next.hp).toBe(50 + SEASON_REST_HP)
    expect(next.rack).toEqual([])
    expect(next.perks).toEqual([hurt.perkOffer[0]])
    expect(pickPerk({ ...perk, hp: START_HP }, perk.perkOffer[0]).hp).toBe(START_HP)
  })

  it('ラック増設を持っていると9着出せる', () => {
    expect(rackSizeOf({ perks: [] })).toBe(RACK_SIZE)
    expect(rackSizeOf({ perks: ['rack'] })).toBe(RACK_SIZE + 2)
  })

  it('4つの季節を終えると年間レポートになり、残った体調も得点になる', () => {
    const s = playUntil(plan, startRun(), (x) => x.phase === 'report')
    expect(s.phase).toBe('report')
    expect(s.finished).toBe(true)
    expect(s.log).toHaveLength(DAYS_PER_SEASON * SEASONS.length)
    expect(s.perks).toHaveLength(3)
    expect(finalScore(s)).toBe(s.score + 100 + s.hp * 2)
    const summary = summarize(plan, s)
    expect(summary.days).toBe(24)
    expect(summary.bySeason.reduce((a, b) => a + b, 0)).toBe(s.score)
    expect(summary.coldest && summary.hottest && summary.best).toBeTruthy()
  })
})

describe('保存', () => {
  const plan = createPlan(world, years[0], 0)

  it('途中の状態を保存して再開できる。終わった年は再開しない', () => {
    const storage = memoryStorage()
    expect(loadSave(storage)).toBeNull()
    const state = toMorning(plan)
    writeSave(storage, { year: plan.year, seed: plan.seed, daily: null, state })
    expect(loadSave(storage)).toEqual({ year: plan.year, seed: plan.seed, daily: null, state })
    writeSave(storage, { year: plan.year, seed: plan.seed, daily: null, state: { ...state, finished: true } })
    expect(loadSave(storage)).toBeNull()
    writeSave(storage, null)
    expect(storage.getItem('shiki.save.v1')).toBeNull()
  })

  it('壊れた保存データは無視する', () => {
    const storage = memoryStorage()
    storage.setItem('shiki.save.v1', '{oops')
    storage.setItem('shiki.best.v1', 'null')
    expect(loadSave(storage)).toBeNull()
    expect(loadBest(storage)).toEqual({})
  })

  it('自己ベストは年ごとに、上回ったときだけ更新する', () => {
    const storage = memoryStorage()
    expect(saveBest(storage, 2024, 2000)).toBe(true)
    expect(saveBest(storage, 2024, 1500)).toBe(false)
    expect(saveBest(storage, 2023, 100)).toBe(true)
    expect(loadBest(storage)).toEqual({ 2024: 2000, 2023: 100 })
  })
})
