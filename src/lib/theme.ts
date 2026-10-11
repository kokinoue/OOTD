import { useCallback, useEffect, useState } from 'react'

// 表示テーマ。auto は端末の設定（prefers-color-scheme）に追従する。
// 初回描画前のちらつきを防ぐため、index.html のインラインスクリプトも同じキー・同じ判定で
// html.dark を付けている。ここを変えるときは両方そろえること。
export const THEME_PREFS = ['light', 'dark', 'auto'] as const
export type ThemePref = (typeof THEME_PREFS)[number]
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ootd-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

// ブラウザUI（アドレスバー等）を背景色になじませる。styles.css の --bg と同じ値。
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#fafafa', dark: '#0e0e0e' }

export function parseThemePref(stored: string | null): ThemePref {
  return stored === 'light' || stored === 'dark' ? stored : 'auto'
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'auto') return systemDark ? 'dark' : 'light'
  return pref
}

const readPref = (): ThemePref => {
  try {
    return parseThemePref(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

const systemDark = () => window.matchMedia(DARK_QUERY).matches

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  // 色のフェードは styles.css の @property + transition が担う
  root.classList.toggle('dark', theme === 'dark')
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref)

  useEffect(() => {
    const apply = () => applyTheme(resolveTheme(pref, systemDark()))
    apply()
    if (pref !== 'auto') return
    const mql = window.matchMedia(DARK_QUERY)
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [pref])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    try {
      if (next === 'auto') window.localStorage.removeItem(THEME_STORAGE_KEY)
      else window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // ストレージが使えなくても、このタブ内では選択が効く。
    }
  }, [])

  return { pref, setPref }
}
