import { useEffect, useMemo, useRef, useState } from 'react'
import type { Filters } from '../App'
import { defaultFilters } from '../App'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import { buildHairFacets, effectiveHair, HAIR_FIELDS } from '../lib/hair'
import { findSimilarOutfits } from '../lib/similar'
import type { HairFile, HairTag, SplitsFile } from '../types'
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
  hair: HairFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
  onSetHair: (outfitKey: string, tag: HairTag) => void
}

// 髪フィルタ各軸を Filters のキーへ対応づける
const HAIR_FILTER_KEY = {
  color: 'hairColor',
  style: 'hairStyle',
  hat: 'hat',
} as const

export default function FitsView({
  data,
  filters,
  setFilters,
  splits,
  hair,
  onAssign,
  onCreateSub,
  onMoveOutfit,
  onSetHair,
}: Props) {
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

  const hairFacets = useMemo(
    () => buildHairFacets(hair, outfits.map((o) => o.key)),
    [hair],
  )

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
      if (filters.itemIds.length > 0) {
        const ids = data.outfitItemIds.get(o.key)
        if (!ids || !filters.itemIds.every((id) => ids.has(id))) return false
      }
      if (filters.hairColor || filters.hairStyle || filters.hat) {
        const tag = effectiveHair(hair, o.key)
        if (filters.hairColor && tag.color !== filters.hairColor) return false
        if (filters.hairStyle && tag.style !== filters.hairStyle) return false
        if (filters.hat && tag.hat !== filters.hat) return false
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
    // outfits は新しい順が基準。古い順は反転、スキ順はスキ数降順（同数は新しい順）
    if (filters.sort === 'old') list.reverse()
    else if (filters.sort === 'like')
      list.sort((a, b) => b.like - a.like || (a.date < b.date ? 1 : -1))
    return list
  }, [data, filters, hair])

  const [shown, setShown] = useState(PAGE)
  const [openOutfitKey, setOpenOutfitKey] = useState<string | null>(null)
  const [timelapseFrames, setTimelapseFrames] = useState<TimelapseFrame[] | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const outfitMap = useMemo(() => new Map(outfits.map((o) => [o.key, o])), [])
  const openOutfit = openOutfitKey ? outfitMap.get(openOutfitKey) : null
  const openFilteredIndex = openOutfitKey
    ? filtered.findIndex((o) => o.key === openOutfitKey)
    : -1
  const similarOutfits = useMemo(
    () => (openOutfit ? findSimilarOutfits(openOutfit, data, hair, 6) : []),
    [openOutfit, data, hair],
  )

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

  const openRandom = () => {
    // 絞り込み結果から1枚をランダムに開く（鑑賞中の1枚は避けて確実に切り替える）
    const pool =
      openOutfitKey && filtered.length > 1
        ? filtered.filter((o) => o.key !== openOutfitKey)
        : filtered
    if (pool.length === 0) return
    const pick = pool[Math.floor(Math.random() * pool.length)]
    setOpenOutfitKey(pick.key)
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
  const activeItems = filters.itemIds
    .map((id) => data.itemMap.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null)
  const hasFilter =
    filters.from ||
    filters.to ||
    filters.year != null ||
    filters.itemId ||
    filters.itemIds.length > 0 ||
    filters.hairColor ||
    filters.hairStyle ||
    filters.hat ||
    filters.q

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
          <select
            className="select"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters['sort'] })}
            title="並び替え"
          >
            <option value="new">新しい順</option>
            <option value="old">古い順</option>
            <option value="like">スキ順</option>
          </select>
        </div>

        {hairFacets.length > 0 && (
          <div className="filter-row hair-row">
            {hairFacets.map((facet) => {
              const filterKey = HAIR_FILTER_KEY[facet.field]
              const active = filters[filterKey]
              const label = HAIR_FIELDS.find((f) => f.key === facet.field)!.label
              return (
                <span key={facet.field} className="hair-group">
                  <span className="hair-group-label jp">{label}</span>
                  {facet.values.map(({ value, count }) => (
                    <button
                      key={value}
                      className={active === value ? 'chip sm active' : 'chip sm'}
                      onClick={() =>
                        setFilters({
                          ...filters,
                          [filterKey]: active === value ? null : value,
                        })
                      }
                    >
                      <span className="jp">{value}</span>
                      <span className="chip-count mono">{count}</span>
                    </button>
                  ))}
                </span>
              )
            })}
          </div>
        )}

        <div className="filter-row status-row">
          {activeItem && (
            <button
              className="chip item-chip active"
              onClick={() => setFilters({ ...filters, itemId: null, itemIds: [] })}
              title="アイテム絞り込みを解除"
            >
              <span className="chip-cat mono">{activeItem.category}</span>
              {activeItem.label} ✕
            </button>
          )}
          {activeItems.length > 0 && (
            <button
              className="chip item-chip active"
              onClick={() => setFilters({ ...filters, itemId: null, itemIds: [] })}
              title="ペア絞り込みを解除"
            >
              {activeItems.map((item, index) => (
                <span key={item.id} className="pair-chip-part">
                  <span className="chip-cat mono">{item.category}</span>
                  {item.label}
                  {index < activeItems.length - 1 ? ' + ' : ''}
                </span>
              ))}
              ✕
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
            onClick={openRandom}
            disabled={filtered.length === 0}
            title="絞り込んだ中からランダムに1枚開く"
          >
            🎲 <span className="jp">ランダム</span>
          </button>
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
          {filtered.slice(0, shown).map((o, i) => {
            const byLike = filters.sort === 'like'
            return (
              <button
                key={o.key}
                className={byLike ? 'card rank-card' : 'card'}
                onClick={() => setOpenOutfitKey(o.key)}
              >
                {byLike && (
                  <span className={'rank-badge mono' + (i < 3 ? ' rank-top' : '')}>{i + 1}</span>
                )}
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
                  {byLike ? (
                    <>
                      <span className="rank-like">♡ {o.like}</span>
                      <span className="card-no">{fmtDate(o.date)}</span>
                    </>
                  ) : (
                    <>
                      <span>{fmtDate(o.date)}</span>
                      {o.no != null && <span className="card-no">#{o.no}</span>}
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {shown < filtered.length && <div ref={sentinelRef} className="sentinel" />}

      {timelapseFrames && (
        <TimelapsePlayer frames={timelapseFrames} onClose={() => setTimelapseFrames(null)} />
      )}

      {openOutfit && (
        <OutfitModal
          outfit={openOutfit}
          data={data}
          splits={splits}
          hair={hair}
          similarOutfits={similarOutfits}
          onOpenSimilar={(key) => setOpenOutfitKey(key)}
          onAssign={onAssign}
          onCreateSub={onCreateSub}
          onMoveOutfit={onMoveOutfit}
          onSetHair={onSetHair}
          onClose={() => setOpenOutfitKey(null)}
          onPrev={
            openFilteredIndex > 0
              ? () => setOpenOutfitKey(filtered[openFilteredIndex - 1].key)
              : undefined
          }
          onNext={
            openFilteredIndex >= 0 && openFilteredIndex < filtered.length - 1
              ? () => setOpenOutfitKey(filtered[openFilteredIndex + 1].key)
              : undefined
          }
          onItemClick={(id) => {
            setFilters({ ...filters, itemId: id, itemIds: [] })
            setOpenOutfitKey(null)
            window.scrollTo({ top: 0 })
          }}
        />
      )}
    </main>
  )
}
