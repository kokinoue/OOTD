import { describe, expect, it } from 'vitest'
import {
  createRun,
  deriveTraits,
  LEVELS,
  parseLevel,
  PLAYER_H,
  PLAYER_W,
  step,
  T_EMPTY,
  TILE,
  type Input,
  type Level,
  type Run,
  type Traits,
} from '../platform'

// 全ステージが実際にクリア可能かを、単純な自動プレイ（右へ走り、障害物でジャンプ）で確認する。
// botがクリアできる = 人間なら余裕でクリアできる、の下限保証。

const DT = 1 / 60
const MAX_SIM_SEC = 150

const cellAt = (run: Run, tx: number, ty: number) => {
  const lv = run.level
  if (tx < 0 || tx >= lv.w) return 1
  if (ty < 0 || ty >= lv.h) return T_EMPTY
  return lv.cells[ty * lv.w + tx]
}
const spikeAt = (run: Run, tx: number, ty: number) => {
  const lv = run.level
  if (tx < 0 || tx >= lv.w || ty < 0 || ty >= lv.h) return false
  return lv.spikes[ty * lv.w + tx]
}

/** 右へ走り、壁・穴・トゲ・敵の手前でジャンプする素朴なbot */
function botInput(run: Run, blockedFor: number): Input {
  const feetTy = Math.floor((run.y - 1) / TILE)
  const tx = Math.floor(run.x / TILE)
  const input: Input = { left: false, right: true, jumpHeld: run.vy < 0, jumpPressed: false, dashPressed: false }

  if (run.onGround) {
    // 目の前の壁（体の高さ2タイル分）
    const wall =
      cellAt(run, tx + 1, feetTy) !== T_EMPTY || cellAt(run, tx + 1, feetTy - 1) !== T_EMPTY
    // 目の前の穴（2列先まで、足元3タイル以内に床がない）
    let gap = true
    for (let dy = 0; dy <= 3 && gap; dy++) {
      if (cellAt(run, tx + 1, feetTy + 1 + dy) !== T_EMPTY) gap = false
    }
    // 目の前のトゲ（同じ高さ or 1段下の notch）
    const spike =
      spikeAt(run, tx + 1, feetTy) ||
      spikeAt(run, tx + 2, feetTy) ||
      spikeAt(run, tx + 1, feetTy + 1) ||
      spikeAt(run, tx + 2, feetTy + 1)
    // 目の前の敵
    const enemy = run.enemies.some(
      (e) => !e.dead && e.x > run.x && e.x - run.x < TILE * 2.5 && Math.abs(e.y - run.y) < TILE * 1.5,
    )
    if (wall || gap || spike || enemy) {
      input.jumpPressed = true
      input.jumpHeld = true
    }
  } else if (run.airLeft > 0) {
    // 空中: 横に詰まっている（壁越え）か、落下中で真下に床がない（穴・トゲ越え）なら追加ジャンプ
    const stuck = Math.abs(run.vx) < 20 && run.vy > -100
    let noFloor = true
    for (let dy = 0; dy <= 4 && noFloor; dy++) {
      if (cellAt(run, tx, feetTy + 1 + dy) !== T_EMPTY) noFloor = false
    }
    const spikeBelow = spikeAt(run, tx, feetTy + 1) || spikeAt(run, tx, feetTy + 2)
    if (stuck || (run.vy > 150 && (noFloor || spikeBelow))) {
      input.jumpPressed = true
      input.jumpHeld = true
    }
  }
  // 長時間詰まっていたらダッシュも試す
  if (blockedFor > 0.6 && run.dashCd <= 0) input.dashPressed = true
  return input
}

// 季節ごとに移動性能が変わるので、全季節でクリアできることを確認する
// （冬=補正なし・氷グリップ / 春=ジャンプ高 / 夏=速い / 秋=滑空で落下が遅い）
const SEASON_DATES = {
  winter: '2025-01-15',
  spring: '2025-04-15',
  summer: '2025-07-15',
  autumn: '2025-10-15',
} as const

describe.each(Object.entries(SEASON_DATES))('全ステージがクリア可能（自動プレイbot・%s）', (_season, date) => {
  for (let i = 0; i < LEVELS.length; i++) {
    it(`STAGE ${i + 1} ${LEVELS[i].title}`, () => {
      const level = parseLevel(LEVELS[i])
      const run = createRun(level, deriveTraits(date, undefined))
      let blockedFor = 0
      let lastX = run.x
      const maxSteps = MAX_SIM_SEC * 60
      let steps = 0
      for (; steps < maxSteps && run.status !== 'clear'; steps++) {
        step(run, botInput(run, blockedFor), DT)
        blockedFor = Math.abs(run.x - lastX) < 1 ? blockedFor + DT : 0
        lastX = run.x
      }
      expect(run.status).toBe('clear')
      // 参考ログ: どのくらいの時間・ミスでクリアできたか
      // eslint-disable-next-line no-console
      console.log(
        `STAGE ${i + 1} ${LEVELS[i].title}: ${run.time.toFixed(1)}s, miss ${run.miss}, coins ${run.coinCount}/${level.coins.length}`,
      )
    })
  }
})

// hitbox 定数が描画側の想定と乖離していないことの回帰チェック
it('プレイヤーのヒットボックスは2タイル未満', () => {
  expect(PLAYER_H).toBeLessThan(TILE * 2)
  expect(PLAYER_W).toBeLessThan(TILE)
})

// ----------------------------------------------------------------------------
// 全コインが取得可能か
// 「コインの近くの足場から取れる」だけでは不十分（その足場に行けないかもしれない）。
// スタートから物理シミュレーションのBFSで到達可能な足場を求め、そこから取れることを確認する。
// ----------------------------------------------------------------------------
const standable = (lv: ReturnType<typeof parseLevel>, tx: number, ty: number) =>
  tx >= 0 &&
  tx < lv.w &&
  ty >= 1 &&
  ty < lv.h &&
  lv.cells[ty * lv.w + tx] !== T_EMPTY &&
  lv.cells[(ty - 1) * lv.w + tx] === T_EMPTY

/** takeoff地点からコインへ向かい、指定の戦略で2.5秒動いて取れるか */
function trySim(
  levelIdx: number,
  coinIdx: number,
  from: { x: number; y: number },
  strategy: 'walk' | 'jump' | 'jumpair',
): boolean {
  const level = parseLevel(LEVELS[levelIdx])
  const run = createRun(level, deriveTraits('2025-01-15', undefined)) // 冬=補正なし基準
  const coin = level.coins[coinIdx]
  run.x = from.x
  run.y = from.y
  run.invuln = 999 // 敵・トゲは取得可否の判定では無視する
  let jumped = false
  let airJumped = false
  for (let s = 0; s < 150; s++) {
    const dx = coin.x - run.x
    const input: Input = {
      left: dx < -6,
      right: dx > 6,
      jumpHeld: strategy !== 'walk',
      jumpPressed: false,
      dashPressed: false,
    }
    if (strategy !== 'walk' && !jumped && run.onGround) {
      input.jumpPressed = true
      jumped = true
    }
    // 上昇が失速したら空中ジャンプ
    if (strategy === 'jumpair' && jumped && !airJumped && !run.onGround && run.vy > -80) {
      input.jumpPressed = true
      airJumped = true
    }
    step(run, input, DT)
    if (run.coins[coinIdx]) return true
  }
  return false
}

// 探索の移動パターン:
//   walk       = 歩くだけ（崖から落ちる・バネに乗る）
//   jump       = 接地するたびにジャンプ（バニーホップ）
//   jumpair    = jump + 上昇が失速したら空中ジャンプ
//   walkair    = 歩き + 空中ジャンプのみ（バネで跳ねた後の追い上げに効く）
//   *-flip     = 空中ジャンプの瞬間に進行方向を反転（S字軌道。バネ上の足場に乗るのに必要）
type ExploreStrat = 'walk' | 'jump' | 'jumpair' | 'jumpair-flip' | 'walkair' | 'walkair-flip'
const EXPLORE_STRATS: ExploreStrat[] = ['walk', 'jump', 'jumpair', 'jumpair-flip', 'walkair', 'walkair-flip']

/** takeoffタイルから一定方向へ約3.5秒動き、着地した足場タイルと拾えたコインを記録する */
function exploreSim(
  level: Level,
  traits: Traits,
  from: { tx: number; ty: number },
  dir: -1 | 1,
  strat: ExploreStrat,
  landed: Set<number>,
  coins: boolean[],
) {
  const run = createRun(level, traits)
  run.x = (from.tx + 0.5) * TILE
  run.y = from.ty * TILE
  run.invuln = 9999 // 敵・トゲは到達可能性の判定では無視する
  const groundJump = strat === 'jump' || strat.startsWith('jumpair')
  const airJump = strat !== 'walk' && strat !== 'jump'
  let curDir: -1 | 1 = dir
  for (let s = 0; s < 210; s++) {
    const input: Input = {
      left: curDir < 0,
      right: curDir > 0,
      jumpHeld: strat !== 'walk',
      jumpPressed: false,
      dashPressed: false,
    }
    if (groundJump && run.onGround) input.jumpPressed = true
    // 上昇が失速したら空中ジャンプ（airLeftはバネ・着地で回復するので何度でも）
    if (airJump && !run.onGround && run.airLeft > 0 && run.vy > -80) {
      input.jumpPressed = true
      if (strat.endsWith('-flip')) curDir = curDir === 1 ? -1 : 1
    }
    step(run, input, DT)
    if (run.onGround) {
      landed.add(Math.floor(run.y / TILE) * level.w + Math.floor(run.x / TILE))
    }
    // バネは接地扱いにならないので、跳ねたイベントから足場として記録する
    for (const ev of run.events) {
      if (ev.type === 'spring') landed.add(Math.floor(run.y / TILE) * level.w + Math.floor(run.x / TILE))
    }
    for (let i = 0; i < coins.length; i++) if (run.coins[i]) coins[i] = true
  }
}

/** スタートから到達できる足場タイル集合と、探索中に拾えたコインを返す */
function computeReach(levelIdx: number): { level: Level; landed: Set<number>; coins: boolean[] } {
  const level = parseLevel(LEVELS[levelIdx])
  const traits = deriveTraits('2025-01-15', undefined) // 冬=補正なし基準
  const landed = new Set<number>()
  const coins = level.coins.map(() => false)

  // シード: スタート地点で立ち尽くしたときに乗っている足場（ベルトで流されるのも含む）
  const seed = createRun(level, traits)
  seed.invuln = 9999
  for (let s = 0; s < 120; s++) {
    step(seed, { left: false, right: false, jumpHeld: false, jumpPressed: false, dashPressed: false }, DT)
    if (seed.onGround) landed.add(Math.floor(seed.y / TILE) * level.w + Math.floor(seed.x / TILE))
  }

  const queued = new Set(landed)
  const queue = [...landed]
  while (queue.length > 0) {
    const key = queue.pop()!
    const ty = Math.floor(key / level.w)
    const tx = key % level.w
    if (!standable(level, tx, ty)) continue
    for (const dir of [-1, 1] as const) {
      for (const strat of EXPLORE_STRATS) exploreSim(level, traits, { tx, ty }, dir, strat, landed, coins)
    }
    for (const k of landed) {
      if (!queued.has(k)) {
        queued.add(k)
        queue.push(k)
      }
    }
  }
  return { level, landed, coins }
}

describe('全コインが取得可能（スタートから到達できる足場経由）', () => {
  for (let li = 0; li < LEVELS.length; li++) {
    it(`STAGE ${li + 1} ${LEVELS[li].title}`, () => {
      const { level, landed, coins } = computeReach(li)
      const unreachable: string[] = []
      for (let ci = 0; ci < level.coins.length; ci++) {
        if (coins[ci]) continue
        // 探索の固定方向パターンで拾えなかったコインは、到達可能な足場から狙い撃ちで再試行
        const coin = level.coins[ci]
        const ctx = Math.floor(coin.x / TILE)
        const candidates = [...landed]
          .map((k) => ({ tx: k % level.w, ty: Math.floor(k / level.w) }))
          .filter((t) => Math.abs(t.tx - ctx) <= 5 && standable(level, t.tx, t.ty))
        const ok = candidates.some((t) =>
          (['walk', 'jump', 'jumpair'] as const).some((st) =>
            trySim(li, ci, { x: (t.tx + 0.5) * TILE, y: t.ty * TILE }, st),
          ),
        )
        if (!ok) unreachable.push(`coin#${ci} tile=(${ctx},${Math.floor(coin.y / TILE)})`)
      }
      expect(unreachable).toEqual([])
    })
  }
})
