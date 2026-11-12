import { describe, expect, it } from 'vitest'
import {
  buildOrbitColorLayout,
  buildOrbitLayout,
  clampOrbitIndex,
  dominantOrbitColor,
  orbitFraming,
  outfitIndicesForItem,
  ORBIT_BASE_CAMERA_RADIUS,
  ORBIT_BASE_FOV,
  visibleOrbitRange,
} from '../orbit'
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

describe('orbit exploration helpers', () => {
  const colorOrder = ['white', 'beige', 'black', 'blue'] as const

  it('selects the most-used outfit color and resolves ties by palette order', () => {
    expect(dominantOrbitColor(['blue', 'black', 'blue'], colorOrder)).toBe('blue')
    expect(dominantOrbitColor(['black', 'white'], colorOrder)).toBe('white')
    expect(dominantOrbitColor([undefined], colorOrder)).toBeNull()
  })

  it('morphs outfits into stable color strands without losing chronological height', () => {
    const entries = buildOrbitLayout([
      outfit('1', '2024-01-01'),
      outfit('2', '2024-01-02'),
      outfit('3', '2024-01-03'),
    ])
    const colors = new Map([
      ['1', ['blue']],
      ['2', ['white', 'white']],
      ['3', []],
    ])
    const layout = buildOrbitColorLayout(entries, colors, colorOrder)

    expect(layout.map((point) => point.color)).toEqual(['blue', 'white', null])
    expect(layout.map((point) => point.position.y)).toEqual(
      entries.map((entry) => entry.position.y),
    )
    expect(layout[0].position).toEqual(
      buildOrbitColorLayout(entries, colors, colorOrder)[0].position,
    )
    expect(layout[0].position.x).not.toBeCloseTo(layout[1].position.x, 3)
  })

  it('returns chronological indices for an item wearing trail', () => {
    const entries = buildOrbitLayout([
      outfit('3', '2024-01-03'),
      outfit('1', '2024-01-01'),
      outfit('2', '2024-01-02'),
    ])
    const itemIds = new Map([
      ['1', new Set(['coat|a'])],
      ['2', new Set(['pants|b'])],
      ['3', new Set(['coat|a', 'pants|b'])],
    ])

    expect(outfitIndicesForItem(entries, itemIds, 'coat|a')).toEqual([0, 2])
    expect(outfitIndicesForItem(entries, itemIds, 'missing')).toEqual([])
  })

  it('keeps the desktop framing untouched on wide screens', () => {
    const framing = orbitFraming(1440, 900)

    expect(framing.portrait).toBe(0)
    expect(framing.fov).toBe(ORBIT_BASE_FOV)
    expect(framing.cameraRadius).toBe(ORBIT_BASE_CAMERA_RADIUS)
    expect(framing.focusLift).toBe(0)
    expect(framing.ambientOpacity).toBe(1)
  })

  it('pulls the camera back and calms the surroundings on phone screens', () => {
    const framing = orbitFraming(390, 844)

    expect(framing.portrait).toBe(1)
    expect(framing.fov).toBeGreaterThan(ORBIT_BASE_FOV)
    expect(framing.cameraRadius).toBeGreaterThan(ORBIT_BASE_CAMERA_RADIUS)
    expect(framing.focusLift).toBeGreaterThan(0)
    expect(framing.ambientOpacity).toBeLessThan(1)
    expect(framing.haloOpacity).toBeLessThan(0.72)
  })

  it('interpolates between both framings on square-ish screens', () => {
    const framing = orbitFraming(800, 1000)
    const phone = orbitFraming(390, 844)

    expect(framing.portrait).toBeGreaterThan(0)
    expect(framing.portrait).toBeLessThan(1)
    expect(framing.cameraRadius).toBeGreaterThan(ORBIT_BASE_CAMERA_RADIUS)
    expect(framing.cameraRadius).toBeLessThan(phone.cameraRadius)
  })

  it('survives a zero-sized container without producing NaN', () => {
    const framing = orbitFraming(0, 0)

    expect(Number.isFinite(framing.fov)).toBe(true)
    expect(Number.isFinite(framing.cameraRadius)).toBe(true)
    expect(Number.isFinite(framing.focusLift)).toBe(true)
  })
})
