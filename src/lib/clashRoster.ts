// 着戦のファイター性能。コーデの季節と代表色から、対戦用の数値と通常必殺技を決める。
import type { ClashKit, FighterStats } from './clash'

export const CLASH_KITS: ClashKit[] = ['spring', 'summer', 'autumn', 'winter']

/** 季節ごとの通常必殺技。名前は英字のまま、説明は i18n のキー（日本語）。 */
export const KIT_INFO: Record<ClashKit, { name: string; lead: string }> = {
  spring: { name: 'PETAL FAN', lead: '花びらを上下に2枚とばす。軽いが、相手の逃げ場をせばめる。' },
  summer: { name: 'HEAT BURST', lead: '踏みこんで目の前を広く焼く。飛ばないかわりに重い。' },
  autumn: { name: 'LEAF RETURN', lead: '落ち葉が飛んで戻ってくる。帰りに当たると手前へ引きよせる。' },
  winter: { name: 'FROST SHARD', lead: '遅くて大きい氷。当たるとしばらく足がにぶる。' },
}

export function clashStats(season: ClashKit, color?: string): FighterStats {
  const stats: FighterStats = {
    speed: 1,
    jump: 1,
    power: 1,
    weight: 1,
    airJumps: 1,
    airControl: 1,
    kit: season,
  }
  if (season === 'spring') {
    stats.jump += 0.1
    stats.airControl += 0.05
  } else if (season === 'summer') {
    stats.speed += 0.1
    stats.power += 0.03
  } else if (season === 'autumn') {
    stats.airControl += 0.13
    stats.power += 0.04
  } else {
    stats.weight += 0.1
    stats.speed -= 0.06
  }
  if (color === 'black' || color === 'red') stats.power += 0.1
  if (color === 'white') {
    stats.speed += 0.035
    stats.jump += 0.035
    stats.power += 0.035
  }
  if (color === 'navy' || color === 'brown') stats.weight += 0.08
  if (color === 'blue' || color === 'purple') {
    stats.airJumps += 1
    stats.weight -= 0.07
  }
  if (color === 'green' || color === 'pink') stats.jump += 0.075
  if (color === 'yellow' || color === 'orange') stats.speed += 0.075
  if (color === 'gray' || color === 'beige') stats.airControl += 0.075
  return stats
}

export type ClashType = 'SPEED' | 'POWER' | 'AIR' | 'HEAVY' | 'BALANCE'

/**
 * いちばん尖っている性能でタイプを呼ぶ。標準値（1）からの伸びで比べる
 * （素の値で比べると、係数の大きい AIR が必ず勝って全員 AIR になる）。
 */
export function clashType(stats: FighterStats): ClashType {
  const scored: [ClashType, number][] = [
    ['SPEED', stats.speed - 1 + (stats.airControl - 1) * 0.3],
    ['POWER', stats.power - 1 + (stats.weight - 1) * 0.2],
    ['AIR', stats.jump - 1 + (stats.airControl - 1) * 0.5 + (stats.airJumps - 1) * 0.1],
    ['HEAVY', stats.weight - 1 + (stats.power - 1) * 0.2],
  ]
  const [type, score] = scored.sort((a, b) => b[1] - a[1])[0]
  return score < 0.05 ? 'BALANCE' : type
}

export const CLASH_COLORS = [
  'white',
  'beige',
  'gray',
  'black',
  'brown',
  'navy',
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
] as const

export type RosterCandidate = {
  key: string
  season: ClashKit
  color?: string
  /** くり抜きの横÷縦。 */
  ratio: number
}

/**
 * 人ひとりぶんの幅に収まるくり抜きか。自転車や二人写りは見た目が当たり判定（幅48）から
 * 大きくはみ出すので、ファイターには使わない。
 */
export const fitsFighterBox = (ratio: number) => ratio >= 0.2 && ratio <= 0.6

/**
 * ファイターを選ぶ。性能は「季節×代表色」で決まるので、その組み合わせごとに1着ずつ採る
 * （同じ効果の色もあるので、性能まで全員ばらばらというわけではない）。
 * `candidates` は新しい順に渡す。各組み合わせでいちばん新しい着になる。
 */
export function pickClashRoster<T extends RosterCandidate>(candidates: T[]): T[] {
  const roster: T[] = []
  for (const season of CLASH_KITS) {
    const seen = new Set<string>()
    for (const candidate of candidates) {
      if (candidate.season !== season || !fitsFighterBox(candidate.ratio)) continue
      const color = candidate.color ?? ''
      if (seen.has(color)) continue
      seen.add(color)
      roster.push(candidate)
    }
  }
  return roster
}
