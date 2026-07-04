import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyOverrides, overrideActions, resolveId } from '../store'
import type { Overrides } from '../../types'

const KEY = 'fits-overrides-v1'

// store.ts は module-level で localStorage / fetch / setTimeout に触るため、
// テストではすべてスタブして純粋なロジック（merge の循環検出など）だけを検証する
const storage = new Map<string, string>()

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v)
    },
    removeItem: (k: string) => {
      storage.delete(k)
    },
    clear: () => storage.clear(),
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })))
  vi.useFakeTimers() // scheduleBake の 400ms デバウンスを発火させない
})

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  storage.clear()
  overrideActions.reset()
})

/** 直近に save された Overrides（localStorage スタブから読む） */
const stored = (): Overrides => JSON.parse(storage.get(KEY)!) as Overrides

describe('resolveId', () => {
  it('merges が空なら id をそのまま返す', () => {
    expect(resolveId('a', {})).toBe('a')
  })

  it('1段のマージを解決する', () => {
    expect(resolveId('a', { a: 'b' })).toBe('b')
  })

  it('多段のマージ (a→b→c→d) を最終IDまで解決する', () => {
    expect(resolveId('a', { a: 'b', b: 'c', c: 'd' })).toBe('d')
  })

  it('チェーンの途中から辿っても最終IDに到達する', () => {
    expect(resolveId('b', { a: 'b', b: 'c', c: 'd' })).toBe('d')
  })

  it('マージ対象でない id はそのまま返す', () => {
    expect(resolveId('x', { a: 'b' })).toBe('x')
  })

  it('自己参照 (a→a) でも無限ループせず a を返す', () => {
    expect(resolveId('a', { a: 'a' })).toBe('a')
  })

  it('2要素の循環 (a→b→a) でも停止する', () => {
    // seen ガードで停止し、循環内のいずれかのIDを返す（現実装は起点 a）
    expect(resolveId('a', { a: 'b', b: 'a' })).toBe('a')
  })

  it('循環に合流するチェーン (a→b→c→b) でも停止する', () => {
    expect(resolveId('a', { a: 'b', b: 'c', c: 'b' })).toBe('b')
  })
})

describe('emptyOverrides', () => {
  it('毎回新しいインスタンスを返す（共有参照ではない）', () => {
    const a = emptyOverrides()
    const b = emptyOverrides()
    expect(a).not.toBe(b)
    a.renames['x'] = 'y'
    a.hidden.push('z')
    expect(b.renames).toEqual({})
    expect(b.hidden).toEqual([])
  })

  it('全フィールドが空で初期化される', () => {
    expect(emptyOverrides()).toEqual({
      renames: {},
      categories: {},
      merges: {},
      hidden: [],
      colors: {},
    })
  })
})

describe('overrideActions.merge の循環検出', () => {
  it('通常のマージは記録される', () => {
    overrideActions.merge('a', 'b')
    expect(stored().merges).toEqual({ a: 'b' })
  })

  it('自己マージ (a→a) は無視される', () => {
    overrideActions.merge('a', 'a')
    expect(stored().merges).toEqual({})
  })

  it('直接の循環 (a→b の後に b→a) は拒否される', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('b', 'a')
    expect(stored().merges).toEqual({ a: 'b' })
  })

  it('多段の循環 (a→b→c の後に c→a) は拒否される', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('b', 'c')
    overrideActions.merge('c', 'a')
    expect(stored().merges).toEqual({ a: 'b', b: 'c' })
  })

  it('循環しないチェーンへの追加 (a→b がある状態で c→a) は許可される', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('c', 'a')
    expect(stored().merges).toEqual({ a: 'b', c: 'a' })
    expect(resolveId('c', stored().merges)).toBe('b')
  })

  it('同じマージ先への合流 (a→b, c→b) は許可される', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('c', 'b')
    expect(stored().merges).toEqual({ a: 'b', c: 'b' })
  })

  it('既存マージの上書き (a→b を a→c に) は許可される', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('a', 'c')
    expect(stored().merges).toEqual({ a: 'c' })
  })

  it('importAll で循環データが入っていても merge は無限ループしない', () => {
    overrideActions.importAll({ ...emptyOverrides(), merges: { x: 'y', y: 'x' } })
    // toId の解決チェーンが既存の循環 (x↔y) に入っても seen ガードで停止する
    overrideActions.merge('a', 'x')
    expect(stored().merges).toEqual({ x: 'y', y: 'x', a: 'x' })
    // resolveId も停止する（循環内のIDを返す）
    expect(['x', 'y']).toContain(resolveId('a', stored().merges))
  })
})

describe('overrideActions.unmerge', () => {
  it('指定した fromId のマージだけを解除する', () => {
    overrideActions.merge('a', 'b')
    overrideActions.merge('c', 'b')
    overrideActions.unmerge('a')
    expect(stored().merges).toEqual({ c: 'b' })
  })
})

describe('overrideActions のその他の純粋ロジック', () => {
  it('rename は trim して保存し、空文字で削除する', () => {
    overrideActions.rename('x', '  新しい名前  ')
    expect(stored().renames).toEqual({ x: '新しい名前' })
    overrideActions.rename('x', '   ')
    expect(stored().renames).toEqual({})
  })

  it('setCategory は trim + 小文字化して保存する', () => {
    overrideActions.setCategory('x', ' Tops ')
    expect(stored().categories).toEqual({ x: 'tops' })
  })

  it("setColor: 'auto' で削除、'none' で空文字、それ以外はバケツ名", () => {
    overrideActions.setColor('x', 'navy')
    expect(stored().colors).toEqual({ x: 'navy' })
    overrideActions.setColor('x', 'none')
    expect(stored().colors).toEqual({ x: '' })
    overrideActions.setColor('x', 'auto')
    expect(stored().colors).toEqual({})
  })

  it('toggleHidden は追加と削除をトグルする', () => {
    overrideActions.toggleHidden('x')
    expect(stored().hidden).toEqual(['x'])
    overrideActions.toggleHidden('x')
    expect(stored().hidden).toEqual([])
  })
})
