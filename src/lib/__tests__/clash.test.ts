import { describe, expect, it } from 'vitest'
import {
  ARENA,
  CPU_PROFILES,
  DEFAULT_STATS,
  createClashMatch,
  cpuClashInput,
  emptyClashInput,
  stepClashMatch,
  type ClashInput,
  type ClashMatch,
} from '../clash'

const DT = 1 / 60

function beginMatch(): ClashMatch {
  const match = createClashMatch(DEFAULT_STATS, DEFAULT_STATS)
  for (let i = 0; i < 230; i++) stepClashMatch(match, [emptyClashInput(), emptyClashInput()], DT)
  expect(match.phase).toBe('fight')
  return match
}

function stepMany(match: ClashMatch, frames: number, p1: Partial<ClashInput> = {}) {
  for (let i = 0; i < frames; i++) {
    stepClashMatch(
      match,
      [{ ...emptyClashInput(), ...p1 }, emptyClashInput()],
      DT,
    )
  }
}

describe('clash match', () => {
  it('starts with a three-stock countdown and enters the fight', () => {
    const match = createClashMatch(DEFAULT_STATS, DEFAULT_STATS)

    expect(match.phase).toBe('countdown')
    expect(match.fighters.map((fighter) => fighter.stocks)).toEqual([3, 3])

    stepMany(match, 230)

    expect(match.phase).toBe('fight')
    expect(match.clock).toBeLessThan(180)
  })

  it('lands a close-range attack only once and builds damage', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    player.x = 580
    target.x = 642
    player.y = target.y = ARENA.main.y
    player.facing = 1

    stepMany(match, 22, { attackPressed: true })

    expect(target.percent).toBeGreaterThanOrEqual(6)
    const hitEvents = match.events.filter((event) => event.type === 'hit')
    expect(hitEvents.length).toBeLessThanOrEqual(1)
  })

  it('scales launch force with accumulated damage', () => {
    const low = beginMatch()
    low.fighters[0].x = 580
    low.fighters[1].x = 642
    low.fighters[0].y = low.fighters[1].y = ARENA.main.y
    stepMany(low, 20, { attackPressed: true })
    const lowLaunch = Math.hypot(low.fighters[1].vx, low.fighters[1].vy)

    const high = beginMatch()
    high.fighters[0].x = 580
    high.fighters[1].x = 642
    high.fighters[0].y = high.fighters[1].y = ARENA.main.y
    high.fighters[1].percent = 120
    stepMany(high, 20, { attackPressed: true })
    const highLaunch = Math.hypot(high.fighters[1].vx, high.fighters[1].vy)

    expect(highLaunch).toBeGreaterThan(lowLaunch * 1.7)
  })

  it('blocks damage with guard while draining the shield', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    player.x = 580
    target.x = 642
    player.y = target.y = ARENA.main.y
    player.facing = 1

    for (let i = 0; i < 22; i++) {
      stepClashMatch(
        match,
        [{ ...emptyClashInput(), attackPressed: i === 0 }, { ...emptyClashInput(), shield: true }],
        DT,
      )
    }

    expect(target.percent).toBe(0)
    expect(target.shield).toBeLessThan(100)
    expect(match.events.some((event) => event.type === 'shield')).toBe(true)
  })

  it('stuns a fighter when a heavy hit breaks the guard', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    player.x = 575
    target.x = 650
    player.y = target.y = ARENA.main.y
    target.shield = 20

    for (let i = 0; i < 34; i++) {
      stepClashMatch(
        match,
        [
          {
            ...emptyClashInput(),
            right: true,
            attackPressed: i === 0,
          },
          { ...emptyClashInput(), shield: true },
        ],
        DT,
      )
    }

    expect(target.hitstun).toBeGreaterThan(1)
    expect(match.events.some((event) => event.type === 'shieldBreak')).toBe(true)
  })

  it('fires a special projectile that cannot hit the same fighter twice', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    player.x = 430
    target.x = 710
    player.y = target.y = ARENA.main.y
    player.facing = 1

    stepClashMatch(
      match,
      [{ ...emptyClashInput(), specialPressed: true }, emptyClashInput()],
      DT,
    )
    stepMany(match, 60)

    expect(target.percent).toBeGreaterThan(0)
    expect(target.percent).toBeLessThan(15)
  })

  it('consumes a stock at a blast zone and ends the match on the last stock', () => {
    const match = beginMatch()
    const target = match.fighters[1]
    target.x = ARENA.blast.right + 1

    stepClashMatch(match, [emptyClashInput(), emptyClashInput()], DT)
    expect(target.stocks).toBe(2)
    expect(target.respawn).toBeGreaterThan(0)

    target.stocks = 1
    target.respawn = 0
    target.x = ARENA.blast.left - 1
    stepClashMatch(match, [emptyClashInput(), emptyClashInput()], DT)

    expect(match.phase).toBe('result')
    expect(match.winner).toBe(0)
  })

  it('limits air jumps and refreshes them after landing', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    player.y = ARENA.main.y
    player.onGround = true

    stepClashMatch(
      match,
      [{ ...emptyClashInput(), jumpPressed: true, jumpHeld: true }, emptyClashInput()],
      DT,
    )
    stepMany(match, 15, { jumpHeld: true })
    stepClashMatch(
      match,
      [{ ...emptyClashInput(), jumpPressed: true, jumpHeld: true }, emptyClashInput()],
      DT,
    )
    expect(player.jumpsLeft).toBe(0)

    stepMany(match, 180)
    expect(player.onGround).toBe(true)
    expect(player.jumpsLeft).toBe(DEFAULT_STATS.airJumps)
  })

  it('makes a CPU below the stage steer inward and use recovery', () => {
    const match = beginMatch()
    const cpu = match.fighters[1]
    cpu.x = ARENA.main.x + ARENA.main.w + 140
    cpu.y = ARENA.main.y + 170
    cpu.onGround = false
    cpu.vy = 160

    const input = cpuClashInput(match, 1, CPU_PROFILES.hard, () => 0.2)

    expect(input.left).toBe(true)
    expect(input.up).toBe(true)
    expect(input.specialPressed || input.jumpPressed).toBe(true)
  })

  it('keeps a full CPU-versus-CPU simulation finite and produces combat', () => {
    const match = beginMatch()
    let seed = 17
    const random = () => {
      seed = (seed * 48271) % 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let frame = 0; frame < 60 * 45 && match.phase !== 'result'; frame++) {
      const first = cpuClashInput(match, 0, CPU_PROFILES.hard, random)
      const second = cpuClashInput(match, 1, CPU_PROFILES.hard, random)
      stepClashMatch(match, [first, second], DT)
    }

    for (const fighter of match.fighters) {
      expect(Number.isFinite(fighter.x)).toBe(true)
      expect(Number.isFinite(fighter.y)).toBe(true)
      expect(Number.isFinite(fighter.percent)).toBe(true)
    }
    expect(match.events.some((event) => event.type === 'hit')).toBe(true)
  })
})
