import { describe, expect, it } from 'vitest'
import {
  ARENA,
  DEFAULT_STATS,
  createClashMatch,
  emptyClashInput,
  ledgePoint,
  stepClashMatch,
  type ClashMatch,
} from '../clash'
import {
  CPU_PROFILES,
  chooseClashPlan,
  createClashCpu,
  isOffstage,
  predictKo,
  recoveryInput,
} from '../clashCpu'
import {
  CLASH_COLORS,
  CLASH_KITS,
  clashStats,
  clashType,
  fitsFighterBox,
  pickClashRoster,
} from '../clashRoster'
import { DT, seeded } from './clashBots'

function beginMatch(): ClashMatch {
  const match = createClashMatch(DEFAULT_STATS, DEFAULT_STATS, { countdown: 0.02 })
  for (let i = 0; i < 4; i++) stepClashMatch(match, [emptyClashInput(), emptyClashInput()], DT)
  expect(match.phase).toBe('fight')
  return match
}

/** 2P を場外の指定位置に置く。 */
function strand(match: ClashMatch, x: number, y: number, jumpsLeft: number) {
  const cpu = match.fighters[1]
  cpu.x = x
  cpu.y = y
  cpu.vx = 0
  cpu.vy = 160
  cpu.onGround = false
  cpu.ground = -1
  cpu.jumpsLeft = jumpsLeft
  return cpu
}

describe('clash cpu', () => {
  it('returns to the stage from deep offstage on every difficulty when it does not blunder', () => {
    const right = ledgePoint('right')
    const spots: [number, number, number][] = [
      [right.x + 150, right.y + 170, 1],
      [right.x + 260, right.y + 40, 1],
      [right.x + 90, right.y + 230, 0],
      [ARENA.main.x - 200, right.y + 120, 1],
      // ステージの真下。外へ回り込んでから上がる必要がある。
      [right.x - 120, right.y + 190, 1],
    ]
    for (const level of ['easy', 'normal', 'hard', 'oni'] as const) {
      for (const [x, y, jumps] of spots) {
        const match = beginMatch()
        // 相手は反対側の端で何もしない。
        match.fighters[0].x = x < 640 ? 900 : 380
        const cpu = strand(match, x, y, jumps)
        const brain = createClashCpu(1, { ...CPU_PROFILES[level], blunder: 0 }, seeded(7))
        for (let frame = 0; frame < 300 && !cpu.onGround; frame++) {
          stepClashMatch(match, [emptyClashInput(), brain.next(match)], DT)
        }
        expect(cpu.stocks, `${level} from ${x},${y}`).toBe(3)
        expect(cpu.onGround, `${level} from ${x},${y}`).toBe(true)
      }
    }
  })

  it('knows a hopeless position is hopeless, and a recoverable one is not', () => {
    const match = beginMatch()
    const right = ledgePoint('right')
    strand(match, right.x + 120, right.y + 150, 1)
    expect(isOffstage(match.fighters[1])).toBe(true)
    // 定石どおりに戻れば助かる位置。
    match.fighters[1].hitstun = 0.01
    expect(predictKo(match, 1)).toBe(false)

    // ジャンプも復帰技も使い切って崖のはるか下。
    const doomed = strand(match, right.x + 200, right.y + 240, 0)
    doomed.usedRecovery = true
    doomed.hitstun = 0.01
    expect(predictKo(match, 1)).toBe(true)
  })

  it('steers outward first when caught underneath the stage', () => {
    const match = beginMatch()
    const cpu = strand(match, ARENA.main.x + 120, ARENA.main.y + 190, 1)
    const input = recoveryInput(cpu)
    expect(input.left).toBe(true)
    expect(input.right).toBe(false)
  })

  it('punishes an opponent while they are still stuck in a whiffed attack', () => {
    const match = beginMatch()
    const [player, cpu] = match.fighters
    player.x = 600
    cpu.x = 690
    // 相手は背中を向けて大振りを空振りしている最中。
    player.facing = -1
    player.action = { kind: 'smash', time: 0.1, hit: false }
    const plan = chooseClashPlan(match, 1, { ...CPU_PROFILES.oni, noise: 0 }, seeded(3))
    let hit = false
    let stillBusy = false
    for (let frame = 0; frame < 40 && !hit; frame++) {
      stillBusy = player.action != null
      stepClashMatch(match, [emptyClashInput(), plan.input(frame, cpu)], DT)
      hit = match.events.some((event) => event.type === 'hit' && event.attacker === 1)
    }
    expect(hit).toBe(true)
    // 硬直が解けたあとではなく、隙のあいだに当てている。
    expect(stillBusy).toBe(true)
    expect(cpu.percent).toBe(0)
  })

  it('cannot react to a jab it has not had time to see, but guards a slow smash', () => {
    const guards = (kind: 'jab' | 'smash', time: number) => {
      const match = beginMatch()
      const [player, cpu] = match.fighters
      player.x = 600
      cpu.x = 668
      player.facing = 1
      cpu.facing = -1
      player.action = { kind, time, hit: false }
      // 反撃の読みを切り、見えているものだけで判断させる。
      const profile = { ...CPU_PROFILES.hard, noise: 0, caution: 0, blunder: 0 }
      const plan = chooseClashPlan(match, 1, profile, seeded(5))
      for (let frame = 0; frame < 24; frame++) {
        stepClashMatch(match, [emptyClashInput(), plan.input(frame, cpu)], DT)
      }
      return cpu.percent === 0
    }
    // 弱攻撃は出が速すぎて、見てからでは間に合わない。
    expect(guards('jab', 0.03)).toBe(false)
    // 強攻撃は構えが見えるので、守るか避けるかできる。
    expect(guards('smash', 0.17)).toBe(true)
  })

  it('plays the same match from the same seed', () => {
    const run = () => {
      const match = beginMatch()
      const bots = [
        createClashCpu(0, CPU_PROFILES.hard, seeded(11)),
        createClashCpu(1, CPU_PROFILES.normal, seeded(12)),
      ] as const
      for (let frame = 0; frame < 900 && match.phase === 'fight'; frame++) {
        stepClashMatch(match, [bots[0].next(match), bots[1].next(match)], DT)
      }
      return match.fighters.map((fighter) => [fighter.x, fighter.y, fighter.percent, fighter.stocks])
    }
    expect(run()).toEqual(run())
  })

  it('stays idle outside the fight and while knocked out', () => {
    const fighting = beginMatch()
    fighting.fighters[1].respawn = 0.5
    expect(createClashCpu(1, CPU_PROFILES.oni, seeded(1)).next(fighting)).toEqual(emptyClashInput())

    const match = createClashMatch(DEFAULT_STATS, DEFAULT_STATS)
    const brain = createClashCpu(1, CPU_PROFILES.oni, seeded(1))
    expect(brain.next(match)).toEqual(emptyClashInput())
  })
})

describe('clash roster', () => {
  it('keeps every season and color combination within a playable range', () => {
    for (const kit of CLASH_KITS) {
      for (const color of [undefined, ...CLASH_COLORS]) {
        const stats = clashStats(kit, color)
        expect(stats.kit).toBe(kit)
        for (const key of ['speed', 'jump', 'power', 'weight', 'airControl'] as const) {
          expect(stats[key], `${kit}/${color}/${key}`).toBeGreaterThanOrEqual(0.9)
          expect(stats[key], `${kit}/${color}/${key}`).toBeLessThanOrEqual(1.25)
        }
        expect([1, 2]).toContain(stats.airJumps)
        expect(['SPEED', 'POWER', 'AIR', 'HEAVY', 'BALANCE']).toContain(clashType(stats))
      }
    }
  })

  it('names the type after what actually stands out, not one label for everyone', () => {
    expect(clashType(clashStats('summer', 'yellow'))).toBe('SPEED')
    expect(clashType(clashStats('winter', 'navy'))).toBe('HEAVY')
    expect(clashType(clashStats('spring', 'green'))).toBe('AIR')
    expect(clashType(clashStats('autumn', 'black'))).toBe('POWER')
    const types = new Set(
      CLASH_KITS.flatMap((kit) => CLASH_COLORS.map((color) => clashType(clashStats(kit, color)))),
    )
    expect(types.size).toBeGreaterThanOrEqual(4)
  })

  it('picks the newest person-shaped look for each season and color', () => {
    const look = (key: string, season: (typeof CLASH_KITS)[number], color: string | undefined, ratio = 0.38) => ({
      key,
      season,
      color,
      ratio,
    })
    // 新しい順。
    const roster = pickClashRoster([
      look('bike', 'winter', 'navy', 0.95),
      look('w-navy-new', 'winter', 'navy'),
      look('w-navy-old', 'winter', 'navy'),
      look('s-red', 'spring', 'red'),
      look('w-black', 'winter', 'black'),
      look('s-none', 'spring', undefined),
      look('s-red-old', 'spring', 'red'),
      look('two-people', 'summer', 'white', 0.8),
    ])
    // 季節の順に並び、同じ季節×色は新しい1着だけ。幅の広いくり抜きは使わない。
    expect(roster.map((entry) => entry.key)).toEqual(['s-red', 's-none', 'w-navy-new', 'w-black'])
    expect(fitsFighterBox(0.38)).toBe(true)
    expect(fitsFighterBox(0.95)).toBe(false)
  })
})
