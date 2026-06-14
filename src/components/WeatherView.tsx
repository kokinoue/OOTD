import { useMemo, useState } from 'react'
import { outfits } from '../lib/useData'
import {
  analyzeCategory,
  doyToMMDD,
  isLayeredCategory,
  labelOf,
  latestWeatherDate,
  seasonForecast,
  SEASONAL_CATEGORIES,
  weather,
} from '../lib/weather'

// 気温→色（青=寒い 〜 赤=暑い）
const tempColor = (t: number) => {
  const c = Math.max(0, Math.min(35, t))
  const hue = 210 - (c / 35) * 200
  return `hsl(${hue}, 70%, 52%)`
}

const SIZE = 360
const CX = SIZE / 2
const CY = SIZE / 2
const R_MAX = 150
const R_MIN = 46

// day-of-year → 角度（1/1が真上、時計回り）
const angleOf = (doy: number) => (doy / 365.25) * 2 * Math.PI
const polar = (r: number, doy: number) => ({
  x: CX + r * Math.sin(angleOf(doy)),
  y: CY - r * Math.cos(angleOf(doy)),
})

const MONTH_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

const realTodayDoy = () => {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000)
}

export default function WeatherView() {
  const available = useMemo(
    () => SEASONAL_CATEGORIES.filter((c) => analyzeCategory(c) != null),
    [],
  )
  const [category, setCategory] = useState(available[0] ?? 'coat')
  const analysis = useMemo(() => analyzeCategory(category), [category])
  const forecast = useMemo(() => (analysis ? seasonForecast(analysis) : null), [analysis])

  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const o of outfits) ys.add(Number(o.date.slice(0, 4)))
    return [...ys].sort((a, b) => a - b)
  }, [])
  const ringR = (year: number) => {
    if (years.length <= 1) return R_MAX
    const i = years.indexOf(year)
    return R_MIN + ((R_MAX - R_MIN) * i) / (years.length - 1)
  }

  const todayDoy = realTodayDoy()
  const lastDate = latestWeatherDate()
  const todayTemp = weather[lastDate]?.max ?? null

  // 解禁予報の状態文
  const countdown = (() => {
    if (!forecast?.avgDoy) return null
    let diff = forecast.avgDoy - todayDoy
    // 年をまたぐ場合は +365 して「次の解禁」までを出す
    if (diff < -120) diff += 365
    const mmdd = doyToMMDD(forecast.avgDoy)
    if (diff > 0 && diff <= 200) return { kind: 'upcoming' as const, days: diff, mmdd }
    if (diff <= 0 && diff > -120) return { kind: 'open' as const, days: -diff, mmdd }
    return { kind: 'far' as const, days: diff, mmdd }
  })()

  // ロジスティック曲線（P vs 気温 0..35）
  const curve = useMemo(() => {
    if (!analysis) return ''
    const pts: string[] = []
    const w = 200
    const h = 70
    for (let t = 0; t <= 35; t += 0.5) {
      const p = analysis.prob(t)
      pts.push(`${(t / 35) * w},${h - p * h}`)
    }
    return pts.join(' ')
  }, [analysis])

  if (!analysis || !forecast) {
    return <main className="weather"><p className="empty jp">データがありません</p></main>
  }

  const showThreshold = analysis.thresholdReliable && analysis.threshold != null
  const thrX = showThreshold ? (Math.max(0, Math.min(35, analysis.threshold!)) / 35) * 200 : null

  return (
    <main className="weather">
      <div className="filterbar">
        <div className="filter-row">
          {available.map((c) => (
            <button
              key={c}
              className={category === c ? 'chip active' : 'chip'}
              onClick={() => setCategory(c)}
            >
              {labelOf(c)}
            </button>
          ))}
        </div>
      </div>

      <div className="weather-grid">
        {/* 極座標プロット: 1年=円環、4年=同心リング、打点=着用日（色=その日の気温） */}
        <figure className="polar-wrap">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="polar">
            {/* 年リング */}
            {years.map((y) => (
              <circle key={y} cx={CX} cy={CY} r={ringR(y)} className="polar-ring" />
            ))}
            {/* 月スポーク + ラベル */}
            {MONTH_DOY.map((d, i) => {
              const outer = polar(R_MAX + 4, d)
              const inner = polar(R_MIN - 14, d)
              const lab = polar(R_MAX + 18, d + 15)
              return (
                <g key={i}>
                  <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="polar-spoke" />
                  <text x={lab.x} y={lab.y} className="polar-month mono">
                    {i + 1}
                  </text>
                </g>
              )
            })}
            {/* 着用日の打点 */}
            {analysis.points.map((p, i) => {
              const { x, y } = polar(ringR(p.year), p.doy)
              return <circle key={i} cx={x} cy={y} r={2.4} fill={tempColor(p.temp)} opacity={0.85} />
            })}
            <text x={CX} y={CY - 4} className="polar-center-label jp">
              {forecast.label}
            </text>
            <text x={CX} y={CY + 12} className="polar-center-sub mono">
              {analysis.wornCount}日
            </text>
          </svg>
          <figcaption className="jp">
            中心から外へ {years[0]}→{years[years.length - 1]} 年。点 = 着用日（色は当日の最高気温）
            {isLayeredCategory(category) && (
              <>
                <br />
                ※一番外側に着た日のみ（インナー使いは除外）
              </>
            )}
          </figcaption>
        </figure>

        {/* 私的気温閾値 */}
        <div className="weather-panel">
          <section className="threshold-card">
            <div className="threshold-head jp">{forecast.label}を着る気温</div>
            {showThreshold ? (
              <div className="threshold-value">
                <span className="mono big">{analysis.threshold!.toFixed(1)}</span>
                <span className="threshold-unit">℃</span>
                <span className="threshold-desc jp">
                  最高気温が
                  {analysis.direction === 'cold' ? 'これを下回ると' : 'これを上回ると'}
                  着用確率50%
                </span>
              </div>
            ) : (
              <div className="threshold-value">
                <span className="mono big">{analysis.wornAvg}</span>
                <span className="threshold-unit">℃</span>
                <span className="threshold-desc jp">
                  着た日の平均最高気温（{analysis.direction === 'cold' ? '寒い' : '暖かい'}日中心だが
                  気温との相関はゆるやか）
                </span>
              </div>
            )}
            <svg viewBox="0 0 200 70" className="logistic" preserveAspectRatio="none">
              <polyline points={curve} className="logistic-line" />
              {thrX != null && (
                <line x1={thrX} y1={0} x2={thrX} y2={70} className="logistic-thr" />
              )}
            </svg>
            <div className="threshold-axis mono">
              <span>0℃</span>
              <span>35℃</span>
            </div>
            <div className="threshold-stats jp">
              着た日の平均 <b className="mono">{analysis.wornAvg}℃</b> ／ 着なかった日{' '}
              <b className="mono">{analysis.notWornAvg}℃</b>
            </div>
          </section>

          {/* 解禁予報 */}
          <section className="forecast-card">
            <div className="forecast-head jp">
              {forecast.label}
              {analysis.direction === 'cold' ? 'シーズンイン' : 'シーズンイン'}
            </div>
            {countdown && (
              <div className={`forecast-countdown ${countdown.kind}`}>
                {countdown.kind === 'upcoming' && (
                  <span className="jp">
                    解禁まで <b className="mono big">{countdown.days}</b> 日
                    <span className="dim">（平年 {countdown.mmdd}）</span>
                  </span>
                )}
                {countdown.kind === 'open' && (
                  <span className="jp">
                    <b className="mono">{countdown.days}</b> 日前に解禁済み
                    <span className="dim">（平年 {countdown.mmdd}）</span>
                  </span>
                )}
                {countdown.kind === 'far' && (
                  <span className="jp dim">オフシーズン（平年解禁 {countdown.mmdd}）</span>
                )}
              </div>
            )}
            <ul className="forecast-years">
              {forecast.perYear.map((p) => (
                <li key={p.year}>
                  <span className="mono fy-year">{p.year}</span>
                  {p.firstDate ? (
                    <span className="mono fy-date">{p.firstDate.slice(5).replace('-', '/')}</span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </li>
              ))}
            </ul>
            {todayTemp != null && (
              <p className="forecast-now jp">
                直近の最高気温 <b className="mono">{todayTemp}℃</b>（{lastDate.slice(5).replace('-', '/')}）
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
