import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { THEME_PREFS, type ThemePref, useTheme } from '../lib/theme'

const LABEL: Record<ThemePref, string> = {
  light: 'ライト表示に固定',
  dark: 'ダーク表示に固定',
  auto: '端末の設定に合わせる',
}

// ヘッダーの幅を食わないようアイコンで出す。意味は aria-label / title で補う。
const ICON: Record<ThemePref, ReactNode> = {
  light: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
      </g>
    </svg>
  ),
  dark: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7Z" fill="currentColor" />
    </svg>
  ),
  auto: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" />
    </svg>
  ),
}

// Light / Dark / Auto の3択。初期値は Auto（端末の設定に追従）。
export default function ThemeToggle() {
  const { t } = useI18n()
  const { pref, setPref } = useTheme()

  return (
    <div className="theme-toggle" role="radiogroup" aria-label={t('表示テーマ')}>
      {THEME_PREFS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={t(LABEL[value])}
          title={t(LABEL[value])}
          className={pref === value ? 'theme-toggle-btn active' : 'theme-toggle-btn'}
          onClick={() => setPref(value)}
        >
          {ICON[value]}
        </button>
      ))}
    </div>
  )
}
