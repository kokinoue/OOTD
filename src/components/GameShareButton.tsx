import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { shareUrl } from '../lib/share'

// ゲーム別OGPを持つ静的ページ（public/game/<name>/）のURLを共有する。
// 共有シート非対応の環境ではクリップボードへのコピーで代替する。
type Props = {
  game: 'memory' | 'duel' | 'platform' | 'tower' | 'chari' | 'quiz'
  title: string
}

export default function GameShareButton({ game, title }: Props) {
  const { t } = useI18n()
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
    const data = { title: `${t(title)} — ${t('出勤服アーカイブ')} GAME`, url }
    const result = await shareUrl(data)
    if (result === 'copied') flash('copied')
    if (result === 'error') flash('error')
  }

  return (
    <span className="game-share">
      {state === 'copied' && <span className="game-share-msg jp">{t('リンクをコピーしました')}</span>}
      {state === 'error' && <span className="game-share-msg error jp">{t('コピーできませんでした')}</span>}
      <button className="game-share-btn jp" onClick={onShare} title={t('このゲームのリンクを共有')}>
        {t('共有')}
      </button>
    </span>
  )
}
