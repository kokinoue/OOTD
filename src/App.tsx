import { Suspense, lazy } from 'react'
import FitsView from './components/FitsView'
import GameHubView from './components/GameHubView'
import ItemsView from './components/ItemsView'
import ScrollToTopButton from './components/ScrollToTopButton'
import { useOverrides } from './lib/store'

// 初期表示に不要なビューは遅延読み込みして初期バンドルを軽くする。
// ゲーム（DuelGameView / MemoryGameView）と色解析は依存が重いので特に効果が大きい。
const ClosetDashboardView = lazy(() => import('./components/ClosetDashboardView'))
const ColorPaletteView = lazy(() => import('./components/ColorPaletteView'))
const WeatherView = lazy(() => import('./components/WeatherView'))
const MemoryGameView = lazy(() => import('./components/MemoryGameView'))
const DuelGameView = lazy(() => import('./components/DuelGameView'))
import { useSplits } from './lib/splitsStore'
import { useHair } from './lib/hairStore'
import { useHashRoute } from './lib/router'
import { fmtDate, meta, outfits, useData } from './lib/useData'

export type View = 'fits' | 'items' | 'closet' | 'palette' | 'weather' | 'game' | 'memory' | 'duel'

export type Filters = {
  from: string
  to: string
  year: number | null
  month: number | null
  itemId: string | null
  itemIds: string[]
  hairColor: string | null
  hairStyle: string | null
  hat: string | null
  q: string
  sort: 'new' | 'old' | 'like'
  anniv: boolean
}

export const defaultFilters: Filters = {
  from: '',
  to: '',
  year: null,
  month: null,
  itemId: null,
  itemIds: [],
  hairColor: null,
  hairStyle: null,
  hat: null,
  q: '',
  sort: 'new',
  anniv: false,
}

export default function App() {
  const ov = useOverrides()
  const { splits, assign, createSub, moveOutfit, saveState } = useSplits()
  const { hair, setHair, saveState: hairSaveState } = useHair()
  const data = useData(ov, splits)
  const [{ view, filters }, navigate] = useHashRoute()

  const setView = (v: View) => navigate({ view: v, filters })
  const setFilters = (f: Filters) => navigate({ view: 'fits', filters: f }, { replace: true })

  const showFitsForItem = (itemId: string) => {
    navigate({ view: 'fits', filters: { ...defaultFilters, itemId, itemIds: [] } })
    window.scrollTo({ top: 0 })
  }

  const showFitsForItems = (itemIds: string[]) => {
    navigate({ view: 'fits', filters: { ...defaultFilters, itemId: null, itemIds } })
    window.scrollTo({ top: 0 })
  }

  const visibleItemCount = data.items.filter((it) => !it.hidden).length

  return (
    <div className="app">
      <header className="header">
        <button
          className="brand"
          onClick={() => {
            navigate({ view: 'fits', filters: defaultFilters })
            window.scrollTo({ top: 0 })
          }}
        >
          <span className="brand-mark jp">出勤服</span>
          <span className="brand-sub">DAILY FITS ARCHIVE</span>
        </button>
        <nav className="tabs" aria-label="ビュー切り替え">
          <button
            className={view === 'fits' ? 'tab active' : 'tab'}
            onClick={() => setView('fits')}
          >
            FITS <span className="tab-count mono">{outfits.length}</span>
          </button>
          <button
            className={view === 'items' ? 'tab active' : 'tab'}
            onClick={() => setView('items')}
          >
            ITEMS <span className="tab-count mono">{visibleItemCount}</span>
          </button>
          <button
            className={view === 'closet' ? 'tab active' : 'tab'}
            onClick={() => setView('closet')}
          >
            稼働率
          </button>
          <button
            className={view === 'palette' ? 'tab active' : 'tab'}
            onClick={() => setView('palette')}
          >
            色
          </button>
          <button
            className={view === 'weather' ? 'tab active' : 'tab'}
            onClick={() => setView('weather')}
          >
            衣替え
          </button>
          <button
            className={
              view === 'game' || view === 'memory' || view === 'duel' ? 'tab active' : 'tab'
            }
            onClick={() => setView('game')}
          >
            ゲーム
          </button>
        </nav>
      </header>

      {view === 'fits' && (
        <FitsView
          data={data}
          filters={filters}
          setFilters={setFilters}
          splits={splits}
          hair={hair}
          onAssign={assign}
          onCreateSub={createSub}
          onMoveOutfit={moveOutfit}
          onSetHair={setHair}
        />
      )}
      {view === 'items' && <ItemsView data={data} onShowFits={showFitsForItem} />}
      {view === 'game' && <GameHubView onSelect={setView} />}
      <Suspense fallback={<div className="view-loading jp">読み込み中…</div>}>
        {view === 'closet' && (
          <ClosetDashboardView
            data={data}
            onShowFits={showFitsForItem}
            onShowPairFits={showFitsForItems}
          />
        )}
        {view === 'palette' && <ColorPaletteView data={data} onShowFits={showFitsForItem} />}
        {view === 'weather' && <WeatherView />}
        {view === 'memory' && <MemoryGameView data={data} onBack={() => setView('game')} />}
        {view === 'duel' && <DuelGameView data={data} onBack={() => setView('game')} />}
      </Suspense>

      {(saveState === 'error' || hairSaveState === 'error') && (
        <div className="save-error jp">
          データを保存できませんでした。`pnpm dev` のサーバーで開いているか確認してください
        </div>
      )}

      <footer className="footer jp">
        データ元:{' '}
        <a href={meta.magazineUrl} target="_blank" rel="noreferrer">
          note マガジン「出勤服」
        </a>{' '}
        · {fmtDate(meta.scrapedAt.slice(0, 10))} 取得
      </footer>

      <ScrollToTopButton />
    </div>
  )
}
