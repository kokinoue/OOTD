import { describe, expect, it } from 'vitest'
import type { Outfit } from '../../types'
import {
  DIFFICULTIES,
  EXIT_COL,
  PAR_RANGE,
  TARGET_LEN,
  TARGET_ROW,
  applyMove,
  generate,
  isSolved,
  legalMoves,
  mulberry32,
  pickDailyOutfit,
  solve,
  todaySeedJST,
  type Board,
} from '../jam'

// ----------------------------------------------------------------------------
// legalMoves / applyMove / isSolved
// ----------------------------------------------------------------------------

describe('legalMoves', () => {
  it('横向きピースは左右に空いている分だけ移動できる', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: 1, len: 2, dir: 'h', isTarget: true },
    ]
    const moves = legalMoves(board)
    // col1..2 から、左は col0 まで、右は GRID-len(=4) まで空いている
    const targetMoves = moves.filter((m) => m.id === 'target').map((m) => m.to)
    expect(targetMoves.sort((a, b) => a - b)).toEqual([0, 2, 3, 4])
  })

  it('他ピースが塞いでいる方向へは進めない', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: 1, len: 2, dir: 'h', isTarget: true },
      { id: 'blocker', row: TARGET_ROW, col: 3, len: 2, dir: 'v' },
    ]
    const moves = legalMoves(board).filter((m) => m.id === 'target')
    // (row2,col3) が blocker に塞がれているので右には全く進めない
    expect(moves.map((m) => m.to)).toEqual([0])
  })

  it('縦向きピースは上下に空いている分、途中で止まる位置もすべて手になる', () => {
    const board: Board = [{ id: 'v', row: 2, col: 0, len: 2, dir: 'v' }]
    const moves = legalMoves(board).map((m) => m.to).sort((a, b) => a - b)
    // row2..3 から、上は row0,1 まで、下は row3,4(GRID-len=4) まで、途中停止も含めすべて合法手
    expect(moves).toEqual([0, 1, 3, 4])
  })

  it('盤面の外へは出られない(端のピースは端方向の手がない、途中停止はすべて手になる)', () => {
    const board: Board = [{ id: 'edge', row: 0, col: 0, len: 3, dir: 'h' }]
    const moves = legalMoves(board).map((m) => m.to)
    // 左には出られず、右は col1,2,3(GRID-len=3)まですべて止まれる
    expect(moves).toEqual([1, 2, 3])
  })
})

describe('applyMove', () => {
  it('指定したピースの座標だけを更新し、他のピースは変えない', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: 1, len: 2, dir: 'h', isTarget: true },
      { id: 'other', row: 0, col: 0, len: 2, dir: 'v' },
    ]
    const next = applyMove(board, { id: 'target', to: 3 })
    expect(next.find((p) => p.id === 'target')?.col).toBe(3)
    expect(next.find((p) => p.id === 'other')).toEqual(board[1])
    // 元の盤面は破壊しない
    expect(board.find((p) => p.id === 'target')?.col).toBe(1)
  })

  it('縦向きピースは row が更新される', () => {
    const board: Board = [{ id: 'v', row: 2, col: 0, len: 2, dir: 'v' }]
    const next = applyMove(board, { id: 'v', to: 4 })
    expect(next[0].row).toBe(4)
    expect(next[0].col).toBe(0)
  })
})

describe('isSolved', () => {
  it('ターゲットが出口(右端)に到達していれば true', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: EXIT_COL, len: TARGET_LEN, dir: 'h', isTarget: true },
    ]
    expect(isSolved(board)).toBe(true)
  })

  it('ターゲットが出口に届いていなければ false', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: EXIT_COL - 1, len: TARGET_LEN, dir: 'h', isTarget: true },
    ]
    expect(isSolved(board)).toBe(false)
  })

  it('ターゲットが存在しない盤面は false', () => {
    const board: Board = [{ id: 'a', row: 0, col: 0, len: 2, dir: 'h' }]
    expect(isSolved(board)).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// solve
// ----------------------------------------------------------------------------

describe('solve', () => {
  it('すでに解けている盤面は 0 手', () => {
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: EXIT_COL, len: TARGET_LEN, dir: 'h', isTarget: true },
    ]
    expect(solve(board)).toBe(0)
  })

  it('既知の局面で最短手数(3手)を正しく返す', () => {
    // target(row2,col1,len2) は (row2,col3) を a、(row2,col4) を b に塞がれていて動けない。
    // a・b をそれぞれ1手ずつ上へどかしてから、target が col1→col4 へ1手で抜ける = 計3手が最短。
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: 1, len: 2, dir: 'h', isTarget: true },
      { id: 'a', row: 1, col: 3, len: 2, dir: 'v' },
      { id: 'b', row: 1, col: 4, len: 2, dir: 'v' },
    ]
    expect(isSolved(board)).toBe(false)
    // 右(出口方向)へは a に塞がれて1マスも進めない。動けるのは左(col0)だけ
    expect(legalMoves(board).filter((m) => m.id === 'target')).toEqual([{ id: 'target', to: 0 }])
    expect(solve(board)).toBe(3)
  })

  it('目的地までまったく道がなくても無限ループせず解を探索できる(到達不能に近い局面)', () => {
    // 6x6の36マスを隙間なく埋めて誰も動けない状況(手が1つも無い)でも正常終了することを確認
    const board: Board = [
      { id: 'target', row: TARGET_ROW, col: 0, len: 2, dir: 'h', isTarget: true },
      { id: 'blockerA', row: TARGET_ROW, col: 2, len: 2, dir: 'h' },
      { id: 'blockerB', row: TARGET_ROW, col: 4, len: 2, dir: 'h' },
      { id: 'w0a', row: 0, col: 0, len: 3, dir: 'h' },
      { id: 'w0b', row: 0, col: 3, len: 3, dir: 'h' },
      { id: 'w1a', row: 1, col: 0, len: 3, dir: 'h' },
      { id: 'w1b', row: 1, col: 3, len: 3, dir: 'h' },
      { id: 'w3a', row: 3, col: 0, len: 3, dir: 'h' },
      { id: 'w3b', row: 3, col: 3, len: 3, dir: 'h' },
      { id: 'w4a', row: 4, col: 0, len: 3, dir: 'h' },
      { id: 'w4b', row: 4, col: 3, len: 3, dir: 'h' },
      { id: 'w5a', row: 5, col: 0, len: 3, dir: 'h' },
      { id: 'w5b', row: 5, col: 3, len: 3, dir: 'h' },
    ]
    expect(legalMoves(board)).toEqual([])
    expect(solve(board)).toBeNull()
  })
})

// ----------------------------------------------------------------------------
// generate
// ----------------------------------------------------------------------------

describe('generate', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i)

  // hard(15手以上)は6x6のRush Hour盤面としては稀にしか出ないため、探索に数秒〜十数秒かかる
  // シードがある。全30シード×3難易度をまとめて検証するのでタイムアウトを長めに取っている。
  it(
    '全シード×全難易度で可解・パーがレンジ内・solve()の結果と一致する',
    () => {
      for (const difficulty of DIFFICULTIES) {
        const [min, max] = PAR_RANGE[difficulty]
        for (const seed of SEEDS) {
          const { board, par } = generate(seed, difficulty)
          expect(isSolved(board)).toBe(false)
          const verified = solve(board)
          expect(verified).not.toBeNull()
          expect(verified).toBe(par)
          expect(par).toBeGreaterThanOrEqual(min)
          expect(par).toBeLessThanOrEqual(max)
        }
      }
    },
    240_000,
  )

  it(
    '同じ seed + difficulty からは常に同じ盤面が生成される(決定的)',
    () => {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of [0, 1, 7, 29]) {
          const a = generate(seed, difficulty)
          const b = generate(seed, difficulty)
          expect(a.par).toBe(b.par)
          expect(a.board).toEqual(b.board)
        }
      }
    },
    90_000,
  )

  it(
    '難易度が違えば(同じseedでも)独立に盤面が決まる',
    () => {
      const easy = generate(3, 'easy')
      const hard = generate(3, 'hard')
      expect(easy.par).not.toBe(hard.par)
    },
    15_000,
  )
})

// ----------------------------------------------------------------------------
// mulberry32 / デイリーモード補助関数
// ----------------------------------------------------------------------------

describe('mulberry32', () => {
  it('同じseedからは同じ数列を返す(決定的)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('0以上1未満の値を返す', () => {
    const rng = mulberry32(123)
    for (let i = 0; i < 20; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('todaySeedJST', () => {
  it('Asia/TokyoのYYYYMMDDを数値で返す', () => {
    // UTC 2026-01-01 15:00 = JST 2026-01-02 00:00
    const seed = todaySeedJST(new Date('2026-01-01T15:00:00Z'))
    expect(seed).toBe(20260102)
  })

  it('日付が変わればseedも変わる', () => {
    const a = todaySeedJST(new Date('2026-03-01T00:00:00Z'))
    const b = todaySeedJST(new Date('2026-03-02T00:00:00Z'))
    expect(a).not.toBe(b)
  })
})

describe('pickDailyOutfit', () => {
  const mk = (key: string, date: string): Outfit => ({
    key,
    no: 1,
    title: key,
    date,
    publishAt: `${date}T00:00:00.000Z`,
    like: 0,
    comment: '',
    noteUrl: `https://example.com/${key}`,
    images: [{ url: `https://example.com/${key}.jpg`, width: 100, height: 100, caption: '', itemIds: [] }],
    itemIds: [],
  })

  it('同じ月日の実在outfitのうち最新年を選ぶ', () => {
    const outfits = [mk('old', '2023-07-11'), mk('new', '2025-07-11'), mk('other-day', '2025-07-12')]
    const picked = pickDailyOutfit(outfits, new Date('2026-07-11T03:00:00Z')) // JST 7/11 正午
    expect(picked?.key).toBe('new')
  })

  it('該当する月日がなければ null', () => {
    const outfits = [mk('a', '2025-01-01')]
    const picked = pickDailyOutfit(outfits, new Date('2026-07-11T03:00:00Z'))
    expect(picked).toBeNull()
  })

  it('画像が無いoutfitは候補から除外する', () => {
    const noImage: Outfit = { ...mk('no-image', '2025-07-11'), images: [] }
    const picked = pickDailyOutfit([noImage], new Date('2026-07-11T03:00:00Z'))
    expect(picked).toBeNull()
  })
})
