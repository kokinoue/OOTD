import { describe, expect, it } from 'vitest'
import { GRID, mineHardPuzzle, type Dir } from '../jam'

// hard 盤面テーブル（src/data/jamHard.json）のオフライン採掘。
// 通常のテスト実行ではスキップされる。テーブルを作り直すときだけ:
//
//   JAM_MINE=1 pnpm vitest run src/lib/__tests__/jam.mine.test.ts
//
// を実行する（数分かかる）。採掘は決定的（同じシード列から同じテーブルができる）。

// tsconfig に node 型を足さずに済ませるための最小宣言（実体は vitest の node 実行環境が持つ）
declare const process: { env: Record<string, string | undefined> }

const MINE = process.env.JAM_MINE === '1'
const TARGET_COUNT = 100
const MIN_PAR = 15

describe('hard盤面の採掘', () => {
  it.runIf(MINE)(
    `par ${MIN_PAR}+ の盤面を ${TARGET_COUNT} 面採掘して src/data/jamHard.json を更新する`,
    { timeout: 30 * 60_000 },
    async () => {
      const boards: { par: number; p: [number, number, number, Dir][] }[] = []
      const seen = new Set<string>()
      for (let seed = 1; boards.length < TARGET_COUNT && seed < 3000; seed++) {
        const found = mineHardPuzzle(seed, MIN_PAR)
        if (!found) continue
        // pieces[0] を必ずターゲットにした圧縮表現へ
        const target = found.board.find((p) => p.isTarget)!
        const rest = found.board.filter((p) => !p.isTarget)
        const p: [number, number, number, Dir][] = [
          [target.row, target.col, target.len, target.dir],
          ...rest.map((x): [number, number, number, Dir] => [x.row, x.col, x.len, x.dir]),
        ]
        const key = p.map((x) => x.join('.')).join('|')
        if (seen.has(key)) continue
        seen.add(key)
        boards.push({ par: found.par, p })
      }
      expect(boards.length).toBe(TARGET_COUNT)
      expect(boards.every((b) => b.p.every(([r, c, len]) => r >= 0 && c >= 0 && len >= 2 && r < GRID && c < GRID))).toBe(true)

      // @ts-expect-error node:fs の型は vitest 実行環境にのみ存在する（tsconfig に node 型を足さない）
      const fs = (await import('node:fs')) as {
        writeFileSync: (path: string, data: string) => void
      }
      const path = new URL('../../data/jamHard.json', import.meta.url).pathname
      fs.writeFileSync(path, JSON.stringify({ minPar: MIN_PAR, boards }) + '\n')
    },
  )

  it.runIf(!MINE)('JAM_MINE=1 のときだけ採掘を実行する（通常はスキップ）', () => {
    expect(true).toBe(true)
  })
})
