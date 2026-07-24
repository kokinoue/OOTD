import type { Outfit } from '../types'

export const ORBIT_RADIUS = 5.6
export const ORBIT_ANGLE_STEP = 0.47
export const ORBIT_Y_STEP = 0.34

export type OrbitEntry = {
  outfit: Outfit
  index: number
  angle: number
  year: number
  position: {
    x: number
    y: number
    z: number
  }
}

export type OrbitColorPoint = {
  color: string | null
  position: OrbitEntry['position']
}

export function buildOrbitLayout(source: Outfit[]): OrbitEntry[] {
  const chronological = [...source].sort(
    (a, b) => a.date.localeCompare(b.date) || a.publishAt.localeCompare(b.publishAt),
  )

  return chronological.map((outfit, index) => {
    const angle = index * ORBIT_ANGLE_STEP
    return {
      outfit,
      index,
      angle,
      year: Number(outfit.date.slice(0, 4)),
      position: {
        x: Math.sin(angle) * ORBIT_RADIUS,
        y: index * ORBIT_Y_STEP,
        z: Math.cos(angle) * ORBIT_RADIUS,
      },
    }
  })
}

export function dominantOrbitColor(
  colors: Iterable<string | undefined>,
  colorOrder: readonly string[],
): string | null {
  const counts = new Map<string, number>()
  for (const color of colors) {
    if (color && colorOrder.includes(color)) counts.set(color, (counts.get(color) ?? 0) + 1)
  }

  let dominant: string | null = null
  let dominantCount = 0
  for (const color of colorOrder) {
    const count = counts.get(color) ?? 0
    if (count > dominantCount) {
      dominant = color
      dominantCount = count
    }
  }
  return dominant
}

/**
 * 時間軸の高さを保ったまま、各コーデを代表色ごとの縦の軌道へ再配置する。
 * 日付の現在地を失わず、色のまとまりだけを読み替えられるレイアウト。
 */
export function buildOrbitColorLayout(
  entries: OrbitEntry[],
  colorsByOutfit: ReadonlyMap<string, Iterable<string | undefined>>,
  colorOrder: readonly string[],
): OrbitColorPoint[] {
  const colorCount = Math.max(1, colorOrder.length)
  return entries.map((entry) => {
    const dominant = dominantOrbitColor(colorsByOutfit.get(entry.outfit.key) ?? [], colorOrder)
    if (dominant == null) {
      return {
        color: null,
        position: {
          x: entry.position.x * 0.5,
          y: entry.position.y,
          z: entry.position.z * 0.5,
        },
      }
    }

    const colorIndex = colorOrder.indexOf(dominant)
    const strandAngle = (colorIndex / colorCount) * Math.PI * 2
    const weave = ((entry.index % 7) - 3) * 0.012
    const radius = ORBIT_RADIUS - 0.35 + ((entry.index % 5) - 2) * 0.07
    const angle = strandAngle + weave
    return {
      color: dominant,
      position: {
        x: Math.sin(angle) * radius,
        y: entry.position.y,
        z: Math.cos(angle) * radius,
      },
    }
  })
}

export function outfitIndicesForItem(
  entries: OrbitEntry[],
  outfitItemIds: ReadonlyMap<string, ReadonlySet<string>>,
  itemId: string,
): number[] {
  const indices: number[] = []
  for (const entry of entries) {
    if (outfitItemIds.get(entry.outfit.key)?.has(itemId)) indices.push(entry.index)
  }
  return indices
}

export function clampOrbitIndex(index: number, total: number) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(total - 1, index))
}

export function visibleOrbitRange(center: number, total: number, radius: number) {
  if (total <= 0) return []
  const start = Math.max(0, Math.round(center) - radius)
  const end = Math.min(total - 1, Math.round(center) + radius)
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}
