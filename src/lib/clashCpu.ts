// KISEKAE CLASH の CPU。
//
// 「近ければ殴る、乱数で守る」という条件分岐ではなく、先読みで手を選ぶ。
//   1. いまの状況から打てる手（歩く・跳ぶ・各種攻撃・ガード・回避・復帰…）を数十通り並べる
//   2. 試合をまるごと複製し、それぞれの手を実際のルールで 0.3〜0.6 秒先まで進める
//   3. 与えたダメージ、受けたダメージ、撃墜、場外に取り残される危険、間合いを採点する
//   4. 上位の手は「相手が最速で反撃してきた場合」でも進め直し、差し返されない手を残す
// 対戦ルール（`clash.ts`）が乱数を使わない決定論的な純粋ロジックなので、これが成立する。
// 強さの違いは、考え直す間隔（＝反応の速さ）・読みの深さ・評価のぶれ・手の幅だけで作っていて、
// どの強さでも CPU が有利になる補正（ダメージ倍率や入力の先読み）は一切ない。

import {
  ARENA,
  ATTACKS,
  LEDGE,
  PHYSICS,
  cloneClashMatch,
  emptyClashInput,
  ledgePoint,
  stepClashMatch,
  type ClashInput,
  type ClashMatch,
  type Fighter,
  type LedgeSide,
} from './clash'

export type CpuLevel = 'easy' | 'normal' | 'hard' | 'oni'

export type CpuProfile = {
  /** 考え直す間隔（秒）。人間でいう反応時間。 */
  reaction: number
  /** 何フレーム先まで読むか。 */
  horizon: number
  /** 採点に乗るぶれ（点）。大きいほど最善手を外す。 */
  noise: number
  /** 読まずに雑な手を出す確率。 */
  blunder: number
  /** 攻めの重み。 */
  aggression: number
  /** 相手の反撃をどれだけ織り込むか（0〜1）。 */
  caution: number
  /** 回避・ジャストガード・メテオ・場外追撃まで手に入れるか。 */
  advanced: boolean
  /**
   * 相手の動き出しに気づくまでの時間（秒）。これより出の速い技は、見てからは守れない。
   * 人間と同じで、弱攻撃は読みでしか止められず、出の遅い強攻撃なら反応して守れる。
   */
  perception: number
  /** 「相手も先読みで最善手を選んでくる」前提をどれだけ織り込むか（0〜1）。 */
  foresight: number
}

export const CPU_LEVELS: CpuLevel[] = ['easy', 'normal', 'hard', 'oni']

export const CPU_PROFILES: Record<CpuLevel, CpuProfile> = {
  easy: {
    reaction: 0.36,
    horizon: 16,
    noise: 30,
    blunder: 0.34,
    aggression: 0.55,
    caution: 0,
    advanced: false,
    perception: 0.34,
    foresight: 0,
  },
  normal: {
    reaction: 0.3,
    horizon: 18,
    noise: 26,
    blunder: 0.26,
    aggression: 0.7,
    caution: 0.1,
    advanced: false,
    perception: 0.28,
    foresight: 0,
  },
  hard: {
    reaction: 0.16,
    horizon: 28,
    noise: 8,
    blunder: 0.06,
    aggression: 1,
    caution: 0.5,
    advanced: true,
    perception: 0.16,
    foresight: 0,
  },
  oni: {
    reaction: 0.075,
    horizon: 34,
    noise: 1.2,
    blunder: 0,
    aggression: 1.1,
    caution: 0.6,
    advanced: true,
    perception: 0.09,
    foresight: 0.3,
  },
}

const STEP = 1 / 60
const HALF_W = PHYSICS.fighterW / 2
const CENTER = ARENA.main.x + ARENA.main.w / 2
/** 攻撃や回避の方向入力を押し続けるフレーム数（先行入力で数フレーム遅れて出ても狙いがずれない）。 */
const AIM_HOLD = 5
/** 吹っ飛びや復帰の決着がつくまで、読みを延ばす上限。 */
const SETTLE_FRAMES = 110

export type CpuPlan = {
  name: string
  input: (frame: number, me: Fighter) => ClashInput
}

type Aim = 'n' | 'up' | 'down' | -1 | 1

type ScriptOptions = {
  move?: -1 | 0 | 1
  /** 0 = 跳ばない、1 = 小ジャンプ、2 = 大ジャンプ。 */
  jump?: 0 | 1 | 2
  jumpAt?: number
  act?: 'attack' | 'special' | 'shield' | 'dodge'
  aim?: Aim
  at?: number
  /** ガードを張り続けるフレーム数。 */
  hold?: number
  /** 落下中は急降下する。 */
  fall?: boolean
  /** soft 足場をすり抜ける。 */
  drop?: boolean
  /** 上昇中のジャンプを切らずに伸ばす。 */
  rise?: boolean
  /** 動く前に 1 フレームだけ向き直す方向。 */
  face?: -1 | 0 | 1
}

function script(name: string, options: ScriptOptions): CpuPlan {
  const at = options.at ?? 0
  const jumpAt = options.jumpAt ?? 0
  return {
    name,
    input: (frame, me) => {
      const input = emptyClashInput()
      let dir: -1 | 0 | 1 = options.move ?? 0
      if (frame === 0 && options.face && dir === 0) dir = options.face
      const span = options.act === 'shield' ? (options.hold ?? 12) : AIM_HOLD
      const acting = options.act != null && frame >= at && frame < at + span
      if (acting) {
        const aim = options.aim ?? 'n'
        if (options.act === 'shield') {
          input.shield = true
          input.shieldPressed = frame === at
          dir = 0
        } else if (options.act === 'dodge') {
          if (frame === at) {
            input.shield = true
            input.shieldPressed = true
            if (aim === 'up') input.up = true
            else if (aim === 'down') input.down = true
            else if (aim !== 'n') dir = aim
            else dir = 0
          }
        } else {
          if (frame === at) {
            if (options.act === 'attack') input.attackPressed = true
            else input.specialPressed = true
          }
          if (aim === 'up') input.up = true
          else if (aim === 'down') input.down = true
          else if (aim === 'n') dir = 0
          else dir = aim
        }
      }
      if (options.jump && frame === jumpAt) input.jumpPressed = true
      if (options.jump === 2 || options.rise) input.jumpHeld = true
      if (options.drop && frame === 0) {
        input.down = true
        input.jumpPressed = true
      }
      if (options.fall && !acting && !me.onGround && me.vy > 0) input.down = true
      input.left = dir < 0
      input.right = dir > 0
      return input
    },
  }
}

const IDLE = script('idle', {})

function shifted(plan: CpuPlan, offset: number): CpuPlan {
  return { name: plan.name, input: (frame, me) => plan.input(frame + offset, me) }
}

const nearestLedge = (fighter: Fighter): LedgeSide => (fighter.x < CENTER ? 'left' : 'right')

/** ステージの外、または下にいて、何もしなければ落ちる位置か。 */
export function isOffstage(fighter: Fighter) {
  if (fighter.onGround || fighter.ledge || fighter.respawn > 0) return false
  const body = ARENA.main
  if (fighter.x < body.x - HALF_W || fighter.x > body.x + body.w + HALF_W) return true
  return fighter.y > body.y + 2
}

const settled = (fighter: Fighter) =>
  fighter.respawn > 0 ||
  fighter.stocks <= 0 ||
  fighter.onGround ||
  fighter.ledge != null ||
  (fighter.hitstun <= 0 && !isOffstage(fighter))

/**
 * 崖へ戻るための定石。CPU 自身の復帰と、先読みの中での「相手もちゃんと戻ってくる」想定に使う。
 * 位置だけを見て毎フレーム決める閉ループなので、途中で殴られても続きから復帰できる。
 */
export function recoveryInput(fighter: Fighter): ClashInput {
  const input = emptyClashInput()
  if (fighter.ledge) {
    input.up = fighter.ledgeTime > 0.2
    return input
  }
  const body = ARENA.main
  const side = nearestLedge(fighter)
  const point = ledgePoint(side)
  const toward = side === 'left' ? 1 : -1
  /** 崖の外側にどれだけ離れているか。負ならステージの真下に潜っている。 */
  const outside = (point.x - fighter.x) * toward
  const depth = fighter.y - point.y
  const underStage = outside < HALF_W + 2 && fighter.y - PHYSICS.fighterH > body.y + body.h - 6
  const dir = underStage ? -toward : toward
  input.left = dir < 0
  input.right = dir > 0
  input.jumpHeld = true
  if (underStage) {
    // 真下では、頭をぶつけない深さまで落ちてから跳び、その滞空で外へ出る。
    const airRise = (PHYSICS.airJumpSpeed * fighter.stats.jump) ** 2 / (2 * PHYSICS.gravity)
    const clear = fighter.y - PHYSICS.fighterH - airRise > body.y + body.h + 4
    if (fighter.jumpsLeft > 0 && fighter.vy > 0 && clear) input.jumpPressed = true
    return input
  }

  const canSpecial = fighter.specialCooldown <= 0 && !fighter.action
  const falling = fighter.vy > -80
  const withinReach =
    outside > 0 && outside <= LEDGE.reachX && depth >= 0 && depth < LEDGE.reachBottom - 6
  if (falling && !withinReach && depth > 34) {
    if (fighter.jumpsLeft > 0) input.jumpPressed = true
    else if (canSpecial && !fighter.usedRecovery && depth > 84) {
      input.up = true
      input.specialPressed = true
    }
  } else if (
    canSpecial &&
    outside > 300 &&
    depth < 40 &&
    fighter.vy > 0 &&
    fighter.jumpsLeft === 0
  ) {
    // 高さは足りているが横が遠いときは、横必殺で距離を稼ぐ。
    input.specialPressed = true
  }
  return input
}

type FoeModel = 'inertia' | 'punish' | CpuPlan

/** 先読みの中での相手。場外にいれば復帰し、'punish' なら届く間合いで最速の技を振る。 */
function foeInput(model: FoeModel, frame: number, foe: Fighter, me: Fighter): ClashInput {
  if (foe.ledge || isOffstage(foe)) return recoveryInput(foe)
  const input = emptyClashInput()
  if (foe.shielding && frame < 10) {
    input.shield = true
    return input
  }
  if (model === 'inertia') return input
  if (model !== 'punish') return model.input(frame, foe)
  if (foe.action || foe.dodge || foe.hitstun > 0 || foe.lag > 0 || foe.shieldStun > 0) return input
  const dx = me.x - foe.x
  const dy = me.y - foe.y
  const ax = Math.abs(dx)
  const side = dx < 0 ? -1 : 1
  if (foe.onGround) {
    if (ax < 104 && Math.abs(dy) < 62) {
      input.attackPressed = true
      if (foe.facing !== side) {
        input.left = side < 0
        input.right = side > 0
      }
    } else if (ax < 150 && Math.abs(dy) < 62) {
      input.attackPressed = true
      input.left = side < 0
      input.right = side > 0
    } else if (ax < 58 && dy < -60 && dy > -190) {
      input.attackPressed = true
      input.up = true
    }
  } else if (ax < 84 && Math.abs(dy) < 92) {
    input.attackPressed = true
  }
  return input
}

/**
 * 場外に取り残される危険の見積もり（0 = 安全、1 以上 = ほぼ戻れない）。
 * 読みを延ばしても決着がつかなかったときの保険。
 */
function strandedRisk(fighter: Fighter) {
  if (!isOffstage(fighter)) return 0
  const point = ledgePoint(nearestLedge(fighter))
  const toward = fighter.x < CENTER ? 1 : -1
  const outside = Math.max(0, (point.x - fighter.x) * toward)
  const need = fighter.y - (point.y + LEDGE.reachBottom - 10)
  const jump = fighter.stats.jump
  const airRise = (PHYSICS.airJumpSpeed * jump) ** 2 / (2 * PHYSICS.gravity)
  const specialRise = (PHYSICS.recoverySpeed * jump) ** 2 / (2 * PHYSICS.gravity)
  const hasSpecial = !fighter.usedRecovery && fighter.specialCooldown < 0.35
  const rise = fighter.jumpsLeft * airRise + (hasSpecial ? specialRise : 0)
  if (need > rise) return 1.5
  const time = fighter.jumpsLeft * 0.42 + (hasSpecial ? 0.8 : 0) + Math.max(0, -need) / 620
  const reach = PHYSICS.runSpeed * fighter.stats.speed * 0.85 * time + LEDGE.reachX
  if (outside > reach) return 1.3
  return (
    0.2 +
    0.45 * Math.max(0, Math.min(1, need / Math.max(rise, 1))) +
    0.3 * Math.min(1, outside / 520) +
    (fighter.hitstun > 0 ? 0.15 : 0)
  )
}

function evaluate(sim: ClashMatch, id: 0 | 1, profile: CpuProfile) {
  const me = sim.fighters[id]
  const foe = sim.fighters[id === 0 ? 1 : 0]
  const aggression = profile.aggression
  let score = 0
  for (const event of sim.events) {
    if (event.type === 'hit') {
      if (event.attacker === id) score += (event.damage + event.power / 110) * aggression
      else score -= (event.damage + event.power / 110) * 1.12
    } else if (event.type === 'ko') {
      if (event.fighter === id) score -= 230
      else score += 200 * aggression
    } else if (event.type === 'parry') {
      score += event.target === id ? 16 : -16
    } else if (event.type === 'shield') {
      score += event.target === id ? -2.5 : 2 * aggression
    } else if (event.type === 'shieldBreak') {
      score += event.fighter === id ? -70 : 60
    }
  }
  score -= strandedRisk(me) * 95
  score += strandedRisk(foe) * 50 * aggression
  score += (foe.hitstun - me.hitstun) * 12
  score += (foe.lag - me.lag) * 16
  score -= (100 - me.shield) * 0.045
  if (me.chill > 0) score -= 2

  if (me.respawn <= 0 && foe.respawn <= 0) {
    // 何も起きない手どうしの差は「間合い」と「中央の取り合い」でつける。
    const gap = Math.hypot(foe.x - me.x, (foe.y - me.y) * 0.8)
    score -= Math.max(0, gap - 115) * 0.034 * aggression
    score -= Math.abs(me.x - CENTER) * 0.009
    score += Math.abs(foe.x - CENTER) * 0.006
    // 空振りの硬直を相手の目の前で晒すのは危ない。
    if (me.action && !me.action.hit) {
      const rest = ATTACKS[me.action.kind].total - me.action.time
      if (gap < 190) score -= rest * 18 * (0.4 + profile.caution)
    }
  }
  return score
}

function rollout(
  base: ClashMatch,
  id: 0 | 1,
  plan: CpuPlan,
  model: FoeModel,
  profile: CpuProfile,
) {
  const sim = cloneClashMatch(base)
  const me = sim.fighters[id]
  const foe = sim.fighters[id === 0 ? 1 : 0]
  const limit = profile.horizon + SETTLE_FRAMES
  for (let frame = 0; frame < limit; frame++) {
    let mine: ClashInput
    if (frame < profile.horizon) mine = plan.input(frame, me)
    else {
      // 読みの先で宙に浮いたままなら、決着（着地・崖・撃墜）まで定石どおりに進めて確かめる。
      if (settled(me) && settled(foe)) break
      mine = isOffstage(me) || me.ledge ? recoveryInput(me) : emptyClashInput()
    }
    const theirs = foeInput(model, frame, foe, me)
    stepClashMatch(sim, id === 0 ? [mine, theirs] : [theirs, mine], STEP)
    if (sim.phase !== 'fight') break
  }
  return evaluate(sim, id, profile)
}

function candidates(me: Fighter, foe: Fighter, profile: CpuProfile): CpuPlan[] {
  const advanced = profile.advanced
  const toward: -1 | 1 = foe.x < me.x ? -1 : foe.x > me.x ? 1 : me.facing
  const away = -toward as -1 | 1
  const stage: -1 | 1 = me.x < CENTER ? 1 : -1
  const face = me.facing === toward ? 0 : toward
  const list: CpuPlan[] = []
  const add = (name: string, options: ScriptOptions) => list.push(script(name, options))
  const specialReady = me.specialCooldown <= 0

  if (me.ledge) {
    add('ledge-wait', {})
    list.push({
      name: 'ledge-climb',
      input: () => ({ ...emptyClashInput(), up: true }),
    })
    list.push({
      name: 'ledge-jump',
      input: (frame, self) => {
        const input = emptyClashInput()
        input.jumpHeld = true
        input.jumpPressed = self.ledge != null && frame % 6 === 0
        input.left = stage < 0
        input.right = stage > 0
        return input
      },
    })
    list.push({
      name: 'ledge-attack',
      input: (frame, self) => ({
        ...emptyClashInput(),
        attackPressed: self.ledge != null && frame % 6 === 0,
      }),
    })
    if (advanced) {
      list.push({
        name: 'ledge-jump-air',
        input: (frame, self) => {
          const input = emptyClashInput()
          input.jumpHeld = true
          input.jumpPressed = self.ledge != null && frame % 6 === 0
          input.attackPressed = self.ledge == null && frame % 8 === 0 && !self.action
          input.left = stage < 0
          input.right = stage > 0
          return input
        },
      })
    }
    return list
  }

  if (me.onGround) {
    add('idle', {})
    add('walk-in', { move: toward })
    add('walk-out', { move: away })
    add('jab', { act: 'attack', aim: 'n', face, at: face ? 1 : 0 })
    add('smash', { act: 'attack', aim: toward })
    add('up-tilt', { act: 'attack', aim: 'up', face, at: face ? 1 : 0 })
    add('sweep', { act: 'attack', aim: 'down', face, at: face ? 1 : 0 })
    add('walk-smash', { move: toward, act: 'attack', aim: toward, at: 7 })
    add('walk-jab', { move: toward, act: 'attack', aim: 'n', at: 9 })
    add('guard', { act: 'shield', hold: 14 })
    add('hop-in', { move: toward, jump: 1 })
    add('jump-in', { move: toward, jump: 2 })
    add('jump-up', { jump: 2 })
    add('hop-air', { move: toward, jump: 1, act: 'attack', aim: 'n', at: 9 })
    add('jump-air', { move: toward, jump: 2, act: 'attack', aim: 'n', at: 15 })
    add('jump-air-up', { move: toward, jump: 2, act: 'attack', aim: 'up', at: 13 })
    if (specialReady) {
      add('special', { act: 'special', aim: 'n', face, at: face ? 1 : 0 })
      add('rush', { act: 'special', aim: toward })
      add('rise', { act: 'special', aim: 'up' })
    }
    if (me.ground > 0) add('drop', { drop: true, move: toward })
    if (advanced) {
      add('guard-long', { act: 'shield', hold: 26 })
      add('roll-in', { act: 'dodge', aim: toward })
      add('roll-out', { act: 'dodge', aim: away })
      add('spot', { act: 'dodge', aim: 'down' })
      add('walk-smash-late', { move: toward, act: 'attack', aim: toward, at: 14 })
      add('back-smash', { move: away, act: 'attack', aim: toward, at: 8 })
      add('jump-out', { move: away, jump: 2 })
      add('hop-air-late', { move: toward, jump: 1, act: 'attack', aim: 'n', at: 15 })
      add('jump-meteor', { move: toward, jump: 2, act: 'attack', aim: 'down', at: 14 })
      add('jump-air-late', { move: toward, jump: 2, act: 'attack', aim: 'n', at: 24 })
    }
    return list
  }

  // 空中。上昇中は rise でジャンプを伸ばす。
  const moves: (-1 | 0 | 1)[] = stage === toward ? [toward, 0, away] : [toward, 0, away, stage]
  for (const move of new Set(moves)) {
    add(`drift${move}`, { move, rise: true })
    add(`fall${move}`, { move, fall: true })
  }
  add('air', { move: toward, rise: true, act: 'attack', aim: 'n' })
  add('air-up', { move: toward, rise: true, act: 'attack', aim: 'up' })
  add('air-late', { move: toward, rise: true, act: 'attack', aim: 'n', at: 8 })
  if (me.jumpsLeft > 0) {
    add('djump-in', { move: toward, jump: 2 })
    add('djump-stage', { move: stage, jump: 2 })
    add('djump-air', { move: toward, jump: 2, act: 'attack', aim: 'n', at: 8 })
  }
  if (specialReady) {
    add('air-special', { act: 'special', aim: 'n', face, at: face ? 1 : 0, rise: true })
    add('air-rush', { act: 'special', aim: toward, rise: true })
    if (stage !== toward) add('air-rush-stage', { act: 'special', aim: stage, rise: true })
    if (!me.usedRecovery) {
      add('air-rise', { move: stage, act: 'special', aim: 'up' })
      add('air-rise-late', { move: stage, act: 'special', aim: 'up', at: 10 })
    }
  }
  if (isOffstage(me)) list.push({ name: 'recover', input: (_frame, self) => recoveryInput(self) })
  if (advanced) {
    add('air-meteor', { move: toward, act: 'attack', aim: 'down' })
    add('air-meteor-late', { move: toward, rise: true, act: 'attack', aim: 'down', at: 7 })
    add('air-very-late', { move: toward, rise: true, act: 'attack', aim: 'n', at: 15 })
    if (me.jumpsLeft > 0) {
      add('djump-meteor', { move: toward, jump: 2, act: 'attack', aim: 'down', at: 10 })
    }
    if (!me.airDodged) {
      add('airdodge', { act: 'dodge', aim: 'n' })
      add('airdodge-stage', { act: 'dodge', aim: stage })
      add('airdodge-out', { act: 'dodge', aim: away })
    }
  }
  return list
}

const SAFE_NAMES = new Set(['idle', 'walk-out', 'guard', 'recover', 'ledge-wait', 'ledge-climb'])

function noise(random: () => number) {
  return random() + random() + random() - 1.5
}

/**
 * CPU に見えている局面。動き出したばかりの技や撃たれた直後の飛び道具は、まだ目に入っていない。
 */
function perceive(match: ClashMatch, id: 0 | 1, profile: CpuProfile) {
  const view = cloneClashMatch(match)
  const foe = view.fighters[id === 0 ? 1 : 0]
  if (foe.action && foe.action.time < profile.perception) foe.action = null
  if (foe.dodge && foe.dodge.time < profile.perception) foe.dodge = null
  view.projectiles = view.projectiles.filter(
    (projectile) => projectile.owner === id || projectile.age >= profile.perception,
  )
  return view
}

/** 相手の立場で浅く読んだ「いちばんやってきそうな手」。 */
function predictFoePlan(view: ClashMatch, id: 0 | 1, profile: CpuProfile): CpuPlan {
  const foeId = id === 0 ? 1 : 0
  const shallow: CpuProfile = { ...profile, horizon: 18, caution: 0, foresight: 0 }
  let best: CpuPlan = IDLE
  let bestScore = -Infinity
  for (const plan of candidates(view.fighters[foeId], view.fighters[id], shallow)) {
    const score = rollout(view, foeId, plan, 'inertia', shallow)
    if (score > bestScore) {
      bestScore = score
      best = plan
    }
  }
  return best
}

/** いまの局面から次の手を選ぶ。`current` は実行中の手の続き。 */
export function chooseClashPlan(
  match: ClashMatch,
  id: 0 | 1,
  profile: CpuProfile,
  random: () => number,
  current: CpuPlan | null = null,
): CpuPlan {
  const view = perceive(match, id, profile)
  const me = view.fighters[id]
  const foe = view.fighters[id === 0 ? 1 : 0]
  const list = candidates(me, foe, profile)
  const offstage = isOffstage(me)

  // 雑な手。場外では命取りなので、落ちている最中は滅多に出さない。
  if (random() < profile.blunder * (offstage ? 0.25 : 1)) {
    const loose = list.filter((plan) => !plan.name.startsWith('air-rise') && plan.name !== 'recover')
    return loose[Math.floor(random() * loose.length)] ?? IDLE
  }

  const scored = list.map((plan) => ({
    plan,
    score: rollout(view, id, plan, 'inertia', profile),
  }))
  // 実行中の手を続ける選択肢。わずかに優遇して、毎回の考え直しで手がばたつくのを防ぐ。
  if (current) {
    scored.push({
      plan: current,
      score: rollout(view, id, current, 'inertia', profile) + 1.5,
    })
  }
  scored.sort((a, b) => b.score - a.score)

  let finalists = scored
  if (profile.caution > 0 || profile.foresight > 0) {
    // 上位の手と、いつでも選べる安全な手だけを、相手が動いてくる前提で読み直す。
    finalists = scored.filter((entry, index) => index < 7 || SAFE_NAMES.has(entry.plan.name))
    const likely =
      profile.foresight > 0 && foe.respawn <= 0 && foe.hitstun <= 0
        ? predictFoePlan(view, id, profile)
        : null
    for (const entry of finalists) {
      const calm = entry.score
      let score = calm
      if (profile.caution > 0) {
        const worst = rollout(view, id, entry.plan, 'punish', profile)
        score += profile.caution * (Math.min(calm, worst) - calm)
      }
      if (likely) {
        const read = rollout(view, id, entry.plan, likely, profile)
        score += profile.foresight * (read - calm)
      }
      entry.score = score
    }
  }

  let best = finalists[0]
  let bestScore = -Infinity
  for (const entry of finalists) {
    const value = entry.score + noise(random) * profile.noise
    if (value > bestScore) {
      bestScore = value
      best = entry
    }
  }
  return best.plan
}

export type ClashCpu = {
  /** 毎フレーム呼ぶ。そのフレームの入力を返す。 */
  next: (match: ClashMatch) => ClashInput
  /** いま実行している手の名前（デバッグ・テスト用）。 */
  planName: () => string
}

export function createClashCpu(
  id: 0 | 1,
  profile: CpuProfile,
  random: () => number = Math.random,
): ClashCpu {
  // 実行中の手は「元の手＋経過フレーム」で持つ（続行のたびにクロージャを重ねない）。
  let base: CpuPlan = IDLE
  let offset = 0
  let frame = 0
  let wait = 0
  const reset = () => {
    base = IDLE
    offset = 0
    frame = 0
  }
  return {
    planName: () => base.name,
    next(match) {
      const me = match.fighters[id]
      if (match.phase !== 'fight' || me.respawn > 0) {
        reset()
        wait = 0
        return emptyClashInput()
      }
      if (me.hitstun > 0) {
        // 吹っ飛び中は何もできない。動けるようになった瞬間ではなく、反応の速さに応じて少し遅れて立て直す。
        reset()
        wait = Math.max(Math.round(profile.reaction * 18), wait - 1)
        return emptyClashInput()
      }
      if (wait <= 0) {
        const current = frame > 0 ? shifted(base, offset + frame) : null
        const chosen = chooseClashPlan(match, id, profile, random, current)
        if (chosen === current) offset += frame
        else {
          base = chosen
          offset = 0
        }
        frame = 0
        wait = Math.max(2, Math.round(profile.reaction * 60 * (0.7 + 0.6 * random())))
        // 場外では一瞬の遅れが命取りになるぶん、誰でも集中する（読みも「決着までは定石で戻る」
        // 前提なので、考え直しがそれより遅れてはいけない）。
        if (isOffstage(me)) wait = Math.min(wait, 8)
      }
      wait -= 1
      return base.input(offset + frame++, me)
    },
  }
}

/**
 * いま吹っ飛ばされた `target` が、定石どおりに復帰しても撃墜されるか。
 * 当たった瞬間に「決まった」と分かるので、描画側が決着の演出を先に始められる。
 */
export function predictKo(match: ClashMatch, target: 0 | 1) {
  const sim = cloneClashMatch(match)
  const fighter = sim.fighters[target]
  const idle = emptyClashInput()
  for (let frame = 0; frame < 200; frame++) {
    const input = fighter.hitstun > 0 ? idle : recoveryInput(fighter)
    stepClashMatch(sim, target === 0 ? [input, idle] : [idle, input], STEP)
    if (fighter.respawn > 0 || fighter.stocks <= 0) return true
    if (fighter.hitstun <= 0 && (fighter.onGround || fighter.ledge)) return false
  }
  return false
}
