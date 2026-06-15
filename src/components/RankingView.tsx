import { useMemo, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import type { SplitsFile } from '../types'
import OutfitModal from './OutfitModal'

type Props = {
  data: Data
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
  onItemClick: (itemId: string) => void
}

export default function RankingView({
  data,
  splits,
  onAssign,
  onCreateSub,
  onMoveOutfit,
  onItemClick,
}: Props) {
  const [year, setYear] = useState<number | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const o of outfits) ys.add(Number(o.date.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [])

  const ranked = useMemo(() => {
    const list = outfits.filter((o) =>
      year == null ? true : o.date.startsWith(String(year)),
    )
    // スキ数降順。同数は新しい順
    return [...list].sort((a, b) => b.like - a.like || (a.date < b.date ? 1 : -1))
  }, [year])

  const total = useMemo(() => ranked.reduce((s, o) => s + o.like, 0), [ranked])

  return (
    <main>
      <div className="filterbar">
        <div className="filter-row">
          <button
            className={year == null ? 'chip active' : 'chip'}
            onClick={() => setYear(null)}
          >
            ALL
          </button>
          {years.map((y) => (
            <button
              key={y}
              className={year === y ? 'chip active' : 'chip'}
              onClick={() => setYear(year === y ? null : y)}
            >
              <span className="mono">{y}</span>
            </button>
          ))}
        </div>
        <div className="filter-row status-row">
          <span className="result-count">
            <span className="jp">スキ合計 </span>
            <span className="mono">{total.toLocaleString()}</span>
            <span className="jp"> · </span>
            <span className="mono">{ranked.length}</span>
            <span className="jp"> 件</span>
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="empty jp">コーデがありません</p>
      ) : (
        <div className="grid rank-grid">
          {ranked.map((o, i) => (
            <button key={o.key} className="card rank-card" onClick={() => setOpenIndex(i)}>
              <span className={'rank-badge mono' + (i < 3 ? ' rank-top' : '')}>{i + 1}</span>
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
                <span className="rank-like">♡ {o.like}</span>
                <span className="card-no">{fmtDate(o.date)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {openIndex != null && ranked[openIndex] && (
        <OutfitModal
          outfit={ranked[openIndex]}
          data={data}
          splits={splits}
          onAssign={onAssign}
          onCreateSub={onCreateSub}
          onMoveOutfit={onMoveOutfit}
          onClose={() => setOpenIndex(null)}
          onPrev={openIndex > 0 ? () => setOpenIndex(openIndex - 1) : undefined}
          onNext={openIndex < ranked.length - 1 ? () => setOpenIndex(openIndex + 1) : undefined}
          onItemClick={(id) => {
            onItemClick(id)
            setOpenIndex(null)
          }}
        />
      )}
    </main>
  )
}
