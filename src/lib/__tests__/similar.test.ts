import { describe, expect, it, vi } from 'vitest'
import type { EffectiveItem, HairFile, Outfit } from '../../types'
import type { Data } from '../useData'

// similar.ts は module-level で実データ（outfits / colorBuckets / weather）を
// 読み込むため、フィクスチャに差し替えて純粋なスコア計算だけを検証する
const fx = vi.hoisted(() => {
  const outfit = (key: string, date: string, hasImage = true) => ({
    key,
    no: null,
    title: key,
    date,
    publishAt: `${date}T08:00:00+09:00`,
    like: 0,
    comment: '',
    noteUrl: '',
    images: hasImage
      ? [{ url: `https://img/${key}`, width: null, height: null, caption: '', itemIds: [] }]
      : [],
    itemIds: [],
  })
  return {
    outfits: [
      outfit('o-src', '2025-06-01'), // 基準コーデ
      outfit('o-share2', '2025-06-08'), // アイテム2つ共有
      outfit('o-share1', '2025-06-15'), // アイテム1つ共有
      outfit('o-cat', '2025-06-20'), // カテゴリのみ共有
      outfit('o-color', '2025-06-25'), // 色のみ共有
      outfit('o-hidden', '2025-11-20'), // 非表示アイテムのみ共有
      outfit('o-none', '2025-12-01'), // 何も共有しない（対極の季節）
      outfit('o-noimg', '2025-06-08', false), // 画像なし → 除外対象
      outfit('o-t1', '2025-03-01'), // 同点タイブレーク用
      outfit('o-t2', '2025-03-01'),
    ],
    colorBuckets: [
      { name: 'white', label: '白', swatch: '#ffffff' },
      { name: 'navy', label: 'ネイビー', swatch: '#001f3f' },
      { name: 'black', label: '黒', swatch: '#000000' },
    ],
    weather: {
      '2025-06-01': { max: 25, min: 18, mean: 21 },
      '2025-06-08': { max: 25, min: 18, mean: 21 },
    },
  }
})

vi.mock('../useData', () => ({ outfits: fx.outfits, colorBuckets: fx.colorBuckets }))
vi.mock('../weather', () => ({ weather: fx.weather }))

import { findSimilarOutfits } from '../similar'

const outfitsFx = fx.outfits as Outfit[]
const byKey = (key: string): Outfit => {
  const o = outfitsFx.find((x) => x.key === key)
  if (!o) throw new Error(`fixture not found: ${key}`)
  return o
}

const item = (
  id: string,
  category: string,
  label: string,
  opts: { color?: string; hidden?: boolean } = {},
): EffectiveItem => ({
  id,
  category,
  label,
  count: 1,
  firstDate: '2025-01-01',
  lastDate: '2025-12-01',
  hidden: opts.hidden ?? false,
  mergedFrom: [],
  color: opts.color,
})

const makeData = (items: EffectiveItem[], outfitItemIds: Record<string, string[]>): Data => ({
  items,
  itemMap: new Map(items.map((it) => [it.id, it])),
  outfitItemIds: new Map(Object.entries(outfitItemIds).map(([k, ids]) => [k, new Set(ids)])),
  resolveItemId: (baseId: string, _outfitKey: string) => baseId,
  categories: [],
  merged: [],
})

const items = [
  item('i1', 'tops', '白T', { color: 'white' }),
  item('i2', 'pants', 'デニム', { color: 'navy' }),
  item('i3', 'tops', '黒シャツ', { color: 'black' }),
  item('i4', 'shoes', '白スニーカー', { color: 'white' }),
  item('ihid', 'hat', '隠し帽子', { hidden: true }),
  item('i5', 'bag', 'バッグ'), // 色なし
]

const data = makeData(items, {
  'o-src': ['i1', 'i2', 'ihid'],
  'o-share2': ['i1', 'i2'],
  'o-share1': ['i1', 'i3'],
  'o-cat': ['i3'],
  'o-color': ['i4'],
  'o-hidden': ['ihid', 'i5'],
  'o-none': ['i5'],
  'o-noimg': ['i1', 'i2'],
  'o-t1': ['i2'],
  'o-t2': ['i2'],
})

const emptyHair: HairFile = { version: 1, auto: {}, manual: {} }
const src = byKey('o-src')

describe('findSimilarOutfits', () => {
  it('共有アイテム数 > カテゴリ/色/季節の順でランキングされる', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 10)
    expect(result.map((r) => r.outfit.key)).toEqual([
      'o-share2', // アイテム2つ共有（200点〜）
      'o-share1', // アイテム1つ共有 + カテゴリ/色/季節
      'o-t1', // アイテム1つ共有（季節が遠い）
      'o-t2',
      'o-hidden', // 非表示アイテム共有のみ（100点強）
      'o-cat', // カテゴリのみ
      'o-color', // 色のみ
    ])
  })

  it('自分自身は候補に含まれない', () => {
    const keys = findSimilarOutfits(src, data, emptyHair, 100).map((r) => r.outfit.key)
    expect(keys).not.toContain('o-src')
  })

  it('画像が無いコーデは除外される', () => {
    const keys = findSimilarOutfits(src, data, emptyHair, 100).map((r) => r.outfit.key)
    expect(keys).not.toContain('o-noimg')
  })

  it('スコアが付いても理由が無い候補は除外される', () => {
    // o-none: 共有なし・対極の季節（微小な seasonScore は付くが理由ゼロ）
    const keys = findSimilarOutfits(src, data, emptyHair, 100).map((r) => r.outfit.key)
    expect(keys).not.toContain('o-none')
  })

  it('デフォルトの limit は 6', () => {
    expect(findSimilarOutfits(src, data, emptyHair)).toHaveLength(6)
  })

  it('limit で件数を絞れる', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 2)
    expect(result.map((r) => r.outfit.key)).toEqual(['o-share2', 'o-share1'])
  })

  it('スコアの内訳が仕様どおりに合算される（o-share2）', () => {
    const top = findSimilarOutfits(src, data, emptyHair, 1)[0]
    // アイテム2つ共有 200 + カテゴリjaccard 1.0×30 + 色2つ 20
    // + 季節（7日差）10×(1−7/182.5) + 気温（同じ最高気温）10
    const expected = 200 + 30 + 20 + 10 * (1 - 7 / 182.5) + 10
    expect(top.score).toBe(Math.round(expected * 100) / 100) // 269.62
  })

  it('理由は最大3件で、アイテム一致が先頭に来る', () => {
    const top = findSimilarOutfits(src, data, emptyHair, 1)[0]
    expect(top.reasons).toEqual(['同じ白T', '同じデニム', 'topsあり'])
  })

  it('色一致の理由はバケツの表示ラベルになる', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 10)
    const colorMatch = result.find((r) => r.outfit.key === 'o-color')
    expect(colorMatch?.reasons).toContain('白')
  })

  it('非表示アイテムだけの一致は「同じアイテム」と表示され、スコアには乗る', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 10)
    const hiddenMatch = result.find((r) => r.outfit.key === 'o-hidden')
    expect(hiddenMatch).toBeDefined()
    expect(hiddenMatch!.reasons).toEqual(['同じアイテム'])
    expect(hiddenMatch!.score).toBeGreaterThanOrEqual(100)
    // ラベル（隠し帽子）は理由に出ない
    expect(hiddenMatch!.reasons.join()).not.toContain('隠し帽子')
  })

  it('同点はコーデkeyの昇順でタイブレークされる', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 10)
    const t1 = result.find((r) => r.outfit.key === 'o-t1')!
    const t2 = result.find((r) => r.outfit.key === 'o-t2')!
    expect(t1.score).toBe(t2.score)
    expect(result.indexOf(t1)).toBeLessThan(result.indexOf(t2))
  })

  it('アイテム情報が無いコーデ（空データ）では何もヒットしない', () => {
    // outfitItemIds に存在しないキー + どの候補とも季節が離れた日付
    const ghost: Outfit = { ...src, key: 'o-ghost', date: '2020-04-16' }
    expect(findSimilarOutfits(ghost, data, emptyHair, 100)).toEqual([])
  })

  it('髪タグ（manual）の一致がスコアと理由に反映される', () => {
    const hair: HairFile = {
      version: 1,
      auto: {},
      manual: {
        'o-src': { color: '黒', style: 'ショート', hat: 'キャップ' },
        'o-none': { color: '黒', style: 'ショート', hat: 'キャップ' },
      },
    }
    const result = findSimilarOutfits(src, data, hair, 100)
    const match = result.find((r) => r.outfit.key === 'o-none')
    expect(match).toBeDefined()
    expect(match!.reasons).toEqual(['髪色: 黒', '髪型: ショート', '帽子: キャップ'])
    // 髪 3+3+4=10 点 + 微小な季節スコア
    expect(match!.score).toBe(Math.round((10 + 10 * (1 - 182 / 182.5)) * 100) / 100)
  })

  it('髪タグが未設定同士（null 同士）は一致扱いにならない', () => {
    const result = findSimilarOutfits(src, data, emptyHair, 10)
    for (const r of result) {
      expect(r.reasons.some((reason) => reason.startsWith('髪'))).toBe(false)
      expect(r.reasons.some((reason) => reason.startsWith('帽子'))).toBe(false)
    }
  })
})
