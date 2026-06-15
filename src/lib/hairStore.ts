import { useCallback, useRef, useState } from 'react'
import hairJson from '../data/hair.json'
import { READONLY } from './env'
import { isEmptyHair } from './hair'
import type { HairFile, HairTag } from '../types'

const INITIAL: HairFile = hairJson as HairFile

/**
 * 髪タグの編集。AI推定（auto）はそのまま、手動修正（manual）だけを更新し
 * devサーバー経由で src/data/hair.json に書き戻す（splitsStore と同じ仕組み）。
 */
export function useHair() {
  const [hair, setHair] = useState<HairFile>(INITIAL)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<HairFile>(INITIAL)

  const persist = useCallback((next: HairFile) => {
    if (READONLY) return // 公開ビルドは保存しない（編集UIも隠れている）
    latest.current = next
    if (timer.current) clearTimeout(timer.current)
    setSaveState('saving')
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/hair', {
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

  /** outfitKey の髪タグを手動で上書きする。空タグなら manual から削除（＝AI推定に戻す） */
  const setHair_ = useCallback(
    (outfitKey: string, tag: HairTag) => {
      setHair((prev) => {
        const next = structuredClone(prev)
        if (isEmptyHair(tag)) delete next.manual[outfitKey]
        else next.manual[outfitKey] = tag
        persist(next)
        return next
      })
    },
    [persist],
  )

  return { hair, setHair: setHair_, saveState }
}
