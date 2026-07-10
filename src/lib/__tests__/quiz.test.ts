import { describe, expect, it } from 'vitest'
import outfitsJson from '../../data/outfits.json'
import itemsJson from '../../data/items.json'
import type { Item, Outfit } from '../../types'
import {
  QUESTIONS,
  QUIZ_TYPES,
  decodeAnswers,
  encodeAnswers,
  matchOutfit,
  resolveType,
  tallyScores,
} from '../quiz'

const outfits = outfitsJson as Outfit[]
const items = itemsJson as Item[]
const itemsById = new Map(items.map((it) => [it.id, it]))

// useData.ts と同様に、outfit.key -> 着用アイテムIDのSet を素朴に構築（splits/overrides は無視）
const outfitItemIds = new Map<string, Set<string>>()
for (const o of outfits) {
  outfitItemIds.set(o.key, new Set(o.itemIds))
}

describe('QUESTIONS', () => {
  it('has exactly 8 questions', () => {
    expect(QUESTIONS.length).toBe(8)
  })

  it('each question has 2-4 choices', () => {
    for (const q of QUESTIONS) {
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      expect(q.choices.length).toBeLessThanOrEqual(4)
    }
  })

  it('question ids are unique', () => {
    const ids = QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('determinism', () => {
  it('same answers always produce same type and same outfit', () => {
    const answers = QUESTIONS.map((_, i) => i % 3)
    const scoresA = tallyScores(answers)
    const scoresB = tallyScores(answers)
    expect(scoresA).toEqual(scoresB)

    const typeA = resolveType(scoresA)
    const typeB = resolveType(scoresB)
    expect(typeA.id).toBe(typeB.id)

    const outfitA = matchOutfit(scoresA, outfits, itemsById, outfitItemIds)
    const outfitB = matchOutfit(scoresB, outfits, itemsById, outfitItemIds)
    expect(outfitA.key).toBe(outfitB.key)
  })
})

describe('resolveType', () => {
  it('reaches all 8 types across the sign combinations of colorful/formal/adventurous', () => {
    const seen = new Set<string>()
    for (const c of [-1, 1]) {
      for (const f of [-1, 1]) {
        for (const a of [-1, 1]) {
          const type = resolveType({ colorful: c, formal: f, adventurous: a, layered: 0, warm: 0 })
          seen.add(type.id)
        }
      }
    }
    expect(seen.size).toBe(8)
    expect(seen).toEqual(new Set(Object.keys(QUIZ_TYPES)))
  })
})

describe('matchOutfit', () => {
  it('always returns a candidate outfit with a non-empty image', () => {
    const patterns: number[][] = [
      QUESTIONS.map(() => 0),
      QUESTIONS.map(() => 1),
      QUESTIONS.map(() => 2),
      QUESTIONS.map(() => 3),
      QUESTIONS.map((_, i) => i % 2),
      QUESTIONS.map((_, i) => (i + 1) % 3),
      QUESTIONS.map((_, i) => (i * 2) % 4),
    ]
    for (const answers of patterns) {
      const scores = tallyScores(answers)
      const outfit = matchOutfit(scores, outfits, itemsById, outfitItemIds)
      expect(outfit).toBeDefined()
      expect(outfit.images[0]?.url).toBeTruthy()
      expect((outfitItemIds.get(outfit.key)?.size ?? 0) > 0).toBe(true)
    }
  })

  it('produces at least 4 distinct outfits across varied answer patterns', () => {
    const patterns: number[][] = [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2, 2, 2, 2],
      [3, 0, 3, 0, 3, 0, 3, 0],
      [0, 1, 2, 3, 0, 1, 2, 3],
      [3, 2, 1, 0, 3, 2, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0],
      [2, 1, 0, 3, 2, 1, 0, 3],
      [0, 3, 0, 3, 0, 3, 0, 3],
      [3, 3, 0, 0, 3, 3, 0, 0],
      [1, 2, 3, 0, 1, 2, 3, 0],
      [0, 0, 3, 3, 0, 0, 3, 3],
      [2, 3, 2, 3, 2, 3, 2, 3],
      [1, 3, 1, 3, 1, 3, 1, 3],
      [0, 2, 0, 2, 0, 2, 0, 2],
      [3, 1, 2, 0, 2, 0, 1, 3],
    ]
    const keys = new Set<string>()
    for (const answers of patterns) {
      const safeAnswers = answers.map((a, i) => Math.min(a, QUESTIONS[i].choices.length - 1))
      const scores = tallyScores(safeAnswers)
      const outfit = matchOutfit(scores, outfits, itemsById, outfitItemIds)
      keys.add(outfit.key)
    }
    expect(keys.size).toBeGreaterThanOrEqual(4)
  })
})

describe('encodeAnswers / decodeAnswers', () => {
  it('round-trips through encode -> decode', () => {
    const patterns: number[][] = [
      QUESTIONS.map(() => 0),
      QUESTIONS.map((_, i) => Math.min(i % 4, QUESTIONS[i].choices.length - 1)),
      QUESTIONS.map((_, i) => (i * 2 + 1) % QUESTIONS[i].choices.length),
    ]
    for (const answers of patterns) {
      const encoded = encodeAnswers(answers)
      expect(encoded).toMatch(new RegExp(`^\\d{${QUESTIONS.length}}$`))
      expect(decodeAnswers(encoded)).toEqual(answers)
    }
  })

  it('rejects the wrong number of digits', () => {
    expect(decodeAnswers('0'.repeat(QUESTIONS.length - 1))).toBeNull()
    expect(decodeAnswers('0'.repeat(QUESTIONS.length + 1))).toBeNull()
    expect(decodeAnswers('')).toBeNull()
  })

  it('rejects a digit out of range for its question', () => {
    // 各質問は最大4択（インデックス0〜3）。9は常に範囲外。
    const tooLarge = QUESTIONS.map(() => '9').join('')
    expect(decodeAnswers(tooLarge)).toBeNull()

    // 実際に選択肢数を超えるインデックスを1問だけ混ぜたケース
    const idx = QUESTIONS.findIndex((q) => q.choices.length < 4)
    if (idx >= 0) {
      const digits = QUESTIONS.map(() => '0')
      digits[idx] = '4'
      expect(decodeAnswers(digits.join(''))).toBeNull()
    }
  })

  it('rejects non-digit characters', () => {
    expect(decodeAnswers('abcdefgh'.slice(0, QUESTIONS.length).padEnd(QUESTIONS.length, '0'))).toBeNull()
    expect(decodeAnswers('0'.repeat(QUESTIONS.length - 1) + 'a')).toBeNull()
  })
})
