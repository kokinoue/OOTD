import { useCallback, useRef, useState } from 'react'
import hairJson from '../data/hair.json'
import { READONLY } from './env'
import { isEmptyHair } from './hair'
import type { HairFile, HairTag } from '../types'

const KEY = 'fits-hair-v1'

// ビルドに焼き込まれた確定編集（公開サイトはこれを表示する）
const baked = (): HairFile => hairJson as HairFile

// dev は localStorage を下敷きに編集を継続する（overrides / splits と同じ挙動）。
// vite.config.ts が hair.json を監視除外しているため、リロード時に Vite は古い
// モジュールを返す。localStorage を真実として読み直すことでリロード後も編集が残る。
function load(): HairFile {
  if (READONLY) return baked() // 公開ビルドは焼き込み済みデータのみ
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return baked() // 初回は焼き込み済みを下敷きに編集開始
    return { ...baked(), ...(JSON.parse(raw) as Partial<HairFile>) }
  } catch {
    return baked()
  }
}

const INITIAL: HairFile = load()

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
