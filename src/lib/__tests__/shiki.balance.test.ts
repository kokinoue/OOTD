import { describe, expect, it } from 'vitest'
import cutoutsJson from '../../data/cutouts.json'
import overridesJson from '../../data/overrides.json'
import splitsJson from '../../data/splits.json'
import weatherJson from '../../data/weather.json'
import type { Overrides, SplitsFile } from '../../types'
import {
  RANK_BORDERS,
  availableKeys,
  availableYears,
  finalScore,
  missOf,
  worldFromData,
  type RunState,
} from '../shiki'
import { greedyBot, oracleBot, plannerBot, playRun, randomBot, type Bot } from '../shikiBots'
import { buildData, outfits } from '../useData'
import type { DayTemp } from '../weather'

// 実データで自動プレイヤーに何百回も遊ばせ、「でたらめだと倒れる・考えれば完走できる・
// 先まで読むほど点が伸びる」という難易度の骨格が保たれていることを確かめる。
const data = buildData(
  { renames: {}, categories: {}, merges: {}, hidden: [], colors: {}, ...(overridesJson as Partial<Overrides>) },
  splitsJson as SplitsFile,
)
const sprites = (cutoutsJson as { sprites: Record<string, unknown> }).sprites
const world = worldFromData(data, outfits, weatherJson as Record<string, DayTemp>, (key) => key in sprites)
const years = availableYears(world)
const SEEDS = Array.from({ length: 30 }, (_, i) => i)

type Stats = { open: number; comfyOpen: number; minHp: number; fail: number; mean: number; p10: number; p50: number; p90: number; forced: number; comfort: number; exact: number }

function sample(make: (seed: number) => Bot): { stats: Stats; states: RunState[] } {
  const states: RunState[] = []
  let mornings = 0
  let open = 0
  let comfyOpen = 0
  for (const year of years) {
    for (const seed of SEEDS) {
      const run = playRun(world, year, seed, make(seed * 31 + year), ({ plan, state }) => {
        const w = plan.seasons[state.season].days[state.day].weather
        const keys = availableKeys(world, state)
        mornings++
        open += keys.length
        comfyOpen += keys.filter((k) => {
          const m = missOf(world.cards.get(k)!, w.morning, w.max, state.perks)
          return m.cold + m.hot <= 0
        }).length
      })
      states.push(run.state)
    }
  }
  const scores = states.map(finalScore).sort((a, b) => a - b)
  const at = (p: number) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))]
  const days = states.reduce((s, st) => s + st.log.length, 0)
  return {
    states,
    stats: {
      open: open / mornings,
      comfyOpen: comfyOpen / mornings,
      minHp: Math.round(states.reduce((s, st) => s + Math.min(100, ...st.log.map((l) => l.hpAfter)), 0) / states.length),
      fail: states.filter((s) => s.failed).length / states.length,
      mean: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      p10: at(0.1),
      p50: at(0.5),
      p90: at(0.9),
      forced: states.reduce((s, st) => s + st.log.filter((l) => l.forced).length, 0) / days,
      comfort: states.reduce((s, st) => s + st.log.filter((l) => l.cold + l.hot <= 0 && !l.wet).length, 0) / days,
      exact: states.reduce((s, st) => s + st.log.filter((l) => l.exact).length, 0) / days,
    },
  }
}

describe('四季通勤の難易度', () => {
  const random = sample((seed) => randomBot(seed))
  const greedy = sample(() => greedyBot)
  const planner = sample(() => plannerBot)
  const oracle = sample(() => oracleBot)
  // 調整用: VITE_SHIKI_REPORT=1 pnpm vitest run src/lib/__tests__/shiki.balance.test.ts で成績の分布を表示する
  if (import.meta.env.VITE_SHIKI_REPORT) {
    const row = (name: string, s: Stats) =>
      `${name.padEnd(8)} fail ${(s.fail * 100).toFixed(1).padStart(5)}%  minHp ${String(s.minHp).padStart(3)}  mean ${s.mean}  p10 ${s.p10}  p50 ${s.p50}  p90 ${s.p90}  comfort ${(s.comfort * 100).toFixed(0)}%  forced ${(s.forced * 100).toFixed(1)}%  exact ${(s.exact * 100).toFixed(0)}%  open ${s.open.toFixed(1)}  comfyOpen ${s.comfyOpen.toFixed(1)}`
    console.log(
      [row('random', random.stats), row('greedy', greedy.stats), row('planner', planner.stats), row('oracle', oracle.stats)].join('\n'),
    )
  }

  it('遊べる年が複数ある', () => {
    expect(years.length).toBeGreaterThanOrEqual(3)
  })

  it('でたらめに選ぶと、たいてい1年もたない', () => {
    expect(random.stats.fail).toBeGreaterThan(0.8)
  })

  it('その日の予報に合わせるだけでも、ほぼ完走できる', () => {
    expect(greedy.stats.fail).toBeLessThan(0.15)
  })

  it('先まで読んで着回すと、ほぼ必ず完走でき、点も伸びる', () => {
    expect(planner.stats.fail).toBeLessThan(0.05)
    expect(planner.stats.mean).toBeGreaterThan(greedy.stats.mean)
    expect(greedy.stats.mean).toBeGreaterThan(random.stats.mean)
  })

  it('着られる服が1着もない朝は、上手に回していればまず起きない', () => {
    expect(planner.stats.forced).toBeLessThan(0.02)
  })

  it('毎朝、選択肢は複数あるが、快適に過ごせる服は限られている', () => {
    expect(planner.stats.open).toBeGreaterThan(4)
    expect(planner.stats.comfyOpen).toBeGreaterThan(1.2)
    expect(planner.stats.comfyOpen).toBeLessThan(3.5)
  })

  it('ランクの境界は、上手なbotがB〜A、答えを知っていればSに届く高さにある', () => {
    const border = (rank: string) => RANK_BORDERS.find((b) => b.rank === rank)!.min
    expect(planner.stats.p50).toBeGreaterThanOrEqual(border('B'))
    expect(planner.stats.p90).toBeLessThan(border('S'))
    expect(oracle.stats.p50).toBeGreaterThanOrEqual(border('S'))
  })
})
