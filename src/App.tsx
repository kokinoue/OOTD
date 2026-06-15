import FitsView from './components/FitsView'
import ItemsView from './components/ItemsView'
import WeatherView from './components/WeatherView'
import { useOverrides } from './lib/store'
import { useSplits } from './lib/splitsStore'
import { useHashRoute } from './lib/router'
import { fmtDate, meta, outfits, useData } from './lib/useData'

export type View = 'fits' | 'items' | 'weather'

export type Filters = {
  from: string
  to: string
  year: number | null
  month: number | null
  itemId: string | null
  q: string
  order: 'desc' | 'asc'
}

export const defaultFilters: Filters = {
  from: '',
  to: '',
  year: null,
  month: null,
  itemId: null,
  q: '',
  order: 'desc',
}

export default function App() {
  const ov = useOverrides()
  const { splits, assign, createSub, saveState } = useSplits()
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
            className={view === 'weather' ? 'tab active' : 'tab'}
            onClick={() => setView('weather')}
          >
            衣替え
          </button>
        </nav>
      </header>

      {view === 'fits' && (
        <FitsView
          data={data}
          filters={filters}
          setFilters={setFilters}
          splits={splits}
          onAssign={assign}
          onCreateSub={createSub}
        />
      )}
      {view === 'items' && <ItemsView data={data} onShowFits={showFitsForItem} />}
      {view === 'weather' && <WeatherView />}

      {saveState === 'error' && (
        <div className="save-error jp">
          splits.json を保存できませんでした。`pnpm dev` のサーバーで開いているか確認してください
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
