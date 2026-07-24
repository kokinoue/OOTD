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
