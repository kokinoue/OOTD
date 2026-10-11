import { describe, expect, it } from 'vitest'
import { groupByDate, monthGrid, monthsWithOutfits } from '../calendar'

describe('calendar', () => {
  it('builds a Monday-first grid padded to whole weeks', () => {
    // 2026-10-01 は木曜日 → 月火水の3マスが空く
    const cells = monthGrid('2026-10')
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(cells.length % 7).toBe(0)
    expect(cells.filter(Boolean)).toHaveLength(31)
    expect(cells.at(-1)).toBe(null) // 10/31 は土曜 → 日曜のマスが空く
  })

  it('handles leap years and months starting on Monday', () => {
    expect(monthGrid('2024-02').filter(Boolean)).toHaveLength(29)
    expect(monthGrid('2026-06')[0]).toBe('2026-06-01') // 2026-06-01 は月曜日
  })

  it('groups outfits by date and lists months newest first', () => {
    const list = [
      { date: '2026-10-09', key: 'a' },
      { date: '2026-10-09', key: 'b' },
      { date: '2026-09-30', key: 'c' },
      { date: '2025-12-01', key: 'd' },
    ]
    expect(groupByDate(list).get('2026-10-09')?.map((o) => o.key)).toEqual(['a', 'b'])
    expect(monthsWithOutfits(list)).toEqual(['2026-10', '2026-09', '2025-12'])
  })
})
