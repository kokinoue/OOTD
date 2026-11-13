import { useEffect, useMemo, useState } from 'react'
import { groupByDate, monthGrid, monthsWithOutfits } from '../lib/calendar'
import { useI18n } from '../lib/i18n'
import { fmtDate, thumb } from '../lib/useData'
import type { Outfit } from '../types'

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

type Props = {
  outfits: Outfit[]
  /** モーダルで開いているコーデの日付。前後送りで月をまたいだら、カレンダーもその月へ追従する */
  focusDate: string | null
  onOpen: (key: string, thumb: HTMLElement | null) => void
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 絞り込み結果を月カレンダーで見る。日付のマスにその日のサムネを置き、撮っていない日は空けておく。
export default function FitsCalendar({ outfits, focusDate, onOpen }: Props) {
  const { t } = useI18n()
  const months = useMemo(() => monthsWithOutfits(outfits), [outfits])
  const byDate = useMemo(() => groupByDate(outfits), [outfits])
  const [picked, setPicked] = useState<string | null>(null)

  // 絞り込みで選んでいた月が消えたら、いちばん新しい月に戻す
  const month = picked && months.includes(picked) ? picked : months[0]
  const index = months.indexOf(month)
  const older = months[index + 1]
  const newer = months[index - 1]

  // 「似ている出勤服」から絞り込み外のコーデを開いた場合は、今見ている月を保つ
  useEffect(() => {
    if (focusDate && months.includes(focusDate.slice(0, 7))) setPicked(focusDate.slice(0, 7))
  }, [focusDate, months])

  if (!month) return null
  const cells = monthGrid(month)
  const today = todayStr()
  const days = cells.filter((d) => d && byDate.has(d)).length

  return (
    <section className="cal" aria-label={month.replace('-', '.')}>
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          onClick={() => setPicked(older)}
          disabled={!older}
          aria-label={t('前の月')}
        >
          ←
        </button>
        <h2 className="cal-title mono">{month.replace('-', '.')}</h2>
        <span className="cal-count mono">{t('{count}日', { count: days })}</span>
        <button
          type="button"
          className="cal-nav"
          onClick={() => setPicked(newer)}
          disabled={!newer}
          aria-label={t('次の月')}
        >
          →
        </button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i >= 5 ? 'cal-weekday weekend mono' : 'cal-weekday mono'}>
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`pad-${i}`} className="cal-cell pad" aria-hidden="true" />
          const day = Number(date.slice(8))
          const list = byDate.get(date)
          const isToday = date === today
          const first = list?.[0]
          if (!first) {
            const cls = ['cal-cell blank', isToday && 'today', date > today && 'future']
            return (
              <span key={date} className={cls.filter(Boolean).join(' ')}>
                <span className="cal-day mono">{day}</span>
              </span>
            )
          }
          return (
            <button
              key={date}
              type="button"
              className={isToday ? 'cal-cell has today' : 'cal-cell has'}
              data-outfit-key={first.key}
              onClick={(e) => onOpen(first.key, e.currentTarget.querySelector('img'))}
              aria-label={`${fmtDate(date)} ${first.title}`}
            >
              {first.images[0] && (
                <img src={thumb(first.images[0].url, 240)} alt="" loading="lazy" decoding="async" />
              )}
              <span className="cal-day mono">{day}</span>
              {list.length > 1 && <span className="cal-more mono">+{list.length - 1}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}
