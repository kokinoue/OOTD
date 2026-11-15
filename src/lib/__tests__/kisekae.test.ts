import { describe, expect, it } from 'vitest'
import cutoutsJson from '../../data/cutouts.json'
import overridesJson from '../../data/overrides.json'
import splitsJson from '../../data/splits.json'
import type { Outfit, Overrides, SplitsFile } from '../../types'
import {
  analyzeSprite,
  anchorOf,
  buildLanes,
  buildSources,
  cellOffset,
  judge,
  LANE_SIZE,
  LANES,
  laneSpeed,
  MAX_SPRITE_W,
  NEEDED,
  PAIR_POINTS,
  pickCandidates,
  rankOf,
  RANKS,
  ROUNDS,
  SEASON_POINTS,
  SEED_DAYS,
  seasonPoints,
  stopTarget,
  wornTogether,
  wrapIndex,
  type Pick,
  type Source,
} from '../kisekae'
import type { CutoutsFile } from '../platform'
import { seededRng } from '../slot'
import { buildData, outfits } from '../useData'
import { weather } from '../weather'

const cutouts = cutoutsJson as CutoutsFile

const outfit = (key: string, itemIds: string[], date = '2025-01-01'): Outfit => ({
  key,
  no: 1,
  title: '',
  date,
  publishAt: `${date}T09:00:00.000+09:00`,
  like: 0,
  comment: '',
  noteUrl: '',
  images: [],
  itemIds,
})

const categoryOf = (id: string) => id.split('|')[0]

function sourcesOf(list: Outfit[], sizes: Record<string, { w: number; h: number }> = {}) {
  const sets = new Map(list.map((o) => [o.key, new Set(o.itemIds)]))
  const sprites = Object.fromEntries(list.map((o) => [o.key, sizes[o.key] ?? { w: 90, h: 240 }]))
  return buildSources(list, sets, categoryOf, () => 20, sprites, 240)
}

const source = (key: string, tmax: number | null, main = { top: `t|${key}`, bottom: `p|${key}`, shoes: `s|${key}` }): Source => ({
  key,
  no: 1,
  date: '2025-01-01',
  tmax,
  main,
})

describe('buildSources', () => {
  it('いちばん外側のトップスを上半身の主役にする', () => {
    const [s] = sourcesOf([
      outfit('a', ['t-shirt|x', 'coat|y', 'shirt|z', 'pants|p', 'shoes|s', 'bag|b']),
    ])
    expect(s.main).toEqual({ top: 'coat|y', bottom: 'pants|p', shoes: 'shoes|s' })
  })

  it('ボトムスの記録が無い日は、セットアップが下半身の主役にもなる', () => {
    const [s] = sourcesOf([outfit('a', ['setup|x', 't-shirt|y', 'boots|s'])])
    expect(s.main).toEqual({ top: 'setup|x', bottom: 'setup|x', shoes: 'boots|s' })
  })

  it('3つのうちどれかが欠ける日と、一人ぶんに収まらないスプライトは使わない', () => {
    const list = [
      outfit('noshoes', ['shirt|a', 'pants|b']),
      outfit('notop', ['pants|b', 'shoes|c', 'bag|d']),
      outfit('wide', ['shirt|a', 'pants|b', 'shoes|c']),
      outfit('short', ['shirt|a', 'pants|b', 'shoes|c']),
      outfit('ok', ['shirt|a', 'pants|b', 'shoes|c']),
    ]
    const got = sourcesOf(list, { wide: { w: MAX_SPRITE_W + 1, h: 240 }, short: { w: 90, h: 200 } })
    expect(got.map((s) => s.key)).toEqual(['ok'])
  })

  it('実データから、5ラウンド遊べるだけのコーデが集まる', () => {
    const data = buildData(overridesJson as Overrides, splitsJson as unknown as SplitsFile)
    const got = buildSources(
      outfits,
      data.outfitItemIds,
      (id) => data.itemMap.get(id)?.category,
      (date) => weather[date]?.max,
      cutouts.sprites,
      cutouts.spriteHeight,
    )
    expect(got.length).toBeGreaterThan(NEEDED * 4)
    for (const s of got) {
      for (const lane of LANES) expect(data.itemMap.has(s.main[lane]), s.key).toBe(true)
    }
  })
})

describe('analyzeSprite', () => {
  // 幅100×高さ240 の絵に、不透明な矩形を置いて人の形を作る
  const draw = (rects: [number, number, number, number][]) => {
    const w = 100
    const h = 240
    const px = new Uint8Array(w * h * 4)
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[(y * w + x) * 4 + 3] = 255
    }
    return analyzeSprite(px, w, h)
  }
  const HEAD: [number, number, number, number] = [40, 0, 60, 36]
  const TORSO: [number, number, number, number] = [30, 34, 70, 125]
  const LEGS: [number, number, number, number] = [36, 120, 66, 240]

  it('まっすぐ立った人は、首・腰・足首の軸がそれぞれの重心になる', () => {
    const a = draw([HEAD, TORSO, LEGS])
    expect(a.ok).toBe(true)
    expect(a.neckX).toBeCloseTo(49.5, 0)
    expect(a.waistX).toBeCloseTo(50, 0)
    expect(a.ankleX).toBeCloseTo(50.5, 0)
    expect(anchorOf(a, 'head')).toBe(a.neckX)
    expect(anchorOf(a, 'top')).toBe(a.neckX)
    expect(anchorOf(a, 'bottom')).toBe(a.waistX)
    expect(anchorOf(a, 'shoes')).toBe(a.ankleX)
  })

  it('離れた位置に持った荷物には、腰の軸が引っ張られない', () => {
    const plain = draw([HEAD, TORSO, LEGS])
    const withBag = draw([HEAD, TORSO, LEGS, [0, 100, 1, 140]])
    expect(withBag.ok).toBe(true)
    expect(withBag.waistX).toBeCloseTo(plain.waistX, 5)
  })

  it('頭の高さに広いもの（傘など）がある絵は使わない', () => {
    expect(draw([[0, 5, 100, 30], TORSO, LEGS]).ok).toBe(false)
  })

  it('下半身が写っていない絵は使わない', () => {
    expect(draw([HEAD, [30, 34, 70, 100]]).ok).toBe(false)
  })
})

describe('buildLanes', () => {
  const cands = Array.from({ length: NEEDED + 4 }, (_, i) => source(`k${i}`, 20))

  it('どのレーンも重複なしで LANE_SIZE 件。完全再現できる日がちょうど SEED_DAYS 日ある', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = seededRng(seed)
      const lanes = buildLanes(pickCandidates(cands, rng, NEEDED), rng)!
      for (const lane of LANES) {
        expect(lanes[lane]).toHaveLength(LANE_SIZE)
        expect(new Set(lanes[lane].map((s) => s.key)).size).toBe(LANE_SIZE)
      }
      const inAll = lanes.top.filter(
        (s) => lanes.bottom.includes(s) && lanes.shoes.includes(s),
      )
      expect(inAll).toHaveLength(SEED_DAYS)
      // それ以外のコーデは、どれか1レーンにしか出ない
      const counts = new Map<string, number>()
      for (const lane of LANES) for (const s of lanes[lane]) counts.set(s.key, (counts.get(s.key) ?? 0) + 1)
      expect([...counts.values()].filter((n) => n === 2)).toHaveLength(0)
    }
  })

  it('候補が足りなければ組まない', () => {
    expect(buildLanes(cands.slice(0, NEEDED - 1), seededRng(1))).toBeNull()
  })

  it('pickCandidates は重複なしで指定の件数をひく', () => {
    const got = pickCandidates(cands, seededRng(3), 10)
    expect(got).toHaveLength(10)
    expect(new Set(got).size).toBe(10)
  })
})

describe('レーンの動き', () => {
  it('ストップは、押した瞬間いちばん近いコマに止まる', () => {
    expect(stopTarget(3.2)).toBe(3)
    expect(stopTarget(3.7)).toBe(4)
    expect(stopTarget(-0.4)).toBe(-0)
    expect(stopTarget(-0.6)).toBe(-1)
    expect(wrapIndex(-1, LANE_SIZE)).toBe(LANE_SIZE - 1)
    expect(wrapIndex(LANE_SIZE + 2, LANE_SIZE)).toBe(2)
  })

  it('コマは輪になっていて、中央から半周以内の位置に折り返して見える', () => {
    expect(cellOffset(0, 0, 9)).toBe(0)
    expect(cellOffset(1, 0, 9)).toBe(1)
    expect(cellOffset(8, 0, 9)).toBe(-1)
    expect(cellOffset(0, 8.5, 9)).toBeCloseTo(0.5)
    expect(cellOffset(2, 100.25, 9)).toBeCloseTo(0.75)
    for (let pos = -20; pos < 20; pos += 0.37) {
      const offs = Array.from({ length: 9 }, (_, i) => cellOffset(i, pos, 9))
      for (const d of offs) {
        expect(d).toBeGreaterThan(-4.5)
        expect(d).toBeLessThanOrEqual(4.5)
      }
      // 9コマが1コマおきに並ぶ（重ならない）
      const sorted = offs.slice().sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(1)
    }
  })

  it('ラウンドが進むほど、下のレーンほど速い', () => {
    for (let r = 1; r < ROUNDS; r++) {
      expect(laneSpeed(r, 'top')).toBeGreaterThan(laneSpeed(r - 1, 'top'))
    }
    expect(laneSpeed(0, 'shoes')).toBeGreaterThan(laneSpeed(0, 'bottom'))
    expect(laneSpeed(0, 'bottom')).toBeGreaterThan(laneSpeed(0, 'top'))
    expect(laneSpeed(99, 'top')).toBe(laneSpeed(ROUNDS - 1, 'top'))
  })
})

describe('judge', () => {
  const sets = [
    new Set(['t|a', 'p|a', 's|a']),
    new Set(['t|a', 'p|a', 's|x']),
    new Set(['t|b', 'p|b', 's|a']),
  ]
  const a = source('a', 10)
  const b = source('b', 12)
  const c = source('c', 30)

  it('同じ日に着た回数を数える', () => {
    expect(wornTogether(sets, 't|a', 'p|a')).toBe(2)
    expect(wornTogether(sets, 't|a', 's|a')).toBe(1)
    expect(wornTogether(sets, 't|a', 'p|b')).toBe(0)
  })

  it('3つとも同じ日なら完全再現で100点', () => {
    const j = judge({ top: a, bottom: a, shoes: a }, sets)
    expect(j.perfect).toBe(true)
    expect(j.score).toBe(100)
  })

  it('実際に着た組み合わせと季節感を足す', () => {
    // 上下は a の日（2回）、靴は b の日のもの = s|b は誰とも着ていない
    const j = judge({ top: a, bottom: a, shoes: b }, sets)
    expect(j.perfect).toBe(false)
    expect(j.pairs).toEqual({ topBottom: 2, bottomShoes: 0, topShoes: 0 })
    expect(j.record).toBe(PAIR_POINTS.topBottom)
    expect(j.spread).toBe(2)
    expect(j.season).toBe(SEASON_POINTS)
    expect(j.score).toBe(PAIR_POINTS.topBottom + SEASON_POINTS)
  })

  it('別の日のパーツでも、同じアイテムなら実績になる', () => {
    const a2 = source('a2', 11, { top: 't|a', bottom: 'p|zzz', shoes: 's|a' })
    const j = judge({ top: a2, bottom: a, shoes: a2 }, sets)
    expect(j.perfect).toBe(false)
    expect(j.pairs).toEqual({ topBottom: 2, bottomShoes: 1, topShoes: 1 })
    expect(j.record).toBe(PAIR_POINTS.topBottom + PAIR_POINTS.bottomShoes + PAIR_POINTS.topShoes)
  })

  it('真冬と真夏を混ぜると季節感は0点', () => {
    const j = judge({ top: a, bottom: c, shoes: b }, sets)
    expect(j.spread).toBe(20)
    expect(j.season).toBe(0)
    expect(j.score).toBe(0)
  })

  it('季節感は気温の開きが小さいほど高く、記録が無ければ半分', () => {
    expect(seasonPoints(0)).toBe(SEASON_POINTS)
    expect(seasonPoints(4)).toBe(SEASON_POINTS)
    expect(seasonPoints(11)).toBe(SEASON_POINTS / 2)
    expect(seasonPoints(18)).toBe(0)
    expect(seasonPoints(40)).toBe(0)
    expect(seasonPoints(null)).toBe(SEASON_POINTS / 2)
    const j = judge({ top: source('x', null), bottom: source('y', null), shoes: source('z', 5) }, sets)
    expect(j.spread).toBeNull()
  })

  it('満点は完全再現と同じ100点を超えない', () => {
    const all = Object.values(PAIR_POINTS).reduce((x, y) => x + y, 0)
    expect(all + SEASON_POINTS).toBe(100)
  })
})

describe('実データでの手ごたえ', () => {
  const data = buildData(overridesJson as Overrides, splitsJson as unknown as SplitsFile)
  const sources = buildSources(
    outfits,
    data.outfitItemIds,
    (id) => data.itemMap.get(id)?.category,
    (date) => weather[date]?.max,
    cutouts.sprites,
    cutouts.spriteHeight,
  )
  const sets = [...data.outfitItemIds.values()]

  const play = (choose: (lanes: Record<string, Source[]>, rng: () => number) => Pick, games: number) => {
    const rng = seededRng(20261115)
    let total = 0
    for (let i = 0; i < games; i++) {
      const lanes = buildLanes(pickCandidates(sources, rng, NEEDED), rng)!
      total += judge(choose(lanes, rng), sets).score
    }
    return total / games
  }

  it('でたらめに止めると平均は2〜4割、同じ日を狙って揃えれば必ず満点', () => {
    const random = play(
      (lanes, rng) =>
        Object.fromEntries(
          LANES.map((lane) => [lane, lanes[lane][Math.floor(rng() * LANE_SIZE)]]),
        ) as Pick,
      3000,
    )
    expect(random).toBeGreaterThan(20)
    expect(random).toBeLessThan(40)

    const aimed = play((lanes) => {
      const seed = lanes.top.find((s) => lanes.bottom.includes(s) && lanes.shoes.includes(s))!
      return { top: seed, bottom: seed, shoes: seed }
    }, 300)
    expect(aimed).toBe(100)
  })

  it('季節感だけを合わせても、でたらめよりはっきり高い', () => {
    const seasonal = play((lanes) => {
      // トップスを1つ決め、気温がいちばん近いボトムスと靴を選ぶ（目で見て季節を合わせる遊び方）
      const top = lanes.top[0]
      const near = (list: Source[]) =>
        list.slice().sort((x, y) => Math.abs(x.tmax! - top.tmax!) - Math.abs(y.tmax! - top.tmax!))[0]
      return { top, bottom: near(lanes.bottom), shoes: near(lanes.shoes) }
    }, 1000)
    expect(seasonal).toBeGreaterThan(50)
  })
})

describe('rankOf', () => {
  it('合計点が高いほど上の称号。0点でも称号がつく', () => {
    expect(rankOf(ROUNDS * 100).name).toBe(RANKS[0].name)
    expect(rankOf(0).name).toBe(RANKS[RANKS.length - 1].name)
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].min).toBeLessThan(RANKS[i - 1].min)
      expect(rankOf(RANKS[i - 1].min - 1).name).toBe(RANKS[i].name)
    }
  })
})
