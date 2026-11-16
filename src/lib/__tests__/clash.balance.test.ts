import { describe, expect, it } from 'vitest'
import { DEFAULT_STATS } from '../clash'
import { CPU_LEVELS, CPU_PROFILES, type CpuLevel } from '../clashCpu'
import { CLASH_KITS, clashStats } from '../clashRoster'
import { LEGACY_HARD, cpuBot, legacyBot, playMatch, type Bot, type MatchSummary } from './clashBots'

// CPU の強さと季節のバランスを、bot どうしの対戦で保証する。
// 調整用: VITE_CLASH_REPORT=1 pnpm vitest run src/lib/__tests__/clash.balance.test.ts --disable-console-intercept
const REPORT = Boolean(import.meta.env.VITE_CLASH_REPORT)
const report = (line: string) => {
  if (REPORT) console.log(line)
}

type Maker = (id: 0 | 1, seed: number) => Bot
const level = (name: CpuLevel): Maker => (id, seed) => cpuBot(id, CPU_PROFILES[name], seed)
const legacy: Maker = (id, seed) => legacyBot(id, LEGACY_HARD, seed)

/** 席を交互に入れ替えながら `games` 試合。`a` 側から見た集計を返す。 */
function series(a: Maker, b: Maker, games: number, stats = [DEFAULT_STATS, DEFAULT_STATS] as const) {
  const total = { wins: 0, seconds: 0, selfDestructs: 0, kos: 0, timeUps: 0, results: [] as MatchSummary[] }
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1
    const bots: [Bot, Bot] = swap ? [b(0, 100 + i), a(1, 200 + i)] : [a(0, 200 + i), b(1, 100 + i)]
    const result = playMatch(swap ? [stats[1], stats[0]] : [stats[0], stats[1]], bots)
    const seat = swap ? 1 : 0
    if (result.winner === seat) total.wins += 1
    total.seconds += result.seconds
    total.selfDestructs += result.selfDestructs[seat]
    total.kos += result.kos[seat]
    if (result.timeUp) total.timeUps += 1
    total.results.push(result)
  }
  return total
}

describe('clash balance', () => {
  it('makes each difficulty clearly stronger than the one below', { timeout: 120_000 }, () => {
    for (let i = 1; i < CPU_LEVELS.length; i++) {
      const games = 10
      const result = series(level(CPU_LEVELS[i]), level(CPU_LEVELS[i - 1]), games)
      report(`${CPU_LEVELS[i]} vs ${CPU_LEVELS[i - 1]}: ${result.wins}/${games}`)
      expect(result.wins / games, `${CPU_LEVELS[i]} vs ${CPU_LEVELS[i - 1]}`).toBeGreaterThanOrEqual(0.7)
    }
  })

  it('outplays the old rule-based CPU from NORMAL up, while EASY stays beatable', { timeout: 120_000 }, () => {
    const games = 12
    // NORMAL は旧CPU（HARD相当）に勝ち越す程度、HARD と ONI は圧倒する。
    const floor = { normal: 0.5, hard: 0.85, oni: 0.85 } as const
    for (const name of ['normal', 'hard', 'oni'] as const) {
      const result = series(level(name), legacy, games)
      report(`${name} vs legacy: ${result.wins}/${games}, avg ${(result.seconds / games).toFixed(0)}s`)
      expect(result.wins / games, name).toBeGreaterThan(floor[name] - 0.001)
    }
    const easy = series(level('easy'), legacy, games)
    report(`easy vs legacy: ${easy.wins}/${games}`)
    expect(easy.wins / games).toBeLessThanOrEqual(0.5)
  })

  it('finishes matches by knockouts, not by walking off the stage', { timeout: 120_000 }, () => {
    const games = 6
    for (const name of ['hard', 'oni'] as const) {
      const result = series(level(name), level(name), games)
      const selfDestructs = result.results.reduce(
        (sum, match) => sum + match.selfDestructs[0] + match.selfDestructs[1],
        0,
      )
      const kos = result.results.reduce((sum, match) => sum + match.kos[0] + match.kos[1], 0)
      report(`${name} mirror: KO ${kos}, SD ${selfDestructs}, time-ups ${result.timeUps}, avg ${(result.seconds / games).toFixed(0)}s`)
      // 強い CPU は自滅しない。撃墜の 1 割未満。
      expect(selfDestructs).toBeLessThanOrEqual(Math.ceil(kos * 0.1))
      // 決着は時間切れではなく撃墜でつく。
      expect(result.timeUps).toBeLessThanOrEqual(1)
      // 1ストックあたり 8〜45 秒。瞬殺でも泥仕合でもない。
      const perStock = result.seconds / Math.max(1, kos + selfDestructs)
      expect(perStock).toBeGreaterThan(8)
      expect(perStock).toBeLessThan(45)
    }
  })

  it('uses the advanced techniques only on HARD and ONI', { timeout: 60_000 }, () => {
    const count = (name: CpuLevel) => {
      const result = series(level(name), level(name), 4)
      return result.results.reduce(
        (sum, match) => ({
          dodges: sum.dodges + match.dodges[0] + match.dodges[1],
          meteors: sum.meteors + match.meteors[0] + match.meteors[1],
          ledges: sum.ledges + match.ledgeGrabs[0] + match.ledgeGrabs[1],
        }),
        { dodges: 0, meteors: 0, ledges: 0 },
      )
    }
    const normal = count('normal')
    const oni = count('oni')
    report(`normal ${JSON.stringify(normal)} / oni ${JSON.stringify(oni)}`)
    expect(normal.dodges).toBe(0)
    expect(normal.meteors).toBe(0)
    expect(oni.dodges).toBeGreaterThan(8)
    expect(oni.meteors).toBeGreaterThan(2)
    // 崖は誰でも使う（復帰の基本）。
    expect(normal.ledges).toBeGreaterThan(0)
    expect(oni.ledges).toBeGreaterThan(0)
  })

  it('keeps the four seasonal kits within reach of each other', { timeout: 180_000 }, () => {
    const games = Number(import.meta.env.VITE_CLASH_GAMES ?? 8)
    const wins = new Map(CLASH_KITS.map((kit) => [kit, 0]))
    const played = new Map(CLASH_KITS.map((kit) => [kit, 0]))
    for (const a of CLASH_KITS) {
      for (const b of CLASH_KITS) {
        if (a >= b) continue
        const result = series(level('hard'), level('hard'), games, [clashStats(a), clashStats(b)])
        wins.set(a, wins.get(a)! + result.wins)
        wins.set(b, wins.get(b)! + games - result.wins)
        played.set(a, played.get(a)! + games)
        played.set(b, played.get(b)! + games)
      }
    }
    for (const kit of CLASH_KITS) {
      const rate = wins.get(kit)! / played.get(kit)!
      report(`${kit}: ${(rate * 100).toFixed(0)}%`)
      // 少ない試合数でのぶれを見込んだ幅。VITE_CLASH_GAMES=40 で回すと 45〜55% に収まる。
      expect(rate, kit).toBeGreaterThan(0.25)
      expect(rate, kit).toBeLessThan(0.75)
    }
  })

  it('thinks fast enough to run every frame on a phone', { timeout: 60_000 }, () => {
    // ONI どうしの 1 試合を丸ごと進め、1 フレームあたりの計算時間を測る（描画は含まない）。
    const started = performance.now()
    const result = series(level('oni'), level('oni'), 2)
    const perFrame = (performance.now() - started) / (result.seconds * 60)
    report(`oni mirror: ${perFrame.toFixed(3)}ms per frame for both CPUs`)
    // 2体ぶんで 1 フレーム 2ms 未満（60fps の 1 フレームは 16.7ms）。CI の遅さを見込んだ上限。
    expect(perFrame).toBeLessThan(2)
  })
})
