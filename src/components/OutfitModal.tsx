import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from '../lib/useData'
import { baseItems, fmtDate, thumb } from '../lib/useData'
import { useOverrides } from '../lib/store'
import { READONLY } from '../lib/env'
import type { Outfit, SplitsFile } from '../types'

const baseItemMap = new Map(baseItems.map((it) => [it.id, it]))
const norm = (s: string) => s.normalize('NFKC').toLowerCase()

type Props = {
  outfit: Outfit
  data: Data
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
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
  onMoveOutfit,
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
          onMoveOutfit={onMoveOutfit}
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
  onMoveOutfit,
  onClose,
}: {
  baseId: string
  outfit: Outfit
  data: Data
  splits: SplitsFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [newLabel, setNewLabel] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveQ, setMoveQ] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const ov = useOverrides()
  const subs = splits.items[baseId]?.subs ?? []
  const currentSubKey =
    subs.find((s) => s.outfits.includes(outfit.key))?.key ?? null
  // この着用が別アイテムへ付け替え済みなら、その付け替え先ID
  const currentMove = splits.moves?.[baseId]?.[outfit.key] ?? null
  const movedItem = currentMove ? data.itemMap.get(currentMove) : null

  // 「別のアイテムへ移す」候補: 自分自身（同ベース＋その個体）を除いた全アイテム
  const moveTargets = useMemo(() => {
    const qn = norm(moveQ.trim())
    return data.items
      .filter((it) => it.id !== baseId && !it.id.startsWith(`${baseId}#`))
      .filter((it) => !qn || norm(it.label).includes(qn) || norm(it.category).includes(qn))
      .slice(0, 30)
  }, [data.items, moveQ, baseId])
  const baseInfo = baseItemMap.get(baseId)
  // 表示名は overrides の rename → items.json の表示ラベル → 生ID の順で解決
  const baseLabel = ov.renames[baseId] ?? baseInfo?.label ?? baseId.split('|')[1] ?? baseId
  const category = ov.categories[baseId] ?? baseInfo?.category ?? baseId.split('|')[0] ?? ''
  // 個体ラベルは itemMap（rename 反映済み）から。未renameなら "ベース · サブ" の接頭辞を外して簡潔に
  const subPrefix = baseInfo ? `${baseInfo.label} · ` : ''
  const subLabelOf = (subKey: string, fallback: string) => {
    const resolved = data.itemMap.get(`${baseId}#${subKey}`)?.label ?? fallback
    return subPrefix && resolved.startsWith(subPrefix) ? resolved.slice(subPrefix.length) : resolved
  }

  const choose = (subKey: string | null) => {
    onAssign(baseId, outfit.key, subKey)
    onClose()
  }

  const create = () => {
    if (!newLabel.trim()) return
    onCreateSub(baseId, newLabel, outfit.key)
    onClose()
  }

  // この日の着用だけを別アイテムへ付け替える（解除すれば元の判定に戻る）
  const moveTo = (targetId: string) => {
    onMoveOutfit(baseId, outfit.key, targetId)
    onClose()
  }
  const clearMove = () => {
    onMoveOutfit(baseId, outfit.key, null)
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
                    !currentMove && sub.key === currentSubKey
                      ? 'assign-option current'
                      : 'assign-option'
                  }
                  onClick={() => choose(sub.key)}
                >
                  <span className="assign-radio">
                    {!currentMove && sub.key === currentSubKey ? '●' : '○'}
                  </span>
                  <span className="assign-label jp">{subLabelOf(sub.key, sub.label)}</span>
                  <span className="item-meta mono dim">{count}回</span>
                </button>
              </li>
            )
          })}
          <li>
            <button
              className={
                currentSubKey == null && !currentMove ? 'assign-option current' : 'assign-option'
              }
              onClick={() => choose(null)}
            >
              <span className="assign-radio">
                {currentSubKey == null && !currentMove ? '●' : '○'}
              </span>
              <span className="assign-label jp dim">未分類</span>
            </button>
          </li>
        </ul>

        {currentMove && (
          <div className="assign-moved jp">
            <span>
              この日の着用は{' '}
              <strong>{movedItem?.label ?? currentMove}</strong> へ付け替え済み
            </span>
            <button className="link" onClick={clearMove}>
              元に戻す
            </button>
          </div>
        )}

        <div className="assign-move">
          {!moving ? (
            <button className="link jp" onClick={() => setMoving(true)}>
              {currentMove ? '別のアイテムへ付け替え直す →' : 'この日の着用だけ別のアイテムへ移す →'}
            </button>
          ) : (
            <>
              <p className="merge-help jp">
                この日（{fmtDate(outfit.date)}）の「{baseLabel}」の着用だけを、選んだアイテムへ付け替えます（「元に戻す」でいつでも戻せます）。
              </p>
              <input
                className="search jp"
                type="search"
                placeholder="付け替え先のアイテムを検索"
                autoFocus
                value={moveQ}
                onChange={(e) => setMoveQ(e.target.value)}
              />
              <ul className="merge-list">
                {moveTargets.map((it) => (
                  <li key={it.id}>
                    <button className="merge-candidate" onClick={() => moveTo(it.id)}>
                      <span className="chip-cat mono">{it.category}</span>
                      {it.label}
                      <span className="item-meta mono dim">{it.count}回</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

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
