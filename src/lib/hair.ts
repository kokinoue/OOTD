import type { HairFile, HairTag } from '../types'

/** 髪タグの3軸。UI のラベルとフィルタ列の並び順を定義 */
export const HAIR_FIELDS = [
  { key: 'color', label: '髪色' },
  { key: 'style', label: '髪型' },
  { key: 'hat', label: '帽子' },
] as const

export type HairField = (typeof HAIR_FIELDS)[number]['key']

export const EMPTY_HAIR: HairTag = { color: null, style: null, hat: null }

/** auto と manual を合成した、表示・絞り込みに使う実効タグ（manual 優先） */
export function effectiveHair(file: HairFile, outfitKey: string): HairTag {
  return file.manual[outfitKey] ?? file.auto[outfitKey] ?? EMPTY_HAIR
}

/** タグが空（3軸すべて未設定）か */
export const isEmptyHair = (t: HairTag) => !t.color && !t.style && !t.hat

export type HairFacet = { field: HairField; values: { value: string; count: number }[] }

/**
 * 全コーデの実効タグから、軸ごとの値と件数を集計（チップ表示用）。
 * 値が1つも無い軸は除外する。件数の多い順、同数はラベル順。
 */
export function buildHairFacets(file: HairFile, outfitKeys: string[]): HairFacet[] {
  const counts: Record<HairField, Map<string, number>> = {
    color: new Map(),
    style: new Map(),
    hat: new Map(),
  }
  for (const key of outfitKeys) {
    const tag = effectiveHair(file, key)
    for (const { key: field } of HAIR_FIELDS) {
      const v = tag[field]
      if (v) counts[field].set(v, (counts[field].get(v) ?? 0) + 1)
    }
  }
  return HAIR_FIELDS.map(({ key: field }) => ({
    field,
    values: [...counts[field].entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  })).filter((f) => f.values.length > 0)
}
