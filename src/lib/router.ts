import { useEffect, useState } from 'react'
import { defaultFilters, defaultItemsFilters, type Filters, type ItemsFilters, type View } from '../App'

// 画面状態を URL hash に載せる軽量ルーティング（A案: タブ＋主要フィルタ）。
// 例: #/fits?item=shoes%7Cjmweston%23black-loafer&year=2024&month=3&q=...&order=asc
//     #/items?q=loafer&cat=shoes&color=black&sort=recent
//     #/closet  #/palette  #/weather
// FITS は Filters、ITEMS は ItemsFilters をそれぞれのパス配下に載せる。衣替え等の内部状態は対象外。

export type Route = { view: View; filters: Filters; itemsFilters: ItemsFilters }

export function encodeHash({ view, filters, itemsFilters }: Route): string {
  if (view === 'items') {
    const ip = new URLSearchParams()
    if (itemsFilters.q) ip.set('q', itemsFilters.q)
    if (itemsFilters.cat !== 'all') ip.set('cat', itemsFilters.cat)
    if (itemsFilters.color !== 'all') ip.set('color', itemsFilters.color)
    if (itemsFilters.sort !== 'count') ip.set('sort', itemsFilters.sort)
    const iqs = ip.toString()
    return iqs ? `/items?${iqs}` : '/items'
  }
  const p = new URLSearchParams()
  // URLSearchParams が | → %7C, # → %23 を自動エンコードするので itemId をそのまま入れて安全
  if (filters.itemId) p.set('item', filters.itemId)
  if (filters.itemIds.length > 0) p.set('items', filters.itemIds.join(','))
  if (filters.hairColor) p.set('hcolor', filters.hairColor)
  if (filters.hairStyle) p.set('hstyle', filters.hairStyle)
  if (filters.hat) p.set('hat', filters.hat)
  if (filters.year != null) p.set('year', String(filters.year))
  if (filters.month != null) p.set('month', String(filters.month))
  if (filters.from) p.set('from', filters.from)
  if (filters.to) p.set('to', filters.to)
  if (filters.q) p.set('q', filters.q)
  if (filters.sort !== 'new') p.set('sort', filters.sort)
  if (filters.anniv) p.set('anniv', '1')
  const qs = p.toString()
  return view === 'fits' && qs ? `/fits?${qs}` : `/${view}`
}

export function decodeHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query] = raw.split('?')
  const view: View =
    path === 'items'
      ? 'items'
      : path === 'closet'
        ? 'closet'
        : path === 'palette'
          ? 'palette'
          : path === 'weather'
            ? 'weather'
            : path === 'today'
              ? 'today'
              : path === 'game'
                ? 'game'
                : path === 'memory'
                  ? 'memory'
                  : path === 'duel'
                    ? 'duel'
                    : 'fits'
  const p = new URLSearchParams(query ?? '')

  // items パスのクエリは ItemsFilters に、それ以外（fits）は Filters に振り分ける。
  // q / sort はどちらのパスでも使うため、パスごとに読み分けて取り違えを防ぐ。
  const itemsSort = p.get('sort')
  const itemsFilters: ItemsFilters =
    view === 'items'
      ? {
          q: p.get('q') ?? '',
          cat: p.get('cat') || 'all',
          color: p.get('color') || 'all',
          sort: itemsSort === 'recent' || itemsSort === 'name' ? itemsSort : 'count',
        }
      : { ...defaultItemsFilters }

  const sortParam = p.get('sort')
  const filters: Filters =
    view === 'fits'
      ? {
          ...defaultFilters,
          itemId: p.get('item') || null,
          itemIds: (p.get('items') ?? '').split(',').filter(Boolean),
          hairColor: p.get('hcolor') || null,
          hairStyle: p.get('hstyle') || null,
          hat: p.get('hat') || null,
          year: p.has('year') ? Number(p.get('year')) : null,
          month: p.has('month') ? Number(p.get('month')) : null,
          from: p.get('from') ?? '',
          to: p.get('to') ?? '',
          q: p.get('q') ?? '',
          sort: sortParam === 'old' || sortParam === 'like' ? sortParam : 'new',
          anniv: p.get('anniv') === '1',
        }
      : { ...defaultFilters }
  return { view, filters, itemsFilters }
}

type NavigateOptions = {
  replace?: boolean
}

/** URL hash を単一の真実とする状態フック。リロード復元・共有・戻る/進むに対応 */
export function useHashRoute(): [Route, (next: Route, options?: NavigateOptions) => void] {
  const [route, setRoute] = useState<Route>(() => decodeHash(window.location.hash))

  useEffect(() => {
    // ブラウザの戻る/進む、URL の手編集に追従
    const onRouteChange = () => {
      const next = decodeHash(window.location.hash)
      setRoute((cur) => (encodeHash(cur) === encodeHash(next) ? cur : next))
    }
    window.addEventListener('hashchange', onRouteChange)
    window.addEventListener('popstate', onRouteChange)
    return () => {
      window.removeEventListener('hashchange', onRouteChange)
      window.removeEventListener('popstate', onRouteChange)
    }
  }, [])

  const navigate = (next: Route, options: NavigateOptions = {}) => {
    setRoute(next)
    const h = `#${encodeHash(next)}`
    if (window.location.hash !== h) {
      if (options.replace) history.replaceState(null, '', h)
      else history.pushState(null, '', h)
    }
  }

  return [route, navigate]
}
