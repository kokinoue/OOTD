import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import cutoutsJson from '../data/cutouts.json'
import weatherJson from '../data/weather.json'
import { findSimilarOutfits } from '../lib/similar'
import { buildOrbitLayout } from '../lib/orbit'
import { createOrbitScene, type OrbitSceneController } from '../lib/orbitScene'
import { colorBuckets, fmtDate, outfits, type Data } from '../lib/useData'
import type { CutoutsFile } from '../lib/platform'
import type { HairFile, HairTag, SplitsFile } from '../types'
import OutfitModal from './OutfitModal'

type WeatherDay = {
  max: number
  min: number
  mean: number
  code: number
}

type Props = {
  data: Data
  splits: SplitsFile
  hair: HairFile
  onAssign: (baseId: string, outfitKey: string, subKey: string | null) => void
  onCreateSub: (baseId: string, label: string, outfitKey: string) => void
  onMoveOutfit: (baseId: string, outfitKey: string, targetId: string | null) => void
  onSetHair: (outfitKey: string, tag: HairTag) => void
  onShowItem: (itemId: string) => void
}

const cutouts = cutoutsJson as CutoutsFile
const weather = weatherJson as Record<string, WeatherDay>
const orbitEntries = buildOrbitLayout(outfits)
const yearStarts = orbitEntries.reduce<{ year: number; index: number }[]>((list, entry) => {
  if (list.at(-1)?.year !== entry.year) list.push({ year: entry.year, index: entry.index })
  return list
}, [])
const outfitIndex = new Map(orbitEntries.map((entry) => [entry.outfit.key, entry.index]))

const weatherLabel = (day?: WeatherDay) => {
  if (!day) return 'WEATHER —'
  return `${day.mean.toFixed(1)}°C · ${day.min.toFixed(1)}–${day.max.toFixed(1)}°`
}

export default function OrbitView({
  data,
  splits,
  hair,
  onAssign,
  onCreateSub,
  onMoveOutfit,
  onSetHair,
  onShowItem,
}: Props) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OrbitSceneController | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(() => orbitEntries.length - 1)
  const [sceneState, setSceneState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [openOutfitKey, setOpenOutfitKey] = useState<string | null>(null)
  const selected = orbitEntries[selectedIndex] ?? orbitEntries.at(-1)!
  const selectedWeather = weather[selected.outfit.date]

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const container = canvasHostRef.current
    if (!container) return
    try {
      const controller = createOrbitScene({
        container,
        entries: orbitEntries,
        sprites: cutouts.sprites,
        assetBase: import.meta.env.BASE_URL,
        initialIndex: orbitEntries.length - 1,
        onIndexChange: (index) => {
          startTransition(() => setSelectedIndex(index))
        },
      })
      sceneRef.current = controller
      setSceneState('ready')
      return () => {
        sceneRef.current = null
        controller.dispose()
      }
    } catch (error) {
      console.error('3Dタイムラインを開始できませんでした:', error)
      setSceneState('fallback')
    }
  }, [])

  const selectedItems = useMemo(() => {
    const ids = data.outfitItemIds.get(selected.outfit.key) ?? new Set<string>()
    return [...ids]
      .map((id) => data.itemMap.get(id))
      .filter((item): item is NonNullable<typeof item> => item != null && !item.hidden)
  }, [data, selected.outfit.key])

  const openOutfit = openOutfitKey
    ? orbitEntries[outfitIndex.get(openOutfitKey) ?? -1]?.outfit
    : undefined
  const similarOutfits = useMemo(
    () => (openOutfit ? findSimilarOutfits(openOutfit, data, hair, 6) : []),
    [data, hair, openOutfit],
  )
  const openIndex = openOutfit ? (outfitIndex.get(openOutfit.key) ?? -1) : -1

  const navigate = (index: number) => {
    sceneRef.current?.setIndex(index)
    if (sceneState === 'fallback') setSelectedIndex(index)
  }

  return (
    <main className="orbit-view">
      <div ref={canvasHostRef} className="orbit-canvas" aria-hidden={sceneState === 'fallback'} />

      <div className="orbit-vignette" aria-hidden="true" />
      <header className="orbit-intro">
        <p className="orbit-kicker mono">667 DAYS IN ORBIT</p>
        <h1 className="orbit-title jp">出勤服の軌道</h1>
        <p className="orbit-lead jp">
          スクロール、ドラッグ、上下キーで時間を移動。ひとつの定点から生まれた毎日の装いを、
          2022年から現在まで辿れます。
        </p>
      </header>

      {sceneState === 'loading' ? (
        <div className="orbit-loading mono" role="status">
          BUILDING ORBIT…
        </div>
      ) : null}

      {sceneState === 'fallback' ? (
        <div className="orbit-fallback">
          <img
            src={`${import.meta.env.BASE_URL}cutouts/${selected.outfit.key}.webp`}
            alt={selected.outfit.title}
          />
          <p className="jp">この環境では3D表示を利用できないため、1日ずつ表示しています。</p>
        </div>
      ) : null}

      <nav className="orbit-years" aria-label="年へ移動">
        {yearStarts.map(({ year, index }) => (
          <button
            key={year}
            className={selected.year === year ? 'active mono' : 'mono'}
            onClick={() => navigate(index)}
          >
            {year}
          </button>
        ))}
      </nav>

      <section className="orbit-detail" aria-live="polite">
        <div className="orbit-detail-number mono">
          <span>{selected.outfit.no != null ? `#${selected.outfit.no}` : 'OOTD'}</span>
          <span>
            {selectedIndex + 1} / {orbitEntries.length}
          </span>
        </div>
        <div className="orbit-detail-main">
          <img
            src={`${import.meta.env.BASE_URL}cutouts/${selected.outfit.key}.webp`}
            alt=""
            width={cutouts.sprites[selected.outfit.key]?.w}
            height={cutouts.sprites[selected.outfit.key]?.h}
          />
          <div>
            <h2 className="mono">{fmtDate(selected.outfit.date)}</h2>
            <p className="orbit-weather mono">{weatherLabel(selectedWeather)}</p>
            <div className="orbit-item-list">
              {selectedItems.slice(0, 4).map((item) => {
                const bucket = colorBuckets.find((candidate) => candidate.name === item.color)
                return (
                  <span key={item.id} className="orbit-item jp">
                    {bucket ? (
                      <i style={{ background: bucket.swatch }} aria-hidden="true" />
                    ) : null}
                    {item.label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
        <div className="orbit-detail-actions">
          <button
            className="orbit-nav-button jp"
            disabled={selectedIndex === 0}
            onClick={() => navigate(selectedIndex - 1)}
          >
            ← 過去へ
          </button>
          <button className="orbit-open-button jp" onClick={() => setOpenOutfitKey(selected.outfit.key)}>
            詳細を見る
          </button>
          <button
            className="orbit-nav-button jp"
            disabled={selectedIndex === orbitEntries.length - 1}
            onClick={() => navigate(selectedIndex + 1)}
          >
            現在へ →
          </button>
        </div>
      </section>

      <div className="orbit-scrubber">
        <span className="mono">2022</span>
        <input
          type="range"
          min={0}
          max={orbitEntries.length - 1}
          value={selectedIndex}
          aria-label="出勤服の日付を移動"
          onChange={(event) => navigate(Number(event.target.value))}
        />
        <span className="mono">NOW</span>
      </div>

      {openOutfit ? (
        <OutfitModal
          outfit={openOutfit}
          data={data}
          splits={splits}
          hair={hair}
          similarOutfits={similarOutfits}
          onOpenSimilar={setOpenOutfitKey}
          onAssign={onAssign}
          onCreateSub={onCreateSub}
          onMoveOutfit={onMoveOutfit}
          onSetHair={onSetHair}
          onClose={() => setOpenOutfitKey(null)}
          onPrev={
            openIndex > 0
              ? () => setOpenOutfitKey(orbitEntries[openIndex - 1].outfit.key)
              : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < orbitEntries.length - 1
              ? () => setOpenOutfitKey(orbitEntries[openIndex + 1].outfit.key)
              : undefined
          }
          onItemClick={(itemId) => {
            setOpenOutfitKey(null)
            onShowItem(itemId)
          }}
        />
      ) : null}
    </main>
  )
}
