import { useMemo } from 'react'
import outfitsJson from '../data/outfits.json'
import itemsJson from '../data/items.json'
import metaJson from '../data/meta.json'
import colorsJson from '../data/colors.json'
import type { ColorsFile, EffectiveItem, Item, Meta, Outfit, Overrides, SplitsFile } from '../types'
import { resolveId } from './store'

export const outfits = outfitsJson as Outfit[]
export const baseItems = itemsJson as Item[]
export const meta = metaJson as Meta

const colorsFile = colorsJson as ColorsFile
/** 自動判定した色: displayId -> 色バケツ名 */
const autoColors = colorsFile.items
/** UIの色フィルタ用バケツ定義（表示順） */
export const colorBuckets = colorsFile.buckets

const baseItemMap = new Map(baseItems.map((it) => [it.id, it]))

export type Data = {
  items: EffectiveItem[]
  itemMap: Map<string, EffectiveItem>
  /** outfit.key -> 解決済みアイテムIDのSet */
  outfitItemIds: Map<string, Set<string>>
  /** 元ID(base)+outfitKey から表示用IDへ（分割→統合の順に解決） */
  resolveItemId: (baseId: string, outfitKey: string) => string
  categories: { name: string; count: number }[]
  merged: {
    fromId: string
    fromLabel: string
    fromCategory: string
    toId: string
    toLabel: string
    toCategory: string
  }[]
}

/** 編集（個体分割 / rename / category / merge / hidden）を適用した表示用データを作る */
export function useData(ov: Overrides, splits: SplitsFile): Data {
  return useMemo(() => {
    // 個体分割: baseItemId -> (outfitKey -> subItemId)、subItemId -> サブラベル
    const splitAssign = new Map<string, Map<string, string>>()
    const subLabels = new Map<string, string>()
    for (const [baseId, def] of Object.entries(splits.items ?? {})) {
      const assign = new Map<string, string>()
      for (const sub of def.subs) {
        const subId = `${baseId}#${sub.key}`
        subLabels.set(subId, sub.label)
        for (const key of sub.outfits) assign.set(key, subId)
      }
      if (def.subs.length > 0) splitAssign.set(baseId, assign)
    }

    const baseInfoOf = (id: string): { category: string; label: string } => {
      const [baseId, subKey] = id.split('#')
      const base = baseItemMap.get(baseId)
      const category = base?.category ?? baseId.split('|')[0] ?? 'other'
      let label = base?.label ?? baseId.split('|')[1] ?? id
      if (subKey != null) {
        label = `${label} · ${subLabels.get(id) ?? subKey}`
      } else if (splitAssign.has(id)) {
        label = `${label} · 未分類`
      }
      return { category, label }
    }

    const resolveItemId = (baseId: string, outfitKey: string) => {
      // 1着用だけの付け替え（moves）が最優先。次に個体分割、最後に統合
      const moved = splits.moves?.[baseId]?.[outfitKey]
      const target = moved ?? splitAssign.get(baseId)?.get(outfitKey) ?? baseId
      return resolveId(target, ov.merges)
    }

    const outfitItemIds = new Map<string, Set<string>>()
    const countByItem = new Map<string, number>()
    const firstDate = new Map<string, string>()
    const lastDate = new Map<string, string>()
    const mergedFrom = new Map<string, string[]>()
    const repImage = new Map<string, { url: string; outfitKey: string }>()

    // outfits は publishAt 降順なので、最初に出会った着用が最新 = 代表サムネ
    for (const o of outfits) {
      const ids = new Set<string>()
      for (const baseId of o.itemIds) {
        const displayId = resolveItemId(baseId, o.key)
        ids.add(displayId)
        if (!repImage.has(displayId)) {
          const img = o.images.find((im) => im.itemIds.includes(baseId))
          if (img) repImage.set(displayId, { url: img.url, outfitKey: o.key })
        }
      }
      outfitItemIds.set(o.key, ids)
      for (const id of ids) {
        countByItem.set(id, (countByItem.get(id) ?? 0) + 1)
        if (!firstDate.has(id) || o.date < firstDate.get(id)!) firstDate.set(id, o.date)
        if (!lastDate.has(id) || o.date > lastDate.get(id)!) lastDate.set(id, o.date)
      }
    }

    for (const [fromId, _toId] of Object.entries(ov.merges)) {
      const to = resolveId(fromId, ov.merges)
      const from = baseInfoOf(fromId)
      const list = mergedFrom.get(to) ?? []
      list.push(ov.renames[fromId] ?? from.label)
      mergedFrom.set(to, list)
    }

    const hiddenSet = new Set(ov.hidden)
    const items: EffectiveItem[] = []
    for (const [id, count] of countByItem) {
      const base = baseInfoOf(id)
      // 色: 手動補正があれば優先（'' は「色なし」固定）、なければ自動判定
      const ovColor = ov.colors[id]
      const color = ovColor !== undefined ? ovColor || undefined : autoColors[id]
      items.push({
        id,
        category: ov.categories[id] ?? base.category,
        label: ov.renames[id] ?? base.label,
        count,
        firstDate: firstDate.get(id) ?? '',
        lastDate: lastDate.get(id) ?? '',
        hidden: hiddenSet.has(id),
        mergedFrom: mergedFrom.get(id) ?? [],
        rep: repImage.get(id),
        color,
      })
    }
    items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

    const catCount = new Map<string, number>()
    for (const it of items) {
      if (it.hidden) continue
      catCount.set(it.category, (catCount.get(it.category) ?? 0) + 1)
    }
    const categories = [...catCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const merged = Object.entries(ov.merges).map(([fromId, toId]) => {
      const finalTo = resolveId(fromId, ov.merges)
      const from = baseInfoOf(fromId)
      const to = baseInfoOf(finalTo)
      return {
        fromId,
        fromLabel: ov.renames[fromId] ?? from.label,
        fromCategory: ov.categories[fromId] ?? from.category,
        toId,
        toLabel: ov.renames[finalTo] ?? to.label,
        toCategory: ov.categories[finalTo] ?? to.category,
      }
    })

    return {
      items,
      itemMap: new Map(items.map((it) => [it.id, it])),
      outfitItemIds,
      resolveItemId,
      categories,
      merged,
    }
  }, [ov, splits])
}

export const fmtDate = (d: string) => d.replaceAll('-', '.')

/** note CDN の画像URLにリサイズパラメータを付ける */
export const thumb = (url: string, width: number) =>
  `${url}?fit=bounds&quality=85&width=${width}`
