// KISEKAE CLASH の対戦ルール。
// 描画や音を持たない決定論的なコアにして、Canvas / CPU / タッチ操作から共用する。

export type FighterStats = {
  speed: number
  jump: number
  power: number
  weight: number
  airJumps: number
  airControl: number
}

export const DEFAULT_STATS: FighterStats = {
  speed: 1,
  jump: 1,
  power: 1,
  weight: 1,
  airJumps: 1,
  airControl: 1,
}

export type ClashInput = {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  jumpHeld: boolean
  jumpPressed: boolean
  attackPressed: boolean
  specialPressed: boolean
  shield: boolean
  shieldPressed: boolean
}

export const emptyClashInput = (): ClashInput => ({
  left: false,
  right: false,
  up: false,
  down: false,
  jumpHeld: false,
  jumpPressed: false,
  attackPressed: false,
  specialPressed: false,
  shield: false,
  shieldPressed: false,
})

export type Platform = {
  x: number
  y: number
  w: number
  h: number
  kind: 'main' | 'soft'
}

export const ARENA = {
  width: 1280,
  height: 720,
  main: { x: 260, y: 525, w: 760, h: 34, kind: 'main' as const },
  platforms: [
    { x: 350, y: 390, w: 230, h: 18, kind: 'soft' as const },
    { x: 700, y: 390, w: 230, h: 18, kind: 'soft' as const },
    { x: 525, y: 270, w: 230, h: 18, kind: 'soft' as const },
  ],
  blast: { left: -145, right: 1425, top: -190, bottom: 865 },
}

export type AttackKind = 'jab' | 'smash' | 'up' | 'down' | 'air' | 'rush' | 'recovery'

export type AttackState = {
  kind: AttackKind
  time: number
  hit: boolean
}

export type Fighter = {
  id: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  facing: -1 | 1
  percent: number
  stocks: number
  onGround: boolean
  jumpsLeft: number
  coyote: number
  jumpBuffer: number
  dropThrough: number
  hitstun: number
  shieldStun: number
  invuln: number
  respawn: number
  shield: number
  shielding: boolean
  specialCooldown: number
  action: AttackState | null
  stats: FighterStats
  lastHitBy: 0 | 1 | null
}

export type Projectile = {
  id: number
  owner: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  life: number
  radius: number
  damage: number
}

export type ClashEvent =
  | { id: number; type: 'go' }
  | { id: number; type: 'jump' | 'airJump' | 'land'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'attack'; fighter: 0 | 1; kind: AttackKind; x: number; y: number }
  | {
      id: number
      type: 'hit'
      attacker: 0 | 1
      target: 0 | 1
      x: number
      y: number
      damage: number
      power: number
    }
  | { id: number; type: 'shield'; attacker: 0 | 1; target: 0 | 1; x: number; y: number }
  | { id: number; type: 'shieldBreak'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'projectile'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'ko'; fighter: 0 | 1; stocks: number; x: number; y: number }
  | { id: number; type: 'respawn'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'gameOver'; winner: 0 | 1 }

export type ClashMatch = {
  phase: 'countdown' | 'fight' | 'result'
  countdown: number
  clock: number
  winner: 0 | 1 | null
  fighters: [Fighter, Fighter]
  projectiles: Projectile[]
  events: ClashEvent[]
  nextEventId: number
  nextProjectileId: number
  freeze: number
  elapsed: number
}

type AttackDef = {
  total: number
  activeFrom: number
  activeTo: number
  damage: number
  base: number
  scale: number
  angle: number
  w: number
  h: number
  ox: number
  oy: number
}

export const ATTACKS: Record<AttackKind, AttackDef> = {
  jab: {
    total: 0.38,
    activeFrom: 0.075,
    activeTo: 0.15,
    damage: 7,
    base: 205,
    scale: 3.1,
    angle: -0.26,
    w: 78,
    h: 52,
    ox: 52,
    oy: -52,
  },
  smash: {
    total: 0.58,
    activeFrom: 0.19,
    activeTo: 0.29,
    damage: 15,
    base: 285,
    scale: 5.2,
    angle: -0.34,
    w: 110,
    h: 62,
    ox: 72,
    oy: -52,
  },
  up: {
    total: 0.47,
    activeFrom: 0.13,
    activeTo: 0.24,
    damage: 11,
    base: 250,
    scale: 4.3,
    angle: -1.42,
    w: 76,
    h: 100,
    ox: 0,
    oy: -101,
  },
  down: {
    total: 0.42,
    activeFrom: 0.11,
    activeTo: 0.22,
    damage: 9,
    base: 225,
    scale: 3.8,
    angle: -0.14,
    w: 118,
    h: 38,
    ox: 42,
    oy: -20,
  },
  air: {
    total: 0.46,
    activeFrom: 0.09,
    activeTo: 0.25,
    damage: 10,
    base: 235,
    scale: 4.1,
    angle: -0.48,
    w: 112,
    h: 100,
    ox: 0,
    oy: -55,
  },
  rush: {
    total: 0.64,
    activeFrom: 0.08,
    activeTo: 0.38,
    damage: 13,
    base: 275,
    scale: 4.7,
    angle: -0.3,
    w: 96,
    h: 78,
    ox: 52,
    oy: -49,
  },
  recovery: {
    total: 0.72,
    activeFrom: 0.05,
    activeTo: 0.31,
    damage: 8,
    base: 230,
    scale: 3.5,
    angle: -1.25,
    w: 82,
    h: 122,
    ox: 0,
    oy: -82,
  },
}

export type Hitbox = { x: number; y: number; w: number; h: number }

const FIGHTER_W = 48
const FIGHTER_H = 94
const GRAVITY = 1960
const MAX_FALL = 850
const RUN_SPEED = 330
const GROUND_ACCEL = 2550
const AIR_ACCEL = 1480
const FRICTION = 2850
const JUMP_SPEED = 700
const AIR_JUMP_SPEED = 650
const COYOTE_TIME = 0.1
const JUMP_BUFFER = 0.11

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const approach = (value: number, target: number, amount: number) => {
  if (value < target) return Math.min(target, value + amount)
  return Math.max(target, value - amount)
}

const fighterBox = (fighter: Fighter): Hitbox => ({
  x: fighter.x - FIGHTER_W / 2,
  y: fighter.y - FIGHTER_H,
  w: FIGHTER_W,
  h: FIGHTER_H,
})

const overlaps = (a: Hitbox, b: Hitbox) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

const spawnPoint = (id: 0 | 1) => ({
  x: id === 0 ? 505 : 775,
  y: ARENA.main.y,
})

function createFighter(id: 0 | 1, stats: FighterStats): Fighter {
  const spawn = spawnPoint(id)
  return {
    id,
    ...spawn,
    vx: 0,
    vy: 0,
    facing: id === 0 ? 1 : -1,
    percent: 0,
    stocks: 3,
    onGround: true,
    jumpsLeft: stats.airJumps,
    coyote: COYOTE_TIME,
    jumpBuffer: 0,
    dropThrough: 0,
    hitstun: 0,
    shieldStun: 0,
    invuln: 0,
    respawn: 0,
    shield: 100,
    shielding: false,
    specialCooldown: 0,
    action: null,
    stats: { ...stats },
    lastHitBy: null,
  }
}

export function createClashMatch(
  firstStats: FighterStats,
  secondStats: FighterStats,
): ClashMatch {
  return {
    phase: 'countdown',
    countdown: 3.2,
    clock: 180,
    winner: null,
    fighters: [createFighter(0, firstStats), createFighter(1, secondStats)],
    projectiles: [],
    events: [],
    nextEventId: 1,
    nextProjectileId: 1,
    freeze: 0,
    elapsed: 0,
  }
}

type ClashEventInput = ClashEvent extends infer Event
  ? Event extends { id: number }
    ? Omit<Event, 'id'>
    : never
  : never

function emit(match: ClashMatch, event: ClashEventInput) {
  match.events.push({ ...event, id: match.nextEventId++ } as ClashEvent)
  if (match.events.length > 180) match.events.splice(0, match.events.length - 180)
}

export function activeAttackHitbox(fighter: Fighter): Hitbox | null {
  const state = fighter.action
  if (!state) return null
  const def = ATTACKS[state.kind]
  if (state.time < def.activeFrom || state.time > def.activeTo || state.hit) return null
  const directional = state.kind !== 'up' && state.kind !== 'air' && state.kind !== 'recovery'
  const ox = directional ? def.ox * fighter.facing : def.ox
  return {
    x: fighter.x + ox - def.w / 2,
    y: fighter.y + def.oy - def.h / 2,
    w: def.w,
    h: def.h,
  }
}

function startAttack(match: ClashMatch, fighter: Fighter, kind: AttackKind) {
  fighter.action = { kind, time: 0, hit: false }
  emit(match, { type: 'attack', fighter: fighter.id, kind, x: fighter.x, y: fighter.y - 48 })
}

function chooseAttack(fighter: Fighter, input: ClashInput): AttackKind {
  if (!fighter.onGround) return 'air'
  if (input.up) return 'up'
  if (input.down) return 'down'
  if (input.left || input.right) return 'smash'
  return 'jab'
}

function startSpecial(match: ClashMatch, fighter: Fighter, input: ClashInput) {
  fighter.specialCooldown = 1.05
  if (input.up) {
    startAttack(match, fighter, 'recovery')
    fighter.vy = -790 * fighter.stats.jump
    fighter.vx *= 0.45
    fighter.onGround = false
    fighter.jumpsLeft = 0
    fighter.invuln = Math.max(fighter.invuln, 0.1)
    return
  }
  if (input.left || input.right) {
    fighter.facing = input.left ? -1 : 1
    fighter.vx = 670 * fighter.facing * fighter.stats.speed
    fighter.vy = Math.min(fighter.vy, -65)
    fighter.onGround = false
    startAttack(match, fighter, 'rush')
    return
  }
  const projectile: Projectile = {
    id: match.nextProjectileId++,
    owner: fighter.id,
    x: fighter.x + fighter.facing * 44,
    y: fighter.y - 56,
    vx: fighter.facing * 545,
    vy: -35,
    life: 1.65,
    radius: 18,
    damage: 8,
  }
  match.projectiles.push(projectile)
  emit(match, { type: 'projectile', fighter: fighter.id, x: projectile.x, y: projectile.y })
}

function tryJump(match: ClashMatch, fighter: Fighter) {
  if (fighter.onGround || fighter.coyote > 0) {
    fighter.vy = -JUMP_SPEED * fighter.stats.jump
    fighter.onGround = false
    fighter.coyote = 0
    fighter.jumpBuffer = 0
    emit(match, { type: 'jump', fighter: fighter.id, x: fighter.x, y: fighter.y })
  } else if (fighter.jumpsLeft > 0) {
    fighter.jumpsLeft -= 1
    fighter.vy = -AIR_JUMP_SPEED * fighter.stats.jump
    fighter.jumpBuffer = 0
    emit(match, { type: 'airJump', fighter: fighter.id, x: fighter.x, y: fighter.y })
  }
}

function landOnPlatforms(match: ClashMatch, fighter: Fighter, previousY: number) {
  if (fighter.vy < 0 || fighter.dropThrough > 0) return
  const platforms: Platform[] = [ARENA.main, ...ARENA.platforms]
  for (const platform of platforms) {
    const insideX =
      fighter.x + FIGHTER_W * 0.34 > platform.x &&
      fighter.x - FIGHTER_W * 0.34 < platform.x + platform.w
    const crossed = previousY <= platform.y + 1 && fighter.y >= platform.y
    if (!insideX || !crossed) continue
    const wasAirborne = !fighter.onGround && fighter.vy > 150
    fighter.y = platform.y
    fighter.vy = 0
    fighter.onGround = true
    fighter.jumpsLeft = fighter.stats.airJumps
    fighter.coyote = COYOTE_TIME
    if (wasAirborne) emit(match, { type: 'land', fighter: fighter.id, x: fighter.x, y: fighter.y })
    break
  }
}

function updateFighter(
  match: ClashMatch,
  fighter: Fighter,
  input: ClashInput,
  dt: number,
) {
  fighter.invuln = Math.max(0, fighter.invuln - dt)
  fighter.hitstun = Math.max(0, fighter.hitstun - dt)
  fighter.shieldStun = Math.max(0, fighter.shieldStun - dt)
  fighter.specialCooldown = Math.max(0, fighter.specialCooldown - dt)
  fighter.dropThrough = Math.max(0, fighter.dropThrough - dt)
  fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - dt)

  if (fighter.respawn > 0) {
    fighter.respawn -= dt
    if (fighter.respawn <= 0 && fighter.stocks > 0) {
      const point = spawnPoint(fighter.id)
      fighter.x = point.x
      fighter.y = 175
      fighter.vx = 0
      fighter.vy = 0
      fighter.percent = 0
      fighter.invuln = 1.8
      fighter.onGround = false
      fighter.jumpsLeft = fighter.stats.airJumps
      emit(match, { type: 'respawn', fighter: fighter.id, x: fighter.x, y: fighter.y })
    }
    return
  }

  if (fighter.action) {
    fighter.action.time += dt
    if (fighter.action.time >= ATTACKS[fighter.action.kind].total) fighter.action = null
  }

  if (fighter.hitstun > 0) {
    fighter.shielding = false
    fighter.vx *= Math.pow(0.985, dt * 60)
  } else {
    const canGuard = fighter.shieldStun <= 0 && fighter.action == null && fighter.shield > 0
    fighter.shielding = canGuard && input.shield
    if (fighter.shielding) {
      fighter.vx = approach(fighter.vx, 0, 3300 * dt)
      fighter.shield = Math.max(0, fighter.shield - 6.5 * dt)
    } else {
      fighter.shield = Math.min(100, fighter.shield + 12 * dt)
    }

    if (!fighter.shielding) {
      if (input.jumpPressed) fighter.jumpBuffer = JUMP_BUFFER
      if (input.down && fighter.onGround && input.jumpPressed) {
        fighter.dropThrough = 0.18
        fighter.onGround = false
        fighter.y += 4
        fighter.jumpBuffer = 0
      }
      if (fighter.jumpBuffer > 0) tryJump(match, fighter)

      const direction = Number(input.right) - Number(input.left)
      if (direction !== 0) fighter.facing = direction as -1 | 1
      const movementLocked =
        fighter.action != null &&
        fighter.action.kind !== 'air' &&
        fighter.action.kind !== 'rush' &&
        fighter.action.kind !== 'recovery'
      if (!movementLocked && fighter.action?.kind !== 'rush') {
        const speed = RUN_SPEED * fighter.stats.speed
        const accel = fighter.onGround
          ? GROUND_ACCEL
          : AIR_ACCEL * fighter.stats.airControl
        if (direction !== 0) fighter.vx = approach(fighter.vx, direction * speed, accel * dt)
        else if (fighter.onGround) fighter.vx = approach(fighter.vx, 0, FRICTION * dt)
      }

      if (!fighter.action && input.attackPressed) {
        startAttack(match, fighter, chooseAttack(fighter, input))
      } else if (!fighter.action && input.specialPressed && fighter.specialCooldown <= 0) {
        startSpecial(match, fighter, input)
      }
    }
  }

  if (fighter.shield <= 0 && fighter.shielding) {
    fighter.shielding = false
    fighter.hitstun = 2.1
    fighter.vy = -330
    fighter.shield = 28
    emit(match, { type: 'shieldBreak', fighter: fighter.id, x: fighter.x, y: fighter.y - 48 })
  }

  if (fighter.onGround) fighter.coyote = COYOTE_TIME
  else fighter.coyote = Math.max(0, fighter.coyote - dt)

  const previousY = fighter.y
  if (!fighter.onGround) {
    const fastFall = input.down && fighter.vy > 0 ? 1.48 : 1
    fighter.vy = Math.min(MAX_FALL, fighter.vy + GRAVITY * fastFall * dt)
  } else if (fighter.dropThrough <= 0) {
    // 足場を走り抜けたフレームで落下へ移れるよう、ごく小さく重力を掛ける。
    fighter.vy = 24
  }

  fighter.x += fighter.vx * dt
  fighter.y += fighter.vy * dt
  const wasGrounded = fighter.onGround
  fighter.onGround = false
  landOnPlatforms(match, fighter, previousY)
  if (wasGrounded && !fighter.onGround) fighter.coyote = COYOTE_TIME

  // ジャンプボタンを早く離すと小ジャンプになる。
  if (!input.jumpHeld && fighter.vy < -260 && fighter.action?.kind !== 'recovery') {
    fighter.vy += 1900 * dt
  }
}

function applyHit(
  match: ClashMatch,
  attacker: Fighter,
  target: Fighter,
  damage: number,
  base: number,
  scale: number,
  angle: number,
  x: number,
  y: number,
) {
  if (target.invuln > 0 || target.respawn > 0) return false
  if (target.shielding) {
    target.shield = Math.max(0, target.shield - damage * 4.8)
    target.shieldStun = 0.11 + damage * 0.012
    target.vx += attacker.facing * damage * 5
    emit(match, { type: 'shield', attacker: attacker.id, target: target.id, x, y })
    if (target.shield <= 0) {
      target.shielding = false
      target.hitstun = 2.1
      target.vy = -330
      target.shield = 28
      emit(match, { type: 'shieldBreak', fighter: target.id, x: target.x, y: target.y - 48 })
    }
    match.freeze = Math.max(match.freeze, 0.045)
    return true
  }

  target.percent = Math.min(999, target.percent + damage)
  const launch = (base + target.percent * scale) * attacker.stats.power / target.stats.weight
  const direction = x < target.x ? 1 : x > target.x ? -1 : attacker.facing
  target.vx = Math.cos(angle) * launch * direction
  target.vy = Math.sin(angle) * launch
  target.hitstun = clamp(0.13 + launch / 1150, 0.16, 0.92)
  target.invuln = 0.08
  target.onGround = false
  target.action = null
  target.shielding = false
  target.lastHitBy = attacker.id
  emit(match, {
    type: 'hit',
    attacker: attacker.id,
    target: target.id,
    x: target.x,
    y: target.y - 55,
    damage,
    power: launch,
  })
  match.freeze = Math.max(match.freeze, clamp(0.035 + launch / 8000, 0.04, 0.11))
  return true
}

function resolveMelee(match: ClashMatch) {
  for (const attacker of match.fighters) {
    const hitbox = activeAttackHitbox(attacker)
    if (!hitbox || !attacker.action) continue
    const target = match.fighters[attacker.id === 0 ? 1 : 0]
    if (!overlaps(hitbox, fighterBox(target))) continue
    const def = ATTACKS[attacker.action.kind]
    if (
      applyHit(
        match,
        attacker,
        target,
        def.damage,
        def.base,
        def.scale,
        def.angle,
        hitbox.x + hitbox.w / 2,
        hitbox.y + hitbox.h / 2,
      )
    ) {
      attacker.action.hit = true
    }
  }
}

function updateProjectiles(match: ClashMatch, dt: number) {
  for (const projectile of match.projectiles) {
    projectile.life -= dt
    projectile.x += projectile.vx * dt
    projectile.y += projectile.vy * dt
    projectile.vy += 80 * dt
    const target = match.fighters[projectile.owner === 0 ? 1 : 0]
    if (target.respawn > 0 || target.stocks <= 0) continue
    const box = fighterBox(target)
    const nearestX = clamp(projectile.x, box.x, box.x + box.w)
    const nearestY = clamp(projectile.y, box.y, box.y + box.h)
    const hit =
      Math.hypot(projectile.x - nearestX, projectile.y - nearestY) <= projectile.radius
    if (!hit) continue
    const owner = match.fighters[projectile.owner]
    if (
      applyHit(
        match,
        owner,
        target,
        projectile.damage,
        190,
        3.25,
        -0.27,
        projectile.x,
        projectile.y,
      )
    ) {
      projectile.life = 0
    }
  }
  match.projectiles = match.projectiles.filter(
    (projectile) =>
      projectile.life > 0 &&
      projectile.x > ARENA.blast.left &&
      projectile.x < ARENA.blast.right &&
      projectile.y > ARENA.blast.top &&
      projectile.y < ARENA.blast.bottom,
  )
}

function knockOut(match: ClashMatch, fighter: Fighter) {
  fighter.stocks -= 1
  fighter.respawn = 1.25
  fighter.action = null
  fighter.shielding = false
  fighter.vx = 0
  fighter.vy = 0
  emit(match, {
    type: 'ko',
    fighter: fighter.id,
    stocks: fighter.stocks,
    x: fighter.x,
    y: fighter.y,
  })
  match.freeze = 0.18
  if (fighter.stocks > 0) return
  const winner = fighter.id === 0 ? 1 : 0
  match.phase = 'result'
  match.winner = winner
  emit(match, { type: 'gameOver', winner })
}

function checkBlastZones(match: ClashMatch) {
  for (const fighter of match.fighters) {
    if (fighter.respawn > 0 || fighter.stocks <= 0) continue
    if (
      fighter.x < ARENA.blast.left ||
      fighter.x > ARENA.blast.right ||
      fighter.y < ARENA.blast.top ||
      fighter.y > ARENA.blast.bottom
    ) {
      knockOut(match, fighter)
    }
  }
}

export function stepClashMatch(
  match: ClashMatch,
  inputs: [ClashInput, ClashInput],
  rawDt: number,
) {
  const dt = clamp(rawDt, 0, 1 / 30)
  match.elapsed += dt
  if (match.phase === 'result') return
  if (match.phase === 'countdown') {
    match.countdown -= dt
    if (match.countdown <= 0) {
      match.countdown = 0
      match.phase = 'fight'
      emit(match, { type: 'go' })
    }
    return
  }
  // ヒットストップ中でも、すでに画面外へ出たファイターのKO判定は遅らせない。
  checkBlastZones(match)
  if (match.winner !== null) return
  if (match.freeze > 0) {
    match.freeze = Math.max(0, match.freeze - dt)
    return
  }

  updateFighter(match, match.fighters[0], inputs[0], dt)
  updateFighter(match, match.fighters[1], inputs[1], dt)
  updateProjectiles(match, dt)
  resolveMelee(match)
  checkBlastZones(match)

  if (match.phase !== 'fight') return
  match.clock = Math.max(0, match.clock - dt)
  if (match.clock > 0) return
  const [first, second] = match.fighters
  let winner: 0 | 1
  if (first.stocks !== second.stocks) winner = first.stocks > second.stocks ? 0 : 1
  else if (first.percent !== second.percent) winner = first.percent < second.percent ? 0 : 1
  else winner = first.x < second.x ? 0 : 1
  match.phase = 'result'
  match.winner = winner
  emit(match, { type: 'gameOver', winner })
}

export type CpuProfile = {
  reaction: number
  aggression: number
  guard: number
  recovery: number
}

export const CPU_PROFILES: Record<'easy' | 'normal' | 'hard', CpuProfile> = {
  easy: { reaction: 0.42, aggression: 0.42, guard: 0.08, recovery: 0.58 },
  normal: { reaction: 0.24, aggression: 0.66, guard: 0.18, recovery: 0.8 },
  hard: { reaction: 0.12, aggression: 0.86, guard: 0.3, recovery: 0.98 },
}

/** 一手分のCPU入力。反応間隔の制御は描画側で行い、同じ入力を数フレーム保持する。 */
export function cpuClashInput(
  match: ClashMatch,
  id: 0 | 1,
  profile: CpuProfile,
  random: () => number = Math.random,
): ClashInput {
  const cpu = match.fighters[id]
  const foe = match.fighters[id === 0 ? 1 : 0]
  const input = emptyClashInput()
  if (match.phase !== 'fight' || cpu.respawn > 0 || cpu.hitstun > 0) return input

  const center = ARENA.main.x + ARENA.main.w / 2
  const offRight = cpu.x > ARENA.main.x + ARENA.main.w + 18
  const offLeft = cpu.x < ARENA.main.x - 18
  const belowStage = cpu.y > ARENA.main.y + 70
  const endangered = offLeft || offRight || belowStage

  if (endangered) {
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
  const foeThreatening =
    foe.action != null &&
    activeAttackHitbox(foe) != null &&
    distance < 150

  if (foeThreatening && cpu.shield > 20 && random() < profile.guard) {
    input.shield = true
    input.shieldPressed = true
    return input
  }

  const nearEdge = cpu.x < ARENA.main.x + 70 || cpu.x > ARENA.main.x + ARENA.main.w - 70
  const desiredDirection = nearEdge ? Math.sign(center - cpu.x) : Math.sign(dx)
  if (distance > 80 || nearEdge) {
    input.left = desiredDirection < 0
    input.right = desiredDirection > 0
  }

  if ((dy < -85 || (distance > 180 && random() < 0.055)) && cpu.onGround) {
    input.jumpPressed = true
    input.jumpHeld = true
  }
  if (dy > 120 && !cpu.onGround) input.down = true

  const attackRoll = random()
  if (distance < 92 && Math.abs(dy) < 105 && attackRoll < profile.aggression) {
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
    attackRoll < profile.aggression * 0.3
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
    attackRoll < profile.aggression * 0.16
  ) {
    input.specialPressed = true
    input.left = false
    input.right = false
  }
  return input
}
