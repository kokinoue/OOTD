import { useEffect, useState } from 'react'

// 長い一覧（FITS / ITEMS）を深くスクロールしたとき、ワンタップで先頭へ戻すボタン。
// スマホでの回遊性向上が主目的だが、PC でも邪魔にならない位置に置く。
const SHOW_AFTER = 800

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      className={visible ? 'scroll-top visible' : 'scroll-top'}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="先頭へ戻る"
      title="先頭へ戻る"
    >
      ↑
    </button>
  )
}
