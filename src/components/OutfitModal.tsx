import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from '../lib/useData'
import { baseItems, fmtDate, thumb } from '../lib/useData'
import { overrideActions, resolveId, useOverrides } from '../lib/store'
import { READONLY } from '../lib/env'
import { effectiveHair, HAIR_FIELDS } from '../lib/hair'
import type { SimilarOutfit } from '../lib/similar'
import { shareAsWallpaper } from '../lib/wallpaper'
import type { HairFile, HairTag, Outfit, SplitsFile } from '../types'

const baseItemMap = new Map(baseItems.map((it) => [it.id, it]))
const norm = (s: string) => s.normalize('NFKC').toLowerCase()

type Props = {
  outfit: Outfit
  data: Data
  splits: SplitsFile
  hair: HairFile
  similarOutfits: SimilarOutfit[]
  onOpenSimilar: (key: string) => void
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
  onSetHair: (outfitKey: string, tag: HairTag) => void
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onItemClick: (itemId: string) => void
}

export default function OutfitModal({
  outfit,
  data,
  splits,
  hair,
  similarOutfits,
  onOpenSimilar,
  onAssign,
  onCreateSub,
  onMoveOutfit,
  onSetHair,
  onClose,
  onPrev,
  onNext,
  onItemClick,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [assigningBaseId, setAssigningBaseId] = useState<string | null>(null)
  // ロック画面用に整形した画像の共有/保存ステータス
  const [wpState, setWpState] = useState<'idle' | 'busy' | 'shared' | 'downloaded' | 'error'>(
    'idle',
  )

  // outfit が変わったらステータスをリセット
  const lastWpKey = useRef(outfit.key)
  if (lastWpKey.current !== outfit.key) {
    lastWpKey.current = outfit.key
    setWpState('idle')
  }

  const mainImage = outfit.images[0]
  const onSaveWallpaper = async () => {
    if (!mainImage || wpState === 'busy') return
    setWpState('busy')
    try {
      // モーダルで既に表示済み（=キャッシュ済み）の幅を使い、共有時のユーザー操作判定切れを避ける
      const res = await shareAsWallpaper({
        imageUrl: thumb(mainImage.url, 1280),
        dateLabel: fmtDate(outfit.date),
        caption: outfit.no != null ? `#${outfit.no}` : undefined,
        fileBase: `ootd-${outfit.date.replaceAll('-', '')}`,
      })
      setWpState(res)
    } catch (err) {
      console.error('壁紙の生成/共有に失敗:', err)
      setWpState('error')
    }
  }

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

  // スマホ用: マッチングアプリのカードのように、指の動きにカードが追従し、
  // 一定量を超えると左右に飛んでいって前後のコーデへ切り替わる。
  // 縦スクロールを邪魔しないよう、横移動が縦移動より大きいときだけ横ドラッグに入る。
  const prevStampRef = useRef<HTMLDivElement>(null)
  const nextStampRef = useRef<HTMLDivElement>(null)
  // ドラッグ状態。再描画を挟むとカクつくので transform は ref 経由で直接当てる
  const drag = useRef({ startX: 0, startY: 0, axis: 'none' as 'none' | 'x' | 'y', dx: 0, active: false })
  const animating = useRef(false)
  const reduceMotion = useRef(false)
  // 最新の onPrev/onNext を native リスナーから参照するための受け皿
  const navRef = useRef({ onPrev, onNext, assigningBaseId })
  navRef.current = { onPrev, onNext, assigningBaseId }

  const SWIPE_THRESHOLD = 80 // この距離を超えて離すと「飛んでいく」

  // dx に応じてカード(=dialog)を移動・回転。0 のときは中央へ戻す
  const applyTransform = (dx: number, animate: boolean) => {
    const el = ref.current
    if (!el) return
    el.style.transition = animate ? 'transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none'
    if (dx === 0) {
      // none ではなく translateX(0) で止める。合成レイヤーを維持し、
      // iOS でレイヤー破棄時に起きるちらつきを防ぐ
      el.style.transform = 'translateX(0)'
    } else {
      const rot = Math.max(-10, Math.min(10, dx / 22))
      el.style.transform = `translateX(${dx}px) rotate(${rot}deg)`
    }
  }
  // 「前へ／次へ」スタンプの濃さをドラッグ量に合わせる
  const setStamps = (dx: number) => {
    const p = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1)
    if (prevStampRef.current) prevStampRef.current.style.opacity = dx > 0 ? String(p) : '0'
    if (nextStampRef.current) nextStampRef.current.style.opacity = dx < 0 ? String(p) : '0'
  }
  const clearStamps = () => {
    if (prevStampRef.current) prevStampRef.current.style.opacity = '0'
    if (nextStampRef.current) nextStampRef.current.style.opacity = '0'
  }
  const resetCard = (animate: boolean) => {
    applyTransform(0, animate)
    clearStamps()
  }

  // dir: 1 = 右へ飛ばして前のコーデ / -1 = 左へ飛ばして次のコーデ
  const flyAway = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const go = dir > 0 ? navRef.current.onPrev : navRef.current.onNext
    if (!go) {
      resetCard(true) // 端まで来ているので跳ね返す
      return
    }
    if (reduceMotion.current) {
      go()
      el.scrollTop = 0
      resetCard(false)
      return
    }
    animating.current = true
    const w = window.innerWidth
    applyTransform(dir * (w + 80), true) // いったん画面外へ飛ばす
    window.setTimeout(() => {
      go() // コーデを切り替え（中身が差し替わる）
      clearStamps()
      applyTransform(-dir * (w + 80), false) // 反対側の画面外に瞬間移動
      el.scrollTop = 0
      // 2フレーム待ってから中央へ滑り込ませる
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          applyTransform(0, true)
          window.setTimeout(() => {
            animating.current = false
          }, 340)
        }),
      )
    }, 260)
  }

  useEffect(() => {
    reduceMotion.current =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // タッチ開始点から親をたどり、横スクロールできる要素（「似ている出勤服」の
    // ストリップなど）の中なら、カードのスワイプ切替より中身の横スクロールを優先する
    const inHorizontalScroller = (start: EventTarget | null): boolean => {
      let node = start instanceof Element ? start : null
      while (node && node !== el) {
        if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth) {
          const ox = getComputedStyle(node).overflowX
          if (ox === 'auto' || ox === 'scroll') return true
        }
        node = node.parentElement
      }
      return false
    }
    const onStart = (e: TouchEvent) => {
      if (animating.current || navRef.current.assigningBaseId) return
      if (e.touches.length !== 1) {
        drag.current.active = false // ピンチズーム等はスワイプ扱いしない
        return
      }
      if (inHorizontalScroller(e.target)) {
        drag.current.active = false // 横スクロール領域の中はスワイプ扱いしない
        return
      }
      const t = e.touches[0]
      drag.current = { startX: t.clientX, startY: t.clientY, axis: 'none', dx: 0, active: true }
    }
    const onMove = (e: TouchEvent) => {
      const d = drag.current
      if (!d.active || animating.current) return
      const t = e.touches[0]
      const dx = t.clientX - d.startX
      const dy = t.clientY - d.startY
      if (d.axis === 'none') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (d.axis === 'y') {
          d.active = false // 縦方向なので通常スクロールに任せる
          return
        }
      }
      if (d.axis !== 'x') return
      e.preventDefault() // 横ドラッグ中は縦スクロールを止める
      // 行き先が無い方向は弱い手応え（ラバーバンド）で「これ以上ない」と伝える
      const hasTarget = dx > 0 ? !!navRef.current.onPrev : !!navRef.current.onNext
      const eff = hasTarget ? dx : dx * 0.3
      d.dx = eff
      applyTransform(eff, false)
      setStamps(eff)
    }
    const onEnd = () => {
      const d = drag.current
      if (!d.active) return
      d.active = false
      if (d.axis !== 'x') return
      if (Math.abs(d.dx) >= SWIPE_THRESHOLD) flyAway(d.dx > 0 ? 1 : -1)
      else resetCard(true)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

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
      {/* スワイプ中に出る方向スタンプ（カードと一緒に動く） */}
      {onPrev && (
        <div ref={prevStampRef} className="swipe-stamp prev jp" aria-hidden="true">
          ← 前へ
        </div>
      )}
      {onNext && (
        <div ref={nextStampRef} className="swipe-stamp next jp" aria-hidden="true">
          次へ →
        </div>
      )}
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

        {mainImage && (
          <div className="modal-wallpaper">
            <button
              className="chip wallpaper-btn"
              onClick={onSaveWallpaper}
              disabled={wpState === 'busy'}
              title="ロック画面用に整形した画像を保存・共有する"
            >
              <span aria-hidden="true">▢</span>{' '}
              <span className="jp">
                {wpState === 'busy' ? '画像を生成中…' : 'ロック画面用に保存'}
              </span>
            </button>
            {wpState === 'shared' && (
              <span className="wallpaper-msg jp">
                共有メニューから「画像を保存」→ 写真アプリで壁紙に設定できます
              </span>
            )}
            {wpState === 'downloaded' && (
              <span className="wallpaper-msg jp">
                画像を保存しました。写真アプリから壁紙／ロック画面に設定できます
              </span>
            )}
            {wpState === 'error' && (
              <span className="wallpaper-msg error jp">画像を生成できませんでした</span>
            )}
          </div>
        )}

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

        <HairSection hair={hair} outfitKey={outfit.key} onSetHair={onSetHair} />

        <SimilarOutfitsSection items={similarOutfits} onOpenSimilar={onOpenSimilar} />

        {(onPrev || onNext) && (
          <p className="modal-swipe-hint jp" aria-hidden="true">
            ← スワイプで前後のコーデ →
          </p>
        )}

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

function SimilarOutfitsSection({
  items,
  onOpenSimilar,
}: {
  items: SimilarOutfit[]
  onOpenSimilar: (key: string) => void
}) {
  if (items.length === 0) return null

  return (
    <section className="modal-similar">
      <h3 className="modal-section-title jp">似ている出勤服</h3>
      <div className="similar-strip">
        {items.map(({ outfit, reasons }) => {
          const image = outfit.images[0]
          return (
            <button
              key={outfit.key}
              className="similar-card"
              onClick={() => onOpenSimilar(outfit.key)}
              title={`${fmtDate(outfit.date)} のコーデを見る`}
            >
              <img
                src={thumb(image.url, 240)}
                alt={image.caption || outfit.title}
                loading="lazy"
                decoding="async"
              />
              <span className="similar-date mono">{fmtDate(outfit.date)}</span>
              {reasons.length > 0 && (
                <span className="similar-reasons">
                  {reasons.map((reason, i) => (
                    <span key={`${reason}-${i}`} className="similar-reason jp">
                      {reason}
                    </span>
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** コーデの髪タグ表示（常時）＋ 手動編集（dev のみ）。空欄は「該当なし／未設定」 */
function HairSection({
  hair,
  outfitKey,
  onSetHair,
}: {
  hair: HairFile
  outfitKey: string
  onSetHair: (outfitKey: string, tag: HairTag) => void
}) {
  const eff = effectiveHair(hair, outfitKey)
  const isManual = hair.manual[outfitKey] != null
  const hasAuto = hair.auto[outfitKey] != null

  // 編集用ドラフト。outfitKey が変わったら同期
  const [draft, setDraft] = useState<HairTag>(eff)
  const lastKey = useRef(outfitKey)
  if (lastKey.current !== outfitKey) {
    lastKey.current = outfitKey
    setDraft(eff)
  }

  if (READONLY) {
    const set = HAIR_FIELDS.filter((f) => eff[f.key])
    if (set.length === 0) return null
    return (
      <div className="modal-hair">
        <span className="modal-hair-label jp">髪</span>
        {set.map((f) => (
          <span key={f.key} className="hair-badge jp">
            <span className="hair-badge-cat">{f.label}</span>
            {eff[f.key]}
          </span>
        ))}
      </div>
    )
  }

  const blankToNull = (s: string): string | null => {
    const t = s.trim()
    return t === '' ? null : t
  }
  const dirty = HAIR_FIELDS.some((f) => (draft[f.key] ?? '') !== (eff[f.key] ?? ''))

  return (
    <div className="modal-hair edit">
      <span className="modal-hair-label jp">
        髪
        <span className="hair-src mono">{isManual ? '手動' : hasAuto ? 'AI推定' : '未設定'}</span>
      </span>
      {HAIR_FIELDS.map((f) => (
        <label key={f.key} className="hair-field jp">
          <span className="hair-field-label">{f.label}</span>
          <input
            className="hair-input jp"
            type="text"
            value={draft[f.key] ?? ''}
            placeholder={f.key === 'hat' ? 'なし' : '—'}
            onChange={(e) => setDraft({ ...draft, [f.key]: blankToNull(e.target.value) })}
          />
        </label>
      ))}
      <button
        className="chip sm primary"
        disabled={!dirty}
        onClick={() => onSetHair(outfitKey, draft)}
      >
        <span className="jp">保存</span>
      </button>
      {isManual && (
        <button
          className="link jp"
          onClick={() => {
            const reset = hair.auto[outfitKey] ?? { color: null, style: null, hat: null }
            setDraft(reset)
            onSetHair(outfitKey, { color: null, style: null, hat: null })
          }}
          title="手動修正を消してAI推定に戻す"
        >
          AI推定に戻す
        </button>
      )}
    </div>
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
  // インラインで名前を編集中の対象id（ベースなら baseId、個体なら `${baseId}#${subKey}`）
  const [editingId, setEditingId] = useState<string | null>(null)

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
  // この着用が今表示されているアイテム（＝すでにそこにある所属先）。これだけ候補から除く
  const currentDisplayId = data.resolveItemId(baseId, outfit.key)

  // 「別のアイテムへ移す」候補: いま表示中のアイテム以外すべて（同ベースの別個体も含む）
  const moveTargets = useMemo(() => {
    const qn = norm(moveQ.trim())
    return data.items
      .filter((it) => it.id !== currentDisplayId)
      .filter((it) => !qn || norm(it.label).includes(qn) || norm(it.category).includes(qn))
      .slice(0, 30)
  }, [data.items, moveQ, currentDisplayId])
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

  // この個体（または未分類のベース）が別アイテムへ「統合」されているか。
  // 統合は個体まるごとの付け替えなので、ここで気づけて解除できるようにする
  const naturalId = currentSubKey ? `${baseId}#${currentSubKey}` : baseId
  const mergedToId = !currentMove && ov.merges[naturalId] ? resolveId(naturalId, ov.merges) : null
  const mergedToItem = mergedToId ? data.itemMap.get(mergedToId) : null
  // 統合先に吸収されると itemMap から消えるので、rename → splits のラベル順で個体名を解決
  const naturalLabel = currentSubKey
    ? ov.renames[naturalId] ?? subs.find((s) => s.key === currentSubKey)?.label ?? currentSubKey
    : baseLabel

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
  // 付け替え先が同じベースの個体なら、moves ではなく個体割り当て(onAssign)で表現する
  const moveTo = (targetId: string) => {
    if (targetId === baseId) {
      onAssign(baseId, outfit.key, null) // 同ベースの「未分類」へ
    } else if (targetId.startsWith(`${baseId}#`)) {
      onAssign(baseId, outfit.key, targetId.slice(baseId.length + 1))
    } else {
      onMoveOutfit(baseId, outfit.key, targetId)
    }
    onClose()
  }
  const clearMove = () => {
    onMoveOutfit(baseId, outfit.key, null)
    onClose()
  }
  // この個体の「統合」を解除する（元のアイテムに戻る）
  const unmergeNatural = () => {
    overrideActions.unmerge(naturalId)
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
            <div className="modal-sub">
              {editingId === baseId ? (
                <RenameEditor
                  initial={baseLabel}
                  onSave={(v) => {
                    overrideActions.rename(baseId, v)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <span className="chip-cat mono">{category}</span> {baseLabel}
                  <button
                    className="assign-rename"
                    onClick={() => setEditingId(baseId)}
                    title="アイテム名を変更"
                  >
                    ✎
                  </button>{' '}
                  · <span className="mono">{fmtDate(outfit.date)}</span>
                </>
              )}
            </div>
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
                {editingId === subId ? (
                  <RenameEditor
                    initial={subLabelOf(sub.key, sub.label)}
                    onSave={(v) => {
                      overrideActions.rename(subId, v)
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="assign-row">
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
                    <button
                      className="assign-rename"
                      onClick={() => setEditingId(subId)}
                      title="この個体名を変更"
                    >
                      ✎
                    </button>
                  </div>
                )}
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

        {mergedToId && (
          <div className="assign-moved jp">
            <span>
              この個体（{naturalLabel}）は{' '}
              <strong>{mergedToItem?.label ?? mergedToId}</strong> に統合されています
            </span>
            <button className="link" onClick={unmergeNatural}>
              統合を解除
            </button>
          </div>
        )}

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

/** 名前のインライン編集。空のまま保存すると上書きが消えて自動ラベルに戻る */
function RenameEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (label: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <span className="assign-edit">
      <input
        className="search jp"
        type="text"
        autoFocus
        value={value}
        placeholder="名前（空で自動に戻す）"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(value)
        }}
      />
      <button className="chip sm primary" onClick={() => onSave(value)}>
        <span className="jp">保存</span>
      </button>
      <button className="chip sm" onClick={onCancel}>
        <span className="jp">取消</span>
      </button>
    </span>
  )
}
