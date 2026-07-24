import { useEffect, useMemo, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import { SKY_LABELS, SKY_ORDER, type Sky, skyOfDay, weather } from '../lib/weather'

type Props = {
  data: Data
  /** アイテム絞り込みで FITS へ（定番アイテムのチップから） */
  onShowFits: (itemId: string) => void
  /** その日のコーデを FITS で開く（カードのタップから） */
  onShowDate: (date: string) => void
}

// 同じ「陽気」とみなす平均気温の幅（±℃）
const BAND = 2.5
// グリッドに出す最大枚数（近い順）
const MAX_CARDS = 36
// 気温クイック選択
const PRESETS = [5, 10, 15, 20, 25, 30]

// 月初までの累積日数（非閏年基準）。月日→年内通算日に使う
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const dayOfYear = (m: number, d: number) => CUM_DAYS[m - 1] + d
const circularDist = (a: number, b: number) => {
  const x = Math.abs(a - b)
  return Math.min(x, 365 - x)
}

/** 例年の「今日（前後3日）」の平均気温。なければ全期間の中央値。スライダー初期値に使う */
function seasonalDefaultTemp(): number {
  const now = new Date()
  const today = dayOfYear(now.getMonth() + 1, now.getDate())
  const means: number[] = []
  for (const [date, w] of Object.entries(weather)) {
    if (w.mean == null) continue
    const m = Number(date.slice(5, 7))
    const d = Number(date.slice(8, 10))
    if (circularDist(dayOfYear(m, d), today) <= 3) means.push(w.mean)
  }
  if (means.length > 0) {
    return Math.round(means.reduce((s, x) => s + x, 0) / means.length)
  }
  const all = Object.values(weather)
    .map((w) => w.mean)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b)
  return all.length > 0 ? Math.round(all[Math.floor(all.length / 2)]) : 18
}

export default function TodayPickView({ data, onShowFits, onShowDate }: Props) {
  const seasonal = useMemo(seasonalDefaultTemp, [])
  const [temp, setTemp] = useState(seasonal)
  // 天気フィルタ（null = すべて）
  const [sky, setSky] = useState<Sky | null>(null)

  // 目標気温に近い日を、近い順に集める（画像のある日のみ）。天気フィルタ前の母集団
  const tempMatches = useMemo(() => {
    return outfits
      .map((o) => ({ o, mean: weather[o.date]?.mean ?? null }))
      .filter((x): x is { o: (typeof outfits)[number]; mean: number } => x.mean != null)
      .filter((x) => Math.abs(x.mean - temp) <= BAND && x.o.images[0] != null)
      .sort(
        (a, b) =>
          Math.abs(a.mean - temp) - Math.abs(b.mean - temp) ||
          (a.o.date < b.o.date ? 1 : -1),
      )
  }, [temp])

  // この気温帯での天気の内訳。チップに件数を出し、0件の天気はチップを出さない
  const skyCounts = useMemo(() => {
    const c: Record<Sky, number> = { sunny: 0, cloudy: 0, rain: 0, snow: 0 }
    for (const { o } of tempMatches) {
      const s = skyOfDay(weather[o.date])
      if (s) c[s]++
    }
    return c
  }, [tempMatches])

  // 選んだ天気で絞った最終結果
  const matches = useMemo(
    () =>
      sky == null
        ? tempMatches
        : tempMatches.filter((m) => skyOfDay(weather[m.o.date]) === sky),
    [tempMatches, sky],
  )

  // 気温を変えて選択中の天気が0件になったら「すべて」に戻す
  useEffect(() => {
    if (sky != null && skyCounts[sky] === 0) setSky(null)
  }, [sky, skyCounts])

  // この条件の「定番アイテム」: 該当日の中での出現回数が多い順
  const staples = useMemo(() => {
    const tally = new Map<string, number>()
    for (const { o } of matches) {
      for (const id of data.outfitItemIds.get(o.key) ?? []) {
        tally.set(id, (tally.get(id) ?? 0) + 1)
      }
    }
    return [...tally.entries()]
      .map(([id, count]) => ({ item: data.itemMap.get(id), count }))
      .filter((x): x is { item: NonNullable<typeof x.item>; count: number } => x.item != null)
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count || b.item.count - a.item.count)
      .slice(0, 8)
  }, [matches, data])

  const avgLike =
    matches.length > 0
      ? Math.round(matches.reduce((s, m) => s + m.o.like, 0) / matches.length)
      : 0

  return (
    <main className="today">
      <div className="today-head">
        <h2 className="today-title jp">気温で選ぶ、今日の一着</h2>
        <p className="today-lead jp">
          気温を合わせると、過去に<strong>同じくらいの陽気</strong>だった日の出勤服が並びます。
        </p>
      </div>

      <div className="today-control">
        <div className="today-temp">
          <span className="today-temp-value mono">{temp}</span>
          <span className="today-temp-unit jp">℃ の日</span>
        </div>
        <input
          className="today-slider"
          type="range"
          min={-2}
          max={38}
          step={1}
          value={temp}
          aria-label="気温"
          onChange={(e) => setTemp(Number(e.target.value))}
        />
        <div className="today-presets">
          {PRESETS.map((t) => (
            <button
              key={t}
              className={t === temp ? 'chip sm active' : 'chip sm'}
              onClick={() => setTemp(t)}
            >
              <span className="mono">{t}</span>
              <span className="jp">℃</span>
            </button>
          ))}
          <button
            className={temp === seasonal ? 'chip sm active' : 'chip sm'}
            onClick={() => setTemp(seasonal)}
            title="例年の今日ごろの平均気温に合わせる"
          >
            <span className="jp">今日の陽気</span>
            <span className="mono">{seasonal}℃</span>
          </button>
        </div>

        <div className="today-weather">
          <span className="today-weather-label jp">天気</span>
          <button
            className={sky == null ? 'chip sm active' : 'chip sm'}
            onClick={() => setSky(null)}
          >
            <span className="jp">すべて</span>
            <span className="chip-count mono">{tempMatches.length}</span>
          </button>
          {SKY_ORDER.filter((s) => skyCounts[s] > 0).map((s) => (
            <button
              key={s}
              className={sky === s ? 'chip sm active' : 'chip sm'}
              onClick={() => setSky(sky === s ? null : s)}
            >
              <span className="jp">{SKY_LABELS[s]}</span>
              <span className="chip-count mono">{skyCounts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="today-summary jp">
        平均 <span className="mono">{temp}</span>℃ 前後（±{BAND}℃）
        {sky != null && <>・{SKY_LABELS[sky]}</>}の日は{' '}
        <strong className="mono">{matches.length}</strong> 件
        {matches.length > 0 && (
          <>
            {' '}· 平均 <span className="mono">♡ {avgLike}</span>
          </>
        )}
      </p>

      {staples.length > 0 && (
        <section className="today-staples">
          <h3 className="today-section-title jp">この陽気の定番アイテム</h3>
          <div className="today-staple-chips">
            {staples.map(({ item, count }) => (
              <button
                key={item.id}
                className="chip item-chip"
                onClick={() => onShowFits(item.id)}
                title={`${item.label} のコーデを見る`}
              >
                <span className="chip-cat mono">{item.category}</span>
                {item.label}
                <span className="chip-count mono">{count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {matches.length === 0 ? (
        <p className="empty jp">条件に合う日が記録にありません。気温や天気を変えてみてください</p>
      ) : (
        <div className="grid">
          {matches.slice(0, MAX_CARDS).map(({ o, mean }) => (
            <button key={o.key} className="card" onClick={() => onShowDate(o.date)}>
              <img
                src={thumb(o.images[0].url, 480)}
                alt={o.title}
                loading="lazy"
                decoding="async"
              />
              <span className="card-meta mono">
                <span>{fmtDate(o.date)}</span>
                <span className="card-no">{Math.round(mean)}℃</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {matches.length > MAX_CARDS && (
        <p className="today-more jp">
          近い順に {MAX_CARDS} 件を表示しています（全 {matches.length} 件）
        </p>
      )}
    </main>
  )
}
