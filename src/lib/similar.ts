import type { Data } from './useData'
import { colorBuckets, outfits } from './useData'
import { effectiveHair } from './hair'
import { weather } from './weather'
import type { EffectiveItem, HairFile, Outfit } from '../types'

export type SimilarOutfit = {
  outfit: Outfit
  score: number
  reasons: string[]
}

const colorLabel = new Map(colorBuckets.map((c) => [c.name, c.label]))
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const SEASON_HALF_YEAR_DAYS = 182.5
const TEMP_TOLERANCE_C = 15
const isString = (value: string | undefined): value is string => typeof value === 'string'

const intersection = <T,>(a: Set<T>, b: Set<T>) => {
  const values: T[] = []
  for (const v of a) if (b.has(v)) values.push(v)
  return values
}

const nonHiddenItems = (ids: Set<string>, data: Data): EffectiveItem[] =>
  [...ids]
    .map((id) => data.itemMap.get(id))
    .filter((item): item is EffectiveItem => item != null && !item.hidden)

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const v of a) if (b.has(v)) shared += 1
  return shared / (a.size + b.size - shared)
}

const dayOfYear365 = (date: string) => {
  const month = Number(date.slice(5, 7))
  const rawDay = Number(date.slice(8, 10))
  const day = month === 2 && rawDay === 29 ? 28 : rawDay
  return MONTH_DAYS.slice(0, month - 1).reduce((sum, d) => sum + d, 0) + day
}

const seasonScore = (a: string, b: string) => {
  const diff = Math.abs(dayOfYear365(a) - dayOfYear365(b))
  const circular = Math.min(diff, 365 - diff)
  return Math.max(0, 10 * (1 - circular / SEASON_HALF_YEAR_DAYS))
}

const tempScore = (a: string, b: string) => {
  const aMax = weather[a]?.max
  const bMax = weather[b]?.max
  if (typeof aMax !== 'number' || typeof bMax !== 'number') return 0
  return Math.max(0, 10 * (1 - Math.abs(aMax - bMax) / TEMP_TOLERANCE_C))
}

const tempReason = (date: string) => {
  const max = weather[date]?.max
  return typeof max === 'number' ? `${Math.floor(max)}℃台` : null
}

const hairScoreAndReasons = (source: Outfit, candidate: Outfit, hair: HairFile) => {
  const a = effectiveHair(hair, source.key)
  const b = effectiveHair(hair, candidate.key)
  const reasons: string[] = []
  let score = 0
  if (a.color && a.color === b.color) {
    score += 3
    reasons.push(`髪色: ${b.color}`)
  }
  if (a.style && a.style === b.style) {
    score += 3
    reasons.push(`髪型: ${b.style}`)
  }
  if (a.hat && a.hat === b.hat) {
    score += 4
    reasons.push(`帽子: ${b.hat}`)
  }
  return { score, reasons }
}

export function findSimilarOutfits(
  source: Outfit,
  data: Data,
  hair: HairFile,
  limit = 6,
): SimilarOutfit[] {
  const sourceIds = data.outfitItemIds.get(source.key) ?? new Set<string>()
  const sourceVisible = nonHiddenItems(sourceIds, data)
  const sourceCategories = new Set(sourceVisible.map((item) => item.category))
  const sourceColors = new Set(sourceVisible.map((item) => item.color).filter(isString))

  return outfits
    .filter((candidate) => candidate.key !== source.key && candidate.images.length > 0)
    .map((candidate) => {
      const candidateIds = data.outfitItemIds.get(candidate.key) ?? new Set<string>()
      const candidateVisible = nonHiddenItems(candidateIds, data)
      const candidateCategories = new Set(candidateVisible.map((item) => item.category))
      const candidateColors = new Set(candidateVisible.map((item) => item.color).filter(isString))

      const sharedIds = intersection(sourceIds, candidateIds)
      const itemScore = sharedIds.length * 100
      const categoryScore = jaccard(sourceCategories, candidateCategories) * 30
      const sharedColors = intersection(sourceColors, candidateColors)
      const colorScore = Math.min(20, sharedColors.length * 10)
      const dateScore = seasonScore(source.date, candidate.date)
      const weatherScore = tempScore(source.date, candidate.date)
      const hairMatch = hairScoreAndReasons(source, candidate, hair)
      const auxiliaryScore = Math.min(
        80,
        categoryScore + colorScore + dateScore + weatherScore + hairMatch.score,
      )

      const itemReasons = sharedIds
        .map((id) => data.itemMap.get(id))
        .filter((item): item is EffectiveItem => item != null && !item.hidden)
        .map((item) => `同じ${item.label}`)
      const hasHiddenOnlyItemMatch = sharedIds.length > 0 && itemReasons.length === 0
      const categoryReasons = intersection(sourceCategories, candidateCategories).map(
        (category) => `${category}あり`,
      )
      const colorReasons = sharedColors.map((color) => colorLabel.get(color) ?? color)
      const weatherReason = weatherScore > 0 ? tempReason(candidate.date) : null
      const seasonReason = dateScore >= 8 ? '近い季節' : null
      const reasons = [
        ...itemReasons,
        ...(hasHiddenOnlyItemMatch ? ['同じアイテム'] : []),
        ...categoryReasons,
        ...colorReasons,
        seasonReason,
        weatherReason,
        ...hairMatch.reasons,
      ].filter((reason): reason is string => Boolean(reason))

      return {
        outfit: candidate,
        score: Math.round((itemScore + auxiliaryScore) * 100) / 100,
        reasons: reasons.slice(0, 3),
      }
    })
    .filter((candidate) => candidate.score > 0 && candidate.reasons.length > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.outfit.date !== a.outfit.date) return b.outfit.date.localeCompare(a.outfit.date)
      return a.outfit.key.localeCompare(b.outfit.key)
    })
    .slice(0, limit)
}
