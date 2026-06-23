import { useMemo, useState } from 'react'
import type { Data } from '../lib/useData'
import { colorBuckets, outfits } from '../lib/useData'
import type { EffectiveItem } from '../types'

type ColorCount = { name: string; label: string; swatch: string; count: number }

type MonthStat = {
  key: string
  label: string
  total: number
  colored: number
  colors: ColorCount[]
}

type YearStat = {
  year: string
  total: number
  colored: number
  avgColors: number
  colors: ColorCount[]
}

type PairStat = {
  key: string
  a: ColorCount
  b: ColorCount
  count: number
}

type ColorItem = {
  item: EffectiveItem
  share: number
}

type Props = {
  data: Data
  onShowFits: (itemId: string) => void
}

const bucketMap = new Map(colorBuckets.map((b) => [b.name, b]))
const bucketOrder = new Map(colorBuckets.map((b, i) => [b.name, i]))

const emptyCounts = () => new Map(colorBuckets.map((b) => [b.name, 0]))

const toColorCounts = (counts: Map<string, number>): ColorCount[] =>
  [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => {
      const meta = bucketMap.get(name)
      return {
        name,
        label: meta?.label ?? name,
        swatch: meta?.swatch ?? '#999',
        count,
      }
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        (bucketOrder.get(a.name) ?? 999) - (bucketOrder.get(b.name) ?? 999),
    )

const pct = (count: number, total: number) => `${total ? Math.round((count / total) * 100) : 0}%`

export default function ColorPaletteView({ data, onShowFits }: Props) {
  const [activeColor, setActiveColor] = useState<string>('all')

  const analysis = useMemo(() => {
    const monthMap = new Map<string, { total: number; colored: number; colors: Map<string, number> }>()
    const yearMap = new Map<
      string,
      { total: number; colored: number; colorTotal: number; colors: Map<string, number> }
    >()
    const pairMap = new Map<string, { a: string; b: string; count: number }>()
    const colorOutfitCounts = emptyCounts()

    for (const outfit of outfits) {
      const ids = data.outfitItemIds.get(outfit.key)
      const colors = new Set<string>()
      if (ids) {
        for (const id of ids) {
          const item = data.itemMap.get(id)
          if (item?.hidden || !item?.color) continue
          colors.add(item.color)
        }
      }

      const month = outfit.date.slice(0, 7)
      const year = outfit.date.slice(0, 4)
      const monthStat = monthMap.get(month) ?? { total: 0, colored: 0, colors: emptyCounts() }
      const yearStat = yearMap.get(year) ?? {
        total: 0,
        colored: 0,
        colorTotal: 0,
        colors: emptyCounts(),
      }
      monthStat.total += 1
      yearStat.total += 1

      if (colors.size > 0) {
        monthStat.colored += 1
        yearStat.colored += 1
        yearStat.colorTotal += colors.size
      }

      for (const color of colors) {
        monthStat.colors.set(color, (monthStat.colors.get(color) ?? 0) + 1)
        yearStat.colors.set(color, (yearStat.colors.get(color) ?? 0) + 1)
        colorOutfitCounts.set(color, (colorOutfitCounts.get(color) ?? 0) + 1)
      }

      const sortedColors = [...colors].sort(
        (a, b) => (bucketOrder.get(a) ?? 999) - (bucketOrder.get(b) ?? 999),
      )
      for (let i = 0; i < sortedColors.length; i++) {
        for (let j = i + 1; j < sortedColors.length; j++) {
          const key = `${sortedColors[i]}|${sortedColors[j]}`
          const cur = pairMap.get(key) ?? { a: sortedColors[i], b: sortedColors[j], count: 0 }
          cur.count += 1
          pairMap.set(key, cur)
        }
      }

      monthMap.set(month, monthStat)
      yearMap.set(year, yearStat)
    }

    const months: MonthStat[] = [...monthMap.entries()]
      .map(([key, stat]) => ({
        key,
        label: key.replace('-', '.'),
        total: stat.total,
        colored: stat.colored,
        colors: toColorCounts(stat.colors),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))

    const years: YearStat[] = [...yearMap.entries()]
      .map(([year, stat]) => ({
        year,
        total: stat.total,
        colored: stat.colored,
        avgColors: stat.colored ? stat.colorTotal / stat.colored : 0,
        colors: toColorCounts(stat.colors),
      }))
      .sort((a, b) => (a.year < b.year ? -1 : 1))

    const pairs: PairStat[] = [...pairMap.values()]
      .map(({ a, b, count }) => ({
        key: `${a}|${b}`,
        a: toColorCounts(new Map([[a, count]]))[0],
        b: toColorCounts(new Map([[b, count]]))[0],
        count,
      }))
      .sort((a, b) => b.count - a.count)

    const items: ColorItem[] = data.items
      .filter((item) => !item.hidden && item.color)
      .map((item) => ({
        item,
        share: item.count / Math.max(1, colorOutfitCounts.get(item.color!) ?? item.count),
      }))
      .sort((a, b) => b.item.count - a.item.count || a.item.label.localeCompare(b.item.label))

    const colorCounts = toColorCounts(colorOutfitCounts)
    const coloredOutfits = outfits.filter((outfit) => {
      const ids = data.outfitItemIds.get(outfit.key)
      if (!ids) return false
      for (const id of ids) {
        const item = data.itemMap.get(id)
        if (!item?.hidden && item?.color) return true
      }
      return false
    }).length

    return {
      months,
      years,
      pairs,
      items,
      colorCounts,
      coloredOutfits,
      topColor: colorCounts[0] ?? null,
      topPair: pairs[0] ?? null,
    }
  }, [data])

  const selectedColor = activeColor === 'all' ? null : bucketMap.get(activeColor)
  const filteredPairs =
    activeColor === 'all'
      ? analysis.pairs.slice(0, 12)
      : analysis.pairs.filter((pair) => pair.a.name === activeColor || pair.b.name === activeColor).slice(0, 12)
  const filteredItems =
    activeColor === 'all'
      ? analysis.items.slice(0, 16)
      : analysis.items.filter(({ item }) => item.color === activeColor).slice(0, 16)

  return (
    <main className="palette">
      <div className="filterbar">
        <div className="filter-row color-row">
          <button
            className={activeColor === 'all' ? 'chip active' : 'chip'}
            onClick={() => setActiveColor('all')}
          >
            色すべて
          </button>
          {analysis.colorCounts.map((color) => (
            <button
              key={color.name}
              className={activeColor === color.name ? 'chip color-chip active' : 'chip color-chip'}
              onClick={() => setActiveColor(activeColor === color.name ? 'all' : color.name)}
              title={color.label}
            >
              <span className="color-dot" style={{ background: color.swatch }} aria-hidden="true" />
              {color.label} <span className="chip-count mono">{color.count}</span>
            </button>
          ))}
        </div>
        <div className="filter-row status-row">
          <span className="result-count jp">
            {selectedColor ? selectedColor.label : '全色'} ·{' '}
            <span className="mono">{analysis.coloredOutfits}</span> colored fits
          </span>
        </div>
      </div>

      <section className="palette-hero">
        <Metric label="色ありコーデ" value={String(analysis.coloredOutfits)} sub={`${outfits.length} fits`} />
        <Metric
          label="主色"
          value={analysis.topColor?.label ?? '-'}
          sub={analysis.topColor ? `${analysis.topColor.count} fits` : 'no color'}
          swatch={analysis.topColor?.swatch}
        />
        <Metric
          label="定番ペア"
          value={analysis.topPair ? `${analysis.topPair.a.label}+${analysis.topPair.b.label}` : '-'}
          sub={analysis.topPair ? `${analysis.topPair.count} fits` : 'no pair'}
        />
        <Metric
          label="平均色数"
          value={averageColors(analysis.years)}
          sub="per colored fit"
        />
      </section>

      <section className="palette-section">
        <h2 className="section-title mono">
          timeline <span className="section-count">{analysis.months.length}</span>
        </h2>
        <div className="palette-timeline">
          {analysis.months.map((month) => (
            <div key={month.key} className="palette-month">
              <span className="palette-month-label mono">{month.label}</span>
              <div className="palette-month-bar" title={`${month.label} / ${month.colored} colored fits`}>
                {month.colors.map((color) => (
                  <span
                    key={color.name}
                    style={{ width: pct(color.count, month.colored), background: color.swatch }}
                    title={`${color.label}: ${color.count}`}
                  />
                ))}
              </div>
              <span className="palette-month-count mono">{month.colored}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="palette-section">
        <h2 className="section-title mono">
          yearly palettes <span className="section-count">{analysis.years.length}</span>
        </h2>
        <div className="palette-year-grid">
          {analysis.years.map((year) => (
            <article key={year.year} className="palette-year">
              <div className="palette-year-head">
                <span className="mono">{year.year}</span>
                <span className="mono">{year.colored}/{year.total}</span>
              </div>
              <div className="palette-year-swatches">
                {year.colors.slice(0, 8).map((color) => (
                  <span
                    key={color.name}
                    className="palette-year-swatch"
                    style={{ background: color.swatch }}
                    title={`${color.label}: ${color.count}`}
                  />
                ))}
              </div>
              <div className="palette-year-bars">
                {year.colors.slice(0, 5).map((color) => (
                  <div key={color.name} className="palette-year-bar">
                    <span className="jp">{color.label}</span>
                    <span className="palette-bar-track">
                      <span style={{ width: pct(color.count, year.colored), background: color.swatch }} />
                    </span>
                    <span className="mono">{pct(color.count, year.colored)}</span>
                  </div>
                ))}
              </div>
              <span className="palette-year-sub mono">{year.avgColors.toFixed(1)} colors / fit</span>
            </article>
          ))}
        </div>
      </section>

      <div className="palette-grid">
        <section className="palette-panel">
          <h2 className="section-title mono">
            combinations <span className="section-count">{filteredPairs.length}</span>
          </h2>
          <ul className="palette-pair-list">
            {filteredPairs.map((pair) => (
              <li key={pair.key} className="palette-pair">
                <span className="palette-pair-swatches">
                  <span style={{ background: pair.a.swatch }} />
                  <span style={{ background: pair.b.swatch }} />
                </span>
                <span className="palette-pair-name jp">
                  {pair.a.label} + {pair.b.label}
                </span>
                <span className="mono">{pair.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="palette-panel">
          <h2 className="section-title mono">
            items <span className="section-count">{filteredItems.length}</span>
          </h2>
          <ul className="palette-item-list">
            {filteredItems.map(({ item, share }) => {
              const color = bucketMap.get(item.color!)
              return (
                <li key={item.id} className="palette-item">
                  <span
                    className="color-dot"
                    style={{ background: color?.swatch ?? '#999' }}
                    aria-hidden="true"
                  />
                  <button className="palette-item-main" onClick={() => onShowFits(item.id)}>
                    <span className="palette-item-label jp">{item.label}</span>
                    <span className="palette-item-meta mono">
                      {item.category} · {item.count} fits · {Math.round(share * 100)}%
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </main>
  )
}

function averageColors(years: YearStat[]): string {
  const colored = years.reduce((sum, year) => sum + year.colored, 0)
  const total = years.reduce((sum, year) => sum + year.avgColors * year.colored, 0)
  return colored ? (total / colored).toFixed(1) : '-'
}

function Metric({
  label,
  value,
  sub,
  swatch,
}: {
  label: string
  value: string
  sub: string
  swatch?: string
}) {
  return (
    <div className="palette-metric">
      <span className="palette-metric-label jp">{label}</span>
      <span className="palette-metric-value jp">
        {swatch && <span className="color-dot" style={{ background: swatch }} aria-hidden="true" />}
        {value}
      </span>
      <span className="palette-metric-sub mono">{sub}</span>
    </div>
  )
}
