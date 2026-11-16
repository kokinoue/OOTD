import { describe, expect, it } from 'vitest'
import {
  ARENA,
  ATTACKS,
  DEFAULT_STATS,
  LEDGE,
  PHYSICS,
  cloneClashMatch,
  createClashMatch,
  emptyClashInput,
  isIntangible,
  ledgePoint,
  stepClashMatch,
  type ClashEvent,
  type ClashInput,
  type ClashKit,
  type ClashMatch,
} from '../clash'

const DT = 1 / 60
const FLOOR = ARENA.main.y

type Inputs = Partial<ClashInput>
const input = (partial: Inputs = {}): ClashInput => ({ ...emptyClashInput(), ...partial })

function beginMatch(firstKit: ClashKit = 'spring', secondKit: ClashKit = 'spring'): ClashMatch {
  const match = createClashMatch(
    { ...DEFAULT_STATS, kit: firstKit },
    { ...DEFAULT_STATS, kit: secondKit },
  )
  for (let i = 0; i < 230; i++) stepClashMatch(match, [input(), input()], DT)
  expect(match.phase).toBe('fight')
  return match
}

/** 2人を地上の指定位置に向かい合わせて立たせる。 */
function face(match: ClashMatch, firstX: number, secondX: number) {
  const [first, second] = match.fighters
  first.x = firstX
  second.x = secondX
  first.y = second.y = FLOOR
  first.facing = secondX >= firstX ? 1 : -1
  second.facing = secondX >= firstX ? -1 : 1
}

function step(match: ClashMatch, frames: number, first: Inputs = {}, second: Inputs = {}) {
  for (let i = 0; i < frames; i++) stepClashMatch(match, [input(first), input(second)], DT)
}

/** 最初の1フレームだけ押し、残りは `held` を持ち続ける。 */
function press(
  match: ClashMatch,
  frames: number,
  first: Inputs = {},
  second: Inputs = {},
  held: [Inputs, Inputs] = [{}, {}],
) {
  stepClashMatch(match, [input({ ...held[0], ...first }), input({ ...held[1], ...second })], DT)
  step(match, frames - 1, held[0], held[1])
}

const events = <T extends ClashEvent['type']>(match: ClashMatch, type: T) =>
  match.events.filter((event): event is Extract<ClashEvent, { type: T }> => event.type === type)

describe('clash match', () => {
  it('starts with a three-stock countdown and enters the fight', () => {
    const match = createClashMatch(DEFAULT_STATS, DEFAULT_STATS)
    expect(match.phase).toBe('countdown')
    expect(match.fighters.map((fighter) => fighter.stocks)).toEqual([3, 3])

    step(match, 230)

    expect(match.phase).toBe('fight')
    expect(match.clock).toBeLessThan(180)
  })

  it('is deterministic, and a clone never disturbs the original', () => {
    const script = (frame: number): [ClashInput, ClashInput] => [
      input({ right: frame % 50 < 30, jumpPressed: frame % 37 === 0, jumpHeld: true, attackPressed: frame % 23 === 0 }),
      input({ left: frame % 40 < 25, specialPressed: frame % 61 === 0, shield: frame % 90 > 70 }),
    ]
    const a = beginMatch('autumn', 'winter')
    const b = beginMatch('autumn', 'winter')
    for (let frame = 0; frame < 600; frame++) {
      stepClashMatch(a, script(frame), DT)
      if (frame === 300) {
        // 途中で複製して好き勝手に進めても、元の試合には影響しない。
        const fork = cloneClashMatch(a)
        for (let i = 0; i < 200; i++) stepClashMatch(fork, [input({ left: true, attackPressed: i % 9 === 0 }), input()], DT)
      }
      stepClashMatch(b, script(frame), DT)
    }
    expect(a.fighters).toEqual(b.fighters)
    expect(a.projectiles).toEqual(b.projectiles)
  })

  it('lands a close-range attack only once and builds damage', () => {
    const match = beginMatch()
    face(match, 580, 642)

    press(match, 22, { attackPressed: true })

    expect(match.fighters[1].percent).toBe(ATTACKS.jab.damage)
    expect(events(match, 'hit')).toHaveLength(1)
  })

  it('scales launch force with accumulated damage', () => {
    const launch = (percent: number) => {
      const match = beginMatch()
      face(match, 580, 642)
      match.fighters[1].percent = percent
      press(match, 8, { attackPressed: true })
      return events(match, 'hit')[0].power
    }
    expect(launch(120)).toBeGreaterThan(launch(0) * 1.7)
  })

  it('trades when both fighters connect on the same frame', () => {
    const match = beginMatch()
    face(match, 590, 650)

    press(match, 12, { attackPressed: true }, { attackPressed: true })

    expect(match.fighters[0].percent).toBe(ATTACKS.jab.damage)
    expect(match.fighters[1].percent).toBe(ATTACKS.jab.damage)
  })

  it('keeps a button pressed during hitstop as a buffered input', () => {
    const match = beginMatch()
    face(match, 580, 642)
    press(match, 4, { attackPressed: true })
    // 弱攻撃の当たるフレームまで進め、ヒットストップに入った直後に次の攻撃を押す。
    while (match.freeze <= 0) step(match, 1)
    const attacksBefore = events(match, 'attack').length
    stepClashMatch(match, [input({ attackPressed: true }), input()], DT)
    expect(match.fighters[0].attackBuffer).toBeGreaterThan(0)
    expect(events(match, 'attack')).toHaveLength(attacksBefore)
  })

  it('counts consecutive hits on a stunned opponent as a combo', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    face(match, 580, 642)
    press(match, 10, { attackPressed: true })
    expect(target.hitstun).toBeGreaterThan(0)
    // のけぞっている相手のそばで、もう一度当てる。
    target.x = player.x + 60
    target.y = FLOOR
    target.vx = target.vy = 0
    target.invuln = 0
    player.action = null
    press(match, 10, { attackPressed: true })

    expect(events(match, 'hit').map((event) => event.combo)).toEqual([1, 2])
  })
})

describe('guard, just guard and dodges', () => {
  it('blocks damage with a held guard while draining the shield', () => {
    const match = beginMatch()
    face(match, 580, 642)
    step(match, 20, {}, { shield: true })
    press(match, 22, { attackPressed: true }, {}, [{}, { shield: true }])

    expect(match.fighters[1].percent).toBe(0)
    expect(match.fighters[1].shield).toBeLessThan(100 - ATTACKS.jab.damage * 4)
    expect(events(match, 'shield')).toHaveLength(1)
    expect(events(match, 'parry')).toHaveLength(0)
  })

  it('keeps the shield up through shield stun so a follow-up cannot slip in', () => {
    const match = beginMatch()
    face(match, 580, 642)
    step(match, 20, {}, { shield: true })
    press(match, 10, { attackPressed: true }, {}, [{}, { shield: true }])
    const target = match.fighters[1]
    expect(target.shieldStun).toBeGreaterThan(0)
    // 硬直中にボタンを離しても、盾は張られたまま。
    step(match, 1)
    expect(target.shielding).toBe(true)
  })

  it('turns a last-moment guard into a just guard that staggers the attacker', () => {
    const match = beginMatch()
    face(match, 580, 642)
    const [player, target] = match.fighters
    // 弱攻撃の出かかりを見てから張る（当たる直前）。
    press(match, 3, { attackPressed: true })
    step(match, 12, {}, { shield: true })

    expect(events(match, 'parry')).toHaveLength(1)
    expect(target.percent).toBe(0)
    expect(target.shield).toBeGreaterThan(99)
    expect(player.action).toBeNull()
    expect(player.lag).toBeGreaterThan(0.2)
  })

  it('does not allow just guards by mashing the button', () => {
    const match = beginMatch()
    face(match, 580, 642)
    // 張って離してすぐ張り直す。張り直しはジャストガードにならない。
    step(match, 4, {}, { shield: true })
    step(match, 2)
    press(match, 3, { attackPressed: true }, { shield: true }, [{}, { shield: true }])
    step(match, 12, {}, { shield: true })

    expect(events(match, 'parry')).toHaveLength(0)
    expect(events(match, 'shield')).toHaveLength(1)
  })

  it('stuns a fighter when a heavy hit breaks the guard', () => {
    const match = beginMatch()
    face(match, 575, 650)
    match.fighters[1].shield = 20
    step(match, 20, {}, { shield: true })
    press(match, 34, { right: true, attackPressed: true }, {}, [{}, { shield: true }])

    expect(match.fighters[1].hitstun).toBeGreaterThan(1)
    expect(events(match, 'shieldBreak')).toHaveLength(1)
  })

  it('rolls through an attack and never rolls off the stage', () => {
    const match = beginMatch()
    face(match, 580, 642)
    const target = match.fighters[1]
    press(match, 1, { attackPressed: true })
    // ガード＋方向で転がる。出だしの隙さえ過ぎていれば、弱攻撃はすり抜ける。
    press(match, 14, {}, { shield: true, left: true })
    expect(events(match, 'dodge')[0].kind).toBe('roll')
    expect(target.percent).toBe(0)

    target.x = ARENA.main.x + ARENA.main.w - 30
    target.dodge = null
    step(match, 2)
    press(match, 40, {}, { shield: true, right: true })
    expect(target.onGround).toBe(true)
    expect(target.x).toBeLessThanOrEqual(ARENA.main.x + ARENA.main.w)
  })

  it('allows one air dodge per airtime', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    press(match, 12, { jumpPressed: true, jumpHeld: true }, {}, [{ jumpHeld: true }, {}])
    press(match, 4, { shieldPressed: true })
    expect(player.dodge?.kind).toBe('air')
    expect(isIntangible(player)).toBe(true)
    step(match, 30)
    press(match, 4, { shieldPressed: true })
    expect(events(match, 'dodge')).toHaveLength(1)

    step(match, 120)
    expect(player.onGround).toBe(true)
    expect(player.airDodged).toBe(false)
  })
})

describe('seasonal specials', () => {
  it('spring throws two light petals, each of which hits at most once', () => {
    const match = beginMatch('spring')
    face(match, 430, 710)
    press(match, 60, { specialPressed: true })

    expect(events(match, 'projectile').map((event) => event.kind)).toEqual(['petal', 'petal'])
    const hits = events(match, 'hit')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.length).toBeLessThanOrEqual(2)
    expect(match.fighters[1].percent).toBe(hits.length * 5)
    // 当たった花びらは消える。
    expect(match.projectiles.length).toBeLessThanOrEqual(2 - hits.length)
  })

  it('summer burns a wide area in front instead of shooting', () => {
    const match = beginMatch('summer')
    face(match, 520, 640)
    press(match, 30, { specialPressed: true })

    expect(match.projectiles).toHaveLength(0)
    expect(events(match, 'projectile')).toHaveLength(0)
    expect(events(match, 'hit')[0].source).toBe('burst')
  })

  it('autumn sends a leaf out and back, pulling the opponent in on the return', () => {
    const match = beginMatch('autumn')
    face(match, 400, 660)
    match.fighters[1].shield = 100
    press(match, 26, { specialPressed: true })
    const out = events(match, 'hit')[0]
    expect(out.source).toBe('leaf')
    expect(out.vx).toBeGreaterThan(0)

    // 行きを当てたあと、相手を軌道上に置き直して帰りを待つ。
    const target = match.fighters[1]
    step(match, 40)
    target.x = 600
    target.y = FLOOR
    target.vx = target.vy = 0
    target.hitstun = 0
    target.invuln = 0
    step(match, 90)
    const back = events(match, 'hit')[1]
    expect(back.source).toBe('leaf')
    expect(back.vx).toBeLessThan(0)
    // 戻ってきた葉は持ち主の手元で消える。
    expect(match.projectiles).toHaveLength(0)
  })

  it('winter chills the opponent, slowing their run', () => {
    const match = beginMatch('winter')
    face(match, 430, 640)
    press(match, 60, { specialPressed: true })
    const target = match.fighters[1]
    expect(events(match, 'hit')[0].source).toBe('frost')
    expect(target.chill).toBeGreaterThan(0)

    target.y = FLOOR
    target.x = 640
    target.vx = target.vy = 0
    target.hitstun = 0
    step(match, 40, {}, { left: true })
    expect(Math.abs(target.vx)).toBeLessThan(PHYSICS.runSpeed * 0.8)
  })

  it('reflects a projectile with a just guard', () => {
    const match = beginMatch('winter')
    face(match, 430, 640)
    press(match, 20, { specialPressed: true })
    // 氷が届く直前に張る。
    const shard = () => match.projectiles[0]
    while (shard() && 640 - shard().x > 70) step(match, 1)
    step(match, 12, {}, { shield: true })

    expect(events(match, 'parry')[0].reflected).toBe(true)
    expect(match.projectiles[0].owner).toBe(1)
    expect(match.projectiles[0].vx).toBeLessThan(0)
  })
})

describe('stage, ledges and recovery', () => {
  it('consumes a stock at a blast zone and ends the match on the last stock', () => {
    const match = beginMatch()
    const target = match.fighters[1]
    target.x = ARENA.blast.right + 1
    target.lastHitBy = 0

    step(match, 1)
    expect(target.stocks).toBe(2)
    expect(target.respawn).toBeGreaterThan(0)
    expect(target.percent).toBe(0)
    expect(events(match, 'ko')[0]).toMatchObject({ side: 'right', by: 0, final: false })

    target.stocks = 1
    target.respawn = 0
    target.x = ARENA.blast.left - 1
    step(match, 1)

    expect(match.phase).toBe('result')
    expect(match.winner).toBe(0)
    expect(events(match, 'ko')[1]).toMatchObject({ side: 'left', by: null, final: true })
  })

  it('lets the lower-damage fighter win when both fall on their last stock at once', () => {
    const match = beginMatch()
    const [first, second] = match.fighters
    first.stocks = second.stocks = 1
    first.percent = 150
    second.percent = 20
    first.x = ARENA.blast.left - 1
    second.x = ARENA.blast.right + 1
    step(match, 1)

    expect(match.winner).toBe(1)
    expect(match.fighters.map((fighter) => fighter.stocks)).toEqual([0, 1])

    // 席順ではなく蓄積で決まる。入れ替えれば 1P が勝つ。
    const mirror = beginMatch()
    mirror.fighters[0].stocks = mirror.fighters[1].stocks = 1
    mirror.fighters[0].percent = 20
    mirror.fighters[1].percent = 150
    mirror.fighters[0].x = ARENA.blast.left - 1
    mirror.fighters[1].x = ARENA.blast.right + 1
    step(mirror, 1)
    expect(mirror.winner).toBe(0)
  })

  it('stops crediting a knockout once the victim has recovered on the ground', () => {
    const fall = (restFrames: number) => {
      const match = beginMatch()
      face(match, 580, 642)
      press(match, 12, { attackPressed: true })
      const target = match.fighters[1]
      // 着地して立て直してから、自分で場外へ出る。
      step(match, restFrames)
      expect(target.onGround).toBe(true)
      target.x = ARENA.blast.right + 1
      step(match, 1)
      return events(match, 'ko')[0].by
    }
    expect(fall(60)).toBe(0)
    expect(fall(60 * 5)).toBeNull()
  })

  it('limits air jumps and refreshes them after landing', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    press(match, 16, { jumpPressed: true, jumpHeld: true }, {}, [{ jumpHeld: true }, {}])
    expect(player.onGround).toBe(false)
    press(match, 1, { jumpPressed: true, jumpHeld: true })
    expect(player.jumpsLeft).toBe(0)

    step(match, 180)
    expect(player.onGround).toBe(true)
    expect(player.jumpsLeft).toBe(DEFAULT_STATS.airJumps)
  })

  it('turns up + attack during the jump squat into an up attack instead of a jump', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    // ↑がジャンプを兼ねる操作: ジャンプの1フレーム後に攻撃が入る。
    stepClashMatch(match, [input({ up: true, jumpPressed: true, jumpHeld: true }), input()], DT)
    stepClashMatch(match, [input({ up: true, jumpHeld: true, attackPressed: true }), input()], DT)
    step(match, 4, { up: true, jumpHeld: true })

    expect(player.action?.kind).toBe('up')
    expect(player.onGround).toBe(true)
    expect(events(match, 'jump')).toHaveLength(0)
  })

  it('treats the main stage as solid from below', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    const bottom = ARENA.main.y + ARENA.main.h
    player.x = 640
    player.y = bottom + PHYSICS.fighterH + 60
    player.vy = -900
    player.onGround = false
    step(match, 20, { jumpHeld: true })

    expect(player.y - PHYSICS.fighterH).toBeGreaterThanOrEqual(bottom - 0.01)
  })

  it('grabs the ledge when falling beside it, then climbs up', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    const point = ledgePoint('left')
    player.x = point.x - 40
    player.y = point.y - 30
    player.vx = 0
    player.vy = 200
    player.onGround = false
    player.jumpsLeft = 0
    step(match, 30)

    expect(player.ledge).toBe('left')
    expect(player.y).toBe(point.y + LEDGE.hangY)
    expect(player.jumpsLeft).toBe(DEFAULT_STATS.airJumps)
    expect(player.invuln).toBeGreaterThan(0)

    step(match, 10, { up: true })
    expect(player.ledge).toBeNull()
    expect(player.onGround).toBe(true)
    expect(player.x).toBeGreaterThan(point.x)
  })

  it('hops onto the stage from the ledge with a jump, however briefly it is pressed', () => {
    for (const held of [{}, { jumpHeld: true }, { right: true }]) {
      const match = beginMatch()
      const player = match.fighters[0]
      const point = ledgePoint('left')
      player.x = point.x - 40
      player.y = point.y - 30
      player.vx = 0
      player.vy = 200
      player.onGround = false
      step(match, 30)
      expect(player.ledge).toBe('left')

      press(match, 60, { jumpPressed: true }, {}, [held, {}])
      expect(player.ledge, JSON.stringify(held)).toBeNull()
      expect(player.onGround, JSON.stringify(held)).toBe(true)
      expect(player.x, JSON.stringify(held)).toBeGreaterThan(point.x - PHYSICS.fighterW / 2)
    }
  })

  it('lets go of the ledge instead of grabbing while holding away from the stage', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    const point = ledgePoint('right')
    player.x = point.x + 40
    player.y = point.y - 30
    player.vy = 200
    player.onGround = false
    step(match, 40, { right: true })

    expect(player.ledge).toBeNull()
    expect(events(match, 'ledge')).toHaveLength(0)
  })

  it('gives ledge invulnerability only on the first grab before landing', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    const point = ledgePoint('left')
    const dropBeside = () => {
      player.x = point.x - 40
      player.y = point.y - 20
      player.vx = 0
      player.vy = 200
      player.onGround = false
      player.ledge = null
      player.ledgeCooldown = 0
      player.invuln = 0
      step(match, 30)
    }
    dropBeside()
    expect(player.invuln).toBeGreaterThan(0)
    dropBeside()
    expect(player.ledge).toBe('left')
    expect(player.invuln).toBe(0)
  })

  it('allows the recovery special once until landing, a ledge or a hit', () => {
    const match = beginMatch()
    const player = match.fighters[0]
    player.x = 640
    player.y = 200
    player.onGround = false
    press(match, 50, { up: true, specialPressed: true })
    expect(events(match, 'attack').filter((event) => event.kind === 'recovery')).toHaveLength(1)
    player.specialCooldown = 0
    press(match, 10, { up: true, specialPressed: true })
    expect(events(match, 'attack').filter((event) => event.kind === 'recovery')).toHaveLength(1)

    step(match, 200)
    expect(player.onGround).toBe(true)
    expect(player.usedRecovery).toBe(false)
  })

  it('spikes downward with the aerial down attack and bounces off the floor', () => {
    const match = beginMatch()
    const [player, target] = match.fighters
    target.x = 640
    target.y = FLOOR
    target.percent = 60
    player.x = 640
    player.y = FLOOR - 120
    player.vy = 0
    player.onGround = false
    press(match, 30, { down: true, attackPressed: true })

    const hit = events(match, 'hit')[0]
    expect(hit.source).toBe('airDown')
    expect(hit.vy).toBeGreaterThan(0)
    expect(events(match, 'bounce')).toHaveLength(1)
  })

  it('decides a time-up by stocks, then by damage', () => {
    const match = beginMatch()
    match.clock = 0.02
    match.fighters[0].percent = 30
    match.fighters[1].percent = 80
    step(match, 3)

    expect(match.phase).toBe('result')
    expect(match.winner).toBe(0)
    expect(events(match, 'gameOver')[0].timeUp).toBe(true)

    // ストックが多ければ、蓄積が多くても勝つ。
    const byStocks = beginMatch()
    byStocks.clock = 0.02
    byStocks.fighters[0].stocks = 1
    byStocks.fighters[0].percent = 10
    byStocks.fighters[1].stocks = 2
    byStocks.fighters[1].percent = 140
    step(byStocks, 3)
    expect(byStocks.winner).toBe(1)
  })
})
