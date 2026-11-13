// 四季通勤の自動プレイヤー。難易度の検証（shiki.balance.test.ts）専用で、アプリ本体からは読み込まない。
// botが見てよいのは人間と同じ情報（予報・ラック・快適帯）だけ。実際の気温や本物の服は覗かない。

import {
  DAYS_PER_SEASON,
  availableKeys,
  bandOf,
  comfortPoints,
  createPlan,
  draftRack,
  forecastOf,
  lockOf,
  mulberry32,
  nextPhase,
  pickPerk,
  rackSizeOf,
  startRun,
  wear,
  type Card,
  type Forecast,
  type PerkId,
  type RunPlan,
  type RunState,
  type World,
} from './shiki'

export type BotContext = { world: World; plan: RunPlan; state: RunState }
export type Bot = {
  name: string
  draft: (ctx: BotContext) => string[]
  choose: (ctx: BotContext) => string
  perk?: (ctx: BotContext) => PerkId
}

/** 予報の幅の中で気温が一様に散らばると見て、その服で1日過ごす期待値を出す */
function expectedValue(card: Card, fc: Forecast, state: RunState, hpWeight: number): number {
  const band = bandOf(card, state.perks)
  const has = (p: PerkId) => state.perks.includes(p)
  let sum = 0
  let n = 0
  for (let am = fc.amLo; am <= fc.amHi + 1e-9; am += 1) {
    for (let pm = fc.pmLo; pm <= fc.pmHi + 1e-9; pm += 1) {
      const miss = Math.max(0, band.lo - am) + Math.max(0, pm - band.hi)
      const hp = miss <= 0 ? 3 : -Math.round(6 * Math.pow(miss, 1.3)) * (has('iron') ? 0.7 : 1)
      sum += comfortPoints(miss) + hpWeight * hp
      n++
    }
  }
  let value = sum / n
  const wetRisk = card.rainProof || has('umbrella') ? 0 : fc.rainPct / 100
  value -= wetRisk * (12 + hpWeight * 6)
  const rewear = (state.wornCards[card.key] ?? 0) > 0
  let style = card.style * (has('eye') ? 1.3 : 1)
  if (rewear) style = has('uniform') ? style + 10 : style * 0.5
  const worn = new Set(state.wornItems)
  const fresh = Math.min(12, card.items.filter((it) => !worn.has(it.id)).length * 2) * (has('adventurer') ? 2 : 1)
  return value + style + fresh
}

const todayForecast = ({ plan, state }: BotContext) =>
  forecastOf(plan.seasons[state.season].days[state.day], 0, state.perks)

const fallbackKey = (ctx: BotContext) => {
  const open = availableKeys(ctx.world, ctx.state)
  return open.length > 0 ? open : ctx.state.rack
}

/** でたらめに選ぶ人。これで完走できてしまうなら簡単すぎる */
export function randomBot(seed: number): Bot {
  const rng = mulberry32(seed)
  return {
    name: 'random',
    draft: ({ plan, state }) => {
      const pool = [...plan.seasons[state.season].pool]
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      return pool.slice(0, rackSizeOf(state))
    },
    choose: (ctx) => {
      const keys = fallbackKey(ctx)
      return keys[Math.floor(rng() * keys.length)]
    },
  }
}

/** その日の予報だけを見て、いちばん合う服を着る人（先のことは考えない） */
export const greedyBot: Bot = {
  name: 'greedy',
  draft: ({ world, plan, state }) => {
    const season = plan.seasons[state.season]
    const scored = season.pool.map((key) => {
      const card = world.cards.get(key)!
      let best = -Infinity
      season.days.forEach((day, i) => {
        best = Math.max(best, expectedValue(card, forecastOf(day, i + 1, state.perks), state, 2))
      })
      return { key, best }
    })
    scored.sort((a, b) => b.best - a.best)
    return scored.slice(0, rackSizeOf(state)).map((s) => s.key)
  },
  choose: (ctx) => {
    const fc = todayForecast(ctx)
    let bestKey = ''
    let best = -Infinity
    for (const key of fallbackKey(ctx)) {
      const v = expectedValue(ctx.world.cards.get(key)!, fc, ctx.state, 2)
      if (v > best) {
        best = v
        bestKey = key
      }
    }
    return bestKey
  },
}

/** 今日これを着たあと、残りの日を貪欲に着回したら合計いくつになるか */
function rollout(ctx: BotContext, first: string, hpWeight: number): number {
  const { world, plan } = ctx
  const season = plan.seasons[ctx.state.season]
  let total = 0
  let rest = { ...ctx.state.restUntil }
  const wornCards = { ...ctx.state.wornCards }
  const wornItems = new Set(ctx.state.wornItems)
  const quick = ctx.state.perks.includes('quickdry') ? 1 : 0
  for (let day = ctx.state.day; day < DAYS_PER_SEASON; day++) {
    const fc = forecastOf(season.days[day], day - ctx.state.day, ctx.state.perks)
    const sim = { ...ctx.state, restUntil: rest, day, wornCards, wornItems: [...wornItems] }
    let key = ''
    let value = -Infinity
    if (day === ctx.state.day) {
      key = first
      value = expectedValue(world.cards.get(first)!, fc, sim, hpWeight)
    } else {
      for (const k of ctx.state.rack) {
        if (lockOf(world, sim, k).locked) continue
        const v = expectedValue(world.cards.get(k)!, fc, sim, hpWeight)
        if (v > value) {
          value = v
          key = k
        }
      }
      // 着られる服が1着もない日は大きな失点として数える
      if (!key) {
        total -= 60
        continue
      }
    }
    total += value
    const card = world.cards.get(key)!
    rest = { ...rest }
    for (const it of card.items) {
      const turns = Math.max(0, it.rest - quick)
      if (turns > 0) rest[it.id] = Math.max(rest[it.id] ?? 0, day + turns + 1)
      wornItems.add(it.id)
    }
    wornCards[key] = (wornCards[key] ?? 0) + 1
  }
  return total
}

/** 週の予報とかぶりを見て、先まで考えて着回す人（上手な人間の代役） */
export const plannerBot: Bot = {
  name: 'planner',
  draft: ({ world, plan, state }) => {
    const season = plan.seasons[state.season]
    const size = Math.min(rackSizeOf(state), season.pool.length)
    const value = (key: string, i: number) =>
      expectedValue(world.cards.get(key)!, forecastOf(season.days[i], i + 1, state.perks), state, 3)
    const table = new Map(season.pool.map((key) => [key, season.days.map((_, i) => value(key, i))]))
    const picked: string[] = []
    // 1着ずつ、「各日のいちばん良い服 + 2番手」の合計がいちばん伸びる服を足していく。
    // 2番手まで数えるのは、休ませ中で1番手が使えない日があるから。
    const coverage = (keys: string[]) => {
      let total = 0
      for (let i = 0; i < season.days.length; i++) {
        const vals = keys.map((k) => table.get(k)![i]).sort((a, b) => b - a)
        total += (vals[0] ?? -80) + 0.5 * (vals[1] ?? -80)
      }
      return total
    }
    while (picked.length < size) {
      let bestKey = ''
      let best = -Infinity
      for (const key of season.pool) {
        if (picked.includes(key)) continue
        const v = coverage([...picked, key])
        if (v > best) {
          best = v
          bestKey = key
        }
      }
      picked.push(bestKey)
    }
    return picked
  },
  choose: (ctx) => {
    let bestKey = ''
    let best = -Infinity
    for (const key of fallbackKey(ctx)) {
      const v = rollout(ctx, key, 3)
      if (v > best) {
        best = v
        bestKey = key
      }
    }
    return bestKey
  },
  perk: ({ state }) => {
    const order: PerkId[] = ['layering', 'sleeves', 'iron', 'app', 'umbrella', 'earlybird', 'eye', 'rack']
    return order.find((p) => state.perkOffer.includes(p)) ?? state.perkOffer[0]
  },
}

/** botに1年を最後まで遊ばせる */
export function playRun(
  world: World,
  year: number,
  seed: number,
  bot: Bot,
  onMorning?: (ctx: BotContext) => void,
): { plan: RunPlan; state: RunState } {
  const plan = createPlan(world, year, seed)
  let state = startRun()
  for (let guard = 0; guard < 200 && state.phase !== 'report'; guard++) {
    const ctx = { world, plan, state }
    const before = state
    if (state.phase === 'draft') state = draftRack(plan, state, bot.draft(ctx))
    else if (state.phase === 'morning') {
      onMorning?.(ctx)
      state = wear(world, plan, state, bot.choose(ctx))
    }
    else if (state.phase === 'night') state = nextPhase(plan, state)
    else if (state.phase === 'perk') state = pickPerk(state, bot.perk?.(ctx) ?? state.perkOffer[0])
    if (state === before) throw new Error(`shiki bot ${bot.name} made an illegal move in ${before.phase}`)
  }
  return { plan, state }
}

/**
 * 答えを全部知っている人（実際の気温も本物の服も見える）。人間には不可能な上限の目安で、
 * ランクの境界が「届きうる高さ」に収まっているかの確認にだけ使う。
 */
export const oracleBot: Bot = {
  name: 'oracle',
  draft: ({ world, plan, state }) => {
    const season = plan.seasons[state.season]
    const base = { ...state, phase: 'morning' as const, rack: season.pool, restUntil: {} }
    const scored = season.pool.map((key) => {
      let best = 0
      for (let day = 0; day < season.days.length; day++) {
        const after = wear(world, plan, { ...base, day }, key)
        best = Math.max(best, after.log[after.log.length - 1].total)
      }
      return { key, best }
    })
    scored.sort((a, b) => b.best - a.best)
    return scored.slice(0, rackSizeOf(state)).map((s) => s.key)
  },
  choose: (ctx) => {
    let bestKey = ''
    let best = -Infinity
    for (const key of fallbackKey(ctx)) {
      const after = wear(ctx.world, ctx.plan, ctx.state, key)
      const log = after.log[after.log.length - 1]
      const v = log.total + 3 * log.hpDelta
      if (v > best) {
        best = v
        bestKey = key
      }
    }
    return bestKey
  },
}
