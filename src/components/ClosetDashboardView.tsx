import { useEffect, useMemo, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import { regionBackgroundStyle } from '../lib/regions'
import type { EffectiveItem } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const RECENT_DAYS = 90
const ACTIVE_DAYS = 180
const DORMANT_DAYS = 365

type ItemStat = {
  item: EffectiveItem
  recentCount: number
  activeCount: number
  yearCount: number
  daysSince: number
  wearsPerYear: number
}

type CategoryStat = {
  name: string
  itemCount: number
  activeItems: number
  dormantItems: number
  recentWears: number
  usageRate: number
}

type Sort = 'idle' | 'recent' | 'staple' | 'dormant'

type Props = {
  data: Data
  onShowFits: (itemId: string) => void
}

const parseDate = (date: string) => new Date(`${date}T00:00:00Z`).getTime()
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((parseDate(to) - parseDate(from)) / MS_PER_DAY))
const pct = (n: number) => `${Math.round(n * 100)}%`

export default function ClosetDashboardView({ data, onShowFits }: Props) {
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<Sort>('idle')

  const snapshot = useMemo(() => {
    const asOf = outfits.reduce((max, o) => (o.date > max ? o.date : max), '')
    const year = Number(asOf.slice(0, 4))
    const recentFrom = new Date(parseDate(asOf) - RECENT_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10)
    const activeFrom = new Date(parseDate(asOf) - ACTIVE_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10)
    const itemStats = new Map<string, ItemStat>()

    for (const item of data.items) {
      if (item.hidden) continue
      const spanDays = Math.max(1, daysBetween(item.firstDate, asOf) + 1)
      itemStats.set(item.id, {
        item,
        recentCount: 0,
        activeCount: 0,
        yearCount: 0,
        daysSince: daysBetween(item.lastDate, asOf),
        wearsPerYear: item.count / (spanDays / 365),
      })
    }

    for (const outfit of outfits) {
      const ids = data.outfitItemIds.get(outfit.key)
      if (!ids) continue
      for (const id of ids) {
        const stat = itemStats.get(id)
        if (!stat) continue
        if (outfit.date >= recentFrom) stat.recentCount += 1
        if (outfit.date >= activeFrom) stat.activeCount += 1
        if (Number(outfit.date.slice(0, 4)) === year) stat.yearCount += 1
      }
    }

    const stats = [...itemStats.values()]
    const categoryMap = new Map<string, CategoryStat>()
    for (const stat of stats) {
      const name = stat.item.category
      const cur =
        categoryMap.get(name) ??
        ({
          name,
          itemCount: 0,
          activeItems: 0,
          dormantItems: 0,
          recentWears: 0,
          usageRate: 0,
        } satisfies CategoryStat)
      cur.itemCount += 1
      cur.recentWears += stat.recentCount
      if (stat.activeCount > 0) cur.activeItems += 1
      if (stat.daysSince >= DORMANT_DAYS) cur.dormantItems += 1
      categoryMap.set(name, cur)
    }
    const categories = [...categoryMap.values()]
      .map((c) => ({ ...c, usageRate: c.itemCount ? c.activeItems / c.itemCount : 0 }))
      .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name))

    const visibleCount = stats.length
    const activeCount = stats.filter((s) => s.activeCount > 0).length
    const dormantCount = stats.filter((s) => s.daysSince >= DORMANT_DAYS).length
    const recentWears = stats.reduce((sum, s) => sum + s.recentCount, 0)
    const firstThisYear = stats.filter((s) => s.item.firstDate.startsWith(String(year))).length

    return {
      asOf,
      year,
      stats,
      categories,
      visibleCount,
      activeCount,
      dormantCount,
      recentWears,
      firstThisYear,
      usageRate: visibleCount ? activeCount / visibleCount : 0,
    }
  }, [data])

  useEffect(() => {
    if (category !== 'all' && !snapshot.categories.some((c) => c.name === category)) {
      setCategory('all')
    }
  }, [category, snapshot.categories])

  const filteredStats = useMemo(() => {
    const list =
      category === 'all'
        ? snapshot.stats
        : snapshot.stats.filter((stat) => stat.item.category === category)
    const sorted = [...list]
    if (sort === 'recent') {
      sorted.sort((a, b) => b.recentCount - a.recentCount || b.item.count - a.item.count)
    } else if (sort === 'staple') {
      sorted.sort((a, b) => b.wearsPerYear - a.wearsPerYear || b.item.count - a.item.count)
    } else if (sort === 'dormant') {
      sorted.sort((a, b) => b.daysSince - a.daysSince || b.item.count - a.item.count)
    } else {
      sorted.sort((a, b) => a.daysSince - b.daysSince || b.recentCount - a.recentCount)
    }
    return sorted
  }, [category, snapshot.stats, sort])

  const activeCategory = snapshot.categories.find((c) => c.name === category)
  const recentItems = filteredStats.filter((s) => s.recentCount > 0).slice(0, 8)
  const dormantItems = filteredStats
    .filter((s) => s.daysSince >= DORMANT_DAYS)
    .sort((a, b) => b.item.count - a.item.count || b.daysSince - a.daysSince)
    .slice(0, 8)
  const newItems = filteredStats
    .filter((s) => s.item.firstDate.startsWith(String(snapshot.year)))
    .sort((a, b) => (a.item.firstDate < b.item.firstDate ? 1 : -1))
    .slice(0, 8)

  return (
    <main className="closet">
      <div className="filterbar">
        <div className="filter-row">
          <button
            className={category === 'all' ? 'chip active' : 'chip'}
            onClick={() => setCategory('all')}
          >
            ALL <span className="chip-count mono">{snapshot.visibleCount}</span>
          </button>
          {snapshot.categories.map((c) => (
            <button
              key={c.name}
              className={category === c.name ? 'chip active' : 'chip'}
              onClick={() => setCategory(category === c.name ? 'all' : c.name)}
            >
              {c.name} <span className="chip-count mono">{c.itemCount}</span>
            </button>
          ))}
        </div>
        <div className="filter-row status-row">
          <select
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            title="アイテムの並び替え"
          >
            <option value="idle">最近着た順</option>
            <option value="recent">90日稼働順</option>
            <option value="staple">年間稼働密度順</option>
            <option value="dormant">休眠長い順</option>
          </select>
          <span className="result-count jp">
            基準日 <span className="mono">{fmtDate(snapshot.asOf)}</span>
            {activeCategory && (
              <>
                {' '}
                · 稼働率 <span className="mono">{pct(activeCategory.usageRate)}</span>
              </>
            )}
          </span>
        </div>
      </div>

      <section className="closet-hero">
        <Metric
          label="180日稼働率"
          value={pct(snapshot.usageRate)}
          sub={`${snapshot.activeCount}/${snapshot.visibleCount} items`}
          title="基準日から180日以内に1回以上着たアイテムの割合"
        />
        <Metric
          label="90日着用数"
          value={String(snapshot.recentWears)}
          sub="resolved wears"
          title="基準日から90日以内の着用回数の合計"
        />
        <Metric
          label="365日休眠"
          value={String(snapshot.dormantCount)}
          sub="items"
          title="最後の着用から365日以上たったアイテム数"
        />
        <Metric
          label={`${snapshot.year} 初登場`}
          value={String(snapshot.firstThisYear)}
          sub="items"
          title={`初めて着たのが${snapshot.year}年のアイテム数`}
        />
      </section>
      <p className="closet-note jp">
        <strong>稼働率</strong>
        は基準日（最終記録日{' '}
        <span className="mono">{fmtDate(snapshot.asOf)}</span>
        ）から180日以内に1回以上着たアイテムの割合です。個体に分けた服はそれぞれ1点として数え、非表示アイテムは母数から除きます。並び替えの「90日稼働」は直近90日の着用回数、「年間稼働密度」は年あたりの着用回数を指します。
      </p>

      <section className="closet-section">
        <div className="closet-section-head">
          <h2 className="section-title mono">
            categories <span className="section-count">{snapshot.categories.length}</span>
          </h2>
        </div>
        <div className="closet-category-list">
          {snapshot.categories.map((c) => (
            <button
              key={c.name}
              className={category === c.name ? 'closet-category active' : 'closet-category'}
              onClick={() => setCategory(category === c.name ? 'all' : c.name)}
            >
              <span className="closet-category-name mono">{c.name}</span>
              <span className="closet-bar" aria-hidden="true">
                <span style={{ width: pct(c.usageRate) }} />
              </span>
              <span className="closet-category-stat mono">{pct(c.usageRate)}</span>
              <span className="closet-category-sub jp">
                {c.activeItems}/{c.itemCount} 稼働 · 休眠 {c.dormantItems} · 90日{' '}
                {c.recentWears}回
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="closet-grid">
        <ItemPanel
          title="recent"
          count={recentItems.length}
          empty="最近90日に動いたアイテムがありません"
          items={recentItems}
          meta={(s) => `90日 ${s.recentCount}回 / total ${s.item.count}回`}
          onShowFits={onShowFits}
        />
        <ItemPanel
          title="dormant"
          count={dormantItems.length}
          empty="365日以上休眠中のアイテムはありません"
          items={dormantItems}
          meta={(s) => `${s.daysSince}日休眠 / total ${s.item.count}回`}
          onShowFits={onShowFits}
        />
        <ItemPanel
          title={`${snapshot.year} debut`}
          count={newItems.length}
          empty={`${snapshot.year}年初登場のアイテムはありません`}
          items={newItems}
          meta={(s) => `${fmtDate(s.item.firstDate)} 初登場 / ${s.yearCount}回`}
          onShowFits={onShowFits}
        />
      </div>
    </main>
  )
}

function Metric({
  label,
  value,
  sub,
  title,
}: {
  label: string
  value: string
  sub: string
  title?: string
}) {
  return (
    <div className="closet-metric" title={title}>
      <span className="closet-metric-label jp">{label}</span>
      <span className="closet-metric-value mono">{value}</span>
      <span className="closet-metric-sub mono">{sub}</span>
    </div>
  )
}

function ItemPanel({
  title,
  count,
  empty,
  items,
  meta,
  onShowFits,
}: {
  title: string
  count: number
  empty: string
  items: ItemStat[]
  meta: (stat: ItemStat) => string
  onShowFits: (itemId: string) => void
}) {
  return (
    <section className="closet-panel">
      <h2 className="section-title mono">
        {title} <span className="section-count">{count}</span>
      </h2>
      {items.length === 0 ? (
        <p className="closet-empty jp">{empty}</p>
      ) : (
        <ul className="closet-item-list">
          {items.map((stat) => (
            <li key={stat.item.id} className="closet-item">
              {stat.item.rep ? (
                <button
                  className="closet-item-thumb"
                  style={regionBackgroundStyle(
                    stat.item.category,
                    thumb(stat.item.rep.url, 240),
                  )}
                  onClick={() => onShowFits(stat.item.id)}
                  aria-label={`${stat.item.label} のコーデを見る`}
                />
              ) : (
                <span className="closet-item-thumb empty" />
              )}
              <button className="closet-item-main" onClick={() => onShowFits(stat.item.id)}>
                <span className="closet-item-label jp">{stat.item.label}</span>
                <span className="closet-item-meta mono">{meta(stat)}</span>
              </button>
              <span className="chip-cat mono">{stat.item.category}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
