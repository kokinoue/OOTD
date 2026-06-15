import { useSyncExternalStore } from 'react'
import overridesJson from '../data/overrides.json'
import { READONLY } from './env'
import type { Overrides } from '../types'

const KEY = 'fits-overrides-v1'

export const emptyOverrides = (): Overrides => ({
  renames: {},
  categories: {},
  merges: {},
  hidden: [],
  colors: {},
})

// ビルドに焼き込まれた確定編集（公開サイトはこれを表示する）
const baked = (): Overrides => ({ ...emptyOverrides(), ...(overridesJson as Partial<Overrides>) })

let cache: Overrides = load()
const listeners = new Set<() => void>()

function load(): Overrides {
  // 公開ビルドは焼き込み済みデータのみ（localStorageは見ない）
  if (READONLY) return baked()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return baked() // 初回は焼き込み済みを下敷きに編集開始
    return { ...baked(), ...JSON.parse(raw) }
  } catch {
    return baked()
  }
}

function save(next: Overrides) {
  if (READONLY) return
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((fn) => fn())
}

export function useOverrides(): Overrides {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => cache,
  )
}

export const overrideActions = {
  rename(id: string, label: string) {
    const renames = { ...cache.renames }
    if (label.trim()) renames[id] = label.trim()
    else delete renames[id]
    save({ ...cache, renames })
  },
  setCategory(id: string, category: string) {
    const categories = { ...cache.categories }
    if (category.trim()) categories[id] = category.trim().toLowerCase()
    else delete categories[id]
    save({ ...cache, categories })
  },
  merge(fromId: string, toId: string) {
    if (fromId === toId) return
    // 循環を防ぐ: toId の解決先が fromId に到達するなら拒否
    let cur = toId
    const seen = new Set<string>()
    while (cache.merges[cur] && !seen.has(cur)) {
      seen.add(cur)
      cur = cache.merges[cur]
      if (cur === fromId) return
    }
    save({ ...cache, merges: { ...cache.merges, [fromId]: toId } })
  },
  unmerge(fromId: string) {
    const merges = { ...cache.merges }
    delete merges[fromId]
    save({ ...cache, merges })
  },
  /** 色の手動補正。'auto' で自動判定に戻す、'none' で「色なし」に固定、それ以外はバケツ名 */
  setColor(id: string, value: string) {
    const colors = { ...cache.colors }
    if (value === 'auto') delete colors[id]
    else colors[id] = value === 'none' ? '' : value
    save({ ...cache, colors })
  },
  toggleHidden(id: string) {
    const hidden = cache.hidden.includes(id)
      ? cache.hidden.filter((h) => h !== id)
      : [...cache.hidden, id]
    save({ ...cache, hidden })
  },
  importAll(data: Overrides) {
    save({ ...emptyOverrides(), ...data })
  },
  reset() {
    save(emptyOverrides())
  },
  /** 現在の編集を src/data/overrides.json に焼き込む（dev サーバー経由・公開用） */
  async bake(): Promise<boolean> {
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cache),
      })
      return res.ok
    } catch {
      return false
    }
  },
}

/** merges を辿って最終的なIDを返す（循環ガードつき） */
export function resolveId(id: string, merges: Record<string, string>): string {
  let cur = id
  const seen = new Set<string>()
  while (merges[cur] && !seen.has(cur)) {
    seen.add(cur)
    cur = merges[cur]
  }
  return cur
}
