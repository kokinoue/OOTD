import { useEffect, useState } from 'react'
import { defaultFilters, type Filters, type View } from '../App'

// 画面状態を URL hash に載せる軽量ルーティング（A案: タブ＋主要フィルタ）。
// 例: #/fits?item=shoes%7Cjmweston%23black-loafer&year=2024&month=3&q=...&order=asc
//     #/items  #/weather
// フィルタは fits ビューのみ載せる。モーダルや ITEMS/衣替えの内部状態は対象外。

export type Route = { view: View; filters: Filters }

export function encodeHash({ view, filters }: Route): string {
  const p = new URLSearchParams()
  // URLSearchParams が | → %7C, # → %23 を自動エンコードするので itemId をそのまま入れて安全
  if (filters.itemId) p.set('item', filters.itemId)
  if (filters.hairColor) p.set('hcolor', filters.hairColor)
  if (filters.hairStyle) p.set('hstyle', filters.hairStyle)
  if (filters.hat) p.set('hat', filters.hat)
  if (filters.year != null) p.set('year', String(filters.year))
  if (filters.month != null) p.set('month', String(filters.month))
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (filters.q) p.set('q', filters.q)
  if (filters.order !== 'desc') p.set('order', filters.order)
  const qs = p.toString()
  return view === 'fits' && qs ? `/fits?${qs}` : `/${view}`
}

export function decodeHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query] = raw.split('?')
  const view: View = path === 'items' ? 'items' : path === 'weather' ? 'weather' : 'fits'
  const p = new URLSearchParams(query ?? '')
  const filters: Filters = {
    ...defaultFilters,
    itemId: p.get('item') || null,
    hairColor: p.get('hcolor') || null,
    hairStyle: p.get('hstyle') || null,
    hat: p.get('hat') || null,
    year: p.has('year') ? Number(p.get('year')) : null,
    month: p.has('month') ? Number(p.get('month')) : null,
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    q: p.get('q') ?? '',
    order: p.get('order') === 'asc' ? 'asc' : 'desc',
  }
  return { view, filters }
}

/** URL hash を単一の真実とする状態フック。リロード復元・共有・戻る/進むに対応 */
export function useHashRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => decodeHash(window.location.hash))

  useEffect(() => {
    // ブラウザの戻る/進む、URL の手編集に追従
    const onHash = () => {
      const next = decodeHash(window.location.hash)
      setRoute((cur) => (encodeHash(cur) === encodeHash(next) ? cur : next))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (next: Route) => {
    setRoute(next)
    const h = `#${encodeHash(next)}`
    // フィルタ変更で履歴を汚さないよう replaceState（リロード/共有には十分）
    if (window.location.hash !== h) history.replaceState(null, '', h)
  }

  return [route, navigate]
}
