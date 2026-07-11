import type { Outfit } from '../types'

// 満員クローゼット — Rush Hour型スライドパズル。
// 6x6グリッドに服の束（ピース）が詰まっていて、ターゲット（今日の一着）だけを
// 右端の出口までスライドさせて出せたらクリア。UIからは完全に独立した純粋関数群。
//
// 座標系: row/col は共にピースの左上（横向きなら左端、縦向きなら上端）のセル。
// 横向き(dir: 'h')ピースは col のみ、縦向き(dir: 'v')ピースは row のみが変化する。

export const GRID = 6
export const TARGET_ROW = 2
export const TARGET_LEN = 2
/** ターゲットが出口(右端)に到達したときの col */
export const EXIT_COL = GRID - TARGET_LEN

export type Dir = 'h' | 'v'

export type Piece = {
  id: string
  row: number
  col: number
  len: number
  dir: Dir
  isTarget?: boolean
}

export type Board = Piece[]

/** 1回のドラッグ操作 = 1手。to はスライド先の col(h) または row(v) */
export type Move = { id: string; to: number }

export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'むずかしい',
}

/** 難易度ごとの最短手数(パー)レンジ。hard は上限なし */
export const PAR_RANGE: Record<Difficulty, [number, number]> = {
  easy: [5, 8],
  normal: [9, 14],
  hard: [15, Infinity],
}

// ---------------------------------------------------------------------------
// 決定的疑似乱数(mulberry32)
// ---------------------------------------------------------------------------

/** 同じ seed から常に同じ乱数列を返す軽量PRNG。日付や「次の問題」カウンタをseedにする */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// 盤面の基本操作
// ---------------------------------------------------------------------------

function cellsOf(p: Pick<Piece, 'row' | 'col' | 'len' | 'dir'>): [number, number][] {
  const cells: [number, number][] = []
  for (let i = 0; i < p.len; i++) {
    cells.push(p.dir === 'h' ? [p.row, p.col + i] : [p.row + i, p.col])
  }
  return cells
}

/** グリッド1マスごとに、どのピース(indexOfボード配列)が占有しているかを詰めた配列。空マスは-1 */
function occupancy(board: Board): Int16Array {
  const grid = new Int16Array(GRID * GRID).fill(-1)
  for (let i = 0; i < board.length; i++) {
    const p = board[i]
    if (p.dir === 'h') {
      const base = p.row * GRID + p.col
      for (let k = 0; k < p.len; k++) grid[base + k] = i
    } else {
      const base = p.row * GRID + p.col
      for (let k = 0; k < p.len; k++) grid[base + k * GRID] = i
    }
  }
  return grid
}

/**
 * 現局面で指せる全ての合法手を列挙する。
 * 1ピースにつき、その方向に空いているマスの分だけ(1マスずつ止まる位置すべてが)候補になる
 * ―― 実際にどこで止めるかで他ピースの通り道が変わるため、途中の停止位置もすべて合法手として扱う。
 */
export function legalMoves(board: Board): Move[] {
  const grid = occupancy(board)
  const moves: Move[] = []
  for (const p of board) {
    if (p.dir === 'h') {
      const row = p.row
      for (let c = p.col - 1; c >= 0; c--) {
        if (grid[row * GRID + c] !== -1) break
        moves.push({ id: p.id, to: c })
      }
      for (let c = p.col + 1; c <= GRID - p.len; c++) {
        if (grid[row * GRID + c + p.len - 1] !== -1) break
        moves.push({ id: p.id, to: c })
      }
    } else {
      const col = p.col
      for (let r = p.row - 1; r >= 0; r--) {
        if (grid[r * GRID + col] !== -1) break
        moves.push({ id: p.id, to: r })
      }
      for (let r = p.row + 1; r <= GRID - p.len; r++) {
        if (grid[(r + p.len - 1) * GRID + col] !== -1) break
        moves.push({ id: p.id, to: r })
      }
    }
  }
  return moves
}

/** 指定した手を適用した新しい盤面を返す(非破壊)。合法性のチェックは行わない */
export function applyMove(board: Board, move: Move): Board {
  return board.map((p) => {
    if (p.id !== move.id) return p
    return p.dir === 'h' ? { ...p, col: move.to } : { ...p, row: move.to }
  })
}

/** ターゲットが出口(右端)に到達しているか */
export function isSolved(board: Board): boolean {
  const target = board.find((p) => p.isTarget)
  if (!target) return false
  return target.dir === 'h' ? target.col + target.len === GRID : target.row + target.len === GRID
}

// board配列の並び順は常に固定(applyMoveはmapで順序を保つ)なので、
// キーは可変座標(hならcol、vならrow)だけを並べれば十分で、文字列生成も軽い。
function boardKey(board: Board): string {
  let s = ''
  for (const p of board) s += (p.dir === 'h' ? p.col : p.row) + ','
  return s
}

const SOLVE_MAX_STATES = 40000

/**
 * BFSで最短手数を求める。探索上限(SOLVE_MAX_STATES)を超えた場合は null を返す
 * (実用上の6x6盤面ではまず到達しない安全弁)。
 */
export function solve(board: Board): number | null {
  if (isSolved(board)) return 0
  const visited = new Set<string>([boardKey(board)])
  let frontier: Board[] = [board]
  let depth = 0
  while (frontier.length > 0) {
    depth++
    const next: Board[] = []
    for (const b of frontier) {
      for (const mv of legalMoves(b)) {
        const nb = applyMove(b, mv)
        const key = boardKey(nb)
        if (visited.has(key)) continue
        if (isSolved(nb)) return depth
        visited.add(key)
        if (visited.size > SOLVE_MAX_STATES) return null
        next.push(nb)
      }
    }
    frontier = next
  }
  return null
}

// ---------------------------------------------------------------------------
// 盤面生成
// ---------------------------------------------------------------------------
// アルゴリズム:
// 1. ターゲットを出口前(解けた状態)に置き、残りのマスにブロッカーをランダム配置する。
// 2. この「解けた状態」を起点に、到達可能な状態を全探索(BFS)して連結成分を作る。
// 3. 連結成分内の「ターゲットが出口にある状態」全てを距離0の起点とする多始点BFSで、
//    連結成分内すべての状態について「最短で解ける手数」を正確に求める
//   (起点1つからのBFS距離だと、起点とは別の解けた配置への近道を見落として過大評価しうるため)。
// 4. 難易度レンジに収まる状態を集め、seed由来の乱数で1つ選ぶ。選んだ後は solve() で再検証し、
//    (安全弁: 探索上限などで万一ズレていた場合は)一致しなければ次の候補・次の配置を試す。
// 5. 上限回数までにレンジ内が見つからなければ、最もレンジに近かった局面をフォールバックとして返す。

const BLOCKER_MIN = 10
const BLOCKER_MAX = 13
const BUILD_ATTEMPTS_PER_LAYOUT = 400
const MAX_GENERATE_ATTEMPTS = 3000
/** 連結成分探索の状態数上限(1レイアウトあたり)。大きすぎる盤面は打ち切って次の配置を試す */
const SEARCH_MAX_STATES = 20000

function canPlace(occ: Int16Array, cells: [number, number][]): boolean {
  for (const [r, c] of cells) {
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false
    if (occ[r * GRID + c] !== -1) return false
  }
  return true
}

/** ターゲットを出口前に置いた「解けた状態」にブロッカーをランダム配置する */
function buildLayout(rng: () => number, blockerCount: number): Board {
  const occ = new Int16Array(GRID * GRID).fill(-1)
  const target: Piece = {
    id: 'target',
    row: TARGET_ROW,
    col: EXIT_COL,
    len: TARGET_LEN,
    dir: 'h',
    isTarget: true,
  }
  for (const [r, c] of cellsOf(target)) occ[r * GRID + c] = 0
  const pieces: Board = [target]

  let pid = 0
  let attempts = 0
  while (pieces.length - 1 < blockerCount && attempts < BUILD_ATTEMPTS_PER_LAYOUT) {
    attempts++
    const dir: Dir = rng() < 0.5 ? 'h' : 'v'
    const len = rng() < 0.7 ? 2 : 3
    const maxRow = dir === 'v' ? GRID - len : GRID - 1
    const maxCol = dir === 'h' ? GRID - len : GRID - 1
    const row = Math.floor(rng() * (maxRow + 1))
    const col = Math.floor(rng() * (maxCol + 1))
    const candidate: Piece = { id: `p${pid}`, row, col, len, dir }
    const cells = cellsOf(candidate)
    if (canPlace(occ, cells)) {
      for (const [r, c] of cells) occ[r * GRID + c] = pieces.length
      pieces.push(candidate)
      pid++
    }
  }
  return pieces
}

/** start から到達可能な状態全体(連結成分)を BFS で列挙する。key -> board */
function enumerateComponent(start: Board, maxStates: number): Map<string, Board> {
  const nodes = new Map<string, Board>([[boardKey(start), start]])
  let frontier: Board[] = [start]
  while (frontier.length > 0 && nodes.size < maxStates) {
    const next: Board[] = []
    for (const b of frontier) {
      for (const mv of legalMoves(b)) {
        const nb = applyMove(b, mv)
        const key = boardKey(nb)
        if (nodes.has(key)) continue
        nodes.set(key, nb)
        next.push(nb)
      }
    }
    frontier = next
  }
  return nodes
}

/** nodes 内の「解けている状態」全てを起点にした多始点BFSで、各状態の本当の最短手数を求める */
function truePars(nodes: Map<string, Board>): Map<string, number> {
  const dist = new Map<string, number>()
  let frontier: Board[] = []
  for (const [key, b] of nodes) {
    if (isSolved(b)) {
      dist.set(key, 0)
      frontier.push(b)
    }
  }
  let d = 0
  while (frontier.length > 0) {
    d++
    const next: Board[] = []
    for (const b of frontier) {
      for (const mv of legalMoves(b)) {
        const nb = applyMove(b, mv)
        const key = boardKey(nb)
        if (!nodes.has(key) || dist.has(key)) continue
        dist.set(key, d)
        next.push(nb)
      }
    }
    frontier = next
  }
  return dist
}

export type Puzzle = { board: Board; par: number }

/**
 * seed から決定的に盤面を生成する。同じ seed + difficulty なら常に同じ盤面になる。
 * 難易度レンジに収まる局面が見つからない場合は、最もレンジに近かった局面を返す
 * (6x6盤面で hard の下限(15手)は稀にしか出現しないため、フォールバックを許容する)。
 */
export function generate(seed: number, difficulty: Difficulty): Puzzle {
  const range = PAR_RANGE[difficulty]
  const rng = mulberry32(seed)

  let fallback: Puzzle | null = null
  let fallbackDist = Infinity
  // フォールバック候補は必ず solve() で確定した(board, par)のペアだけを保持する
  // (par は常に solve(board) と一致する状態を保つ)
  const considerVerified = (board: Board, verified: number) => {
    const dist = verified < range[0] ? range[0] - verified : verified > range[1] ? verified - range[1] : 0
    if (dist < fallbackDist) {
      fallbackDist = dist
      fallback = { board, par: verified }
    }
  }

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const blockerCount = BLOCKER_MIN + Math.floor(rng() * (BLOCKER_MAX - BLOCKER_MIN + 1))
    const layout = buildLayout(rng, blockerCount)
    const nodes = enumerateComponent(layout, SEARCH_MAX_STATES)
    const dist = truePars(nodes)

    // レンジ内候補と、レンジ外で最もレンジに近い1件(このレイアウトの代表フォールバック候補)を1パスで拾う
    const inRangeKeys: string[] = []
    let nearestKey: string | null = null
    let nearestDist = Infinity
    for (const [key, d] of dist) {
      if (d >= range[0] && d <= range[1]) {
        inRangeKeys.push(key)
        continue
      }
      const dd = d < range[0] ? range[0] - d : d - range[1]
      if (dd < nearestDist) {
        nearestDist = dd
        nearestKey = key
      }
    }

    if (inRangeKeys.length > 0) {
      const idx = Math.floor(rng() * inRangeKeys.length)
      const board = nodes.get(inRangeKeys[idx])!
      // 安全弁: 多始点BFSの結果を solve() で再検証してから確定する
      const verified = solve(board)
      if (verified != null && verified >= range[0] && verified <= range[1]) {
        return { board, par: verified }
      }
      // 稀に多始点BFSの推定とズレていた場合は、この結果もフォールバック候補として拾っておく
      if (verified != null) considerVerified(board, verified)
    } else if (nearestKey) {
      const board = nodes.get(nearestKey)!
      const verified = solve(board)
      if (verified != null) considerVerified(board, verified)
    }
  }

  if (fallback) return fallback
  // ここに来るのは理論上ありえない(layout自身が常に「解けた状態」= par 0の有効な局面のため)
  throw new Error('jam: failed to generate a board')
}

// ---------------------------------------------------------------------------
// デイリーモード: 日付シードと「実在の一着」
// ---------------------------------------------------------------------------

function jstParts(now: Date): Record<'year' | 'month' | 'day', string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Asia/Tokyo基準の「今日」をYYYYMMDD形式の数値にする(デイリーパズルのseed用) */
export function todaySeedJST(now: Date = new Date()): number {
  const { year, month, day } = jstParts(now)
  return Number(`${year}${month}${day}`)
}

/**
 * 過去の実在outfitから「今日と同じ月日」のものを選ぶ(Asia/Tokyo基準)。
 * 複数あれば最新の年のものを採用。該当がなければ null
 */
export function pickDailyOutfit(outfits: Outfit[], now: Date = new Date()): Outfit | null {
  const { month, day } = jstParts(now)
  const mmdd = `${month}-${day}`
  const matches = outfits.filter((o) => o.date.slice(5, 10) === mmdd && o.images[0]?.url)
  if (matches.length === 0) return null
  return matches.reduce((latest, o) => (o.date > latest.date ? o : latest))
}
