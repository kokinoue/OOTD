import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, thumb } from '../lib/useData'
import { regionBackgroundStyle } from '../lib/regions'
import { overrideActions, useOverrides } from '../lib/store'
import { READONLY } from '../lib/env'
import type { EffectiveItem } from '../types'

const norm = (s: string) => s.normalize('NFKC').toLowerCase()

type Sort = 'count' | 'recent' | 'name'
type Layout = 'list' | 'grid'
const LAYOUT_KEY = 'items-layout'

type Props = {
  data: Data
  onShowFits: (itemId: string) => void
}

export default function ItemsView({ data, onShowFits }: Props) {
  const ov = useOverrides()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [sort, setSort] = useState<Sort>('count')
  const [layout, setLayout] = useState<Layout>(
    () => (localStorage.getItem(LAYOUT_KEY) as Layout) || 'list',
  )
  const [showHidden, setShowHidden] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mergingItem, setMergingItem] = useState<EffectiveItem | null>(null)
  const [bakeMsg, setBakeMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => {
    const qn = norm(q.trim())
    let list = data.items.filter((it) => (showHidden ? true : !it.hidden))
    if (cat !== 'all') list = list.filter((it) => it.category === cat)
    if (qn) {
      list = list.filter(
        (it) => norm(it.label).includes(qn) || norm(it.category).includes(qn),
      )
    }
    const sorted = [...list]
    if (sort === 'count') sorted.sort((a, b) => b.count - a.count)
    if (sort === 'recent') sorted.sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1))
    if (sort === 'name') sorted.sort((a, b) => a.label.localeCompare(b.label, 'ja'))
    return sorted
  }, [data.items, q, cat, sort, showHidden])

  const grouped = useMemo(() => {
    if (cat !== 'all') return [{ name: cat, items: visible }]
    const m = new Map<string, EffectiveItem[]>()
    for (const it of visible) {
      const list = m.get(it.category) ?? []
      list.push(it)
      m.set(it.category, list)
    }
    return [...m.entries()]
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [visible, cat])

  const allCategories = useMemo(
    () => [...new Set(data.items.map((it) => it.category))].sort(),
    [data.items],
  )

  const changeCategory = (it: EffectiveItem, value: string) => {
    if (value === '__new__') {
      const input = window.prompt('新しいカテゴリ名（例: jacket）', it.category)
      if (input?.trim()) overrideActions.setCategory(it.id, input)
    } else {
      overrideActions.setCategory(it.id, value)
    }
  }

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, layout)
  }, [layout])

  const renderActions = (it: EffectiveItem) =>
    !READONLY && (
      <span className="item-actions">
        <select
          className="select sm"
          value={it.category}
          onChange={(e) => changeCategory(it, e.target.value)}
          title="カテゴリを変更"
        >
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__new__">＋新しいカテゴリ…</option>
        </select>
        <button className="icon-btn" onClick={() => setEditingId(it.id)} title="名前を変更">
          ✎
        </button>
        <button className="icon-btn" onClick={() => setMergingItem(it)} title="別のアイテムに統合">
          ⇒
        </button>
        <button
          className="icon-btn"
          onClick={() => overrideActions.toggleHidden(it.id)}
          title={it.hidden ? '一覧に表示する' : '一覧から非表示にする'}
        >
          {it.hidden ? '◌' : '−'}
        </button>
      </span>
    )

  const renameInput = (it: EffectiveItem) => (
    <input
      className="rename-input"
      defaultValue={it.label}
      autoFocus
      onBlur={(e) => {
        overrideActions.rename(it.id, e.target.value)
        setEditingId(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setEditingId(null)
      }}
    />
  )

  const exportOverrides = () => {
    const blob = new Blob([JSON.stringify(ov, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fits-overrides.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importOverrides = async (file: File) => {
    try {
      overrideActions.importAll(JSON.parse(await file.text()))
    } catch {
      window.alert('読み込めませんでした。エクスポートしたJSONを指定してください。')
    }
  }

  return (
    <main>
      <div className="filterbar">
        <div className="filter-row">
          <input
            className="search jp"
            type="search"
            placeholder="アイテム・ブランド名で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="count">着用回数順</option>
            <option value="recent">最近着た順</option>
            <option value="name">名前順</option>
          </select>
          <label className="toggle jp">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            非表示も見る
          </label>
          <div className="view-toggle" role="group" aria-label="表示の切り替え">
            <button
              type="button"
              className={layout === 'list' ? 'view-toggle-btn active' : 'view-toggle-btn'}
              onClick={() => setLayout('list')}
              aria-pressed={layout === 'list'}
              title="リスト表示"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                <rect x="1" y="2" width="3" height="3" rx="0.5" />
                <rect x="6" y="2.75" width="8" height="1.5" rx="0.75" />
                <rect x="1" y="6" width="3" height="3" rx="0.5" />
                <rect x="6" y="6.75" width="8" height="1.5" rx="0.75" />
                <rect x="1" y="10" width="3" height="3" rx="0.5" />
                <rect x="6" y="10.75" width="8" height="1.5" rx="0.75" />
              </svg>
            </button>
            <button
              type="button"
              className={layout === 'grid' ? 'view-toggle-btn active' : 'view-toggle-btn'}
              onClick={() => setLayout('grid')}
              aria-pressed={layout === 'grid'}
              title="グリッド表示"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                <rect x="1" y="1" width="5.5" height="5.5" rx="1" />
                <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" />
                <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" />
                <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
              </svg>
            </button>
          </div>
        </div>
        <div className="filter-row">
          <button
            className={cat === 'all' ? 'chip active' : 'chip'}
            onClick={() => setCat('all')}
          >
            ALL
          </button>
          {data.categories.map((c) => (
            <button
              key={c.name}
              className={cat === c.name ? 'chip active' : 'chip'}
              onClick={() => setCat(cat === c.name ? 'all' : c.name)}
            >
              {c.name} <span className="chip-count mono">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {grouped.map((group) => (
        <section key={group.name} className="item-section">
          <h2 className="section-title mono">
            {group.name} <span className="section-count">{group.items.length}</span>
          </h2>
          {layout === 'grid' ? (
            <ul className="item-grid">
              {group.items.map((it) => (
                <li key={it.id} className={it.hidden ? 'item-card hidden-row' : 'item-card'}>
                  {it.rep ? (
                    <button
                      className="item-card-thumb"
                      style={regionBackgroundStyle(it.category, thumb(it.rep.url, 320))}
                      onClick={() => onShowFits(it.id)}
                      title="このアイテムのコーデを見る"
                      aria-label={`${it.label} の最新着用`}
                    />
                  ) : (
                    <span className="item-card-thumb empty" />
                  )}
                  <div className="item-card-body">
                    {editingId === it.id ? (
                      renameInput(it)
                    ) : (
                      <button
                        className="item-card-label"
                        onClick={() => onShowFits(it.id)}
                        title="このアイテムのコーデを見る"
                      >
                        {it.label}
                      </button>
                    )}
                    <div className="item-card-foot">
                      <span className="item-meta mono">{it.count}回</span>
                      <span className="item-meta mono dim">{fmtDate(it.lastDate)}</span>
                      {it.mergedFrom.length > 0 && (
                        <span className="merged-note jp" title="統合済みのアイテム">
                          +{it.mergedFrom.length}
                        </span>
                      )}
                    </div>
                    {renderActions(it)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="item-list">
              {group.items.map((it) => (
                <li key={it.id} className={it.hidden ? 'item-row hidden-row' : 'item-row'}>
                  {it.rep ? (
                    <button
                      className="item-thumb"
                      style={regionBackgroundStyle(it.category, thumb(it.rep.url, 320))}
                      onClick={() => onShowFits(it.id)}
                      title="このアイテムのコーデを見る"
                      aria-label={`${it.label} の最新着用`}
                    />
                  ) : (
                    <span className="item-thumb empty" />
                  )}
                  {editingId === it.id ? (
                    renameInput(it)
                  ) : (
                    <button
                      className="item-label"
                      onClick={() => onShowFits(it.id)}
                      title="このアイテムのコーデを見る"
                    >
                      {it.label}
                    </button>
                  )}
                  {it.mergedFrom.length > 0 && (
                    <span className="merged-note jp" title="統合済みのアイテム">
                      +{it.mergedFrom.length}件統合
                    </span>
                  )}
                  <span className="item-meta mono">{it.count}回</span>
                  <span className="item-meta mono dim">{fmtDate(it.lastDate)}</span>
                  {renderActions(it)}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {visible.length === 0 && <p className="empty jp">条件に合うアイテムがありません</p>}

      {data.merged.length > 0 && (
        <section className="item-section">
          <h2 className="section-title mono">
            merged <span className="section-count">{data.merged.length}</span>
          </h2>
          <ul className="item-list">
            {data.merged.map((m) => (
              <li key={m.fromId} className="item-row merged-row">
                <span className="item-label-static jp">
                  <span className="chip-cat mono">{m.fromCategory}</span> {m.fromLabel}{' '}
                  <span className="dim">→</span>{' '}
                  <span className="chip-cat mono">{m.toCategory}</span> {m.toLabel}
                </span>
                {!READONLY && (
                  <span className="item-actions">
                    <button
                      className="chip sm"
                      onClick={() => overrideActions.unmerge(m.fromId)}
                    >
                      <span className="jp">解除</span>
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!READONLY && (
        <div className="tools jp">
          <button className="chip" onClick={exportOverrides}>
            編集内容をエクスポート
          </button>
          <button className="chip" onClick={() => fileRef.current?.click()}>
            インポート
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importOverrides(f)
              e.target.value = ''
            }}
          />
          <button
            className="chip danger"
            onClick={() => {
              if (window.confirm('名前変更・統合・カテゴリ変更・非表示をすべてリセットします。よろしいですか？')) {
                overrideActions.reset()
              }
            }}
          >
            リセット
          </button>
          <button
            className="chip primary"
            onClick={async () => {
              setBakeMsg('保存中…')
              const ok = await overrideActions.bake()
              setBakeMsg(ok ? '公開用データに焼き込みました' : '保存に失敗しました')
              setTimeout(() => setBakeMsg(''), 4000)
            }}
            title="名前変更・統合・カテゴリ・非表示を overrides.json に書き込み、公開ビルドに反映する"
          >
            公開用に確定
          </button>
          <span className="tools-note">
            {bakeMsg || '編集はこのブラウザに保存。「公開用に確定」で overrides.json に焼き込む'}
          </span>
        </div>
      )}

      {mergingItem && (
        <MergeDialog
          source={mergingItem}
          data={data}
          onClose={() => setMergingItem(null)}
        />
      )}
    </main>
  )
}

function MergeDialog({
  source,
  data,
  onClose,
}: {
  source: EffectiveItem
  data: Data
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const candidates = useMemo(() => {
    const qn = norm(q.trim())
    return data.items
      .filter((it) => it.id !== source.id)
      .filter((it) => !qn || norm(it.label).includes(qn) || norm(it.category).includes(qn))
      .slice(0, 30)
  }, [data.items, q, source.id])

  return (
    <dialog
      ref={ref}
      className="modal merge-modal"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <article className="modal-body">
        <header className="modal-head">
          <h2 className="modal-title jp">
            「{source.label}」を統合する先を選ぶ
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <p className="merge-help jp">
          統合すると、このアイテムの着用コーデは統合先のアイテムとして数えられます（あとで解除できます）。
        </p>
        <input
          className="search jp"
          type="search"
          placeholder="統合先を検索"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="merge-list">
          {candidates.map((it) => (
            <li key={it.id}>
              <button
                className="merge-candidate"
                onClick={() => {
                  overrideActions.merge(source.id, it.id)
                  onClose()
                }}
              >
                <span className="chip-cat mono">{it.category}</span>
                {it.label}
                <span className="item-meta mono dim">{it.count}回</span>
              </button>
            </li>
          ))}
        </ul>
      </article>
    </dialog>
  )
}
