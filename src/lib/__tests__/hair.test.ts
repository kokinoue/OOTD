import { describe, expect, it } from 'vitest'
import { buildHairFacets, effectiveHair, EMPTY_HAIR, isEmptyHair } from '../hair'
import type { HairFile, HairTag } from '../../types'

const tag = (
  color: string | null = null,
  style: string | null = null,
  hat: string | null = null,
): HairTag => ({ color, style, hat })

const file = (auto: Record<string, HairTag> = {}, manual: Record<string, HairTag> = {}): HairFile => ({
  version: 1,
  auto,
  manual,
})

describe('effectiveHair', () => {
  it('manual が auto より優先される', () => {
    const f = file({ k: tag('茶', 'ロング') }, { k: tag('黒', 'ショート') })
    expect(effectiveHair(f, 'k')).toEqual(tag('黒', 'ショート'))
  })

  it('manual はタグ全体で置き換える（フィールド単位で auto にフォールバックしない）', () => {
    const f = file({ k: tag('茶', 'ショート', 'キャップ') }, { k: tag('黒', null, null) })
    expect(effectiveHair(f, 'k')).toEqual(tag('黒', null, null))
  })

  it('manual が無ければ auto を返す', () => {
    const f = file({ k: tag('茶') })
    expect(effectiveHair(f, 'k')).toEqual(tag('茶'))
  })

  it('どちらにも無いキーは空タグを返す', () => {
    expect(effectiveHair(file(), 'unknown')).toEqual({ color: null, style: null, hat: null })
  })
})

describe('isEmptyHair', () => {
  it('3軸すべて null なら true', () => {
    expect(isEmptyHair(EMPTY_HAIR)).toBe(true)
    expect(isEmptyHair(tag())).toBe(true)
  })

  it('どれか1軸でも値があれば false', () => {
    expect(isEmptyHair(tag('黒'))).toBe(false)
    expect(isEmptyHair(tag(null, 'ショート'))).toBe(false)
    expect(isEmptyHair(tag(null, null, 'ハット'))).toBe(false)
  })
})

describe('buildHairFacets', () => {
  const f = file(
    {
      k1: tag('black', 'short'),
      k2: tag('black'),
      k3: tag('brown', 'short'), // manual で上書きされる
      k5: tag('brown'),
    },
    {
      k3: tag('black', 'perm'),
    },
  )

  it('実効タグ（manual 優先）で軸ごとに件数を集計する', () => {
    const facets = buildHairFacets(f, ['k1', 'k2', 'k3', 'k5'])
    const color = facets.find((x) => x.field === 'color')
    // k3 は manual の black が数えられ、auto の brown は数えられない
    expect(color?.values).toEqual([
      { value: 'black', count: 3 },
      { value: 'brown', count: 1 },
    ])
  })

  it('値が1つも無い軸（hat）は除外される', () => {
    const facets = buildHairFacets(f, ['k1', 'k2', 'k3', 'k5'])
    expect(facets.map((x) => x.field)).toEqual(['color', 'style'])
  })

  it('件数の多い順、同数は値の辞書順でソートする', () => {
    const facets = buildHairFacets(f, ['k1', 'k2', 'k3', 'k5'])
    const style = facets.find((x) => x.field === 'style')
    // short(k1) と perm(k3) が1件ずつ → 辞書順で perm が先
    expect(style?.values).toEqual([
      { value: 'perm', count: 1 },
      { value: 'short', count: 1 },
    ])
  })

  it('渡した outfitKeys のみ集計対象になる', () => {
    const facets = buildHairFacets(f, ['k1'])
    expect(facets).toEqual([
      { field: 'color', values: [{ value: 'black', count: 1 }] },
      { field: 'style', values: [{ value: 'short', count: 1 }] },
    ])
  })

  it('未知のキーは空タグ扱いで何も加算しない', () => {
    expect(buildHairFacets(f, ['nope', 'nada'])).toEqual([])
  })

  it('outfitKeys が空なら空配列を返す', () => {
    expect(buildHairFacets(f, [])).toEqual([])
  })
})
