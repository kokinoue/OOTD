import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { Card, Forecast, LockInfo } from '../lib/shiki'
import { useI18n } from '../lib/i18n'
import type { Sky } from '../lib/weather'

// 四季通勤の表示部品（アイコン・快適帯のバー・コーデカード・予報の帯）。
// ルールは lib/shiki.ts、進行は ShikiGameView.tsx が持つ。ここは見た目だけ。

export const spriteUrl = (key: string) => `${import.meta.env.BASE_URL}cutouts/${key}.webp`

type IconProps = { className?: string }
const Svg = ({ className, children }: IconProps & { children: ReactNode }) => (
  <svg
    className={className ? `shiki-icon ${className}` : 'shiki-icon'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </Svg>
)
export const CloudIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18.5a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.6a4.45 4.45 0 0 1 0 8.9H7z" />
  </Svg>
)
export const RainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 6.1a4.45 4.45 0 0 1 0 8.9H7z" />
    <path d="M8.5 18.2l-.8 2.3M12.4 18.2l-.8 2.3M16.3 18.2l-.8 2.3" />
  </Svg>
)
export const SnowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
  </Svg>
)
export const UmbrellaIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 0 1 17 0z" />
    <path d="M12 12v7a2 2 0 0 1-4 0M12 3.5V2.5" />
  </Svg>
)
export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.3S4 15.4 4 9.6A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 8 2.2c0 5.8-8 10.7-8 10.7z" />
  </Svg>
)
export const RestIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
    <circle cx="12" cy="13" r="4" />
    <path d="M7.5 7h2" />
  </Svg>
)
export const SkyIcon = ({ sky, className }: { sky: Sky; className?: string }) =>
  sky === 'sunny' ? (
    <SunIcon className={className} />
  ) : sky === 'rain' ? (
    <RainIcon className={className} />
  ) : sky === 'snow' ? (
    <SnowIcon className={className} />
  ) : (
    <CloudIcon className={className} />
  )

export type Axis = { min: number; max: number }
const pct = (axis: Axis, v: number) => `${Math.min(100, Math.max(0, ((v - axis.min) / (axis.max - axis.min)) * 100))}%`
const span = (axis: Axis, lo: number, hi: number) => ({
  left: pct(axis, lo),
  width: `${Math.max(1.5, ((Math.min(axis.max, hi) - Math.max(axis.min, lo)) / (axis.max - axis.min)) * 100)}%`,
})

/**
 * 快適帯のバー。塗りがその服の快適帯、縦線が朝の気温、斜線の帯が午後の最高気温の予報幅。
 * 縦線と斜線が塗りの中に収まっていれば、その日は快適に過ごせる。
 */
export function BandBar({
  lo,
  hi,
  axis,
  am,
  pm,
}: {
  lo: number
  hi: number
  axis: Axis
  am?: number | null
  pm?: [number, number] | null
}) {
  return (
    <div className="shiki-band">
      <div className="shiki-band-track">
        <div className="shiki-band-fill" style={span(axis, lo, hi)} />
        {pm && <div className="shiki-band-pm" style={span(axis, pm[0], pm[1])} />}
        {am != null && <div className="shiki-band-am" style={{ left: pct(axis, am) }} />}
      </div>
      <div className="shiki-band-label mono">
        {lo}–{hi}℃
      </div>
    </div>
  )
}

export type Verdict = { kind: 'safe' | 'risk' | 'cold' | 'hot'; text: string }

type CardProps = {
  card: Card
  band: { lo: number; hi: number }
  axis: Axis
  am?: number | null
  pm?: [number, number] | null
  verdict?: Verdict | null
  lock?: LockInfo | null
  selected?: boolean
  /** いま選んでいる服を着ると、この服は明日休ませ中になる */
  willRest?: boolean
  rewear?: boolean
  /** 雨の予報なのに雨に弱い */
  rainRisk?: boolean
  /** 衣替えで、選択中の他の服とアイテムがかぶっている数 */
  overlap?: number
  disabled?: boolean
  onClick?: () => void
}

export function OutfitCard({
  card,
  band,
  axis,
  am,
  pm,
  verdict,
  lock,
  selected,
  willRest,
  rewear,
  rainRisk,
  overlap,
  disabled,
  onClick,
}: CardProps) {
  const { t } = useI18n()
  const locked = lock?.locked ?? false
  const cls = ['shiki-card', selected && 'selected', locked && 'locked', verdict && `v-${verdict.kind}`]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      <span className="shiki-card-figure">
        <img src={spriteUrl(card.key)} alt="" loading="lazy" draggable={false} />
        <span className="shiki-card-tags">
          <span className="shiki-tag mono" title={t('見映え（noteのスキ数）')}>
            <HeartIcon />
            {card.like}
          </span>
          {card.rainProof && (
            <span className="shiki-tag" title={t('雨に強い')}>
              <UmbrellaIcon />
            </span>
          )}
        </span>
        {locked && (
          <span className="shiki-card-lock jp">
            <RestIcon />
            {t('休ませ中 あと{n}日', { n: lock!.turns })}
          </span>
        )}
        {!locked && willRest && <span className="shiki-card-note jp">{t('明日は休み')}</span>}
        {!locked && !willRest && rewear && <span className="shiki-card-note jp">{t('2回目')}</span>}
        {overlap != null && overlap > 0 && (
          <span className="shiki-card-note jp">{t('かぶり {n}', { n: overlap })}</span>
        )}
      </span>
      <BandBar lo={band.lo} hi={band.hi} axis={axis} am={am} pm={pm} />
      {verdict && (
        <span className={`shiki-verdict jp v-${verdict.kind}`}>
          {verdict.text}
          {rainRisk && <span className="shiki-verdict-rain"> · {t('雨に弱い')}</span>}
        </span>
      )}
    </button>
  )
}

export type ForecastCell = {
  key: string
  label: string
  forecast: Forecast
  today?: boolean
  past?: boolean
  /** 衣替え中: この日に合いそうな服がいま何着選ばれているか */
  fits?: number
}

export function ForecastStrip({ cells }: { cells: ForecastCell[] }) {
  const { t } = useI18n()
  return (
    <div className="shiki-forecast" role="list" aria-label={t('この先の予報')}>
      {cells.map((c) => {
        const f = c.forecast
        const am = f.amLo === f.amHi ? `${f.amLo}` : `${f.amLo}–${f.amHi}`
        return (
          <div
            key={c.key}
            role="listitem"
            className={['shiki-fc', c.today && 'today', c.past && 'past'].filter(Boolean).join(' ')}
          >
            <span className="shiki-fc-day mono">{c.label}</span>
            <span className="shiki-fc-row">
              <span className="shiki-fc-k jp">{t('朝')}</span>
              <span className="mono">{am}℃</span>
            </span>
            <span className="shiki-fc-row">
              <span className="shiki-fc-k jp">{t('午後')}</span>
              <span className="mono">
                {f.pmLo}–{f.pmHi}℃
              </span>
            </span>
            <span className={f.rainPct >= 50 ? 'shiki-fc-rain wet mono' : 'shiki-fc-rain mono'}>
              <UmbrellaIcon />
              {f.rainPct}%
            </span>
            {c.fits != null && (
              <span className={c.fits === 0 ? 'shiki-fc-fits none jp' : 'shiki-fc-fits jp'}>
                {t('合う服 {n}', { n: c.fits })}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 出勤中、朝の気温から午後の最高気温まで数字が動いていく（その日の答えが出る瞬間） */
export function TempReveal({ from, to, ms, lo, hi }: { from: number; to: number; ms: number; lo: number; hi: number }) {
  const { t } = useI18n()
  const [now, setNow] = useState(from)
  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / ms)
      // 最後にゆっくり止まるほうが、結果を待つ時間が生まれる
      const e = 1 - Math.pow(1 - p, 2.2)
      setNow(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, ms])
  const state = now > hi ? 'hot' : now < lo ? 'cold' : 'ok'
  return (
    <div className={`shiki-reveal ${state}`} aria-live="off">
      <span className="shiki-reveal-k jp">{t('いまの気温')}</span>
      <span className="shiki-reveal-v mono">{now.toFixed(1)}℃</span>
      <span className="shiki-reveal-band mono">
        {t('快適帯')} {lo}–{hi}℃
      </span>
    </div>
  )
}
