// 着戦のbot対戦ハーネス（テスト専用。アプリ本体には含めない）。
import {
  ARENA,
  activeAttackHitbox,
  createClashMatch,
  emptyClashInput,
  stepClashMatch,
  type ClashInput,
  type ClashMatch,
  type ClashRules,
  type FighterStats,
} from '../clash'
import { createClashCpu, type CpuProfile } from '../clashCpu'

export const DT = 1 / 60

export function seeded(seed: number) {
  let state = (seed * 2654435761) % 0x7fffffff || 1
  return () => {
    state = (state * 48271) % 0x7fffffff
    return state / 0x7fffffff
  }
}

export type Bot = (match: ClashMatch) => ClashInput

export const cpuBot = (id: 0 | 1, profile: CpuProfile, seed: number): Bot => {
  const cpu = createClashCpu(id, profile, seeded(seed))
  return (match) => cpu.next(match)
}

/**
 * 作り直す前の CPU（条件分岐＋乱数）をそのまま写した比較用の相手。
 * 反応間隔ごとに入力を決め、次に決め直すまで同じ入力を持ち続ける。
 */
export function legacyBot(
  id: 0 | 1,
  profile: { reaction: number; aggression: number; guard: number; recovery: number },
  seed: number,
): Bot {
  const random = seeded(seed)
  let held = emptyClashInput()
  let think = 0
  const decide = (match: ClashMatch): ClashInput => {
    const cpu = match.fighters[id]
    const foe = match.fighters[id === 0 ? 1 : 0]
    const input = emptyClashInput()
    if (match.phase !== 'fight' || cpu.respawn > 0 || cpu.hitstun > 0) return input
    const center = ARENA.main.x + ARENA.main.w / 2
    const offRight = cpu.x > ARENA.main.x + ARENA.main.w + 18
    const offLeft = cpu.x < ARENA.main.x - 18
    const belowStage = cpu.y > ARENA.main.y + 70
    if (offLeft || offRight || belowStage) {
      input.left = cpu.x > center
      input.right = cpu.x < center
      input.up = true
      input.jumpHeld = true
      if (cpu.jumpsLeft > 0 && cpu.vy > -130) input.jumpPressed = true
      if (
        cpu.specialCooldown <= 0 &&
        (belowStage || cpu.jumpsLeft <= 0 || random() < profile.recovery * 0.35)
      ) {
        input.specialPressed = true
      }
      return input
    }
    const dx = foe.x - cpu.x
    const dy = foe.y - cpu.y
    const distance = Math.abs(dx)
    const threatened = foe.action != null && activeAttackHitbox(foe) != null && distance < 150
    if (threatened && cpu.shield > 20 && random() < profile.guard) {
      input.shield = true
      input.shieldPressed = true
      return input
    }
    const nearEdge = cpu.x < ARENA.main.x + 70 || cpu.x > ARENA.main.x + ARENA.main.w - 70
    const desired = nearEdge ? Math.sign(center - cpu.x) : Math.sign(dx)
    if (distance > 80 || nearEdge) {
      input.left = desired < 0
      input.right = desired > 0
    }
    if ((dy < -85 || (distance > 180 && random() < 0.055)) && cpu.onGround) {
      input.jumpPressed = true
      input.jumpHeld = true
    }
    if (dy > 120 && !cpu.onGround) input.down = true
    const roll = random()
    if (distance < 92 && Math.abs(dy) < 105 && roll < profile.aggression) {
      input.attackPressed = true
      if (foe.y < cpu.y - 45) input.up = true
      else if (foe.y > cpu.y + 25) input.down = true
      else if (random() < 0.46) {
        input.left = dx < 0
        input.right = dx > 0
      }
    } else if (
      distance < 235 &&
      Math.abs(dy) < 115 &&
      cpu.specialCooldown <= 0 &&
      roll < profile.aggression * 0.3
    ) {
      input.specialPressed = true
      if (distance < 125) {
        input.left = dx < 0
        input.right = dx > 0
      }
    } else if (
      distance >= 235 &&
      distance < 520 &&
      cpu.specialCooldown <= 0 &&
      roll < profile.aggression * 0.16
    ) {
      input.specialPressed = true
      input.left = false
      input.right = false
    }
    return input
  }
  return (match) => {
    think -= DT
    if (think <= 0) {
      held = decide(match)
      think = profile.reaction * (0.65 + random() * 0.65)
    }
    const out = { ...held }
    held.jumpPressed = false
    held.attackPressed = false
    held.specialPressed = false
    held.shieldPressed = false
    return out
  }
}

export const LEGACY_HARD = { reaction: 0.12, aggression: 0.86, guard: 0.3, recovery: 0.98 }

export type MatchSummary = {
  winner: 0 | 1
  timeUp: boolean
  seconds: number
  stocks: [number, number]
  damage: [number, number]
  kos: [number, number]
  selfDestructs: [number, number]
  parries: [number, number]
  meteors: [number, number]
  ledgeGrabs: [number, number]
  dodges: [number, number]
}

export function playMatch(
  stats: [FighterStats, FighterStats],
  bots: [Bot, Bot],
  rules: ClashRules = {},
): MatchSummary {
  const match = createClashMatch(stats[0], stats[1], { countdown: 0.05, ...rules })
  const summary: MatchSummary = {
    winner: 0,
    timeUp: false,
    seconds: 0,
    stocks: [0, 0],
    damage: [0, 0],
    kos: [0, 0],
    selfDestructs: [0, 0],
    parries: [0, 0],
    meteors: [0, 0],
    ledgeGrabs: [0, 0],
    dodges: [0, 0],
  }
  let seen = 0
  let fightFrames = 0
  for (let frame = 0; frame < 60 * 400 && match.phase !== 'result'; frame++) {
    stepClashMatch(match, [bots[0](match), bots[1](match)], DT)
    if (match.phase === 'fight') fightFrames += 1
    for (const event of match.events) {
      if (event.id <= seen) continue
      seen = event.id
      if (event.type === 'hit') {
        summary.damage[event.attacker] += event.damage
        if (event.source === 'airDown') summary.meteors[event.attacker] += 1
      } else if (event.type === 'ko') {
        if (event.by == null) summary.selfDestructs[event.fighter] += 1
        else summary.kos[event.by] += 1
      } else if (event.type === 'parry') summary.parries[event.target] += 1
      else if (event.type === 'ledge') summary.ledgeGrabs[event.fighter] += 1
      else if (event.type === 'dodge') summary.dodges[event.fighter] += 1
      else if (event.type === 'gameOver') summary.timeUp = event.timeUp
    }
  }
  if (match.winner == null) throw new Error('試合が終わらなかった')
  summary.winner = match.winner
  summary.seconds = fightFrames / 60
  summary.stocks = [match.fighters[0].stocks, match.fighters[1].stocks]
  return summary
}
