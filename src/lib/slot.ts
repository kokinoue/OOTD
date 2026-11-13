// 俺スロ: 出勤服のくり抜き（＝俺）を揃える3リールスロット。
// このファイルは純粋ロジック（リール配列・内部抽選・リール制御・台の状態遷移・図柄の選出）。
// 描画・入力・音は View 側（SlotGameView）。
//
// 仕組みは日本のスロット（パチスロ）と同じ「内部抽選 + リール制御」:
//   1. レバーONの瞬間に乱数で「このゲームで揃ってよい役（フラグ）」を決める
//   2. ストップボタンを押した位置から最大4コマの範囲で、止める位置をリール制御が選ぶ
//      - フラグの役は揃う方向へ引き込む（スベリ）
//      - フラグ以外の役は絶対に揃わない位置へ逃がす（蹴り）
// 「どの押し順・どのタイミングで押しても、フラグ以外は揃わない／小役は必ず揃う」ことは
// slot.test.ts で全通り（3リール × 21コマ × 押し順6通り）検証している。

import type { HairFile, Outfit } from '../types'
import { effectiveHair } from './hair'

// ----------------------------------------------------------------------------
// 図柄と役
// ----------------------------------------------------------------------------

/** 図柄（全部「俺」）。配列順が配当の高い順 */
export const SYMBOLS = ['new', 'blond', 'coat', 'cap', 'tee', 'usual'] as const
export type SymbolId = (typeof SYMBOLS)[number]

export type Role = 'big' | 'reg' | 'coat' | 'cap' | 'tee' | 'replay'

export const ROLE_SYMBOL: Record<Role, SymbolId> = {
  big: 'new',
  reg: 'blond',
  coat: 'coat',
  cap: 'cap',
  tee: 'tee',
  replay: 'usual',
}

const SYMBOL_ROLE: Record<SymbolId, Role> = {
  new: 'big',
  blond: 'reg',
  coat: 'coat',
  cap: 'cap',
  tee: 'tee',
  usual: 'replay',
}

/** 通常時の払い出し枚数（BIG/REG はボーナス突入、replay は再遊技なので 0） */
export const PAYOUT: Record<Role, number> = { big: 0, reg: 0, coat: 10, cap: 8, tee: 2, replay: 0 }

export const BET = 3 // 通常時の1ゲームの掛け枚数
export const BONUS_PAY = 15 // ボーナスゲーム1回の払い出し
export const BONUS_GAMES = { big: 6, reg: 2 } as const // ボーナスゲーム数（掛け枚数なし）
export const REFILL = 50 // メダルが尽きたときのおかわり枚数
export const CEILING = 77 // 天井: このゲーム数ハマると次でボーナス確定
export const CEILING_MORNING = 20 // 朝イチ（台移動直後）だけ天井が浅い

export const REEL_LEN = 21
export const MAX_SLIP = 4 // スベリコマ数の上限（実機と同じ4コマ）

const N: SymbolId = 'new'
const B: SymbolId = 'blond'
const C: SymbolId = 'coat'
const H: SymbolId = 'cap'
const T: SymbolId = 'tee'
const U: SymbolId = 'usual'

/**
 * リール配列（左・中・右）。index 0 から順に、リール上で「上→下」に並ぶ。
 * 回転中は index の大きい側から小さい側へ流れてくる（表示は下向きに動く）。
 * 小役3種（いつも・帽子・Tシャツ）は5コマ以内に必ず1つあり、どこで押しても引き込める。
 * レア3種（最新・金髪・コート）は各リール2個ずつで、狙わないと揃わない。
 * この性質（取りこぼしゼロ・フラグ外は揃わない）は slot.test.ts が全通り検証している。
 */
export const STRIPS: readonly (readonly SymbolId[])[] = [
  [U, H, T, N, U, B, H, T, U, T, C, H, U, B, T, N, H, U, C, T, H],
  [H, U, T, C, H, N, U, T, H, T, U, B, U, H, T, C, H, U, N, T, B],
  [H, C, U, T, H, N, T, U, H, B, U, T, H, C, U, N, T, H, B, U, T],
]

/** 有効ライン5本。各要素は [左, 中, 右] の段（-1=上段, 0=中段, 1=下段） */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [-1, -1, -1],
  [1, 1, 1],
  [-1, 0, 1],
  [1, 0, -1],
]

const mod = (n: number) => ((n % REEL_LEN) + REEL_LEN) % REEL_LEN

/** リール reel が位置 pos（=中段のコマ番号）で止まっているとき、row 段に見える図柄 */
export function symbolAt(
  reel: number,
  pos: number,
  row: number,
  strips: readonly (readonly SymbolId[])[] = STRIPS,
): SymbolId {
  return strips[reel]![mod(pos + row)]!
}

export type WinLine = { line: number; symbol: SymbolId }

/** 3リールの停止位置から、図柄が揃っているラインを返す */
export function winningLines(
  pos: readonly [number, number, number],
  strips: readonly (readonly SymbolId[])[] = STRIPS,
): WinLine[] {
  const out: WinLine[] = []
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i]!
    const a = symbolAt(0, pos[0], l[0], strips)
    if (a === symbolAt(1, pos[1], l[1], strips) && a === symbolAt(2, pos[2], l[2], strips)) {
      out.push({ line: i, symbol: a })
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// リール制御
// ----------------------------------------------------------------------------

/** 各リールの停止位置。回転中は null */
export type Positions = readonly [number | null, number | null, number | null]

type Eval = {
  /** この先どう押されても、フラグ以外の役が揃わない位置を選び続けられるか */
  safe: boolean
  /** 残りリールを「でたらめなタイミング」で押されたときにフラグ役が揃う確率 (0..1) */
  win: number
}

const STATE_BASE = REEL_LEN + 1 // 各リール: 0=回転中, 1..21=停止位置+1
const STATE_COUNT = STATE_BASE ** 3
const UNKNOWN = -2
const UNSAFE = -1

/**
 * リール制御。配列ごとに1つ作る（評価結果をメモ化するため）。
 * 状態数は 22^3 × 図柄数 しかないので全探索できる。初回のストップで固まらないよう、
 * 評価は型付き配列に持ち、割り当てなしで回す（1図柄あたり数ms）。
 */
export function createReelControl(strips: readonly (readonly SymbolId[])[] = STRIPS) {
  // 図柄を数値にしたリール（row のはみ出しを mod せず引けるよう前後に1コマ足す）
  const reels = strips.map((strip) => {
    const a = new Int8Array(REEL_LEN + 2)
    for (let i = -1; i <= REEL_LEN; i++) a[i + 1] = SYMBOLS.indexOf(strip[mod(i)]!)
    return a
  })
  const tables = new Map<number, Float32Array>()

  // 値: UNSAFE(-1) = フラグ以外が揃う/揃わされる, 0..1 = フラグ役が揃う確率
  const value = (table: Float32Array, target: number, p0: number, p1: number, p2: number): number => {
    const key = p0 + 1 + STATE_BASE * (p1 + 1) + STATE_BASE * STATE_BASE * (p2 + 1)
    const cached = table[key]!
    if (cached !== UNKNOWN) return cached

    let result: number
    if (p0 >= 0 && p1 >= 0 && p2 >= 0) {
      result = 0
      for (let i = 0; i < LINES.length; i++) {
        const l = LINES[i]!
        const a = reels[0]![p0 + l[0] + 1]!
        if (a === reels[1]![p1 + l[1] + 1]! && a === reels[2]![p2 + l[2] + 1]!) {
          if (a !== target) {
            result = UNSAFE
            break
          }
          result = 1
        }
      }
    } else {
      // 次にどのリールを・どのコマで押されても、安全な停止位置が1つは残っていること。
      // そのうえで、最もフラグ役が揃いやすい位置を選んだときの期待値を持つ。
      let sum = 0
      let count = 0
      result = 0
      outer: for (let r = 0; r < 3; r++) {
        if ((r === 0 ? p0 : r === 1 ? p1 : p2) >= 0) continue
        for (let press = 0; press < REEL_LEN; press++) {
          let best = UNSAFE
          for (let slip = 0; slip <= MAX_SLIP; slip++) {
            const q = mod(press - slip)
            const v = value(table, target, r === 0 ? q : p0, r === 1 ? q : p1, r === 2 ? q : p2)
            if (v > best) best = v
          }
          if (best === UNSAFE) {
            result = UNSAFE
            break outer
          }
          sum += best
          count++
        }
      }
      if (result !== UNSAFE) result = sum / count
    }
    table[key] = result
    return result
  }

  const tableOf = (target: number) => {
    let table = tables.get(target)
    if (!table) {
      table = new Float32Array(STATE_COUNT).fill(UNKNOWN)
      tables.set(target, table)
    }
    return table
  }

  const raw = (target: SymbolId | null, pos: Positions): number => {
    const t = target ? SYMBOLS.indexOf(target) : -1
    return value(tableOf(t), t, pos[0] ?? -1, pos[1] ?? -1, pos[2] ?? -1)
  }

  const evaluate = (target: SymbolId | null, pos: Positions): Eval => {
    const v = raw(target, pos)
    return v === UNSAFE ? { safe: false, win: 0 } : { safe: true, win: v }
  }

  const withStop = (stopped: Positions, reel: number, pos: number): Positions => [
    reel === 0 ? pos : stopped[0],
    reel === 1 ? pos : stopped[1],
    reel === 2 ? pos : stopped[2],
  ]

  /**
   * リール reel を press（押した瞬間に中段へ来るコマ）で押したときの、最終停止位置を返す。
   * 安全な候補の中で、フラグ役が最も揃いやすい位置 → 同点ならスベリが少ない位置を選ぶ。
   */
  const chooseStop = (
    target: SymbolId | null,
    stopped: Positions,
    reel: number,
    press: number,
  ): number => {
    let bestPos = mod(press)
    let bestWin = UNSAFE
    for (let slip = 0; slip <= MAX_SLIP; slip++) {
      const pos = mod(press - slip)
      const v = raw(target, withStop(stopped, reel, pos))
      if (v > bestWin + 1e-6) {
        bestWin = v
        bestPos = pos
      }
    }
    return bestPos
  }

  /** 目押しの理想解: いま押すと最もフラグ役が揃いやすい（リール, コマ）。bot とテスト用 */
  const bestPress = (target: SymbolId | null, stopped: Positions): { reel: number; press: number } => {
    let best = { reel: -1, press: 0 }
    let bestWin = UNSAFE
    for (let r = 0; r < 3; r++) {
      if (stopped[r] != null) continue
      for (let press = 0; press < REEL_LEN; press++) {
        const v = raw(target, withStop(stopped, r, chooseStop(target, stopped, r, press)))
        if (v > bestWin + 1e-6) {
          bestWin = v
          best = { reel: r, press }
        }
      }
    }
    return best
  }

  /** 全図柄ぶんの評価を先に済ませる（初回ストップの計算待ちをなくす） */
  const warmUp = () => {
    const empty: Positions = [null, null, null]
    raw(null, empty)
    for (const s of SYMBOLS) raw(s, empty)
  }

  return { evaluate, chooseStop, bestPress, warmUp }
}

export type ReelControl = ReturnType<typeof createReelControl>

let defaultControl: ReelControl | null = null
/** 本番の配列（STRIPS）用のリール制御。初回呼び出しで作る */
export function reelControl(): ReelControl {
  if (!defaultControl) defaultControl = createReelControl(STRIPS)
  return defaultControl
}

// ----------------------------------------------------------------------------
// 内部抽選
// ----------------------------------------------------------------------------

export const LOTTERY_RANGE = 65536 // 実機と同じ 0〜65535 の乱数で抽選する

export type Setting = 1 | 2 | 3 | 4 | 5 | 6

/** 小役の当選値（65536分のいくつか）。設定によらず一定 */
export const SMALL_ODDS: Record<'replay' | 'tee' | 'cap' | 'coat', number> = {
  replay: 8978, // 1/7.3
  tee: 8192, // 1/8
  cap: 2731, // 1/24
  coat: 1820, // 1/36。狙わないと揃わない「チャンス役」。成立はレバー時に知らせる
}

/**
 * ボーナスの当選値。設定差は主に REG に付けてある（＝REG が多い台は高設定）。
 * 実機よりかなり甘い。数分の遊びでも1〜2回はボーナスに届くようにしてある。
 */
export const BONUS_ODDS: Record<Setting, { big: number; reg: number }> = {
  1: { big: 862, reg: 655 }, // 1/76, 1/100
  2: { big: 886, reg: 712 }, // 1/74, 1/92
  3: { big: 910, reg: 780 }, // 1/72, 1/84
  4: { big: 936, reg: 851 }, // 1/70, 1/77
  5: { big: 978, reg: 936 }, // 1/67, 1/70
  6: { big: 1024, reg: 1024 }, // 1/64, 1/64
}

/** 0〜65535 の乱数値から成立役を引く。どれにも当たらなければ null（ハズレ） */
export function drawRole(setting: Setting, value: number): Role | null {
  const b = BONUS_ODDS[setting]
  const table: [Role, number][] = [
    ['big', b.big],
    ['reg', b.reg],
    ['coat', SMALL_ODDS.coat],
    ['cap', SMALL_ODDS.cap],
    ['tee', SMALL_ODDS.tee],
    ['replay', SMALL_ODDS.replay],
  ]
  let acc = 0
  for (const [role, n] of table) {
    acc += n
    if (value < acc) return role
  }
  return null
}

// ----------------------------------------------------------------------------
// 台の状態
// ----------------------------------------------------------------------------

export type BonusKind = 'big' | 'reg'

export type Machine = {
  /** 台番号。図柄の顔ぶれと設定はこの番号（と日付）で決まる */
  no: number
  setting: Setting
  coins: number
  /** 投入したメダルの合計（初期メダル + おかわり）。差枚 = coins - invested */
  invested: number
  /** 成立したがまだ揃えていないボーナス（揃うまで持ち越す） */
  pending: BonusKind | null
  /** 告知ランプが点いているか（pending があっても、告知前は false） */
  lamp: boolean
  /** 消化中のボーナス */
  bonus: { kind: BonusKind; left: number; gained: number } | null
  /** 次のゲームがリプレイ（掛け枚数なしで回せる）か */
  replay: boolean
  spins: number // 通常ゲームの総回転数
  big: number
  reg: number
  sinceBonus: number // 前回のボーナスからのゲーム数（ハマり）
  ceiling: number
  /** 差枚の推移（スランプグラフ用）。1ゲームごとに1点、長くなったら間引く */
  history: number[]
  /** 回転中のゲーム。停止中は null */
  spin: {
    target: SymbolId | null
    pos: [number | null, number | null, number | null]
  } | null
}

export const START_COINS = 50
const HISTORY_MAX = 240

export function newMachine(no: number, setting: Setting): Machine {
  return {
    no,
    setting,
    coins: START_COINS,
    invested: START_COINS,
    pending: null,
    lamp: false,
    bonus: null,
    replay: false,
    spins: 0,
    big: 0,
    reg: 0,
    sinceBonus: 0,
    ceiling: CEILING_MORNING,
    history: [0],
    spin: null,
  }
}

/** 1ゲームに必要な掛け枚数（ボーナス中とリプレイは 0） */
export const betOf = (m: Machine) => (m.bonus || m.replay ? 0 : BET)

export const canSpin = (m: Machine) => m.spin == null && m.coins >= betOf(m)

/** メダル切れでおかわりできる状態か */
export const canRefill = (m: Machine) => m.spin == null && m.coins < betOf(m)

export function refill(m: Machine): Machine {
  if (!canRefill(m)) return m
  return { ...m, coins: m.coins + REFILL, invested: m.invested + REFILL }
}

export type LeverResult = {
  machine: Machine
  /** このゲームで新しく成立した役（ボーナス中・持ち越し中は null） */
  role: Role | null
  /** レバーONと同時にランプが点く「先告知」か */
  earlyLamp: boolean
}

const ALWAYS: SymbolId[] = ['usual', 'cap', 'tee']

/**
 * レバーON。掛け枚数を引き、内部抽選で「このゲームで揃ってよい図柄」を決める。
 * rng は [0,1) を返す関数（テストでは決定的な乱数に差し替える）。
 */
export function lever(m: Machine, rng: () => number = Math.random): LeverResult {
  if (!canSpin(m)) return { machine: m, role: null, earlyLamp: false }
  const coins = m.coins - betOf(m)
  let target: SymbolId | null
  let role: Role | null = null
  let pending = m.pending
  let lamp = m.lamp
  let earlyLamp = false
  let spins = m.spins
  let sinceBonus = m.sinceBonus

  if (m.bonus) {
    // ボーナスゲーム: 必ず揃う図柄のどれかを毎ゲーム狙わせる
    target = ALWAYS[Math.floor(rng() * ALWAYS.length)]!
  } else {
    spins++
    sinceBonus++
    if (pending) {
      // 持ち越し中は小役を抽選せず、ボーナス図柄だけを引き込む（狙えば必ず揃う）
      target = ROLE_SYMBOL[pending]
    } else {
      role =
        sinceBonus >= m.ceiling
          ? 'big' // 天井到達
          : drawRole(m.setting, Math.floor(rng() * LOTTERY_RANGE))
      target = role ? ROLE_SYMBOL[role] : null
      if (role === 'big' || role === 'reg') {
        pending = role
        // 4回に1回は先告知。それ以外は全リール停止後に告知する
        earlyLamp = rng() < 0.25
        lamp = earlyLamp
      }
    }
  }

  return {
    machine: {
      ...m,
      coins,
      replay: false,
      pending,
      lamp,
      spins,
      sinceBonus,
      spin: { target, pos: [null, null, null] },
    },
    role,
    earlyLamp,
  }
}

export type SpinOutcome = {
  lines: WinLine[]
  symbol: SymbolId | null
  payout: number
  replay: boolean
  bonusStart: BonusKind | null
  /** このゲームでボーナスが終わったとき、その種類と獲得枚数 */
  bonusEnd: { kind: BonusKind; gained: number } | null
  /** このゲームの終わりに告知ランプが点いた（後告知） */
  lampOn: boolean
}

export type StopResult = {
  machine: Machine
  /** 止まった位置（中段のコマ番号） */
  pos: number
  /** 3リール目を止めたときだけ入る、このゲームの結果 */
  outcome: SpinOutcome | null
}

/**
 * ストップ。press は押した瞬間に中段へ来るコマ番号。
 * 止める位置はリール制御が決め、3リール止まったら出目から払い出しを確定する。
 */
export function stop(
  m: Machine,
  reel: number,
  press: number,
  control: ReelControl = reelControl(),
): StopResult {
  const spin = m.spin
  if (!spin || spin.pos[reel] != null) return { machine: m, pos: -1, outcome: null }
  const pos = control.chooseStop(spin.target, spin.pos, reel, press)
  const next = [spin.pos[0], spin.pos[1], spin.pos[2]] as [
    number | null,
    number | null,
    number | null,
  ]
  next[reel] = pos
  if (next.some((p) => p == null)) {
    return { machine: { ...m, spin: { ...spin, pos: next } }, pos, outcome: null }
  }

  // 払い出しはフラグではなく「実際に止まった出目」から決める
  const lines = winningLines(next as [number, number, number])
  const symbol = lines[0]?.symbol ?? null
  let coins = m.coins
  let payout = 0
  let replay = false
  let bonusStart: BonusKind | null = null
  let bonusEnd: SpinOutcome['bonusEnd'] = null
  let bonus = m.bonus
  let pending = m.pending
  let lamp = m.lamp
  let big = m.big
  let reg = m.reg
  let sinceBonus = m.sinceBonus
  let ceiling = m.ceiling
  let lampOn = false

  if (bonus) {
    if (symbol) payout = BONUS_PAY
    bonus = { ...bonus, left: bonus.left - 1, gained: bonus.gained + payout }
    if (bonus.left <= 0) {
      bonusEnd = { kind: bonus.kind, gained: bonus.gained }
      bonus = null
    }
  } else if (symbol) {
    const role = SYMBOL_ROLE[symbol]
    if (role === 'big' || role === 'reg') {
      bonusStart = role
      bonus = { kind: role, left: BONUS_GAMES[role], gained: 0 }
      pending = null
      lamp = false
      if (role === 'big') big++
      else reg++
      sinceBonus = 0
      ceiling = CEILING
    } else if (role === 'replay') {
      replay = true
    } else {
      payout = PAYOUT[role]
    }
  }
  if (pending && !lamp) {
    lamp = true
    lampOn = true
  }
  coins += payout

  const history = bonus && !bonusEnd ? m.history : pushHistory(m.history, coins - m.invested)

  return {
    machine: {
      ...m,
      coins,
      replay,
      bonus,
      pending,
      lamp,
      big,
      reg,
      sinceBonus,
      ceiling,
      history,
      spin: null,
    },
    pos,
    outcome: { lines, symbol, payout, replay, bonusStart, bonusEnd, lampOn },
  }
}

function pushHistory(history: number[], value: number): number[] {
  const next = [...history, value]
  if (next.length <= HISTORY_MAX) return next
  // 古い側を2点→1点に間引いて、全体の形を保ったまま長さを抑える
  const half = Math.floor(next.length / 2)
  const head: number[] = []
  for (let i = 0; i < half; i += 2) head.push(next[i]!)
  return [...head, ...next.slice(half)]
}

// ----------------------------------------------------------------------------
// 保存（localStorage）
// ----------------------------------------------------------------------------

export const SAVE_KEY = 'slot.machine'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 保存データを検証して Machine に戻す。壊れていたら null */
export function parseMachine(raw: string | null): Machine | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<Machine> | null
    if (!v || typeof v !== 'object') return null
    const ints = [v.no, v.coins, v.invested, v.spins, v.big, v.reg, v.sinceBonus, v.ceiling]
    if (!ints.every((n) => isInt(n) && n >= 0)) return null
    if (!isInt(v.setting) || v.setting < 1 || v.setting > 6) return null
    if (v.pending != null && v.pending !== 'big' && v.pending !== 'reg') return null
    if (!Array.isArray(v.history) || !v.history.every(isInt)) return null
    const bonus = v.bonus
    if (bonus != null) {
      if (bonus.kind !== 'big' && bonus.kind !== 'reg') return null
      if (!isInt(bonus.left) || bonus.left <= 0 || !isInt(bonus.gained)) return null
    }
    return {
      no: v.no!,
      setting: v.setting as Setting,
      coins: v.coins!,
      invested: v.invested!,
      pending: v.pending ?? null,
      lamp: v.pending != null && v.lamp === true,
      bonus: bonus ?? null,
      replay: v.replay === true,
      spins: v.spins!,
      big: v.big!,
      reg: v.reg!,
      sinceBonus: v.sinceBonus!,
      ceiling: v.ceiling!,
      history: v.history.slice(-HISTORY_MAX),
      spin: null, // 回転中に閉じた場合は、掛け枚数を返さず停止状態から再開する
    }
  } catch {
    return null
  }
}

export function loadMachine(): Machine | null {
  try {
    return parseMachine(localStorage.getItem(SAVE_KEY))
  } catch {
    return null
  }
}

export function saveMachine(m: Machine): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...m, spin: null }))
  } catch {
    // localStorage が使えない環境では保存しない
  }
}

// ----------------------------------------------------------------------------
// 図柄の顔ぶれ（どの日の俺がリールに乗るか）
// ----------------------------------------------------------------------------

/** 文字列から決定的な 32bit シードを作る (FNV-1a) */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** シード付き乱数 (mulberry32)。[0,1) を返す */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 台番号から設定を決める（同じ台番号なら同じ設定） */
export function settingOf(no: number): Setting {
  // 低設定ほど多い、ホールらしい配分
  const weights = [30, 24, 18, 13, 9, 6]
  let r = seededRng(hashSeed(`setting:${no}`))() * 100
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!
    if (r < 0) return (i + 1) as Setting
  }
  return 1
}

export type Lineup = Record<SymbolId, Outfit>

// くり抜きの幅がこの範囲のコーデだけを図柄にする（傘や自転車が写り込んだ横長の切り抜きを除く）
const SPRITE_W_MIN = 62
const SPRITE_W_MAX = 128

const OUTER_CATS = new Set([
  'coat',
  'jacket',
  'outer',
  'blouson',
  'knit',
  'sweat',
  'hoodie',
  'cardigan',
  'vest',
  'shirt',
  'setup',
  'down vest',
])

const categoriesOf = (o: Outfit) => new Set(o.itemIds.map((id) => id.split('|')[0]!))

/**
 * リールに乗せる6人の俺を選ぶ。
 * 「最新の俺」は常にいちばん新しいコーデ。残りは髪・帽子・服のデータから条件に合う日を
 * シード付き乱数で1日ずつ選ぶ（同じ日・同じ台番号なら同じ顔ぶれになる）。
 * outfits は新しい順に並んでいる前提。
 */
export function pickLineup(
  outfits: readonly Outfit[],
  sprites: Record<string, { w: number; h: number }>,
  hair: HairFile,
  seed: number,
): Lineup | null {
  const pool = outfits.filter((o) => {
    const sp = sprites[o.key]
    return sp != null && sp.w >= SPRITE_W_MIN && sp.w <= SPRITE_W_MAX
  })
  if (pool.length < SYMBOLS.length) return null

  const rng = seededRng(seed)
  const used = new Set<string>()
  const take = (match: (o: Outfit) => boolean): Outfit => {
    const free = pool.filter((o) => !used.has(o.key))
    const hits = free.filter(match)
    // 条件に合う日が無い（データが少ない）ときは、残りから選んで必ず6人そろえる
    const from = hits.length > 0 ? hits : free
    const picked = from[Math.floor(rng() * from.length)]!
    used.add(picked.key)
    return picked
  }

  const newest = pool[0]!
  used.add(newest.key)

  const tag = (o: Outfit) => effectiveHair(hair, o.key)
  const blond = take((o) => tag(o).color === '金' && !tag(o).hat)
  const cap = take((o) => tag(o).hat != null && tag(o).color !== '金')
  const coat = take((o) => categoriesOf(o).has('coat') && !tag(o).hat && tag(o).color !== '金')
  const tee = take((o) => {
    const cats = categoriesOf(o)
    if (!cats.has('t-shirt') || tag(o).hat || tag(o).color === '金') return false
    for (const c of cats) if (OUTER_CATS.has(c)) return false
    return true
  })
  const usual = take((o) => {
    const cats = categoriesOf(o)
    return tag(o).color === '黒' && !tag(o).hat && cats.has('jacket') && !cats.has('coat')
  })

  return { new: newest, blond, coat, cap, tee, usual }
}
