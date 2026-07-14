import { useEffect, useRef, useState } from 'react'

// ゲーム別OGPを持つ静的ページ（public/game/<name>/）のURLを共有する。
// 共有シート非対応の環境ではクリップボードへのコピーで代替する。
type Props = {
  game: 'memory' | 'duel' | 'platform' | 'tower'
  title: string
}

export default function GameShareButton({ game, title }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flash = (s: 'copied' | 'error') => {
    setState(s)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2500)
  }

  const onShare = async () => {
    const url = `${location.origin}${import.meta.env.BASE_URL}game/${game}/`
    const data = { title: `${title} — 出勤服アーカイブ GAME`, url }
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean }
    if (nav.canShare?.(data)) {
      try {
        await nav.share(data)
        return
      } catch (err) {
        // ユーザーが共有シートを閉じただけなら何もしない
        if (err instanceof DOMException && err.name === 'AbortError') return
        // それ以外はコピーへフォールバック
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      flash('copied')
    } catch {
      flash('error')
    }
  }

  return (
    <span className="game-share">
      {state === 'copied' && <span className="game-share-msg jp">リンクをコピーしました</span>}
      {state === 'error' && <span className="game-share-msg error jp">コピーできませんでした</span>}
      <button className="game-share-btn jp" onClick={onShare} title="このゲームのリンクを共有">
        共有
      </button>
    </span>
  )
}
