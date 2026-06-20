import { useCallback, useRef, useState } from 'react'
import splitsJson from '../data/splits.json'
import { READONLY } from './env'
import type { SplitsFile } from '../types'

const KEY = 'fits-splits-v1'

// ビルドに焼き込まれた確定編集（公開サイトはこれを表示する）
const baked = (): SplitsFile => splitsJson as SplitsFile

// dev は localStorage を下敷きに編集を継続する（overrides と同じ挙動）。
// vite.config.ts が splits.json を監視除外しているため、リロード時に Vite は古い
// モジュールを返す。localStorage を真実として読み直すことでリロード後も編集が残る。
function load(): SplitsFile {
  if (READONLY) return baked() // 公開ビルドは焼き込み済みデータのみ
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return baked() // 初回は焼き込み済みを下敷きに編集開始
    return { ...baked(), ...(JSON.parse(raw) as Partial<SplitsFile>) }
  } catch {
    return baked()
  }
}

const INITIAL: SplitsFile = load()

/** 個体分割の編集。状態はReactで持ち、devサーバー経由で src/data/splits.json に書き戻す */
export function useSplits() {
  const [splits, setSplits] = useState<SplitsFile>(INITIAL)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<SplitsFile>(INITIAL)

  const persist = useCallback((next: SplitsFile) => {
    if (READONLY) return // 公開ビルドは保存しない（編集UIも隠れている）
    latest.current = next
    // リロードしても残るよう localStorage にも即時保存（ファイル書き戻しはデバウンス）
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // localStorage が使えない環境ではファイル書き戻しのみに委ねる
    }
    if (timer.current) clearTimeout(timer.current)
    setSaveState('saving')
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/splits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(latest.current),
        })
        if (!res.ok) throw new Error(await res.text())
        setSaveState('idle')
      } catch {
        setSaveState('error')
      }
    }, 400)
  }, [])

  const mutate = useCallback(
    (fn: (draft: SplitsFile) => void) => {
      setSplits((prev) => {
        const next = structuredClone(prev)
        fn(next)
        persist(next)
        return next
      })
    },
    [persist],
  )

  /** baseId/outfitKey の付け替え（moves）を1件消す。空になったら baseId ごと削除 */
  const clearMove = (draft: SplitsFile, baseId: string, outfitKey: string) => {
    const m = draft.moves?.[baseId]
    if (!m) return
    delete m[outfitKey]
    if (Object.keys(m).length === 0) delete draft.moves![baseId]
  }

  /** outfitKey の baseId 着用を subKey の個体に割り当てる（null で未分類に戻す） */
  const assign = useCallback(
    (baseId: string, outfitKey: string, subKey: string | null) => {
      mutate((draft) => {
        clearMove(draft, baseId, outfitKey) // 個体を選び直したら付け替えは解除
        const entry = draft.items[baseId]
        if (!entry) return
        for (const sub of entry.subs) {
          sub.outfits = sub.outfits.filter((k) => k !== outfitKey)
        }
        if (subKey != null) {
          const target = entry.subs.find((s) => s.key === subKey)
          target?.outfits.push(outfitKey)
        }
      })
    },
    [mutate],
  )

  /** outfitKey の baseId 着用だけを別アイテム targetId へ付け替える（null で解除＝元の判定に戻す） */
  const moveOutfit = useCallback(
    (baseId: string, outfitKey: string, targetId: string | null) => {
      mutate((draft) => {
        if (targetId == null) {
          clearMove(draft, baseId, outfitKey)
          return
        }
        // 個体割り当て(subs)はそのまま残す。解決時に moves が優先されるため二重計上は起きず、
        // 「元に戻す」で元の個体に戻れる
        const moves = (draft.moves ??= {})
        ;(moves[baseId] ??= {})[outfitKey] = targetId
      })
    },
    [mutate],
  )

  /** 新しい個体を作って outfitKey を割り当てる */
  const createSub = useCallback(
    (baseId: string, label: string, outfitKey: string) => {
      const trimmed = label.trim()
      if (!trimmed) return
      mutate((draft) => {
        clearMove(draft, baseId, outfitKey) // 個体を作って割り当てたら付け替えは解除
        const entry = (draft.items[baseId] ??= { subs: [] })
        for (const sub of entry.subs) {
          sub.outfits = sub.outfits.filter((k) => k !== outfitKey)
        }
        let key = `u-${trimmed
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 24)}`
        while (entry.subs.some((s) => s.key === key)) key += '2'
        entry.subs.push({ key, label: trimmed, outfits: [outfitKey] })
        // 新規分割したアイテムはnoSplitリストから外す
        if (draft.noSplit) draft.noSplit = draft.noSplit.filter((id) => id !== baseId)
      })
    },
    [mutate],
  )

  return { splits, assign, createSub, moveOutfit, saveState }
}
