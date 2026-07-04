import { describe, expect, it, vi } from 'vitest'
import type { Outfit } from '../../types'

// ----------------------------------------------------------------------------
// weather.ts はモジュールトップで weather.json と useData(outfits) を読むので、
// 決定的なフィクスチャに差し替えてから import する
// ----------------------------------------------------------------------------
const { WEATHER, OUTFITS } = vi.hoisted(() => {
  const outfit = (date: string, cats: string[]) => ({
    key: `o-${date}`,
    no: null,
    title: `outfit ${date}`,
    date,
    publishAt: date,
    like: 0,
    comment: '',
    noteUrl: '',
    images: [],
    itemIds: cats.map((c) => `${c}|dummy item`),
  })

  const WEATHER: Record<string, { max: number | null; min: number | null; mean: number | null }> = {}
  const OUTFITS: ReturnType<typeof outfit>[] = []

  // 寒い日6日（気温 2〜12℃）: コートを一枚で着る
  const coldTemps = [2, 4, 6, 8, 10, 12]
  coldTemps.forEach((t, i) => {
    const d = `2025-01-0${i + 1}`
    WEATHER[d] = { max: t, min: t - 5, mean: t - 2 }
    OUTFITS.push(outfit(d, ['coat', 'pants', 'shoes']))
  })
  // 中間の3日（15〜17℃）: t-shirt の上に jacket（Tシャツはインナー使い）
  const midTemps = [15, 16, 17]
  midTemps.forEach((t, i) => {
    const d = `2025-04-0${i + 1}`
    WEATHER[d] = { max: t, min: t - 5, mean: t - 2 }
    OUTFITS.push(outfit(d, ['jacket', 't-shirt', 'pants', 'shoes']))
  })
  // 暑い日6日（22〜32℃）: Tシャツ一枚
  const hotTemps = [22, 24, 26, 28, 30, 32]
  hotTemps.forEach((t, i) => {
    const d = `2025-07-0${i + 1}`
    WEATHER[d] = { max: t, min: t - 5, mean: t - 2 }
    OUTFITS.push(outfit(d, ['t-shirt', 'pants', 'shoes']))
  })
  // 気象データが無い日のコーデ（スキップされるべき）
  OUTFITS.push(outfit('2025-12-31', ['coat', 'shoes']))

  return { WEATHER, OUTFITS }
})

vi.mock('../useData', () => ({ outfits: OUTFITS as unknown as Outfit[] }))
vi.mock('../../data/weather.json', () => ({ default: WEATHER }))

import {
  SKY_ORDER,
  analyzeCategory,
  doyToMMDD,
  isLayeredCategory,
  labelOf,
  latestWeatherDate,
  seasonForecast,
  skyOf,
  todayDoy,
  type SeasonalAnalysis,
} from '../weather'

describe('skyOf: WMO weather_code → 天気カテゴリ', () => {
  it('null / undefined は判定不能で null', () => {
    expect(skyOf(null)).toBeNull()
    expect(skyOf(undefined)).toBeNull()
  })

  it('0-1 は晴れ', () => {
    expect(skyOf(0)).toBe('sunny')
    expect(skyOf(1)).toBe('sunny')
  })

  it('2-3 と霧(45,48)はくもり', () => {
    expect(skyOf(2)).toBe('cloudy')
    expect(skyOf(3)).toBe('cloudy')
    expect(skyOf(45)).toBe('cloudy')
    expect(skyOf(48)).toBe('cloudy')
  })

  it('雪系（71-77, 85, 86）は雪', () => {
    for (const c of [71, 73, 75, 77, 85, 86]) expect(skyOf(c)).toBe('snow')
  })

  it('雨系（51-67, 80-82, 95以上）は雨', () => {
    for (const c of [51, 55, 61, 65, 67, 80, 81, 82, 95, 96, 99]) expect(skyOf(c)).toBe('rain')
  })

  it('未知のコードはくもりにフォールバック', () => {
    expect(skyOf(4)).toBe('cloudy')
    expect(skyOf(70)).toBe('cloudy')
  })

  it('SKY_ORDER は4カテゴリすべてを含む', () => {
    expect([...SKY_ORDER].sort()).toEqual(['cloudy', 'rain', 'snow', 'sunny'])
  })
})

describe('latestWeatherDate / todayDoy', () => {
  it('weather.json の最終日を返す', () => {
    expect(latestWeatherDate()).toBe('2025-07-06')
  })

  it('todayDoy は最終日の day-of-year（2025-07-06 = 187）', () => {
    expect(todayDoy()).toBe(31 + 28 + 31 + 30 + 31 + 30 + 6)
  })
})

describe('doyToMMDD', () => {
  it('day-of-year を MM/DD に変換する（非閏年基準）', () => {
    expect(doyToMMDD(1)).toBe('1/1')
    expect(doyToMMDD(31)).toBe('1/31')
    expect(doyToMMDD(32)).toBe('2/1')
    expect(doyToMMDD(60)).toBe('3/1') // 31 + 28 + 1
    expect(doyToMMDD(365)).toBe('12/31')
  })
})

describe('labelOf / isLayeredCategory', () => {
  it('既知カテゴリは日本語ラベル、未知はそのまま', () => {
    expect(labelOf('coat')).toBe('コート')
    expect(labelOf('t-shirt')).toBe('半袖（Tシャツ）')
    expect(labelOf('unknown-cat')).toBe('unknown-cat')
  })

  it('レイヤー対象カテゴリの判定', () => {
    expect(isLayeredCategory('coat')).toBe(true)
    expect(isLayeredCategory('t-shirt')).toBe(true)
    expect(isLayeredCategory('shoes')).toBe(false)
    expect(isLayeredCategory('pants')).toBe(false)
  })
})

describe('analyzeCategory: ロジスティック回帰による衣替え分析', () => {
  it('寒い日にだけ着るカテゴリ（coat）は direction=cold で境界温度が着用/非着用の間に入る', () => {
    const a = analyzeCategory('coat')
    expect(a).not.toBeNull()
    expect(a!.direction).toBe('cold')
    expect(a!.wornCount).toBe(6)
    // 着用 2〜12℃ / 非着用 15〜32℃ → 境界はその間（実測 ≈13.7℃）
    expect(a!.threshold).not.toBeNull()
    expect(a!.threshold!).toBeGreaterThan(12)
    expect(a!.threshold!).toBeLessThan(15)
    expect(a!.thresholdReliable).toBe(true)
    expect(a!.tempRange).toEqual({ min: 2, max: 32 })
    expect(a!.wornAvg).toBe(7) // (2+4+6+8+10+12)/6
    expect(a!.notWornAvg).toBeCloseTo(23.3, 1)
  })

  it('coat の着用確率は気温に対して単調減少し、境界で約50%になる', () => {
    const a = analyzeCategory('coat')!
    expect(a.prob(0)).toBeGreaterThan(0.9)
    expect(a.prob(32)).toBeLessThan(0.1)
    expect(a.prob(a.threshold!)).toBeCloseTo(0.5, 5)
    for (let t = 0; t < 32; t += 2) {
      expect(a.prob(t)).toBeGreaterThan(a.prob(t + 2))
    }
  })

  it('暑い日にだけ着るカテゴリ（t-shirt）は direction=warm', () => {
    const a = analyzeCategory('t-shirt')
    expect(a).not.toBeNull()
    expect(a!.direction).toBe('warm')
    // 一枚で着たのは暑い6日だけ（春の3日はジャケットの下＝インナー使いで除外）
    expect(a!.wornCount).toBe(6)
    // 着用 22〜32℃ / 非着用 2〜17℃ → 境界はその間（実測 ≈19.5℃）
    expect(a!.threshold!).toBeGreaterThan(17)
    expect(a!.threshold!).toBeLessThan(22)
    expect(a!.prob(30)).toBeGreaterThan(0.9)
    expect(a!.prob(5)).toBeLessThan(0.1)
  })

  it('外側にレイヤーがある日は着用と数えない（jacket は着用日3日 < 6 で null）', () => {
    // jacket は春の3日しか最外で着ていない → データ不足
    expect(analyzeCategory('jacket')).toBeNull()
  })

  it('着用日が6日未満なら null（データ不足）', () => {
    expect(analyzeCategory('cardigan')).toBeNull() // 一度も着ていない
    expect(analyzeCategory('boots')).toBeNull()
  })

  it('毎日着るカテゴリ（shoes）は傾きが立たず threshold=null・確率はほぼ一定', () => {
    const a = analyzeCategory('shoes')
    expect(a).not.toBeNull()
    expect(a!.wornCount).toBe(15) // 気象データのある全日
    expect(a!.threshold).toBeNull()
    expect(a!.thresholdReliable).toBe(false)
    // 全ラベル=1 なので確率は気温によらず高い定数に収束する
    expect(a!.prob(0)).toBeCloseTo(a!.prob(30), 5)
    expect(a!.prob(15)).toBeGreaterThan(0.9)
  })

  it('気象データの無い日はサンプルから除外される（points に現れない）', () => {
    const a = analyzeCategory('coat')!
    expect(a.points.some((p) => p.date === '2025-12-31')).toBe(false)
    expect(a.points).toHaveLength(6)
    expect(a.points.every((p) => p.worn)).toBe(true)
    expect(a.points.every((p) => p.year === 2025)).toBe(true)
  })
})

describe('seasonForecast: シーズン開始日の年次抽出', () => {
  const mkAnalysis = (
    direction: 'cold' | 'warm',
    dates: string[],
  ): SeasonalAnalysis => ({
    category: 'coat',
    direction,
    threshold: 10,
    thresholdReliable: true,
    tempRange: { min: 0, max: 30 },
    prob: () => 0.5,
    wornAvg: 5,
    notWornAvg: 20,
    wornCount: dates.length,
    points: dates.map((date) => ({
      date,
      doy: 0, // seasonForecast は date から doy を再計算するので未使用
      year: Number(date.slice(0, 4)),
      temp: 10,
      worn: true,
    })),
  })

  it('cold系は8月以降の初着用をシーズンインとする（1月の着用は前シーズンの残り）', () => {
    const f = seasonForecast(
      mkAnalysis('cold', [
        '2023-01-15', // 8月より前 → 除外
        '2023-11-05',
        '2023-10-01', // ← 2023 の最初
        '2024-09-15',
        '2025-02-01', // 8月以降なし → null
      ]),
    )
    expect(f.direction).toBe('cold')
    expect(f.label).toBe('コート')
    expect(f.perYear).toEqual([
      { year: 2023, firstDate: '2023-10-01', doy: 274 },
      { year: 2024, firstDate: '2024-09-15', doy: 259 }, // 2024は閏年
      { year: 2025, firstDate: null, doy: null },
    ])
    // avg = round((274 + 259) / 2) = 267
    expect(f.avgDoy).toBe(267)
    expect(f.predictedDoy).toBe(267)
  })

  it('warm系は3月以降の初着用をシーズンインとする', () => {
    const f = seasonForecast(
      mkAnalysis('warm', ['2024-01-10', '2024-04-20', '2024-06-01']),
    )
    expect(f.perYear).toEqual([
      { year: 2024, firstDate: '2024-04-20', doy: 31 + 29 + 31 + 20 },
    ])
    expect(f.avgDoy).toBe(111)
  })

  it('シーズン内の着用が1年も無ければ avgDoy は null', () => {
    const f = seasonForecast(mkAnalysis('cold', ['2024-03-01', '2024-05-10']))
    expect(f.perYear).toEqual([{ year: 2024, firstDate: null, doy: null }])
    expect(f.avgDoy).toBeNull()
    expect(f.predictedDoy).toBeNull()
  })
})
