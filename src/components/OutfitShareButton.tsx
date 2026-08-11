import { useEffect, useRef, useState } from 'react'
import { fmtDate } from '../lib/useData'
import { useI18n } from '../lib/i18n'
import { shareUrl } from '../lib/share'
import type { Outfit } from '../types'

export default function OutfitShareButton({ outfit }: { outfit: Outfit }) {
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<number>()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flash = (next: 'copied' | 'error') => {
    setState(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2500)
  }

  const onShare = async () => {
    const result = await shareUrl({
      title: `${fmtDate(outfit.date)} — ${t('出勤服アーカイブ')}`,
      text: outfit.title,
      url: window.location.href,
    })
    if (result === 'copied') flash('copied')
    if (result === 'error') flash('error')
  }

  return (
    <span className="outfit-share">
      <button
        className="chip outfit-share-btn jp"
        onClick={onShare}
        title={t('このコーデのリンクを共有')}
      >
        <span aria-hidden="true">↗</span> {t('共有')}
      </button>
      <span
        className={state === 'error' ? 'outfit-share-msg error jp' : 'outfit-share-msg jp'}
        aria-live="polite"
      >
        {state === 'copied'
          ? t('リンクをコピーしました')
          : state === 'error'
            ? t('コピーできませんでした')
            : ''}
      </span>
    </span>
  )
}
