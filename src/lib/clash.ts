// KISEKAE CLASH の対戦ルール。
// 描画や音を持たない決定論的なコアにして、Canvas / CPU の先読み / テストから共用する。
// 乱数を一切使わないので、同じ入力列からは必ず同じ試合になる（CPU はこの性質を使って
// 試合を複製し、数十フレーム先まで実際に進めてから手を選ぶ。`clashCpu.ts` 参照）。

export type ClashKit = 'spring' | 'summer' | 'autumn' | 'winter'

export type FighterStats = {
  speed: number
  jump: number
  power: number
  weight: number
  airJumps: number
  airControl: number
  /** 季節ごとの通常必殺技。 */
  kit: ClashKit
}

export const DEFAULT_STATS: FighterStats = {
  speed: 1,
  jump: 1,
  power: 1,
  weight: 1,
  airJumps: 1,
  airControl: 1,
  kit: 'spring',
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

// main は上にも横にも下にも当たりがある一枚岩。soft は下からすり抜けて乗れる薄い足場。
export const ARENA = {
  width: 1280,
  height: 720,
  main: { x: 260, y: 525, w: 760, h: 64, kind: 'main' as const },
  platforms: [
    { x: 350, y: 390, w: 230, h: 18, kind: 'soft' as const },
    { x: 700, y: 390, w: 230, h: 18, kind: 'soft' as const },
    { x: 525, y: 270, w: 230, h: 18, kind: 'soft' as const },
  ],
  blast: { left: -145, right: 1425, top: -190, bottom: 865 },
}

const ALL_PLATFORMS: Platform[] = [ARENA.main, ...ARENA.platforms]

export type AttackKind =
  | 'jab'
  | 'smash'
  | 'up'
  | 'down'
  | 'air'
  | 'airUp'
  | 'airDown'
  | 'rush'
  | 'recovery'
  | 'burst'

export type AttackState = {
  kind: AttackKind
  time: number
  hit: boolean
}

export type DodgeKind = 'roll' | 'spot' | 'air'

export type DodgeState = {
  kind: DodgeKind
  time: number
  dir: -1 | 0 | 1
}

export type LedgeSide = 'left' | 'right'

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
  /** 乗っている足場（0 = main、1〜 = soft）。空中は -1。 */
  ground: number
  jumpsLeft: number
  /** 踏み切りまでの残り時間。この間に ↑＋攻撃を入れると、跳ばずに上攻撃になる。 */
  squat: number
  coyote: number
  jumpBuffer: number
  attackBuffer: number
  specialBuffer: number
  dodgeBuffer: number
  dropThrough: number
  hitstun: number
  shieldStun: number
  /** 行動できない硬直（着地・崖のぼり・ジャストガードされた側）。 */
  lag: number
  invuln: number
  respawn: number
  shield: number
  shielding: boolean
  /** ガードを張ってからの経過。短いうちに受けるとジャストガードになる。 */
  guardTime: number
  parryReady: boolean
  parryLock: number
  specialCooldown: number
  /** 上必殺（復帰技）は着地・崖・被弾までに1回だけ。 */
  usedRecovery: boolean
  airDodged: boolean
  action: AttackState | null
  dodge: DodgeState | null
  ledge: LedgeSide | null
  ledgeTime: number
  ledgeCooldown: number
  /** 崖ジャンプの直後。この間は小ジャンプに化けず、壁でも内向きの勢いを失わない。 */
  ledgeHop: number
  /** 着地せずに崖をつかんだ回数。無敵がつくのは最初の1回だけ。 */
  ledgeGrabs: number
  /** 冬の必殺技を受けたあとの「かじかみ」。移動とジャンプが鈍る。 */
  chill: number
  combo: number
  prevDir: -1 | 0 | 1
  prevDown: boolean
  stats: FighterStats
  lastHitBy: 0 | 1 | null
  /** 撃墜の手柄が残る時間。地上で立て直してしばらくすると消え、そのあと落ちれば自滅になる。 */
  credit: number
}

export type ProjectileKind = 'petal' | 'leaf' | 'frost'

export type Projectile = {
  id: number
  kind: ProjectileKind
  owner: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  /** 横方向の加速度。落ち葉はこれで戻ってくる。 */
  ax: number
  age: number
  life: number
  radius: number
  damage: number
  base: number
  scale: number
  angle: number
  /** 一度当たったら、向きが変わるまで同じ相手には当たらない。 */
  spent: boolean
  chill: number
}

export type BlastSide = 'left' | 'right' | 'top' | 'bottom'
export type HitSource = AttackKind | ProjectileKind

export type ClashEvent =
  | { id: number; type: 'go' }
  | { id: number; type: 'jump' | 'airJump' | 'land'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'attack'; fighter: 0 | 1; kind: AttackKind; x: number; y: number }
  | {
      id: number
      type: 'hit'
      attacker: 0 | 1
      target: 0 | 1
      source: HitSource
      x: number
      y: number
      vx: number
      vy: number
      damage: number
      power: number
      combo: number
    }
  | { id: number; type: 'shield'; attacker: 0 | 1; target: 0 | 1; x: number; y: number }
  | {
      id: number
      type: 'parry'
      attacker: 0 | 1
      target: 0 | 1
      reflected: boolean
      x: number
      y: number
    }
  | { id: number; type: 'shieldBreak'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'projectile'; fighter: 0 | 1; kind: ProjectileKind; x: number; y: number }
  | { id: number; type: 'dodge'; fighter: 0 | 1; kind: DodgeKind; x: number; y: number }
  | { id: number; type: 'ledge' | 'climb'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'bounce'; fighter: 0 | 1; x: number; y: number; speed: number }
  | {
      id: number
      type: 'ko'
      fighter: 0 | 1
      by: 0 | 1 | null
      side: BlastSide
      stocks: number
      final: boolean
      x: number
      y: number
    }
  | { id: number; type: 'respawn'; fighter: 0 | 1; x: number; y: number }
  | { id: number; type: 'gameOver'; winner: 0 | 1; timeUp: boolean }

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

export type AttackDef = {
  total: number
  activeFrom: number
  activeTo: number
  damage: number
  base: number
  scale: number
  /** 吹っ飛ばす向き（ラジアン）。負は上、正は下（メテオ）。 */
  angle: number
  w: number
  h: number
  ox: number
  oy: number
  aerial?: boolean
}

export const ATTACKS: Record<AttackKind, AttackDef> = {
  jab: {
    total: 0.34,
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
    aerial: true,
  },
  airUp: {
    total: 0.44,
    activeFrom: 0.1,
    activeTo: 0.23,
    damage: 9,
    base: 240,
    scale: 4,
    angle: -1.5,
    w: 86,
    h: 84,
    ox: 0,
    oy: -112,
    aerial: true,
  },
  // 下向きに叩き落とすメテオ。出は遅いが、場外で当てれば低い蓄積でも決まる。
  airDown: {
    total: 0.56,
    activeFrom: 0.17,
    activeTo: 0.3,
    damage: 11,
    base: 250,
    scale: 3.6,
    angle: 1.32,
    w: 68,
    h: 74,
    ox: 0,
    oy: -4,
    aerial: true,
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
  // 夏の通常必殺技。飛び道具のかわりに、目の前を広く焼く。
  burst: {
    total: 0.52,
    activeFrom: 0.13,
    activeTo: 0.28,
    damage: 14,
    base: 300,
    scale: 4.6,
    angle: -0.55,
    w: 150,
    h: 96,
    ox: 82,
    oy: -52,
  },
}

export type Hitbox = { x: number; y: number; w: number; h: number }

export const PHYSICS = {
  fighterW: 48,
  fighterH: 94,
  gravity: 1960,
  maxFall: 850,
  runSpeed: 330,
  jumpSpeed: 700,
  airJumpSpeed: 650,
  recoverySpeed: 790,
}

const FIGHTER_W = PHYSICS.fighterW
const FIGHTER_H = PHYSICS.fighterH
const HALF_W = FIGHTER_W / 2
const GRAVITY = PHYSICS.gravity
const MAX_FALL = PHYSICS.maxFall
const RUN_SPEED = PHYSICS.runSpeed
const GROUND_ACCEL = 2550
const AIR_ACCEL = 1480
const FRICTION = 2850
const JUMP_SPEED = PHYSICS.jumpSpeed
const AIR_JUMP_SPEED = PHYSICS.airJumpSpeed
const COYOTE_TIME = 0.1
/** 地上ジャンプの踏み切り（3フレーム）。 */
const JUMP_SQUAT = 0.05
const INPUT_BUFFER = 0.11
const SPECIAL_COOLDOWN = 1.05
const NEUTRAL_COOLDOWN: Record<ClashKit, number> = {
  spring: 0.9,
  summer: 0.85,
  autumn: 1.25,
  winter: 1.7,
}

/** ガードを張ってからこの時間内に受けるとジャストガード。 */
export const PARRY_WINDOW = 0.1
const PARRY_LOCK = 0.3
/** 殴られてから地上でこれだけ過ごすと、そのあとの落下は自滅として数える。 */
const HIT_CREDIT = 3
const PARRY_STAGGER = 0.5
const CHILL_TIME = 1.6
const CHILL_FACTOR = 0.72

export const DODGES: Record<DodgeKind, { total: number; from: number; to: number; speed: number }> = {
  roll: { total: 0.42, from: 0.04, to: 0.3, speed: 470 },
  spot: { total: 0.36, from: 0.03, to: 0.26, speed: 0 },
  air: { total: 0.42, from: 0.03, to: 0.3, speed: 300 },
}

// 崖。つかまると main の角にぶら下がる。
export const LEDGE = {
  reachX: 70,
  reachTop: 24,
  reachBottom: 118,
  hangX: 26,
  hangY: 80,
  minHang: 0.14,
  holdToClimb: 0.45,
  maxHang: 3,
  invuln: 0.55,
}

export const ledgePoint = (side: LedgeSide) => ({
  x: side === 'left' ? ARENA.main.x : ARENA.main.x + ARENA.main.w,
  y: ARENA.main.y,
})

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const approach = (value: number, target: number, amount: number) => {
  if (value < target) return Math.min(target, value + amount)
  return Math.max(target, value - amount)
}

export const fighterBox = (fighter: Fighter): Hitbox => ({
  x: fighter.x - HALF_W,
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

function createFighter(id: 0 | 1, stats: FighterStats, stocks: number): Fighter {
  const spawn = spawnPoint(id)
  return {
    id,
    ...spawn,
    vx: 0,
    vy: 0,
    facing: id === 0 ? 1 : -1,
    percent: 0,
    stocks,
    onGround: true,
    ground: 0,
    jumpsLeft: stats.airJumps,
    squat: 0,
    coyote: COYOTE_TIME,
    jumpBuffer: 0,
    attackBuffer: 0,
    specialBuffer: 0,
    dodgeBuffer: 0,
    dropThrough: 0,
    hitstun: 0,
    shieldStun: 0,
    lag: 0,
    invuln: 0,
    respawn: 0,
    shield: 100,
    shielding: false,
    guardTime: 0,
    parryReady: false,
    parryLock: 0,
    specialCooldown: 0,
    usedRecovery: false,
    airDodged: false,
    action: null,
    dodge: null,
    ledge: null,
    ledgeTime: 0,
    ledgeCooldown: 0,
    ledgeHop: 0,
    ledgeGrabs: 0,
    chill: 0,
    combo: 0,
    prevDir: 0,
    prevDown: false,
    stats: { ...stats },
    lastHitBy: null,
    credit: 0,
  }
}

export type ClashRules = {
  stocks?: number
  clock?: number
  countdown?: number
}

export function createClashMatch(
  firstStats: FighterStats,
  secondStats: FighterStats,
  rules: ClashRules = {},
): ClashMatch {
  const stocks = rules.stocks ?? 3
  return {
    phase: 'countdown',
    countdown: rules.countdown ?? 3.2,
    clock: rules.clock ?? 180,
    winner: null,
    fighters: [createFighter(0, firstStats, stocks), createFighter(1, secondStats, stocks)],
    projectiles: [],
    events: [],
    nextEventId: 1,
    nextProjectileId: 1,
    freeze: 0,
    elapsed: 0,
  }
}

/** 先読み用の複製。イベント履歴は持ち越さない（複製側で起きたことだけが積まれる）。 */
export function cloneClashMatch(match: ClashMatch): ClashMatch {
  const [first, second] = match.fighters
  return {
    ...match,
    fighters: [
      { ...first, action: first.action && { ...first.action }, dodge: first.dodge && { ...first.dodge } },
      { ...second, action: second.action && { ...second.action }, dodge: second.dodge && { ...second.dodge } },
    ],
    projectiles: match.projectiles.map((projectile) => ({ ...projectile })),
    events: [],
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

/** 回避の無敵時間の中にいるか。 */
export function isDodging(fighter: Fighter) {
  const dodge = fighter.dodge
  if (!dodge) return false
  const def = DODGES[dodge.kind]
  return dodge.time >= def.from && dodge.time <= def.to
}

export const isIntangible = (fighter: Fighter) =>
  fighter.invuln > 0 || fighter.respawn > 0 || isDodging(fighter)

export function attackHitboxAt(fighter: Fighter, kind: AttackKind): Hitbox {
  const def = ATTACKS[kind]
  return {
    x: fighter.x + def.ox * fighter.facing - def.w / 2,
    y: fighter.y + def.oy - def.h / 2,
    w: def.w,
    h: def.h,
  }
}

export function activeAttackHitbox(fighter: Fighter): Hitbox | null {
  const state = fighter.action
  if (!state) return null
  const def = ATTACKS[state.kind]
  if (state.time < def.activeFrom || state.time > def.activeTo || state.hit) return null
  return attackHitboxAt(fighter, state.kind)
}

function startAttack(match: ClashMatch, fighter: Fighter, kind: AttackKind) {
  fighter.action = { kind, time: 0, hit: false }
  fighter.attackBuffer = 0
  emit(match, { type: 'attack', fighter: fighter.id, kind, x: fighter.x, y: fighter.y - 48 })
}

function chooseAttack(fighter: Fighter, input: ClashInput): AttackKind {
  if (!fighter.onGround) return input.up ? 'airUp' : input.down ? 'airDown' : 'air'
  if (input.up) return 'up'
  if (input.down) return 'down'
  if (input.left || input.right) return 'smash'
  return 'jab'
}

function spawnProjectile(
  match: ClashMatch,
  fighter: Fighter,
  shot: Pick<Projectile, 'kind' | 'vx' | 'vy' | 'ax' | 'life' | 'radius' | 'damage' | 'base' | 'scale'> &
    Partial<Pick<Projectile, 'chill' | 'angle'>>,
) {
  const projectile: Projectile = {
    id: match.nextProjectileId++,
    owner: fighter.id,
    x: fighter.x + fighter.facing * 44,
    y: fighter.y - 56,
    age: 0,
    spent: false,
    chill: 0,
    angle: -0.27,
    ...shot,
  }
  match.projectiles.push(projectile)
  emit(match, {
    type: 'projectile',
    fighter: fighter.id,
    kind: projectile.kind,
    x: projectile.x,
    y: projectile.y,
  })
}

/** 通常必殺技。季節ごとに性格がまったく違う。 */
function startNeutralSpecial(match: ClashMatch, fighter: Fighter) {
  const facing = fighter.facing
  const kit = fighter.stats.kit
  fighter.specialCooldown = NEUTRAL_COOLDOWN[kit]
  if (kit === 'summer') {
    // 熱波。飛ばないかわりに踏み込んで広く当てる。
    fighter.vx += facing * 170
    startAttack(match, fighter, 'burst')
    return
  }
  if (kit === 'spring') {
    // 花びらを上下2枚。軽いが、相手の動ける場所を狭める。
    for (const tilt of [-0.21, 0.07]) {
      spawnProjectile(match, fighter, {
        kind: 'petal',
        vx: Math.cos(tilt) * 470 * facing,
        vy: Math.sin(tilt) * 470,
        ax: 0,
        life: 1.3,
        radius: 14,
        damage: 5,
        base: 150,
        scale: 2.4,
      })
    }
    return
  }
  if (kit === 'autumn') {
    // 落ち葉は飛んでいって戻ってくる。帰りに当たると手前へ引き寄せる。
    spawnProjectile(match, fighter, {
      kind: 'leaf',
      vx: facing * 760,
      vy: 0,
      ax: -facing * 820,
      life: 2,
      radius: 16,
      damage: 6,
      base: 165,
      scale: 2.7,
    })
    return
  }
  // 氷のつぶて。遅くて大きく、当たるとしばらく足が鈍る。
  spawnProjectile(match, fighter, {
    kind: 'frost',
    vx: facing * 340,
    vy: 0,
    ax: 0,
    life: 2.6,
    radius: 22,
    damage: 9,
    base: 170,
    scale: 3,
    chill: CHILL_TIME,
  })
}

function startSpecial(match: ClashMatch, fighter: Fighter, input: ClashInput) {
  if (input.up) {
    if (fighter.usedRecovery) return false
    fighter.specialCooldown = SPECIAL_COOLDOWN
    fighter.usedRecovery = true
    startAttack(match, fighter, 'recovery')
    fighter.vy = -PHYSICS.recoverySpeed * fighter.stats.jump
    fighter.vx *= 0.45
    leaveGround(fighter)
    fighter.jumpsLeft = 0
    fighter.invuln = Math.max(fighter.invuln, 0.1)
    return true
  }
  if (input.left || input.right) {
    fighter.specialCooldown = SPECIAL_COOLDOWN
    fighter.facing = input.left ? -1 : 1
    fighter.vx = 670 * fighter.facing * fighter.stats.speed
    fighter.vy = Math.min(fighter.vy, -65)
    leaveGround(fighter)
    startAttack(match, fighter, 'rush')
    return true
  }
  startNeutralSpecial(match, fighter)
  return true
}

function leaveGround(fighter: Fighter) {
  fighter.onGround = false
  fighter.ground = -1
}

function groundJump(match: ClashMatch, fighter: Fighter) {
  const chill = fighter.chill > 0 ? 0.92 : 1
  fighter.vy = -JUMP_SPEED * fighter.stats.jump * chill
  leaveGround(fighter)
  fighter.coyote = 0
  fighter.jumpBuffer = 0
  emit(match, { type: 'jump', fighter: fighter.id, x: fighter.x, y: fighter.y })
}

function tryJump(match: ClashMatch, fighter: Fighter) {
  const chill = fighter.chill > 0 ? 0.92 : 1
  if (fighter.onGround) {
    fighter.squat = JUMP_SQUAT
    fighter.jumpBuffer = 0
  } else if (fighter.coyote > 0) {
    groundJump(match, fighter)
  } else if (fighter.jumpsLeft > 0) {
    fighter.jumpsLeft -= 1
    fighter.vy = -AIR_JUMP_SPEED * fighter.stats.jump * chill
    fighter.jumpBuffer = 0
    emit(match, { type: 'airJump', fighter: fighter.id, x: fighter.x, y: fighter.y })
  }
}

function startDodge(
  match: ClashMatch,
  fighter: Fighter,
  kind: DodgeKind,
  dir: -1 | 0 | 1,
  input: ClashInput,
) {
  fighter.dodge = { kind, time: 0, dir }
  fighter.shielding = false
  fighter.squat = 0
  fighter.dodgeBuffer = 0
  if (kind === 'air') {
    fighter.airDodged = true
    const dy = Number(input.down) - Number(input.up)
    if (dir !== 0 || dy !== 0) {
      const length = Math.hypot(dir, dy)
      fighter.vx = (dir / length) * DODGES.air.speed
      fighter.vy = (dy / length) * DODGES.air.speed
    } else {
      fighter.vx *= 0.4
      fighter.vy = Math.min(fighter.vy, 80)
    }
  }
  emit(match, { type: 'dodge', fighter: fighter.id, kind, x: fighter.x, y: fighter.y })
}

function touchDown(match: ClashMatch, fighter: Fighter, index: number, impact: number) {
  fighter.onGround = true
  fighter.ground = index
  fighter.jumpsLeft = fighter.stats.airJumps
  fighter.coyote = COYOTE_TIME
  fighter.usedRecovery = false
  fighter.airDodged = false
  fighter.ledgeGrabs = 0
  if (impact <= 150) return
  // 空中技と空中回避は着地で途切れ、わずかな隙になる。
  if (fighter.action && ATTACKS[fighter.action.kind].aerial) {
    fighter.action = null
    fighter.lag = Math.max(fighter.lag, 0.07)
  }
  if (fighter.dodge?.kind === 'air') {
    fighter.dodge = null
    fighter.lag = Math.max(fighter.lag, 0.09)
  }
  emit(match, { type: 'land', fighter: fighter.id, x: fighter.x, y: fighter.y })
}

function landOnPlatforms(match: ClashMatch, fighter: Fighter, previousY: number) {
  if (fighter.vy < 0) return
  for (let index = 0; index < ALL_PLATFORMS.length; index++) {
    const platform = ALL_PLATFORMS[index]
    const soft = platform.kind === 'soft'
    if (soft && fighter.dropThrough > 0) continue
    // main は端いっぱいまで立てる。soft は少し内側まで。
    const inset = soft ? FIGHTER_W * 0.34 : HALF_W
    const insideX = fighter.x + inset > platform.x && fighter.x - inset < platform.x + platform.w
    const crossed = previousY <= platform.y + 1 && fighter.y >= platform.y
    if (!insideX || !crossed) continue
    const impact = fighter.vy
    fighter.y = platform.y
    // 吹っ飛び中に強く叩きつけられると跳ね返る（メテオ→バウンドの追撃が成立する）。
    if (fighter.hitstun > 0.05 && impact > 520) {
      fighter.vy = -impact * 0.42
      fighter.vx *= 0.82
      emit(match, { type: 'bounce', fighter: fighter.id, x: fighter.x, y: fighter.y, speed: impact })
      return
    }
    fighter.vy = 0
    touchDown(match, fighter, index, impact)
    return
  }
}

/** main の横と下の当たり。吹っ飛び中は壁や天井で跳ね返る。 */
function collideMainBody(fighter: Fighter, previousX: number, previousY: number) {
  const body = ARENA.main
  const left = fighter.x - HALF_W
  const right = fighter.x + HALF_W
  const top = fighter.y - FIGHTER_H
  if (right <= body.x || left >= body.x + body.w) return
  if (fighter.y <= body.y + 1 || top >= body.y + body.h) return
  const stunned = fighter.hitstun > 0
  // 崖から跳びのる途中は、壁に触れても内向きの勢いを残す（上面を越えたらそのまま乗れる）。
  const hopping = fighter.ledgeHop > 0 && !stunned
  if (previousY - FIGHTER_H >= body.y + body.h - 2) {
    fighter.y = body.y + body.h + FIGHTER_H
    if (fighter.vy < 0) fighter.vy = stunned ? -fighter.vy * 0.45 : 0
    return
  }
  let side: -1 | 1
  if (previousX + HALF_W <= body.x + 2) side = -1
  else if (previousX - HALF_W >= body.x + body.w - 2) side = 1
  else side = fighter.x < body.x + body.w / 2 ? -1 : 1
  if (side < 0) {
    fighter.x = body.x - HALF_W
    if (fighter.vx > 0 && !hopping) fighter.vx = stunned ? -fighter.vx * 0.5 : 0
  } else {
    fighter.x = body.x + body.w + HALF_W
    if (fighter.vx < 0 && !hopping) fighter.vx = stunned ? -fighter.vx * 0.5 : 0
  }
}

/** いまの位置と状態で、どちらかの崖に手が届くか。CPU の復帰判断でも使う。 */
export function ledgeInReach(fighter: Fighter): LedgeSide | null {
  for (const side of ['left', 'right'] as const) {
    const point = ledgePoint(side)
    const outward = side === 'left' ? point.x - fighter.x : fighter.x - point.x
    if (outward <= 0 || outward > LEDGE.reachX) continue
    const below = fighter.y - point.y
    if (below < LEDGE.reachTop || below > LEDGE.reachBottom) continue
    return side
  }
  return null
}

function tryLedgeGrab(match: ClashMatch, fighter: Fighter, input: ClashInput, dir: -1 | 0 | 1) {
  if (fighter.hitstun > 0 || fighter.lag > 0 || fighter.ledgeCooldown > 0) return
  if (fighter.vy < -60 || input.down) return
  if (fighter.action && fighter.action.kind !== 'recovery' && fighter.action.kind !== 'rush') return
  const side = ledgeInReach(fighter)
  if (!side) return
  const toward = side === 'left' ? 1 : -1
  // 外へ向かって入力しているあいだは、つかまらずに降りられる。
  if (dir === -toward) return
  const point = ledgePoint(side)
  fighter.ledge = side
  fighter.ledgeTime = 0
  fighter.x = point.x - toward * LEDGE.hangX
  fighter.y = point.y + LEDGE.hangY
  fighter.vx = 0
  fighter.vy = 0
  fighter.facing = toward
  fighter.action = null
  fighter.dodge = null
  fighter.jumpsLeft = fighter.stats.airJumps
  fighter.usedRecovery = false
  fighter.airDodged = false
  if (fighter.ledgeGrabs === 0) fighter.invuln = Math.max(fighter.invuln, LEDGE.invuln)
  fighter.ledgeGrabs += 1
  emit(match, { type: 'ledge', fighter: fighter.id, x: point.x, y: point.y })
}

function climbLedge(match: ClashMatch, fighter: Fighter) {
  const side = fighter.ledge
  if (!side) return
  const toward = side === 'left' ? 1 : -1
  const point = ledgePoint(side)
  fighter.ledge = null
  fighter.ledgeCooldown = 0.3
  fighter.x = point.x + toward * 30
  fighter.y = point.y
  fighter.vx = 0
  fighter.vy = 0
  fighter.facing = toward
  fighter.onGround = true
  fighter.ground = 0
  fighter.coyote = COYOTE_TIME
  fighter.ledgeGrabs = 0
  fighter.lag = 0.14
  fighter.invuln = Math.max(fighter.invuln, 0.22)
  emit(match, { type: 'climb', fighter: fighter.id, x: fighter.x, y: fighter.y })
}

function updateLedge(match: ClashMatch, fighter: Fighter, input: ClashInput, dir: -1 | 0 | 1, dt: number) {
  const side = fighter.ledge!
  const toward = side === 'left' ? 1 : -1
  fighter.ledgeTime += dt
  fighter.vx = 0
  fighter.vy = 0
  fighter.shielding = false
  if (fighter.ledgeTime < LEDGE.minHang) return
  const pressedToward = dir === toward && fighter.prevDir !== toward
  const pressedAway = dir === -toward && fighter.prevDir !== -toward
  if (fighter.attackBuffer > 0) {
    // のぼりながら足元を払う。
    climbLedge(match, fighter)
    fighter.lag = 0
    startAttack(match, fighter, 'down')
  } else if (fighter.jumpBuffer > 0) {
    fighter.ledge = null
    fighter.ledgeCooldown = 0.5
    fighter.ledgeHop = 0.4
    fighter.jumpBuffer = 0
    fighter.vy = -JUMP_SPEED * fighter.stats.jump
    fighter.vx = toward * 150
    emit(match, { type: 'jump', fighter: fighter.id, x: fighter.x, y: fighter.y })
  } else if (
    pressedToward ||
    (input.up && fighter.ledgeTime > LEDGE.minHang) ||
    fighter.dodgeBuffer > 0 ||
    (dir === toward && fighter.ledgeTime > LEDGE.holdToClimb)
  ) {
    fighter.dodgeBuffer = 0
    climbLedge(match, fighter)
  } else if (
    pressedAway ||
    (input.down && !fighter.prevDown) ||
    fighter.ledgeTime > LEDGE.maxHang
  ) {
    fighter.ledge = null
    fighter.ledgeCooldown = 0.5
    fighter.vy = 40
  }
}

function bufferInput(fighter: Fighter, input: ClashInput) {
  if (input.jumpPressed) fighter.jumpBuffer = INPUT_BUFFER
  if (input.attackPressed) fighter.attackBuffer = INPUT_BUFFER
  if (input.specialPressed) fighter.specialBuffer = INPUT_BUFFER
  if (input.shieldPressed) fighter.dodgeBuffer = INPUT_BUFFER
}

function breakShield(match: ClashMatch, fighter: Fighter) {
  fighter.shielding = false
  fighter.shieldStun = 0
  fighter.hitstun = 2.1
  fighter.vy = -330
  leaveGround(fighter)
  fighter.shield = 28
  emit(match, { type: 'shieldBreak', fighter: fighter.id, x: fighter.x, y: fighter.y - 48 })
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
  fighter.lag = Math.max(0, fighter.lag - dt)
  fighter.specialCooldown = Math.max(0, fighter.specialCooldown - dt)
  fighter.dropThrough = Math.max(0, fighter.dropThrough - dt)
  fighter.ledgeCooldown = Math.max(0, fighter.ledgeCooldown - dt)
  fighter.ledgeHop = Math.max(0, fighter.ledgeHop - dt)
  fighter.parryLock = Math.max(0, fighter.parryLock - dt)
  fighter.chill = Math.max(0, fighter.chill - dt)
  fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - dt)
  fighter.attackBuffer = Math.max(0, fighter.attackBuffer - dt)
  fighter.specialBuffer = Math.max(0, fighter.specialBuffer - dt)
  fighter.dodgeBuffer = Math.max(0, fighter.dodgeBuffer - dt)

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
      leaveGround(fighter)
      fighter.jumpsLeft = fighter.stats.airJumps
      fighter.usedRecovery = false
      fighter.airDodged = false
      fighter.chill = 0
      fighter.shield = Math.max(fighter.shield, 60)
      emit(match, { type: 'respawn', fighter: fighter.id, x: fighter.x, y: fighter.y })
    }
    return
  }

  if (fighter.lastHitBy != null && fighter.onGround && fighter.hitstun <= 0) {
    fighter.credit -= dt
    if (fighter.credit <= 0) fighter.lastHitBy = null
  }

  bufferInput(fighter, input)
  const dir = (Number(input.right) - Number(input.left)) as -1 | 0 | 1

  if (fighter.ledge) {
    updateLedge(match, fighter, input, dir, dt)
    fighter.prevDir = dir
    fighter.prevDown = input.down
    if (fighter.ledge || fighter.onGround) return
  }

  if (fighter.action) {
    fighter.action.time += dt
    if (fighter.action.time >= ATTACKS[fighter.action.kind].total) fighter.action = null
  }
  if (fighter.dodge) {
    fighter.dodge.time += dt
    if (fighter.dodge.time >= DODGES[fighter.dodge.kind].total) {
      // 転がり終わりは相手のほうを向き直す。
      if (fighter.dodge.kind === 'roll') {
        const foe = match.fighters[fighter.id === 0 ? 1 : 0]
        if (foe.x !== fighter.x) fighter.facing = foe.x > fighter.x ? 1 : -1
      }
      fighter.dodge = null
    }
  }

  const wasShielding = fighter.shielding
  const slow = fighter.chill > 0 ? CHILL_FACTOR : 1

  if (fighter.hitstun > 0) {
    fighter.shielding = false
    fighter.vx *= Math.pow(0.985, dt * 60)
    if (fighter.onGround) fighter.vx = approach(fighter.vx, 0, FRICTION * 0.35 * dt)
  } else if (fighter.lag > 0) {
    fighter.shielding = false
    if (fighter.onGround) fighter.vx = approach(fighter.vx, 0, FRICTION * dt)
  } else if (fighter.dodge) {
    const dodge = fighter.dodge
    if (dodge.kind === 'roll') {
      const def = DODGES.roll
      fighter.vx = dodge.dir * def.speed * (dodge.time < def.to ? 1 : 0.25)
    } else if (dodge.kind === 'spot') {
      fighter.vx = approach(fighter.vx, 0, FRICTION * dt)
    }
  } else if (fighter.shieldStun > 0 && wasShielding) {
    // ガード硬直中は盾を張ったまま動けない。
    fighter.vx = approach(fighter.vx, 0, FRICTION * dt)
  } else {
    const canGuard = fighter.onGround && fighter.action == null && fighter.shield > 0
    fighter.shielding = canGuard && input.shield
    if (fighter.shielding && !wasShielding) {
      fighter.guardTime = 0
      fighter.parryReady = fighter.parryLock <= 0
    }
    // 地上でガードに使った押下を、直後のジャンプで空中回避に化けさせない。
    if (fighter.shielding) {
      fighter.dodgeBuffer = 0
      fighter.squat = 0
    }
    if (fighter.shielding) {
      fighter.guardTime += dt
      const dirPressed = dir !== 0 && (fighter.prevDir !== dir || !wasShielding)
      const downPressed = input.down && (!fighter.prevDown || !wasShielding)
      if (dirPressed) startDodge(match, fighter, 'roll', dir, input)
      else if (downPressed) startDodge(match, fighter, 'spot', 0, input)
      else {
        fighter.vx = approach(fighter.vx, 0, 3300 * dt)
        fighter.shield = Math.max(0, fighter.shield - 6.5 * dt)
        if (fighter.shield <= 0) breakShield(match, fighter)
      }
    } else {
      fighter.shield = Math.min(100, fighter.shield + 12 * dt)
    }

    if (!fighter.shielding && !fighter.dodge && fighter.hitstun <= 0) {
      if (
        !fighter.onGround &&
        fighter.dodgeBuffer > 0 &&
        !fighter.airDodged &&
        !fighter.action
      ) {
        startDodge(match, fighter, 'air', dir, input)
      } else {
        const onSoft = fighter.onGround && fighter.ground > 0
        if (fighter.squat > 0) {
          fighter.squat -= dt
          if (fighter.attackBuffer > 0 && input.up && fighter.onGround && !fighter.action) {
            // 踏み切り中の ↑＋攻撃は、跳ばずに上攻撃へ切り替える（↑がジャンプを兼ねる操作でも出せる）。
            fighter.squat = 0
            fighter.jumpBuffer = 0
            startAttack(match, fighter, 'up')
          } else if (fighter.squat <= 0) {
            fighter.squat = 0
            groundJump(match, fighter)
          }
        } else if (onSoft && input.down && fighter.jumpBuffer > 0) {
          // soft 足場は ↓＋ジャンプですり抜ける。
          fighter.dropThrough = 0.2
          leaveGround(fighter)
          fighter.coyote = 0
          fighter.y += 4
          fighter.jumpBuffer = 0
        } else {
          const jumpable = !fighter.action || ATTACKS[fighter.action.kind].aerial === true
          if (fighter.jumpBuffer > 0 && jumpable) tryJump(match, fighter)
        }

        const grounded = fighter.onGround
        const acting = fighter.action
        if (dir !== 0 && !acting) fighter.facing = dir
        const steerable = !acting || (ATTACKS[acting.kind].aerial && !grounded)
        if (steerable || acting?.kind === 'recovery') {
          const speed = RUN_SPEED * fighter.stats.speed * slow
          const accel = grounded ? GROUND_ACCEL : AIR_ACCEL * fighter.stats.airControl
          if (dir !== 0) fighter.vx = approach(fighter.vx, dir * speed, accel * dt)
          else if (grounded) fighter.vx = approach(fighter.vx, 0, FRICTION * dt)
        } else if (grounded) {
          // 地上技の最中は踏ん張って止まる（以前は慣性のまま滑っていた）。
          fighter.vx = approach(fighter.vx, 0, FRICTION * 0.8 * dt)
        }

        // 踏み切り中に押した攻撃は、離陸してから空中技として出る。
        if (fighter.squat > 0) {
          // 何もしない
        } else if (!fighter.action && fighter.attackBuffer > 0) {
          startAttack(match, fighter, chooseAttack(fighter, input))
        } else if (
          !fighter.action &&
          fighter.specialBuffer > 0 &&
          fighter.specialCooldown <= 0
        ) {
          if (startSpecial(match, fighter, input)) fighter.specialBuffer = 0
        }
      }
    }
  }
  if (wasShielding && !fighter.shielding) fighter.parryLock = PARRY_LOCK

  if (fighter.onGround) fighter.coyote = COYOTE_TIME
  else fighter.coyote = Math.max(0, fighter.coyote - dt)

  const previousX = fighter.x
  const previousY = fighter.y
  if (!fighter.onGround) {
    const fastFall = input.down && fighter.vy > 0 && fighter.hitstun <= 0 ? 1.48 : 1
    fighter.vy = Math.min(
      fighter.hitstun > 0 ? Math.max(MAX_FALL, fighter.vy) : MAX_FALL,
      fighter.vy + GRAVITY * fastFall * dt,
    )
  } else {
    // 足場を走り抜けたフレームで落下へ移れるよう、ごく小さく重力を掛ける。
    fighter.vy = 24
  }

  fighter.x += fighter.vx * dt
  fighter.y += fighter.vy * dt
  const wasGrounded = fighter.onGround
  if (wasGrounded && fighter.dodge?.kind === 'roll' && fighter.ground >= 0) {
    // 転がって足場から落ちることはない。
    const platform = ALL_PLATFORMS[fighter.ground]
    fighter.x = clamp(fighter.x, platform.x + 6, platform.x + platform.w - 6)
  }
  leaveGround(fighter)
  landOnPlatforms(match, fighter, previousY)
  if (!fighter.onGround) {
    collideMainBody(fighter, previousX, previousY)
    tryLedgeGrab(match, fighter, input, dir)
    if (wasGrounded) fighter.coyote = COYOTE_TIME
  }

  // ジャンプボタンを早く離すと小ジャンプになる。
  if (
    !input.jumpHeld &&
    fighter.vy < -260 &&
    fighter.hitstun <= 0 &&
    fighter.ledgeHop <= 0 &&
    fighter.action?.kind !== 'recovery'
  ) {
    fighter.vy += 1900 * dt
  }
  fighter.prevDir = dir
  fighter.prevDown = input.down
}

type HitSpec = {
  source: HitSource
  damage: number
  base: number
  scale: number
  angle: number
  x: number
  y: number
  /** 吹っ飛ばす左右の向き。 */
  dir: -1 | 1
  chill?: number
}

type HitResult = 'hit' | 'shield' | 'parry' | null

function applyHit(
  match: ClashMatch,
  attacker: Fighter,
  target: Fighter,
  spec: HitSpec,
  melee: boolean,
): HitResult {
  if (isIntangible(target)) return null
  if (target.shielding) {
    if (target.parryReady && target.guardTime <= PARRY_WINDOW) {
      // ジャストガード。盾は減らず、殴ってきた側が大きくのけぞる。
      target.parryReady = false
      target.shieldStun = 0
      if (melee) {
        attacker.action = null
        attacker.lag = Math.max(attacker.lag, PARRY_STAGGER)
        attacker.vx = -spec.dir * 120
      }
      emit(match, {
        type: 'parry',
        attacker: attacker.id,
        target: target.id,
        reflected: !melee,
        x: spec.x,
        y: spec.y,
      })
      match.freeze = Math.max(match.freeze, 0.1)
      return 'parry'
    }
    target.shield = Math.max(0, target.shield - spec.damage * 4.8)
    target.shieldStun = 0.11 + spec.damage * 0.012
    target.vx += spec.dir * spec.damage * 5
    emit(match, { type: 'shield', attacker: attacker.id, target: target.id, x: spec.x, y: spec.y })
    if (target.shield <= 0) breakShield(match, target)
    match.freeze = Math.max(match.freeze, 0.045)
    return 'shield'
  }

  attacker.combo = target.hitstun > 0 && target.lastHitBy === attacker.id ? attacker.combo + 1 : 1
  target.percent = Math.min(999, target.percent + spec.damage)
  const launch = ((spec.base + target.percent * spec.scale) * attacker.stats.power) / target.stats.weight
  target.vx = Math.cos(spec.angle) * launch * spec.dir
  target.vy = Math.sin(spec.angle) * launch
  target.hitstun = clamp(0.13 + launch / 1150, 0.16, 0.92)
  target.invuln = 0.08
  target.squat = 0
  target.ledgeHop = 0
  leaveGround(target)
  target.action = null
  target.dodge = null
  target.ledge = null
  target.lag = 0
  target.shielding = false
  target.shieldStun = 0
  target.usedRecovery = false
  target.lastHitBy = attacker.id
  target.credit = HIT_CREDIT
  if (spec.chill) target.chill = spec.chill
  emit(match, {
    type: 'hit',
    attacker: attacker.id,
    target: target.id,
    source: spec.source,
    x: target.x,
    y: target.y - 55,
    vx: target.vx,
    vy: target.vy,
    damage: spec.damage,
    power: launch,
    combo: attacker.combo,
  })
  match.freeze = Math.max(match.freeze, clamp(0.035 + launch / 8000, 0.04, 0.11))
  return 'hit'
}

function resolveMelee(match: ClashMatch) {
  // 先に両者の当たりを確定させてから適用する（同時に当たれば相打ちになる）。
  const pending: { attacker: Fighter; target: Fighter; spec: HitSpec }[] = []
  for (const attacker of match.fighters) {
    const hitbox = activeAttackHitbox(attacker)
    if (!hitbox || !attacker.action) continue
    const target = match.fighters[attacker.id === 0 ? 1 : 0]
    if (target.respawn > 0 || target.stocks <= 0) continue
    if (!overlaps(hitbox, fighterBox(target))) continue
    const def = ATTACKS[attacker.action.kind]
    const dir = target.x > attacker.x ? 1 : target.x < attacker.x ? -1 : attacker.facing
    pending.push({
      attacker,
      target,
      spec: {
        source: attacker.action.kind,
        damage: def.damage,
        base: def.base,
        scale: def.scale,
        angle: def.angle,
        x: hitbox.x + hitbox.w / 2,
        y: hitbox.y + hitbox.h / 2,
        dir,
      },
    })
  }
  for (const { attacker, target, spec } of pending) {
    const state = attacker.action
    const result = applyHit(match, attacker, target, spec, true)
    if (result && state) state.hit = true
  }
}

function updateProjectiles(match: ClashMatch, dt: number) {
  for (const projectile of match.projectiles) {
    projectile.life -= dt
    projectile.age += dt
    const before = projectile.vx
    projectile.vx += projectile.ax * dt
    if (before !== 0 && Math.sign(before) !== Math.sign(projectile.vx)) projectile.spent = false
    projectile.x += projectile.vx * dt
    projectile.y += projectile.vy * dt
    const owner = match.fighters[projectile.owner]
    if (projectile.kind === 'leaf' && projectile.age > 0.5) {
      // 戻ってきた落ち葉は持ち主の手元で消える。
      const returning = Math.sign(projectile.vx) === Math.sign(owner.x - projectile.x)
      if (returning && Math.abs(owner.x - projectile.x) < 26) projectile.life = 0
    }
    if (projectile.spent || projectile.life <= 0) continue
    const target = match.fighters[projectile.owner === 0 ? 1 : 0]
    if (target.respawn > 0 || target.stocks <= 0) continue
    const box = fighterBox(target)
    const nearestX = clamp(projectile.x, box.x, box.x + box.w)
    const nearestY = clamp(projectile.y, box.y, box.y + box.h)
    if (Math.hypot(projectile.x - nearestX, projectile.y - nearestY) > projectile.radius) continue
    const result = applyHit(
      match,
      owner,
      target,
      {
        source: projectile.kind,
        damage: projectile.damage,
        base: projectile.base,
        scale: projectile.scale,
        angle: projectile.angle,
        x: projectile.x,
        y: projectile.y,
        dir: projectile.vx >= 0 ? 1 : -1,
        chill: projectile.chill,
      },
      false,
    )
    if (result === 'parry') {
      // ジャストガードで跳ね返す。持ち主が入れ替わり、少し速く重くなる。
      projectile.owner = target.id
      projectile.vx = -projectile.vx * 1.25
      projectile.ax = 0
      projectile.damage = Math.round(projectile.damage * 1.3)
      projectile.life = Math.max(projectile.life, 1.1)
      projectile.spent = false
    } else if (result === 'hit') {
      if (projectile.kind === 'leaf') projectile.spent = true
      else projectile.life = 0
    } else if (result === 'shield') {
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

function knockOut(match: ClashMatch, fighter: Fighter, side: BlastSide) {
  fighter.stocks -= 1
  fighter.respawn = 1.25
  fighter.action = null
  fighter.dodge = null
  fighter.ledge = null
  fighter.shielding = false
  fighter.hitstun = 0
  fighter.lag = 0
  fighter.vx = 0
  fighter.vy = 0
  fighter.combo = 0
  fighter.percent = 0
  const final = fighter.stocks <= 0
  emit(match, {
    type: 'ko',
    fighter: fighter.id,
    by: fighter.lastHitBy,
    side,
    stocks: fighter.stocks,
    final,
    x: fighter.x,
    y: fighter.y,
  })
  fighter.lastHitBy = null
  match.freeze = 0.18
  if (!final) return
  const winner = fighter.id === 0 ? 1 : 0
  match.phase = 'result'
  match.winner = winner
  emit(match, { type: 'gameOver', winner, timeUp: false })
}

function blastSide(fighter: Fighter): BlastSide | null {
  if (fighter.x < ARENA.blast.left) return 'left'
  if (fighter.x > ARENA.blast.right) return 'right'
  if (fighter.y < ARENA.blast.top) return 'top'
  if (fighter.y > ARENA.blast.bottom) return 'bottom'
  return null
}

function checkBlastZones(match: ClashMatch) {
  const out: { fighter: Fighter; side: BlastSide }[] = []
  for (const fighter of match.fighters) {
    if (fighter.respawn > 0 || fighter.stocks <= 0) continue
    const side = blastSide(fighter)
    if (side) out.push({ fighter, side })
  }
  // 最後の1ストックどうしが同じフレームに落ちたら、蓄積の多い側だけを負けにする
  // （席順で勝敗が決まらないように。同率は時間切れと同じく 1P の勝ち）。
  if (out.length === 2 && out.every((entry) => entry.fighter.stocks === 1)) {
    const [first, second] = out
    const loser = first.fighter.percent > second.fighter.percent ? first : second
    knockOut(match, loser.fighter, loser.side)
    return
  }
  for (const { fighter, side } of out) {
    knockOut(match, fighter, side)
    if (match.winner !== null) return
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
    // 止まっているあいだに押されたボタンは先行入力として残す。
    bufferInput(match.fighters[0], inputs[0])
    bufferInput(match.fighters[1], inputs[1])
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
  else winner = first.percent <= second.percent ? 0 : 1
  match.phase = 'result'
  match.winner = winner
  emit(match, { type: 'gameOver', winner, timeUp: true })
}
