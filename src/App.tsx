import ClosetDashboardView from './components/ClosetDashboardView'
import ColorPaletteView from './components/ColorPaletteView'
import DuelGameView from './components/DuelGameView'
import FitsView from './components/FitsView'
import GameHubView from './components/GameHubView'
import ItemsView from './components/ItemsView'
import MemoryGameView from './components/MemoryGameView'
import WeatherView from './components/WeatherView'
import { useOverrides } from './lib/store'
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
  hairColor: string | null
  hairStyle: string | null
  hat: string | null
  q: string
  sort: 'new' | 'old' | 'like'
}

export const defaultFilters: Filters = {
  from: '',
  to: '',
  year: null,
  month: null,
  itemId: null,
  hairColor: null,
  hairStyle: null,
  hat: null,
  q: '',
  sort: 'new',
}

export default function App() {
  const ov = useOverrides()
  const { splits, assign, createSub, moveOutfit, saveState } = useSplits()
  const { hair, setHair, saveState: hairSaveState } = useHair()
  const data = useData(ov, splits)
  const [{ view, filters }, navigate] = useHashRoute()

  const setView = (v: View) => navigate({ view: v, filters })
  const setFilters = (f: Filters) => navigate({ view: 'fits', filters: f })

  const showFitsForItem = (itemId: string) => {
    navigate({ view: 'fits', filters: { ...defaultFilters, itemId } })
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
      {view === 'closet' && <ClosetDashboardView data={data} onShowFits={showFitsForItem} />}
      {view === 'palette' && <ColorPaletteView data={data} onShowFits={showFitsForItem} />}
      {view === 'weather' && <WeatherView />}
      {view === 'game' && <GameHubView onSelect={setView} />}
      {view === 'memory' && <MemoryGameView data={data} onBack={() => setView('game')} />}
      {view === 'duel' && <DuelGameView data={data} onBack={() => setView('game')} />}

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
    </div>
  )
}
