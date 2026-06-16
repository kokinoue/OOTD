import DuelGameView from './components/DuelGameView'
import FitsView from './components/FitsView'
import ItemsView from './components/ItemsView'
import MemoryGameView from './components/MemoryGameView'
import RankingView from './components/RankingView'
import WeatherView from './components/WeatherView'
import { useOverrides } from './lib/store'
import { useSplits } from './lib/splitsStore'
import { useHair } from './lib/hairStore'
import { useHashRoute } from './lib/router'
import { fmtDate, meta, outfits, useData } from './lib/useData'

export type View = 'fits' | 'items' | 'ranking' | 'weather' | 'game' | 'duel'

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
  order: 'desc' | 'asc'
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
  order: 'desc',
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
            className={view === 'ranking' ? 'tab active' : 'tab'}
            onClick={() => setView('ranking')}
          >
            スキ順
          </button>
          <button
            className={view === 'weather' ? 'tab active' : 'tab'}
            onClick={() => setView('weather')}
          >
            衣替え
          </button>
          <button
            className={view === 'game' ? 'tab active' : 'tab'}
            onClick={() => setView('game')}
          >
            神経衰弱
          </button>
          <button
            className={view === 'duel' ? 'tab active' : 'tab'}
            onClick={() => setView('duel')}
          >
            デュエル
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
      {view === 'ranking' && (
        <RankingView
          data={data}
          splits={splits}
          hair={hair}
          onAssign={assign}
          onCreateSub={createSub}
          onMoveOutfit={moveOutfit}
          onSetHair={setHair}
          onItemClick={showFitsForItem}
        />
      )}
      {view === 'weather' && <WeatherView />}
      {view === 'game' && <MemoryGameView data={data} />}
      {view === 'duel' && <DuelGameView data={data} />}

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
