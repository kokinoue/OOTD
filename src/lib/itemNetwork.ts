import type { EffectiveItem } from '../types'
import type { Data } from './useData'

const MIN_PAIR_COUNT = 2
const MAX_NODES = 24
const MAX_EDGES = 40
const MAX_TOP_PAIRS = 12

export type ItemNetworkNode = {
  id: string
  item: EffectiveItem
  strength: number
  degree: number
  totalWears: number
}

export type ItemNetworkEdge = {
  id: string
  source: string
  target: string
  sourceItem: EffectiveItem
  targetItem: EffectiveItem
  count: number
}

export type ItemNetworkPair = ItemNetworkEdge

export type ItemNetworkMetrics = {
  nodeCount: number
  pairCount: number
  strongestPair: ItemNetworkPair | null
}

export type ItemNetwork = {
  nodes: ItemNetworkNode[]
  edges: ItemNetworkEdge[]
  topPairs: ItemNetworkPair[]
  metrics: ItemNetworkMetrics
}

type PairRecord = {
  source: string
  target: string
  count: number
}

type NodeScore = {
  item: EffectiveItem
  strength: number
  degree: number
  totalWears: number
}

export function buildItemNetwork(data: Data): ItemNetwork {
  const pairCounts = new Map<string, PairRecord>()

  for (const ids of data.outfitItemIds.values()) {
    const visibleIds = [...ids]
      .filter((id) => {
        const item = data.itemMap.get(id)
        return item != null && !item.hidden
      })
      .sort(compareItemIds(data))

    for (let i = 0; i < visibleIds.length; i += 1) {
      for (let j = i + 1; j < visibleIds.length; j += 1) {
        const source = visibleIds[i]
        const target = visibleIds[j]
        const id = pairId(source, target)
        const current = pairCounts.get(id)
        if (current) {
          current.count += 1
        } else {
          pairCounts.set(id, { source, target, count: 1 })
        }
      }
    }
  }

  const targetPairs = [...pairCounts.values()].filter((pair) => pair.count >= MIN_PAIR_COUNT)
  const scores = new Map<string, NodeScore>()

  for (const pair of targetPairs) {
    const source = data.itemMap.get(pair.source)
    const target = data.itemMap.get(pair.target)
    if (!source || !target || source.hidden || target.hidden) continue
    addScore(scores, source, pair.count)
    addScore(scores, target, pair.count)
  }

  const selectedNodeIds = new Set(
    [...scores.entries()]
      .sort((a, b) => compareNodeScores(a[1], b[1]) || a[0].localeCompare(b[0]))
      .slice(0, MAX_NODES)
      .map(([id]) => id),
  )

  const selectedScores = new Map([...scores].filter(([id]) => selectedNodeIds.has(id)))
  const sortedEdges = targetPairs
    .filter((pair) => selectedNodeIds.has(pair.source) && selectedNodeIds.has(pair.target))
    .sort(
      (a, b) =>
        b.count - a.count ||
        nodeStrengthSum(b, selectedScores) - nodeStrengthSum(a, selectedScores) ||
        pairLabel(a, data).localeCompare(pairLabel(b, data)) ||
        pairId(a.source, a.target).localeCompare(pairId(b.source, b.target)),
    )
    .slice(0, MAX_EDGES)
    .map((pair) => toEdge(pair, data))
    .filter((edge): edge is ItemNetworkEdge => edge != null)

  const connectedNodeIds = new Set<string>()
  for (const edge of sortedEdges) {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  }

  const nodes = [...selectedScores.entries()]
    .filter(([id]) => connectedNodeIds.has(id))
    .sort((a, b) => compareNodeScores(a[1], b[1]) || a[0].localeCompare(b[0]))
    .map(([id, score]) => ({
      id,
      item: score.item,
      strength: score.strength,
      degree: score.degree,
      totalWears: score.totalWears,
    }))

  const topPairs = targetPairs
    .sort(
      (a, b) =>
        b.count - a.count ||
        pairLabel(a, data).localeCompare(pairLabel(b, data)) ||
        pairId(a.source, a.target).localeCompare(pairId(b.source, b.target)),
    )
    .slice(0, MAX_TOP_PAIRS)
    .map((pair) => toEdge(pair, data))
    .filter((edge): edge is ItemNetworkPair => edge != null)

  return {
    nodes,
    edges: sortedEdges,
    topPairs,
    metrics: {
      nodeCount: nodes.length,
      pairCount: targetPairs.length,
      strongestPair: topPairs[0] ?? null,
    },
  }
}

function addScore(scores: Map<string, NodeScore>, item: EffectiveItem, count: number) {
  const current =
    scores.get(item.id) ??
    ({
      item,
      strength: 0,
      degree: 0,
      totalWears: item.count,
    } satisfies NodeScore)
  current.strength += count
  current.degree += 1
  scores.set(item.id, current)
}

function compareNodeScores(a: NodeScore, b: NodeScore) {
  return (
    b.strength - a.strength ||
    b.degree - a.degree ||
    b.totalWears - a.totalWears ||
    a.item.label.localeCompare(b.item.label)
  )
}

function compareItemIds(data: Data) {
  return (a: string, b: string) => {
    const itemA = data.itemMap.get(a)
    const itemB = data.itemMap.get(b)
    return (
      (itemA?.label ?? a).localeCompare(itemB?.label ?? b) ||
      (itemA?.category ?? '').localeCompare(itemB?.category ?? '') ||
      a.localeCompare(b)
    )
  }
}

function nodeStrengthSum(pair: PairRecord, scores: Map<string, NodeScore>) {
  return (scores.get(pair.source)?.strength ?? 0) + (scores.get(pair.target)?.strength ?? 0)
}

function pairLabel(pair: PairRecord, data: Data) {
  const source = data.itemMap.get(pair.source)
  const target = data.itemMap.get(pair.target)
  return `${source?.label ?? pair.source} / ${target?.label ?? pair.target}`
}

function pairId(source: string, target: string) {
  return `${source}__${target}`
}

function toEdge(pair: PairRecord, data: Data): ItemNetworkEdge | null {
  const sourceItem = data.itemMap.get(pair.source)
  const targetItem = data.itemMap.get(pair.target)
  if (!sourceItem || !targetItem || sourceItem.hidden || targetItem.hidden) return null
  return {
    id: pairId(pair.source, pair.target),
    source: pair.source,
    target: pair.target,
    sourceItem,
    targetItem,
    count: pair.count,
  }
}
