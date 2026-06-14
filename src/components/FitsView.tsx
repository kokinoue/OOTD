import { useEffect, useMemo, useRef, useState } from 'react'
import type { Filters } from '../App'
import { defaultFilters } from '../App'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import type { SplitsFile } from '../types'
import OutfitModal from './OutfitModal'
import TimelapsePlayer, { type TimelapseFrame } from './TimelapsePlayer'

const PAGE = 60

const norm = (s: string) => s.normalize('NFKC').toLowerCase()
const pad2 = (n: number) => String(n).padStart(2, '0')

type Props = {
  data: Data
  filters: Filters
  setFilters: (f: Filters) => void
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
}

export default function FitsView({ data, filters, setFilters, splits, onAssign, onCreateSub }: Props) {
  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const o of outfits) ys.add(Number(o.date.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [])

  const monthsForYear = useMemo(() => {
    if (filters.year == null) return []
    const ms = new Set<number>()
    for (const o of outfits) {
      if (o.date.startsWith(String(filters.year))) ms.add(Number(o.date.slice(5, 7)))
    }
    return [...ms].sort((a, b) => a - b)
  }, [filters.year])

  const filtered = useMemo(() => {
    const q = norm(filters.q.trim())
    const list = outfits.filter((o) => {
      if (filters.from && o.date < filters.from) return false
      if (filters.to && o.date > filters.to) return false
      if (filters.year != null) {
        const prefix =
          filters.month != null
            ? `${filters.year}-${pad2(filters.month)}`
            : String(filters.year)
        if (!o.date.startsWith(prefix)) return false
      }
      if (filters.itemId != null) {
        if (!data.outfitItemIds.get(o.key)?.has(filters.itemId)) return false
      }
      if (q) {
        const labels = [...(data.outfitItemIds.get(o.key) ?? [])]
          .map((id) => data.itemMap.get(id)?.label ?? '')
          .join(' ')
        const hay = norm(
          `${o.title} ${o.comment} ${o.images.map((i) => i.caption).join(' ')} ${labels}`,
        )
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (filters.order === 'asc') list.reverse()
    return list
  }, [data, filters])

  const [shown, setShown] = useState(PAGE)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [timelapseFrames, setTimelapseFrames] = useState<TimelapseFrame[] | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const startTimelapse = () => {
    // 絞り込み結果を時系列昇順で再生（画像のないコーデは除外）
    const frames = [...filtered]
      .sort((a, b) => (a.publishAt < b.publishAt ? -1 : 1))
      .filter((o) => o.images[0])
      .map((o) => ({
        key: o.key,
        no: o.no,
        date: o.date,
        url: o.images[0].url,
        items: [...(data.outfitItemIds.get(o.key) ?? [])]
          .map((id) => data.itemMap.get(id)?.label ?? '')
          .filter(Boolean)
          .join('  /  '),
        like: o.like,
      }))
    if (frames.length >= 2) setTimelapseFrames(frames)
  }

  useEffect(() => {
    setShown(PAGE)
  }, [filters])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setShown((s) => s + PAGE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const activeItem = filters.itemId ? data.itemMap.get(filters.itemId) : null
  const hasFilter =
    filters.from || filters.to || filters.year != null || filters.itemId || filters.q

  return (
    <main>
      <div className="filterbar">
        <div className="filter-row">
          <button
            className={filters.year == null && !filters.from && !filters.to ? 'chip active' : 'chip'}
            onClick={() => setFilters({ ...filters, year: null, month: null, from: '', to: '' })}
          >
            ALL
          </button>
          {years.map((y) => (
            <button
              key={y}
              className={filters.year === y ? 'chip active' : 'chip'}
              onClick={() =>
                setFilters({
                  ...filters,
                  year: filters.year === y ? null : y,
                  month: null,
                  from: '',
                  to: '',
                })
              }
            >
              <span className="mono">{y}</span>
            </button>
          ))}
          {filters.year != null && (
            <span className="month-chips">
              {monthsForYear.map((m) => (
                <button
                  key={m}
                  className={filters.month === m ? 'chip sm active' : 'chip sm'}
                  onClick={() =>
                    setFilters({ ...filters, month: filters.month === m ? null : m })
                  }
                >
                  <span className="mono">{m}</span>
                  <span className="jp">月</span>
                </button>
              ))}
            </span>
          )}
        </div>

        <div className="filter-row">
          <label className="range jp">
            <input
              type="date"
              value={filters.from}
              onChange={(e) =>
                setFilters({ ...filters, from: e.target.value, year: null, month: null })
              }
            />
            <span className="range-sep">→</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) =>
                setFilters({ ...filters, to: e.target.value, year: null, month: null })
              }
            />
          </label>
          <input
            className="search jp"
            type="search"
            placeholder="ブランド・アイテム・メモで検索"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <button
            className="chip"
            onClick={() =>
              setFilters({ ...filters, order: filters.order === 'desc' ? 'asc' : 'desc' })
            }
            title="並び順を切り替え"
          >
            {filters.order === 'desc' ? '新しい順 ↓' : '古い順 ↑'}
          </button>
        </div>

        <div className="filter-row status-row">
          {activeItem && (
            <button
              className="chip item-chip active"
              onClick={() => setFilters({ ...filters, itemId: null })}
              title="アイテム絞り込みを解除"
            >
              <span className="chip-cat mono">{activeItem.category}</span>
              {activeItem.label} ✕
            </button>
          )}
          <span className="result-count">
            <span className="mono">{filtered.length}</span>
            <span className="jp"> 件</span>
            {hasFilter && (
              <button className="link jp" onClick={() => setFilters(defaultFilters)}>
                すべて解除
              </button>
            )}
          </span>
          <button
            className="chip"
            onClick={startTimelapse}
            disabled={filtered.length < 2}
            title="絞り込んだコーデを時系列で連続再生"
          >
            ▶ <span className="jp">タイムラプス</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty jp">条件に合うコーデがありません</p>
      ) : (
        <div className="grid">
          {filtered.slice(0, shown).map((o, i) => (
            <button key={o.key} className="card" onClick={() => setOpenIndex(i)}>
              {o.images[0] ? (
                <img
                  src={thumb(o.images[0].url, 480)}
                  alt={o.title}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="card-placeholder jp">no image</span>
              )}
              <span className="card-meta mono">
                <span>{fmtDate(o.date)}</span>
                {o.no != null && <span className="card-no">#{o.no}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {shown < filtered.length && <div ref={sentinelRef} className="sentinel" />}

      {timelapseFrames && (
        <TimelapsePlayer frames={timelapseFrames} onClose={() => setTimelapseFrames(null)} />
      )}

      {openIndex != null && filtered[openIndex] && (
        <OutfitModal
          outfit={filtered[openIndex]}
          data={data}
          splits={splits}
          onAssign={onAssign}
          onCreateSub={onCreateSub}
          onClose={() => setOpenIndex(null)}
          onPrev={openIndex > 0 ? () => setOpenIndex(openIndex - 1) : undefined}
          onNext={
            openIndex < filtered.length - 1 ? () => setOpenIndex(openIndex + 1) : undefined
          }
          onItemClick={(id) => {
            setFilters({ ...filters, itemId: id })
            setOpenIndex(null)
            window.scrollTo({ top: 0 })
          }}
        />
      )}
    </main>
  )
}
