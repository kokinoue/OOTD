import { describe, expect, it } from 'vitest'
import cutoutsJson from '../../data/cutouts.json'
import hairJson from '../../data/hair.json'
import outfitsJson from '../../data/outfits.json'
import type { HairFile, Outfit } from '../../types'
import {
  BET,
  BONUS_GAMES,
  BONUS_ODDS,
  BONUS_PAY,
  canRefill,
  canSpin,
  CEILING,
  CEILING_MORNING,
  drawRole,
  hashSeed,
  lever,
  LOTTERY_RANGE,
  newMachine,
  parseMachine,
  PAYOUT,
  pickLineup,
  REEL_LEN,
  reelControl,
  refill,
  ROLE_SYMBOL,
  seededRng,
  settingOf,
  SMALL_ODDS,
  START_COINS,
  stop,
  STRIPS,
  SYMBOLS,
  symbolAt,
  winningLines,
  type Machine,
  type Positions,
  type Setting,
  type SymbolId,
} from '../slot'

const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const

const ALWAYS: SymbolId[] = ['usual', 'cap', 'tee']
const RARE: SymbolId[] = ['new', 'blond', 'coat']

/** 押し順 order・押したコマ presses で3リール止めたときの最終位置 */
function play(target: SymbolId | null, order: readonly number[], presses: readonly number[]) {
  const control = reelControl()
  let pos: Positions = [null, null, null]
  for (const reel of order) {
    const stopped = control.chooseStop(target, pos, reel, presses[reel]!)
    pos = [reel === 0 ? stopped : pos[0], reel === 1 ? stopped : pos[1], reel === 2 ? stopped : pos[2]]
  }
  return pos as [number, number, number]
}

/** 全押し順 × 全コマの組み合わせ（6 × 21^3 = 55,566通り）を回す */
function forEveryPress(fn: (order: readonly number[], presses: number[]) => void) {
  for (const order of ORDERS) {
    for (let a = 0; a < REEL_LEN; a++) {
      for (let b = 0; b < REEL_LEN; b++) {
        for (let c = 0; c < REEL_LEN; c++) fn(order, [a, b, c])
      }
    }
  }
}

describe('リール配列', () => {
  it('各リール21コマで、図柄の個数が設計どおり', () => {
    for (const strip of STRIPS) {
      expect(strip).toHaveLength(REEL_LEN)
      const count = (s: SymbolId) => strip.filter((x) => x === s).length
      for (const s of ALWAYS) expect(count(s)).toBe(5)
      for (const s of RARE) expect(count(s)).toBe(2)
    }
  })

  it('同じ図柄が上下に連続しない', () => {
    for (const strip of STRIPS) {
      for (let i = 0; i < REEL_LEN; i++) expect(strip[i]).not.toBe(strip[(i + 1) % REEL_LEN])
    }
  })

  it('停止位置から3段の図柄を引ける（端はリールを一周する）', () => {
    expect(symbolAt(0, 0, -1)).toBe(STRIPS[0]![REEL_LEN - 1])
    expect(symbolAt(0, 0, 0)).toBe(STRIPS[0]![0])
    expect(symbolAt(0, REEL_LEN - 1, 1)).toBe(STRIPS[0]![0])
  })
})

describe('リール制御', () => {
  it('ハズレのゲームは、どの押し順・どのタイミングでも何も揃わない', () => {
    forEveryPress((order, presses) => {
      const pos = play(null, order, presses)
      if (winningLines(pos).length > 0) {
        throw new Error(`ハズレで揃った: order=${order} presses=${presses}`)
      }
    })
  })

  it('小役（いつも・帽子・Tシャツ）は、どう押しても必ず揃う（取りこぼしゼロ）', () => {
    for (const target of ALWAYS) {
      forEveryPress((order, presses) => {
        const wins = winningLines(play(target, order, presses))
        if (wins.length === 0 || wins.some((w) => w.symbol !== target)) {
          throw new Error(`${target} を取りこぼした: order=${order} presses=${presses}`)
        }
      })
    }
  })

  it('レア役（最新・金髪・コート）は狙わないと揃わないが、フラグ以外は絶対に揃わない', () => {
    for (const target of RARE) {
      let hit = 0
      let total = 0
      forEveryPress((order, presses) => {
        const wins = winningLines(play(target, order, presses))
        if (wins.some((w) => w.symbol !== target)) {
          throw new Error(`${target} のゲームで別の役が揃った: order=${order} presses=${presses}`)
        }
        total++
        if (wins.length > 0) hit++
      })
      // でたらめに押しても2割弱は揃う（=数ゲームで揃う）。狙わずに毎回揃うほど甘くはない
      const rate = hit / total
      expect(rate).toBeGreaterThan(0.15)
      expect(rate).toBeLessThan(0.3)
      // 事前計算した「揃う確率」と実測が一致する
      expect(reelControl().evaluate(target, [null, null, null]).win).toBeCloseTo(rate, 5)
    }
  })

  it('目押しすれば、レア役はどの押し順でも1ゲームで揃えられる', () => {
    const control = reelControl()
    for (const target of RARE) {
      let pos: Positions = [null, null, null]
      for (let i = 0; i < 3; i++) {
        const { reel, press } = control.bestPress(target, pos)
        const stopped = control.chooseStop(target, pos, reel, press)
        pos = [reel === 0 ? stopped : pos[0], reel === 1 ? stopped : pos[1], reel === 2 ? stopped : pos[2]]
      }
      const wins = winningLines(pos as [number, number, number])
      expect(wins.length).toBeGreaterThan(0)
      expect(wins.every((w) => w.symbol === target)).toBe(true)
    }
  })

  it('スベリは最大4コマ', () => {
    const control = reelControl()
    for (const target of [null, ...SYMBOLS]) {
      for (let reel = 0; reel < 3; reel++) {
        for (let press = 0; press < REEL_LEN; press++) {
          const pos = control.chooseStop(target, [null, null, null], reel, press)
          const slip = (press - pos + REEL_LEN) % REEL_LEN
          expect(slip).toBeLessThanOrEqual(4)
        }
      }
    }
  })
})

describe('内部抽選', () => {
  it('乱数値の範囲ごとに役が決まり、当選値の合計が確率になる', () => {
    for (const setting of [1, 2, 3, 4, 5, 6] as Setting[]) {
      const count: Record<string, number> = {}
      for (let v = 0; v < LOTTERY_RANGE; v++) {
        const role = drawRole(setting, v) ?? 'none'
        count[role] = (count[role] ?? 0) + 1
      }
      expect(count.big).toBe(BONUS_ODDS[setting].big)
      expect(count.reg).toBe(BONUS_ODDS[setting].reg)
      expect(count.replay).toBe(SMALL_ODDS.replay)
      expect(count.cap).toBe(SMALL_ODDS.cap)
      // 6割以上はハズレ
      expect(count.none! / LOTTERY_RANGE).toBeGreaterThan(0.6)
    }
  })

  it('設定が高いほどボーナスが当たりやすい', () => {
    for (let s = 2; s <= 6; s++) {
      const hi = BONUS_ODDS[s as Setting]
      const lo = BONUS_ODDS[(s - 1) as Setting]
      expect(hi.big).toBeGreaterThan(lo.big)
      expect(hi.reg).toBeGreaterThan(lo.reg)
    }
  })
})

// ---- 台の状態遷移 -----------------------------------------------------------

/** rng の返す値を順番に指定する（尽きたら 0.999 = ハズレ側） */
const scripted = (...values: number[]) => {
  let i = 0
  return () => values[i++] ?? 0.999
}

/** 役を指定してレバーを叩くための乱数値（drawRole の表の並びに合わせる） */
const rollFor = (m: Machine, role: 'big' | 'reg' | 'cap' | 'replay' | 'none') => {
  const b = BONUS_ODDS[m.setting]
  const start =
    role === 'big'
      ? 0
      : role === 'reg'
        ? b.big
        : role === 'cap'
          ? b.big + b.reg + SMALL_ODDS.coat
          : role === 'replay'
            ? b.big + b.reg + SMALL_ODDS.coat + SMALL_ODDS.cap + SMALL_ODDS.tee
            : LOTTERY_RANGE - 1
  return (start + 0.5) / LOTTERY_RANGE
}

/** 目押しbot: レア役は揃う確率が最も高い（リール, コマ）を狙う。小役とハズレは適当に押す */
function playSpin(m: Machine, rng: () => number) {
  const control = reelControl()
  let { machine } = lever(m, rng)
  let outcome = null
  while (machine.spin) {
    const target = machine.spin.target
    const aim =
      target != null && RARE.includes(target)
        ? control.bestPress(target, machine.spin.pos)
        : { reel: machine.spin.pos.findIndex((p) => p == null), press: Math.floor(rng() * REEL_LEN) }
    const r = stop(machine, aim.reel, aim.press)
    machine = r.machine
    outcome = r.outcome
  }
  return { machine, outcome: outcome! }
}

/** 連打bot: 目押しせず、でたらめなコマで左から順に止める */
function mashSpin(m: Machine, rng: () => number) {
  let { machine } = lever(m, rng)
  let outcome = null
  for (let reel = 0; reel < 3 && machine.spin; reel++) {
    const r = stop(machine, reel, Math.floor(rng() * REEL_LEN))
    machine = r.machine
    outcome = r.outcome
  }
  return { machine, outcome: outcome! }
}

describe('台の状態遷移', () => {
  const fresh = () => ({ ...newMachine(7, 1), ceiling: CEILING })

  it('レバーで3枚掛かり、小役が揃うと払い出される', () => {
    const m = fresh()
    const { machine, outcome } = playSpin(m, scripted(rollFor(m, 'cap')))
    expect(outcome.symbol).toBe('cap')
    expect(outcome.payout).toBe(PAYOUT.cap)
    expect(machine.coins).toBe(START_COINS - BET + PAYOUT.cap)
    expect(machine.spins).toBe(1)
  })

  it('ハズレは3枚減るだけ', () => {
    const m = fresh()
    const { machine, outcome } = playSpin(m, scripted(rollFor(m, 'none')))
    expect(outcome.lines).toHaveLength(0)
    expect(machine.coins).toBe(START_COINS - BET)
  })

  it('リプレイが揃うと、次のゲームは掛け枚数なしで回せる', () => {
    const m = fresh()
    const first = playSpin(m, scripted(rollFor(m, 'replay')))
    expect(first.outcome.replay).toBe(true)
    expect(first.machine.replay).toBe(true)
    const second = playSpin(first.machine, scripted(rollFor(m, 'none')))
    expect(second.machine.coins).toBe(first.machine.coins)
    expect(second.machine.replay).toBe(false)
  })

  it('BIGは揃えるとボーナスゲームに入り、1ゲーム15枚ずつ増えて規定ゲーム数で終わる', () => {
    const m = fresh()
    let { machine, outcome } = playSpin(m, scripted(rollFor(m, 'big'), 0.9))
    expect(outcome.bonusStart).toBe('big')
    expect(machine.bonus).toEqual({ kind: 'big', left: BONUS_GAMES.big, gained: 0 })
    expect(machine.big).toBe(1)
    const before = machine.coins
    for (let i = 0; i < BONUS_GAMES.big; i++) {
      ;({ machine, outcome } = playSpin(machine, seededRng(i + 1)))
      expect(outcome.payout).toBe(BONUS_PAY)
    }
    expect(outcome.bonusEnd).toEqual({ kind: 'big', gained: BONUS_PAY * BONUS_GAMES.big })
    expect(machine.bonus).toBeNull()
    expect(machine.coins).toBe(before + BONUS_PAY * BONUS_GAMES.big)
    // ボーナス中は通常ゲームとして数えない
    expect(machine.spins).toBe(1)
  })

  it('揃え損ねたボーナスは持ち越され、全リール停止後にランプが点く（後告知）', () => {
    const m = fresh()
    // 抽選でREG成立 → 先告知なし(0.9) → わざと外す
    let { machine } = lever(m, scripted(rollFor(m, 'reg'), 0.9))
    expect(machine.pending).toBe('reg')
    expect(machine.lamp).toBe(false)
    const miss = findMiss('blond')
    let outcome = null
    for (const reel of [0, 1, 2]) {
      const r = stop(machine, reel, miss[reel]!)
      machine = r.machine
      outcome = r.outcome
    }
    expect(outcome!.lines).toHaveLength(0)
    expect(outcome!.lampOn).toBe(true)
    expect(machine.pending).toBe('reg')
    expect(machine.lamp).toBe(true)

    // 持ち越し中は抽選なしで毎ゲーム狙える。目押しすれば次で揃う
    const next = playSpin(machine, scripted())
    expect(next.outcome.bonusStart).toBe('reg')
    expect(next.machine.pending).toBeNull()
    expect(next.machine.lamp).toBe(false)
    expect(next.machine.reg).toBe(1)
  })

  it('4回に1回は、レバーONと同時にランプが点く（先告知）', () => {
    const m = fresh()
    const early = lever(m, scripted(rollFor(m, 'big'), 0.1))
    expect(early.earlyLamp).toBe(true)
    expect(early.machine.lamp).toBe(true)
    const late = lever(m, scripted(rollFor(m, 'big'), 0.3))
    expect(late.earlyLamp).toBe(false)
    expect(late.machine.lamp).toBe(false)
  })

  it('天井: 規定ゲーム数ハマると、次のゲームでBIGが成立する', () => {
    const m = { ...fresh(), sinceBonus: CEILING - 1 }
    const { machine, role } = lever(m, scripted(rollFor(m, 'none'), 0.9))
    expect(role).toBe('big')
    expect(machine.pending).toBe('big')
  })

  it('朝イチ（新しい台）は天井が浅く、ボーナス後は通常の天井に戻る', () => {
    const m = newMachine(1, 1)
    expect(m.ceiling).toBe(CEILING_MORNING)
    const { machine } = playSpin(m, scripted(rollFor(m, 'big'), 0.9))
    expect(machine.ceiling).toBe(CEILING)
    expect(machine.sinceBonus).toBe(0)
  })

  it('メダルが尽きたら回せず、おかわりで50枚増える（投資として記録される）', () => {
    const m = { ...fresh(), coins: 2 }
    expect(canSpin(m)).toBe(false)
    expect(canRefill(m)).toBe(true)
    expect(lever(m).machine).toBe(m)
    const r = refill(m)
    expect(r.coins).toBe(52)
    expect(r.invested).toBe(START_COINS + 50)
    // メダルが足りている間はおかわりできない
    expect(refill(r)).toBe(r)
  })

  it('回転中は次のレバーを受け付けず、止めたリールは二度押しできない', () => {
    const m = fresh()
    const { machine } = lever(m, scripted(rollFor(m, 'none')))
    expect(lever(machine).machine).toBe(machine)
    const a = stop(machine, 0, 3)
    expect(stop(a.machine, 0, 9).machine).toBe(a.machine)
  })

  it('差枚の推移を1ゲームごとに記録し、長くなっても上限を超えない', () => {
    let m = { ...fresh(), coins: 100000 }
    const rng = seededRng(42)
    for (let i = 0; i < 1500; i++) m = mashSpin(m, rng).machine
    // ボーナス中は記録しない（終わったときに獲得ぶんがまとめて1点入る）ので、消化しきる
    while (m.bonus) m = mashSpin(m, rng).machine
    expect(m.history.length).toBeGreaterThan(100)
    expect(m.history.length).toBeLessThanOrEqual(240)
    expect(m.history.at(-1)).toBe(m.coins - m.invested)
  })
})

/** target のゲームで「外れる」押し位置を1組探す */
function findMiss(target: SymbolId): number[] {
  for (let a = 0; a < REEL_LEN; a++) {
    for (let b = 0; b < REEL_LEN; b++) {
      for (let c = 0; c < REEL_LEN; c++) {
        if (winningLines(play(target, [0, 1, 2], [a, b, c])).length === 0) return [a, b, c]
      }
    }
  }
  throw new Error('外れる押し位置が無い')
}

describe('出玉率（botで長時間回す）', () => {
  /** 天井ありの実戦と同じ条件で games ゲーム回し、出玉率（払い出し ÷ 掛け枚数）を返す */
  function simulate(setting: Setting, games: number, spin: typeof playSpin, seed: number) {
    const rng = seededRng(seed)
    const bank = 1e9
    let m: Machine = { ...newMachine(1, setting), coins: bank, invested: bank, ceiling: CEILING }
    let bet = 0
    for (let i = 0; i < games; i++) {
      if (!m.replay) bet += BET
      m = spin(m, rng).machine
      // ボーナスは掛け枚数なしで消化する
      while (m.bonus) m = spin(m, rng).machine
    }
    return { rate: (m.coins - bank + bet) / bet, machine: m }
  }

  it('目押しができる人: 設定1でも少し勝てる(103%前後)、設定6は112%前後', () => {
    const s1 = simulate(1, 400_000, playSpin, 1).rate
    const s6 = simulate(6, 400_000, playSpin, 2).rate
    expect(s1).toBeGreaterThan(1.0)
    expect(s1).toBeLessThan(1.06)
    expect(s6).toBeGreaterThan(1.08)
    expect(s6).toBeLessThan(1.15)
  })

  it('連打するだけだと負けるが、負けすぎない（設定3で82〜95%）', () => {
    const aim = simulate(3, 400_000, playSpin, 5).rate
    const mash = simulate(3, 400_000, mashSpin, 5).rate
    expect(mash).toBeLessThan(aim)
    expect(mash).toBeGreaterThan(0.82)
    expect(mash).toBeLessThan(0.95)
  })

  it('ボーナスは平均30〜40ゲームに1回（数分遊べば届く）', () => {
    for (const setting of [1, 6] as Setting[]) {
      const { machine } = simulate(setting, 200_000, playSpin, 20 + setting)
      const every = machine.spins / (machine.big + machine.reg)
      expect(every).toBeGreaterThan(26)
      expect(every).toBeLessThan(40)
    }
  })

  it('REGの出現率は当選値どおり、BIGは天井のぶんだけ当選値より出やすい', () => {
    const { machine } = simulate(4, 400_000, playSpin, 9)
    const big = machine.spins / machine.big
    const reg = machine.spins / machine.reg
    const regOdds = LOTTERY_RANGE / BONUS_ODDS[4].reg
    expect(reg).toBeGreaterThan(regOdds - 10)
    expect(reg).toBeLessThan(regOdds + 10)
    expect(big).toBeLessThan(LOTTERY_RANGE / BONUS_ODDS[4].big)
    expect(big).toBeGreaterThan(45)
  })

  it('最初の50枚で連打しても、過半数は最初のボーナスまで届く（朝イチ天井）', () => {
    let reached = 0
    const trials = 2000
    for (let t = 0; t < trials; t++) {
      const rng = seededRng(1000 + t)
      let m = newMachine(t, settingOf(t))
      while (canSpin(m) && m.big + m.reg === 0) m = mashSpin(m, rng).machine
      if (m.big + m.reg > 0) reached++
    }
    expect(reached / trials).toBeGreaterThan(0.5)
  })
})

describe('保存データ', () => {
  it('保存した台をそのまま復元する（回転中のゲームは捨てる）', () => {
    const m = lever(newMachine(12, 3)).machine
    const restored = parseMachine(JSON.stringify(m))
    expect(restored).toEqual({ ...m, spin: null })
  })

  it('壊れたデータは受け付けない', () => {
    expect(parseMachine(null)).toBeNull()
    expect(parseMachine('{')).toBeNull()
    expect(parseMachine('null')).toBeNull()
    const m = newMachine(1, 1)
    expect(parseMachine(JSON.stringify({ ...m, coins: -5 }))).toBeNull()
    expect(parseMachine(JSON.stringify({ ...m, coins: 1.5 }))).toBeNull()
    expect(parseMachine(JSON.stringify({ ...m, setting: 9 }))).toBeNull()
    expect(parseMachine(JSON.stringify({ ...m, pending: 'jackpot' }))).toBeNull()
    expect(parseMachine(JSON.stringify({ ...m, history: ['x'] }))).toBeNull()
    expect(parseMachine(JSON.stringify({ ...m, bonus: { kind: 'big', left: 0, gained: 0 } }))).toBeNull()
  })

  it('ボーナス持ち越しが無いのにランプだけ点いたデータは、消灯して復元する', () => {
    const m = { ...newMachine(1, 1), lamp: true }
    expect(parseMachine(JSON.stringify(m))!.lamp).toBe(false)
  })
})

describe('図柄の顔ぶれ', () => {
  const outfits = outfitsJson as Outfit[]
  const sprites = (cutoutsJson as { sprites: Record<string, { w: number; h: number }> }).sprites
  const hair = hairJson as HairFile
  const tag = (o: Outfit) => hair.manual[o.key] ?? hair.auto[o.key]
  const cats = (o: Outfit) => new Set(o.itemIds.map((id) => id.split('|')[0]))

  it('実データから、条件どおりの6人を重複なく選ぶ', () => {
    for (let seed = 0; seed < 200; seed++) {
      const lineup = pickLineup(outfits, sprites, hair, seed)!
      expect(new Set(SYMBOLS.map((s) => lineup[s].key)).size).toBe(SYMBOLS.length)
      for (const s of SYMBOLS) expect(sprites[lineup[s].key]).toBeDefined()
      expect(tag(lineup.blond)?.color).toBe('金')
      expect(tag(lineup.cap)?.hat).toBeTruthy()
      expect(cats(lineup.coat).has('coat')).toBe(true)
      expect(cats(lineup.tee).has('t-shirt')).toBe(true)
      expect(cats(lineup.tee).has('jacket')).toBe(false)
      expect(tag(lineup.usual)?.color).toBe('黒')
    }
  })

  it('「最新の俺」は、くり抜きがあるいちばん新しいコーデ', () => {
    const lineup = pickLineup(outfits, sprites, hair, 1)!
    const newest = outfits.find((o) => {
      const sp = sprites[o.key]
      return sp && sp.w >= 62 && sp.w <= 128
    })!
    expect(lineup.new.key).toBe(newest.key)
  })

  it('同じシードなら同じ顔ぶれ、シードが変われば入れ替わる', () => {
    const a = pickLineup(outfits, sprites, hair, hashSeed('2026-11-12:7'))!
    const b = pickLineup(outfits, sprites, hair, hashSeed('2026-11-12:7'))!
    const c = pickLineup(outfits, sprites, hair, hashSeed('2026-11-13:7'))!
    expect(SYMBOLS.map((s) => a[s].key)).toEqual(SYMBOLS.map((s) => b[s].key))
    expect(SYMBOLS.map((s) => a[s].key)).not.toEqual(SYMBOLS.map((s) => c[s].key))
  })

  it('条件に合う日が無くても、残りから選んで6人そろえる', () => {
    const few = outfits.filter((o) => sprites[o.key] && sprites[o.key]!.w <= 128 && sprites[o.key]!.w >= 62).slice(0, 6)
    const lineup = pickLineup(few, sprites, { version: 1, auto: {}, manual: {} }, 3)!
    expect(new Set(SYMBOLS.map((s) => lineup[s].key)).size).toBe(6)
    // くり抜きが6人ぶん無ければ遊べない
    expect(pickLineup(few.slice(0, 5), sprites, hair, 3)).toBeNull()
  })

  it('台番号ごとに設定が決まり、低設定ほど多い', () => {
    const count = [0, 0, 0, 0, 0, 0, 0]
    for (let no = 1; no <= 999; no++) {
      expect(settingOf(no)).toBe(settingOf(no))
      count[settingOf(no)]!++
    }
    expect(count[1]).toBeGreaterThan(count[6]!)
    for (let s = 1; s <= 6; s++) expect(count[s]).toBeGreaterThan(0)
  })

  it('役と図柄の対応', () => {
    expect(ROLE_SYMBOL.big).toBe('new')
    expect(ROLE_SYMBOL.replay).toBe('usual')
  })
})
