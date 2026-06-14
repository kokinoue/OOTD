import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, thumb } from '../lib/useData'
import { READONLY } from '../lib/env'
import type { Outfit, SplitsFile } from '../types'

type Props = {
  outfit: Outfit
  data: Data
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onItemClick: (itemId: string) => void
}

export default function OutfitModal({
  outfit,
  data,
  splits,
  onAssign,
  onCreateSub,
  onClose,
  onPrev,
  onNext,
  onItemClick,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [assigningBaseId, setAssigningBaseId] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (assigningBaseId) return
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrev, onNext, assigningBaseId])

  // 生のアイテムID（分割前）ごとに表示用アイテムを解決。表示が重複したら1つに
  const chips = useMemo(() => {
    const seen = new Set<string>()
    const list: { baseId: string; displayId: string }[] = []
    for (const baseId of outfit.itemIds) {
      const displayId = data.resolveItemId(baseId, outfit.key)
      if (seen.has(displayId)) continue
      seen.add(displayId)
      list.push({ baseId, displayId })
    }
    return list
      .map((c) => ({ ...c, item: data.itemMap.get(c.displayId) }))
      .filter((c) => c.item != null)
      .sort((a, b) => b.item!.count - a.item!.count)
  }, [outfit, data])

  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // backdropクリックで閉じる
      }}
    >
      <article className="modal-body">
        <header className="modal-head">
          <div>
            <h2 className="modal-title jp">{outfit.title}</h2>
            <p className="modal-sub mono">
              {fmtDate(outfit.date)}
              <span className="modal-like">♡ {outfit.like}</span>
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>

        {outfit.images.map((img, i) => (
          <figure key={i} className="modal-figure">
            <img
              src={thumb(img.url, 1280)}
              alt={img.caption || outfit.title}
              loading="lazy"
              style={
                img.width && img.height
                  ? { aspectRatio: `${img.width} / ${img.height}` }
                  : undefined
              }
            />
            {img.caption && <figcaption className="modal-caption">{img.caption}</figcaption>}
          </figure>
        ))}

        {chips.length > 0 && (
          <div className="modal-items">
            {chips.map(({ baseId, displayId, item }) => (
              <span key={displayId} className="chip-group">
                <button
                  className="chip item-chip"
                  onClick={() => onItemClick(displayId)}
                  title={`${item!.label} のコーデを見る`}
                >
                  <span className="chip-cat mono">{item!.category}</span>
                  {item!.label}
                  <span className="chip-count mono">{item!.count}</span>
                </button>
                {!READONLY && (
                  <button
                    className="chip-edit"
                    onClick={() => setAssigningBaseId(baseId)}
                    title="この着用を別の個体に割り当てる"
                  >
                    ⇄
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {outfit.comment && <p className="modal-comment jp">{outfit.comment}</p>}

        <footer className="modal-foot">
          <button className="chip" onClick={onPrev} disabled={!onPrev}>
            ← <span className="jp">前</span>
          </button>
          <a className="chip" href={outfit.noteUrl} target="_blank" rel="noreferrer">
            <span className="jp">noteで見る</span> ↗
          </a>
          <button className="chip" onClick={onNext} disabled={!onNext}>
            <span className="jp">次</span> →
          </button>
        </footer>
      </article>

      {assigningBaseId && (
        <AssignDialog
          baseId={assigningBaseId}
          outfit={outfit}
          data={data}
          splits={splits}
          onAssign={onAssign}
          onCreateSub={onCreateSub}
          onClose={() => setAssigningBaseId(null)}
        />
      )}
    </dialog>
  )
}

function AssignDialog({
  baseId,
  outfit,
  data,
  splits,
  onAssign,
  onCreateSub,
  onClose,
}: {
  baseId: string
  outfit: Outfit
  data: Data
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const subs = splits.items[baseId]?.subs ?? []
  const currentSubKey =
    subs.find((s) => s.outfits.includes(outfit.key))?.key ?? null
  const baseLabel = baseId.split('|')[1] ?? baseId
  const category = baseId.split('|')[0] ?? ''

  const choose = (subKey: string | null) => {
    onAssign(baseId, outfit.key, subKey)
    onClose()
  }

  const create = () => {
    if (!newLabel.trim()) return
    onCreateSub(baseId, newLabel, outfit.key)
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className="modal assign-modal"
      onClose={onClose}
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === ref.current) onClose()
      }}
    >
      <article className="modal-body">
        <header className="modal-head">
          <div>
            <h2 className="modal-title jp">この日の着用をどの個体にする？</h2>
            <p className="modal-sub">
              <span className="chip-cat mono">{category}</span> {baseLabel} ·{' '}
              <span className="mono">{fmtDate(outfit.date)}</span>
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>

        <ul className="assign-list">
          {subs.map((sub) => {
            const subId = `${baseId}#${sub.key}`
            const count = data.itemMap.get(subId)?.count ?? sub.outfits.length
            return (
              <li key={sub.key}>
                <button
                  className={
                    sub.key === currentSubKey ? 'assign-option current' : 'assign-option'
                  }
                  onClick={() => choose(sub.key)}
                >
                  <span className="assign-radio">{sub.key === currentSubKey ? '●' : '○'}</span>
                  <span className="assign-label jp">{sub.label}</span>
                  <span className="item-meta mono dim">{count}回</span>
                </button>
              </li>
            )
          })}
          <li>
            <button
              className={currentSubKey == null ? 'assign-option current' : 'assign-option'}
              onClick={() => choose(null)}
            >
              <span className="assign-radio">{currentSubKey == null ? '●' : '○'}</span>
              <span className="assign-label jp dim">未分類</span>
            </button>
          </li>
        </ul>

        <div className="assign-new">
          <input
            className="search jp"
            type="text"
            placeholder="新しい個体名（例: 紺フレアデニム）"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
            }}
          />
          <button className="chip" onClick={create} disabled={!newLabel.trim()}>
            <span className="jp">＋作成して割当</span>
          </button>
        </div>
      </article>
    </dialog>
  )
}
