import { describe, expect, it } from 'vitest'
import { Box, Circle, Vec2, World } from 'planck'
import {
  DENSITY,
  findMergePairs,
  FRICTION,
  GRAVITY,
  mergeScore,
  pickRankOutfits,
  PPM,
  RANK_COUNT,
  RANK_RADII,
  RESTITUTION,
  SPAWN_MAX_RANK,
  spawnRank,
} from '../merge'
import { outfits } from '../useData'

describe('ランク定義', () => {
  it('半径は11段階で単調増加する', () => {
    expect(RANK_RADII.length).toBe(RANK_COUNT)
    for (let i = 1; i < RANK_RADII.length; i++) {
      expect(RANK_RADII[i]).toBeGreaterThan(RANK_RADII[i - 1])
    }
  })

  it('合体スコアはランクとともに単調増加する', () => {
    for (let i = 0; i < RANK_COUNT; i++) {
      expect(mergeScore(i)).toBeGreaterThan(0)
      if (i > 0) expect(mergeScore(i)).toBeGreaterThan(mergeScore(i - 1))
    }
  })
})

describe('spawnRank', () => {
  it('rand=0 で最小ランク、rand→1 で SPAWN_MAX_RANK を返す', () => {
    expect(spawnRank(() => 0)).toBe(0)
    expect(spawnRank(() => 0.999999)).toBe(SPAWN_MAX_RANK)
  })

  it('常に 0..SPAWN_MAX_RANK の範囲', () => {
    for (let i = 0; i < 100; i++) {
      const r = spawnRank(() => i / 100)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(SPAWN_MAX_RANK)
    }
  })
})

describe('pickRankOutfits（実データ）', () => {
  it('画像つきの11着を、いいね昇順・重複なし・決定的に返す', () => {
    const a = pickRankOutfits(outfits)
    const b = pickRankOutfits(outfits)
    expect(a.length).toBe(RANK_COUNT)
    expect(new Set(a.map((o) => o.key)).size).toBe(RANK_COUNT)
    expect(a.map((o) => o.key)).toEqual(b.map((o) => o.key))
    for (const o of a) expect(o.images[0]?.url).toBeTruthy()
    for (let i = 1; i < a.length; i++) {
      expect(a[i].like).toBeGreaterThanOrEqual(a[i - 1].like)
    }
    // 最終ランクは全体のいいね数1位
    const maxLike = Math.max(...outfits.filter((o) => o.images[0]?.url).map((o) => o.like))
    expect(a[a.length - 1].like).toBe(maxLike)
  })
})

describe('findMergePairs', () => {
  const r0 = RANK_RADII[0]

  it('接触している同ランクのペアを見つける', () => {
    const pairs = findMergePairs([
      { id: 1, rank: 0, x: 100, y: 100 },
      { id: 2, rank: 0, x: 100 + r0 * 2 - 1, y: 100 },
    ])
    expect(pairs).toEqual([[1, 2]])
  })

  it('ランクが違えば接触していても合体しない', () => {
    const pairs = findMergePairs([
      { id: 1, rank: 0, x: 100, y: 100 },
      { id: 2, rank: 1, x: 100 + 10, y: 100 },
    ])
    expect(pairs).toEqual([])
  })

  it('離れていれば合体しない', () => {
    const pairs = findMergePairs([
      { id: 1, rank: 0, x: 100, y: 100 },
      { id: 2, rank: 0, x: 100 + r0 * 2 * 1.2, y: 100 },
    ])
    expect(pairs).toEqual([])
  })

  it('3つ接触していても1フレームで合体するのは1ペアだけ（残り1つは持ち越し）', () => {
    const pairs = findMergePairs([
      { id: 3, rank: 0, x: 100 + r0 * 4 - 2, y: 100 },
      { id: 1, rank: 0, x: 100, y: 100 },
      { id: 2, rank: 0, x: 100 + r0 * 2 - 1, y: 100 },
    ])
    expect(pairs.length).toBe(1)
    // id 昇順の貪欲なので (1,2) が選ばれ、3 は残る（決定的）
    expect(pairs[0]).toEqual([1, 2])
  })
})

describe('物理スモーク（planck）', () => {
  it('床に落とした同ランクの2玉は静止後も接触していて合体対象になる', () => {
    const world = new World({ gravity: new Vec2(0, GRAVITY) })
    const floor = world.createBody({ type: 'static', position: new Vec2(240 / PPM, 700 / PPM) })
    floor.createFixture({ shape: new Box(240 / PPM, 20 / PPM), friction: FRICTION, restitution: RESTITUTION })

    const mkBall = (x: number, y: number) => {
      const b = world.createBody({ type: 'dynamic', position: new Vec2(x / PPM, y / PPM), bullet: true })
      b.createFixture({
        shape: new Circle(RANK_RADII[0] / PPM),
        density: DENSITY,
        friction: FRICTION,
        restitution: RESTITUTION,
      })
      return b
    }
    // 同じx に縦に積んで落とす → 床の上で接触して静止するはず
    const a = mkBall(240, 600)
    const b = mkBall(240, 560)
    for (let i = 0; i < 300; i++) world.step(1 / 60, 8, 3)

    const pairs = findMergePairs([
      { id: 1, rank: 0, x: a.getPosition().x * PPM, y: a.getPosition().y * PPM },
      { id: 2, rank: 0, x: b.getPosition().x * PPM, y: b.getPosition().y * PPM },
    ])
    expect(pairs).toEqual([[1, 2]])
  })
})
