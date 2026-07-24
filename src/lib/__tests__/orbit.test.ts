import { describe, expect, it } from 'vitest'
import { buildOrbitLayout, clampOrbitIndex, visibleOrbitRange } from '../orbit'
import type { Outfit } from '../../types'

const outfit = (key: string, date: string): Outfit => ({
  key,
  no: Number(key),
  title: key,
  date,
  publishAt: `${date}T09:00:00+09:00`,
  like: 0,
  comment: '',
  noteUrl: '',
  images: [],
  itemIds: [],
})

describe('buildOrbitLayout', () => {
  it('sorts outfits from oldest to newest and places them on a stable helix', () => {
    const layout = buildOrbitLayout([
      outfit('3', '2024-01-03'),
      outfit('1', '2024-01-01'),
      outfit('2', '2024-01-02'),
    ])

    expect(layout.map((entry) => entry.outfit.key)).toEqual(['1', '2', '3'])
    expect(layout.map((entry) => entry.index)).toEqual([0, 1, 2])

    for (const entry of layout) {
      expect(Math.hypot(entry.position.x, entry.position.z)).toBeCloseTo(5.6, 5)
    }
    expect(layout[1].position.y).toBeGreaterThan(layout[0].position.y)
    expect(layout[2].angle).toBeGreaterThan(layout[1].angle)
  })
})

describe('orbit navigation helpers', () => {
  it('clamps navigation to an existing outfit', () => {
    expect(clampOrbitIndex(-3, 10)).toBe(0)
    expect(clampOrbitIndex(4.5, 10)).toBe(4.5)
    expect(clampOrbitIndex(99, 10)).toBe(9)
    expect(clampOrbitIndex(2, 0)).toBe(0)
  })

  it('returns a bounded texture-loading window', () => {
    expect(visibleOrbitRange(2, 20, 4)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(visibleOrbitRange(18, 20, 4)).toEqual([14, 15, 16, 17, 18, 19])
  })
})
