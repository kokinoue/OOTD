import { describe, expect, it } from 'vitest'
import {
  createRun,
  deriveTraits,
  dominantColor,
  LEVELS,
  parseLevel,
  PLAYER_H,
  step,
  T_EMPTY,
  TILE,
  type Input,
  type Run,
} from '../platform'

const idle = (): Input => ({
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  dashPressed: false,
})

const DT = 1 / 60
const frames = (run: Run, n: number, input: Partial<Input> = {}) => {
  for (let i = 0; i < n; i++) {
    step(run, { ...idle(), ...input }, DT)
    // jumpPressed / dashPressed はエッジ入力なので1フレームで消す
    input = { ...input, jumpPressed: false, dashPressed: false }
  }
}

const mini = (grid: string[], title = 'test') => parseLevel({ title, tip: '', grid })

describe('deriveTraits', () => {
  it('季節と色の効果が乗る', () => {
    const t = deriveTraits('2025-07-15', 'black') // 夏 × 黒
    expect(t.speed).toBeGreaterThan(1)
    expect(t.dash).toBeCloseTo(1.3)
    expect(t.notes).toHaveLength(2)
  })
  it('冬は氷グリップ、紫は空中ジャンプ+1', () => {
    expect(deriveTraits('2025-01-10', undefined).iceGrip).toBe(true)
    expect(deriveTraits('2025-04-10', 'purple').airJumps).toBe(2)
  })
  it('未知の色は無視される', () => {
    expect(deriveTraits('2025-04-10', 'rainbow').notes).toHaveLength(1)
  })
})

describe('dominantColor', () => {
  it('最頻の色を返す', () => {
    expect(dominantColor(['black', 'white', 'black', undefined])).toBe('black')
    expect(dominantColor([undefined, undefined])).toBeUndefined()
  })
})

describe('LEVELS', () => {
  it('全ステージがパースでき、扉の下に地形がある', () => {
    for (const def of LEVELS) {
      const lv = parseLevel(def)
      expect(lv.coins.length).toBeGreaterThan(0)
      // ゴール扉のすぐ下のタイルは地形（扉が宙に浮かない）
      const gx = Math.floor((lv.goal.x + lv.goal.w / 2) / TILE)
      const gy = Math.floor((lv.goal.y + lv.goal.h) / TILE)
      expect(lv.cells[gy * lv.w + gx]).not.toBe(T_EMPTY)
      // スタート列の下に足場がある
      const px = Math.floor(lv.start.x / TILE)
      const py = Math.floor(lv.start.y / TILE)
      const hasFloor = Array.from({ length: lv.h - py }, (_, i) => py + i).some(
        (ty) => lv.cells[ty * lv.w + px] !== T_EMPTY,
      )
      expect(hasFloor).toBe(true)
    }
  })
  it('短い行は右側が空として扱われる', () => {
    const lv = mini(['P.G', '###..', '#####'])
    expect(lv.w).toBe(5)
    expect(lv.cells[4]).toBe(T_EMPTY) // 1行目の右端（パディング部分）
  })
})

describe('physics', () => {
  const flat = () =>
    mini([
      '..........',
      'P.......G.',
      '##########',
      '##########',
    ])

  it('接地して静止する', () => {
    const run = createRun(flat(), deriveTraits('2025-05-01', undefined))
    frames(run, 60)
    expect(run.onGround).toBe(true)
    expect(run.vy).toBe(0)
    expect(run.y).toBeCloseTo(TILE * 2) // 地面の上
  })

  it('ジャンプで2タイル以上上がって着地する', () => {
    const run = createRun(flat(), deriveTraits('2025-01-01', undefined)) // 冬（ジャンプ補正なし）
    frames(run, 30)
    const groundY = run.y
    let minY = groundY
    step(run, { ...idle(), jumpHeld: true, jumpPressed: true }, DT)
    for (let i = 0; i < 90; i++) {
      step(run, { ...idle(), jumpHeld: true }, DT)
      minY = Math.min(minY, run.y)
    }
    expect(groundY - minY).toBeGreaterThan(TILE * 2)
    expect(run.onGround).toBe(true)
  })

  it('空中ジャンプは airJumps 回まで', () => {
    const run = createRun(flat(), deriveTraits('2025-01-01', undefined))
    frames(run, 30)
    step(run, { ...idle(), jumpHeld: true, jumpPressed: true }, DT)
    frames(run, 10, { jumpHeld: true })
    expect(run.airLeft).toBe(1)
    step(run, { ...idle(), jumpHeld: true, jumpPressed: true }, DT)
    expect(run.airLeft).toBe(0)
    // もう押しても何も起きない（バッファが残るだけで消費されない）
    step(run, { ...idle(), jumpHeld: true, jumpPressed: true }, DT)
    expect(run.airLeft).toBe(0)
  })

  it('右へ歩くとコインを取り、ゴールでクリアになる', () => {
    const run = createRun(
      mini([
        '..........',
        'P..o....G.',
        '##########',
        '##########',
      ]),
      deriveTraits('2025-07-01', undefined),
    )
    frames(run, 300, { right: true })
    expect(run.coinCount).toBe(1)
    expect(run.status).toBe('clear')
  })

  it('トゲに触れるとミスしてスタートに戻る（コインは保持）', () => {
    const run = createRun(
      mini([
        '..........',
        'P.o....^G.',
        '##########',
        '##########',
      ]),
      deriveTraits('2025-07-01', undefined),
    )
    // ミスするまで右へ歩く
    for (let i = 0; i < 300 && run.miss === 0; i++) step(run, { ...idle(), right: true }, DT)
    expect(run.miss).toBe(1)
    expect(run.coinCount).toBe(1)
    expect(run.status).toBe('play')
    expect(run.x).toBeCloseTo(run.level.start.x) // 直後はスタート位置
  })

  it('穴に落ちるとミス', () => {
    const run = createRun(
      mini([
        '.........G',
        'P........#',
        '##......##',
      ]),
      deriveTraits('2025-07-01', undefined),
    )
    for (let i = 0; i < 600 && run.miss === 0; i++) step(run, { ...idle(), right: true }, DT)
    expect(run.miss).toBe(1)
  })

  it('壁は通り抜けない', () => {
    const run = createRun(
      mini([
        '..........',
        '....#...G.',
        'P...#.....',
        '##########',
      ]),
      deriveTraits('2025-07-01', undefined),
    )
    frames(run, 120, { right: true })
    // 壁（x=4タイル）の手前で止まる
    expect(run.x).toBeLessThanOrEqual(4 * TILE)
    expect(run.status).toBe('play')
  })

  it('敵を踏むと倒せて、横から当たるとミス', () => {
    const grid = [
      '..........',
      'P....w..G.',
      '##########',
      '##########',
    ]
    // 横から歩いて当たる → ミス
    const runA = createRun(mini(grid), deriveTraits('2025-07-01', undefined))
    frames(runA, 200, { right: true })
    expect(runA.miss).toBeGreaterThanOrEqual(1)

    // 上から落ちて踏む → 敵が死ぬ
    const runB = createRun(mini(grid), deriveTraits('2025-07-01', undefined))
    const enemy = runB.enemies[0]
    runB.x = enemy.x
    runB.y = enemy.y - PLAYER_H // 敵の真上から落とす
    runB.vy = 300
    frames(runB, 30)
    expect(enemy.dead).toBe(true)
    expect(runB.miss).toBe(0)
  })

  it('バネで通常ジャンプより高く跳ぶ（ボタンを離していても短縮されない）', () => {
    const run = createRun(
      mini([
        '............',
        '............',
        '............',
        '............',
        '............',
        '..........G',
        'P.........##',
        '###S########',
      ]),
      deriveTraits('2025-01-01', undefined),
    )
    const groundY = run.level.start.y
    let minY = groundY
    for (let i = 0; i < 240; i++) {
      step(run, { ...idle(), right: i < 30 }, DT) // バネの上を歩いて通過
      minY = Math.min(minY, run.y)
    }
    expect(groundY - minY).toBeGreaterThan(TILE * 4)
  })
})
