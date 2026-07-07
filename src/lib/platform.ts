// ランウェイ（プラットフォームゲーム）のコアロジック。
// ・プレイヤー = 出勤服から人物をくり抜いたスプライト（scripts/cutout.mjs が生成）
// ・特性 = 季節（コーデの日付）× 代表色（アイテムの色バケツ）で移動性能が変わる
// ・レベルは文字グリッドで定義し、タイル単位のAABB衝突で動かす
// 描画・入力は PlatformGameView 側。ここは純粋ロジックのみ（vitest対象）。
import { seasonOf, type Season } from './duel'

// ----------------------------------------------------------------------------
// くり抜きスプライトのマニフェスト（src/data/cutouts.json）
// ----------------------------------------------------------------------------
export type CutoutsFile = {
  version: number
  spriteHeight: number
  sprites: Record<string, { w: number; h: number }>
}

// ----------------------------------------------------------------------------
// 特性（季節 × 色）
// ----------------------------------------------------------------------------
export type Traits = {
  speed: number // 最高速の係数
  jump: number // ジャンプ初速の係数
  airJumps: number // 空中ジャンプ回数（基本1）
  air: number // 空中での加速係数（空中制御）
  glide: boolean // 落下がゆっくり（滑空）
  iceGrip: boolean // 氷ですべらない
  dash: number // ダッシュ強さの係数
  magnet: number // コイン取得半径の追加(px)
  notes: { name: string; desc: string }[] // 選択画面に出す特性の説明
}

const baseTraits = (): Traits => ({
  speed: 1,
  jump: 1,
  airJumps: 1,
  air: 1,
  glide: false,
  iceGrip: false,
  dash: 1,
  magnet: 0,
  notes: [],
})

const SEASON_TRAIT: Record<Season, (t: Traits) => void> = {
  spring: (t) => {
    t.jump *= 1.12
    t.notes.push({ name: '春風の跳躍', desc: 'ジャンプが高い' })
  },
  summer: (t) => {
    t.speed *= 1.12
    t.notes.push({ name: '真夏の疾走', desc: '走りが速い' })
  },
  autumn: (t) => {
    t.glide = true
    t.notes.push({ name: '落ち葉の滑空', desc: '落下がゆっくり' })
  },
  winter: (t) => {
    t.iceGrip = true
    t.notes.push({ name: '冬の踏ん張り', desc: '氷ですべらない' })
  },
}

const COLOR_TRAIT: Record<string, (t: Traits) => void> = {
  white: (t) => {
    t.speed *= 1.05
    t.jump *= 1.05
    t.notes.push({ name: '白の調和', desc: '走りとジャンプが少し上がる' })
  },
  beige: (t) => {
    t.magnet += 40
    t.notes.push({ name: '砂色の引力', desc: 'コインを引き寄せる' })
  },
  gray: (t) => {
    t.air *= 1.4
    t.notes.push({ name: '霧の身軽さ', desc: '空中で動きやすい' })
  },
  black: (t) => {
    t.dash *= 1.3
    t.notes.push({ name: '漆黒のダッシュ', desc: 'ダッシュが強い' })
  },
  brown: (t) => {
    t.iceGrip = true
    t.notes.push({ name: '大地の足裏', desc: '氷ですべらない' })
  },
  navy: (t) => {
    t.dash *= 1.15
    t.speed *= 1.04
    t.notes.push({ name: '深海の推進', desc: 'ダッシュと走りが少し上がる' })
  },
  blue: (t) => {
    t.iceGrip = true
    t.notes.push({ name: '青の冷静', desc: '氷ですべらない' })
  },
  green: (t) => {
    t.jump *= 1.08
    t.notes.push({ name: '若葉のバネ', desc: 'ジャンプが少し高い' })
  },
  yellow: (t) => {
    t.magnet += 64
    t.notes.push({ name: '金運の磁力', desc: 'コインを強く引き寄せる' })
  },
  orange: (t) => {
    t.speed *= 1.08
    t.notes.push({ name: '陽気な加速', desc: '走りが少し速い' })
  },
  red: (t) => {
    t.dash *= 1.2
    t.speed *= 1.04
    t.notes.push({ name: '情熱の初速', desc: 'ダッシュが強め' })
  },
  pink: (t) => {
    t.jump *= 1.06
    t.speed *= 1.03
    t.notes.push({ name: '花吹雪', desc: 'ジャンプと走りが少し上がる' })
  },
  purple: (t) => {
    t.airJumps += 1
    t.notes.push({ name: '宵闇の羽', desc: '空中ジャンプがもう1回増える' })
  },
}

/** コーデのアイテム色から代表色（最頻の色バケツ）を選ぶ */
export function dominantColor(colors: (string | undefined)[]): string | undefined {
  const freq = new Map<string, number>()
  for (const c of colors) if (c) freq.set(c, (freq.get(c) ?? 0) + 1)
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** 日付（季節）と代表色から特性を導出する */
export function deriveTraits(date: string, color: string | undefined): Traits {
  const t = baseTraits()
  SEASON_TRAIT[seasonOf(date)](t)
  if (color && COLOR_TRAIT[color]) COLOR_TRAIT[color](t)
  return t
}

// ----------------------------------------------------------------------------
// レベル定義（文字グリッド）
// ----------------------------------------------------------------------------
// 記号: # 地形 / ~ 氷 / < > ベルト / ^ トゲ / o コイン / S バネ /
//       G ゴール扉（下に地形が必要） / P スタート / w 歩く敵 / h 跳ねる敵 / . 空
export type LevelDef = { title: string; tip: string; grid: string[] }

export const TILE = 36

// タイル種別（solids 配列の値）
export const T_EMPTY = 0
export const T_SOLID = 1
export const T_ICE = 2
export const T_BELT_L = 3
export const T_BELT_R = 4
export const T_SPRING = 5

export type EnemyKind = 'walker' | 'hopper'
export type Level = {
  title: string
  tip: string
  w: number
  h: number
  cells: Uint8Array // タイル種別（w*h）
  spikes: boolean[]
  coins: { x: number; y: number }[] // ピクセル中心
  goal: { x: number; y: number; w: number; h: number } // ピクセル矩形（扉）
  start: { x: number; y: number } // プレイヤー初期位置（足元中心）
  spawns: { x: number; y: number; kind: EnemyKind }[]
}

export function parseLevel(def: LevelDef): Level {
  // 行末の空白は '.' 扱い（最長行に合わせて右パディング）
  const h = def.grid.length
  const w = Math.max(...def.grid.map((r) => r.length))
  const rows = def.grid.map((r) => r.padEnd(w, '.'))
  const cells = new Uint8Array(w * h)
  const spikes = Array.from({ length: w * h }, () => false)
  const coins: Level['coins'] = []
  const spawns: Level['spawns'] = []
  let start: Level['start'] | null = null
  let goal: Level['goal'] | null = null
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x]
      const cx = (x + 0.5) * TILE
      const feetY = (y + 1) * TILE
      if (c === '#') cells[y * w + x] = T_SOLID
      else if (c === '~') cells[y * w + x] = T_ICE
      else if (c === '<') cells[y * w + x] = T_BELT_L
      else if (c === '>') cells[y * w + x] = T_BELT_R
      else if (c === 'S') cells[y * w + x] = T_SPRING
      else if (c === '^') spikes[y * w + x] = true
      else if (c === 'o') coins.push({ x: cx, y: (y + 0.5) * TILE })
      else if (c === 'P') start = { x: cx, y: feetY }
      else if (c === 'G') goal = { x: x * TILE + 5, y: (y - 1) * TILE + 6, w: TILE - 10, h: TILE * 2 - 6 }
      else if (c === 'w') spawns.push({ x: cx, y: feetY, kind: 'walker' })
      else if (c === 'h') spawns.push({ x: cx, y: feetY, kind: 'hopper' })
    }
  }
  if (!start) throw new Error(`level "${def.title}": P がない`)
  if (!goal) throw new Error(`level "${def.title}": G がない`)
  return { title: def.title, tip: def.tip, w, h, cells, spikes, coins, goal, start, spawns }
}

// 全6ステージ。ジャンプ高さ約2.5タイル・二段で約4タイルを前提に設計。
export const LEVELS: LevelDef[] = [
  {
    title: 'RUN & JUMP',
    tip: '←→で移動、Z/スペースでジャンプ（空中でもう1回とべる）',
    grid: [
      '............................................................',
      '............................................................',
      '............................................................',
      '............................................................',
      '.................................o.o.o......................',
      '.................................#####......................',
      '...........o.o........o.o...................o...............',
      '...........####......#####..................##..............',
      '......o..............................o..............o.....G.',
      '.....###..........................####...##.........#....##.',
      'P.........................................................##.',
      '#######..########..#########....#####..#####..##..#########.',
      '############################....#############################',
      '############################....#############################',
    ],
  },
  {
    title: 'SPIKE VALLEY',
    tip: 'トゲに触れるとスタートに戻る。とったコインは消えない',
    grid: [
      '............................................................',
      '............................................................',
      '............................................................',
      '...............o.o...............o.o........................',
      '...............###...............###........................',
      '............................................................',
      '.........o..........o.......o..........o........o..........',
      '........###........###.....###........###......###.........',
      '............................................................',
      '............................................................',
      'P.........................o.................o...........G..',
      '#####^^######^^^#######^^######^^^########^^#######^^#######',
      '############################################################',
      '############################################################',
    ],
  },
  {
    title: 'SPRING',
    tip: 'バネで大ジャンプ！ 上のコインもとれる',
    grid: [
      '............................................................',
      '............................................................',
      '........o...............o.............o.o.o................',
      '.......###.............###..........###....................',
      '............................................................',
      '......................o.o..........o.o.....................',
      '....o................####..........###.....................',
      '...###......................................................',
      '...............................................o.o.......G.',
      '..........S...............S..............S...#####......##.',
      'P........###.............###............###..............##.',
      '######..............########....##################..#######',
      '######..............########....##################..#######',
      '############################################################',
    ],
  },
  {
    title: 'ICE',
    tip: '氷はすべる！ 冬服（と茶・青の服）はすべらない',
    grid: [
      '............................................................',
      '............................................................',
      '............................................................',
      '............o.o................o.o.........................',
      '............~~~~...............~~~~........................',
      '............................................................',
      '........o..............................o.o.....o...........',
      '.......~~~..........................~~~~~~....~~~..........',
      '............................................................',
      '..........................o.o..............................',
      'P.......................................................G..',
      '~~~~~~~..~~~~~~~~..~~~~~~~^^^~~..~~~~~~~~~~~~..~~~..~~~~~~~~',
      '~~~~~~~..~~~~~~~~..~~~~~~~~~~~~..~~~~~~~~~~~~..~~~..~~~~~~~~',
      '############################################################',
    ],
  },
  {
    title: 'BELT',
    tip: 'ベルトは流れに注意！ Xダッシュで勢いをのせろ',
    grid: [
      '............................................................',
      '............................................................',
      '............................................................',
      '............................................................',
      '.............o.o.o..............o.o.o......................',
      '.............<<<<<..............>>>>>......................',
      '............................................................',
      '............................................................',
      '.....o....##...........o............##..o........o.o........',
      '............................................................',
      'P.........................................................G',
      '###>>>>...<<<<<<<...>>>>>>>>...<<<<<<<<...>>>>>>...#########',
      '#######...#######...########...########...######...#########',
      '############################################################',
    ],
  },
  {
    title: 'HOP & STOMP',
    tip: '敵は上から踏めば倒せる。踏むと空中ジャンプも回復！',
    grid: [
      '............................................................',
      '............................................................',
      '............................................................',
      '..................o.o.o.....................................',
      '..................#####............o.o......................',
      '............###...................####......................',
      '.......o.o..............................o.o.....o.o........',
      '.......###..............................###......###.......',
      '............................................................',
      '............................h...............h..............',
      'P..........w.........w..............w....................G..',
      '######..#############..#####...#############...#####..#####',
      '######..#############..#####...#############...#####..#####',
      '############################################################',
    ],
  },
]

// ----------------------------------------------------------------------------
// 物理・ゲーム進行
// ----------------------------------------------------------------------------
export const PLAYER_W = 20
export const PLAYER_H = 50

const MOVE = 205 // 最高速 px/s
const ACCEL = 1900
const AIR_ACCEL = 1300
const FRICTION = 2100
const ICE_ACCEL = 0.35 // 氷での加速倍率
const ICE_FRICTION = 0.08 // 氷での摩擦倍率
const GRAV = 2150
const MAX_FALL = 900
const JUMP_V = 625
const AIR_JUMP_V = 560
const SPRING_V = 1000
const BELT_PUSH = 95 // ベルトの流し速度 px/s
const DASH_V = 500
const DASH_TIME = 0.16
const DASH_CD = 0.55
const COYOTE = 0.09
const JUMP_BUFFER = 0.12
const PICKUP_R = 26
const STOMP_BOUNCE = 400
const INVULN = 1.0

export type Input = {
  left: boolean
  right: boolean
  jumpHeld: boolean
  /** このフレームで押された（エッジ）。step が消費する */
  jumpPressed: boolean
  dashPressed: boolean
}

export type Enemy = {
  kind: EnemyKind
  x: number
  y: number // 足元
  vx: number
  vy: number
  dead: boolean
  timer: number // hopper のジャンプ間隔
}

export type FxEvent =
  | { type: 'jump' | 'airjump' | 'land' | 'dash' | 'spring' | 'stomp' | 'miss' | 'clear'; x: number; y: number }
  | { type: 'coin'; x: number; y: number }

export type Run = {
  level: Level
  traits: Traits
  x: number // 中心
  y: number // 足元
  vx: number
  vy: number
  facing: 1 | -1
  onGround: boolean
  groundKind: number // 乗っているタイル種別
  airLeft: number
  coyote: number
  buffer: number
  dashT: number
  dashCd: number
  invuln: number
  /** 上昇がジャンプ由来か（バネ・踏みつけの跳ねはボタン離しで短縮しない） */
  cutJump: boolean
  coins: boolean[] // 取得済みフラグ（レベルの coins と同じ index）
  coinCount: number
  miss: number
  time: number
  status: 'play' | 'clear'
  enemies: Enemy[]
  /** このstepで起きたイベント（描画側がエフェクト・音に使う）。step冒頭でクリア */
  events: FxEvent[]
}

const makeEnemies = (level: Level): Enemy[] =>
  level.spawns.map((s) => ({
    kind: s.kind,
    x: s.x,
    y: s.y,
    vx: s.kind === 'walker' ? -55 : 0,
    vy: 0,
    dead: false,
    timer: 0.8,
  }))

export function createRun(level: Level, traits: Traits): Run {
  return {
    level,
    traits,
    x: level.start.x,
    y: level.start.y,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    groundKind: T_EMPTY,
    airLeft: traits.airJumps,
    coyote: 0,
    buffer: 0,
    dashT: 0,
    dashCd: 0,
    invuln: 0,
    cutJump: false,
    coins: Array.from({ length: level.coins.length }, () => false),
    coinCount: 0,
    miss: 0,
    time: 0,
    status: 'play',
    enemies: makeEnemies(level),
    events: [],
  }
}

const cellAt = (lv: Level, tx: number, ty: number): number => {
  if (tx < 0 || tx >= lv.w) return T_SOLID // 左右端は壁
  if (ty < 0 || ty >= lv.h) return T_EMPTY // 上下は抜ける（下は落下ミス）
  return lv.cells[ty * lv.w + tx]
}
const isSolid = (k: number) => k !== T_EMPTY

/** AABB（中心x・足元y・幅・高さ）とタイルの衝突を軸ごとに解決する */
function moveAxis(run: Run, dx: number, dy: number) {
  const lv = run.level
  // X軸
  if (dx !== 0) {
    run.x += dx
    const y0 = Math.floor((run.y - PLAYER_H) / TILE)
    const y1 = Math.floor((run.y - 0.01) / TILE)
    if (dx > 0) {
      const tx = Math.floor((run.x + PLAYER_W / 2) / TILE)
      for (let ty = y0; ty <= y1; ty++) {
        if (isSolid(cellAt(lv, tx, ty))) {
          run.x = tx * TILE - PLAYER_W / 2
          run.vx = 0
          break
        }
      }
    } else {
      const tx = Math.floor((run.x - PLAYER_W / 2) / TILE)
      for (let ty = y0; ty <= y1; ty++) {
        if (isSolid(cellAt(lv, tx, ty))) {
          run.x = (tx + 1) * TILE + PLAYER_W / 2
          run.vx = 0
          break
        }
      }
    }
  }
  // Y軸
  if (dy !== 0) {
    run.y += dy
    const x0 = Math.floor((run.x - PLAYER_W / 2) / TILE)
    const x1 = Math.floor((run.x + PLAYER_W / 2 - 0.01) / TILE)
    if (dy > 0) {
      const ty = Math.floor(run.y / TILE)
      for (let tx = x0; tx <= x1; tx++) {
        const k = cellAt(lv, tx, ty)
        if (isSolid(k)) {
          run.y = ty * TILE
          run.vy = 0
          run.onGround = true
          run.groundKind = k
          break
        }
      }
    } else {
      const ty = Math.floor((run.y - PLAYER_H) / TILE)
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolid(cellAt(lv, tx, ty))) {
          run.y = (ty + 1) * TILE + PLAYER_H
          run.vy = 0
          break
        }
      }
    }
  }
}

function respawn(run: Run) {
  run.miss += 1
  run.x = run.level.start.x
  run.y = run.level.start.y
  run.vx = 0
  run.vy = 0
  run.facing = 1
  run.dashT = 0
  run.dashCd = 0
  run.invuln = INVULN
  run.airLeft = run.traits.airJumps
  run.enemies = makeEnemies(run.level) // 敵は初期位置に戻す（コインは保持）
  run.events.push({ type: 'miss', x: run.x, y: run.y })
}

const overlaps = (
  run: Run,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean =>
  run.x + PLAYER_W / 2 > x &&
  run.x - PLAYER_W / 2 < x + w &&
  run.y > y &&
  run.y - PLAYER_H < y + h

function stepEnemies(run: Run, dt: number) {
  const lv = run.level
  for (const e of run.enemies) {
    if (e.dead) continue
    if (e.kind === 'walker') {
      const nx = e.x + e.vx * dt
      const dir = Math.sign(e.vx)
      const aheadX = Math.floor((nx + dir * 12) / TILE)
      const footY = Math.floor((e.y + 1) / TILE)
      const bodyY = Math.floor((e.y - 10) / TILE)
      // 壁か崖（足場の先がない）で反転
      if (isSolid(cellAt(lv, aheadX, bodyY)) || !isSolid(cellAt(lv, aheadX, footY))) e.vx = -e.vx
      else e.x = nx
    } else {
      // hopper: 接地中はタメて、時間が来たら跳ねる
      e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt)
      const ny = e.y + e.vy * dt
      const ty = Math.floor(ny / TILE)
      const tx = Math.floor(e.x / TILE)
      if (e.vy > 0 && isSolid(cellAt(lv, tx, ty))) {
        e.y = ty * TILE
        e.vy = 0
        e.timer -= dt
        if (e.timer <= 0) {
          e.vy = -520
          e.timer = 1.6
        }
      } else {
        e.y = ny
      }
    }
  }
}

/** 1ステップ進める（dt は 1/60 固定を想定） */
export function step(run: Run, input: Input, dt: number) {
  run.events = []
  if (run.status !== 'play') return
  run.time += dt
  run.invuln = Math.max(0, run.invuln - dt)
  run.dashCd = Math.max(0, run.dashCd - dt)

  const tr = run.traits
  const wasGround = run.onGround

  // --- 横移動 ---
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  if (dir !== 0) run.facing = dir as 1 | -1
  const onIce = run.onGround && run.groundKind === T_ICE && !tr.iceGrip
  const maxV = MOVE * tr.speed
  if (run.dashT > 0) {
    run.dashT -= dt // ダッシュ中は速度維持（摩擦・入力を無視）
  } else if (dir !== 0) {
    const a = (run.onGround ? ACCEL : AIR_ACCEL * tr.air) * (onIce ? ICE_ACCEL : 1)
    run.vx += dir * a * dt
    if (Math.abs(run.vx) > maxV) run.vx = Math.sign(run.vx) * Math.max(maxV, Math.abs(run.vx) - FRICTION * dt)
  } else {
    const f = (run.onGround ? FRICTION : FRICTION * 0.25) * (onIce ? ICE_FRICTION : 1)
    const s = Math.sign(run.vx)
    run.vx -= s * Math.min(Math.abs(run.vx), f * dt)
  }

  // --- ダッシュ ---
  if (input.dashPressed && run.dashCd <= 0 && run.dashT <= 0) {
    run.vx = run.facing * DASH_V * tr.dash
    run.dashT = DASH_TIME
    run.dashCd = DASH_CD
    if (run.vy > 0) run.vy = 0 // 空中ダッシュは少し浮く
    run.events.push({ type: 'dash', x: run.x, y: run.y })
  }

  // --- ジャンプ（コヨーテタイム＋先行入力） ---
  run.coyote = run.onGround ? COYOTE : Math.max(0, run.coyote - dt)
  run.buffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, run.buffer - dt)
  if (run.buffer > 0) {
    if (run.coyote > 0) {
      run.vy = -JUMP_V * tr.jump
      run.coyote = 0
      run.buffer = 0
      run.cutJump = true
      run.events.push({ type: 'jump', x: run.x, y: run.y })
    } else if (run.airLeft > 0) {
      run.vy = -AIR_JUMP_V * tr.jump
      run.airLeft -= 1
      run.buffer = 0
      run.cutJump = true
      run.events.push({ type: 'airjump', x: run.x, y: run.y })
    }
  }
  // 上昇中にボタンを離したら早めに落ちる（可変ジャンプ。バネ・踏みつけの跳ねは対象外）
  if (run.cutJump && !input.jumpHeld && run.vy < -220) run.vy = -220
  if (run.vy >= 0) run.cutJump = false

  // --- 重力 ---
  const falling = run.vy > 0
  const g = GRAV * (falling && tr.glide ? 0.68 : 1)
  const maxFall = MAX_FALL * (tr.glide ? 0.72 : 1)
  run.vy = Math.min(maxFall, run.vy + g * dt)

  // --- 移動と衝突 ---
  run.onGround = false
  const beltPush =
    wasGround && run.groundKind === T_BELT_L ? -BELT_PUSH : wasGround && run.groundKind === T_BELT_R ? BELT_PUSH : 0
  moveAxis(run, (run.vx + beltPush) * dt, 0)
  moveAxis(run, 0, run.vy * dt)
  if (!run.onGround && wasGround === false) run.groundKind = T_EMPTY

  if (run.onGround) {
    run.airLeft = tr.airJumps
    if (!wasGround) run.events.push({ type: 'land', x: run.x, y: run.y })
    // バネ: 乗ったら大ジャンプ
    if (run.groundKind === T_SPRING) {
      run.vy = -SPRING_V
      run.onGround = false
      run.cutJump = false
      run.events.push({ type: 'spring', x: run.x, y: run.y })
    }
  }

  // --- 落下ミス ---
  if (run.y - PLAYER_H > run.level.h * TILE + TILE * 2) {
    respawn(run)
    return
  }

  // --- トゲ ---
  if (run.invuln <= 0) {
    const x0 = Math.floor((run.x - PLAYER_W / 2) / TILE)
    const x1 = Math.floor((run.x + PLAYER_W / 2 - 0.01) / TILE)
    const y0 = Math.floor((run.y - PLAYER_H) / TILE)
    const y1 = Math.floor((run.y - 0.01) / TILE)
    outer: for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || tx >= run.level.w || ty < 0 || ty >= run.level.h) continue
        if (!run.level.spikes[ty * run.level.w + tx]) continue
        // トゲはタイルより少し小さい当たり判定（理不尽さ軽減）
        const sx = tx * TILE + 5
        const sy = ty * TILE + 12
        if (overlaps(run, sx, sy, TILE - 10, TILE - 12)) {
          respawn(run)
          break outer
        }
      }
    }
    if (run.miss && run.invuln > 0) return
  }

  // --- 敵 ---
  stepEnemies(run, dt)
  if (run.invuln <= 0) {
    for (const e of run.enemies) {
      if (e.dead) continue
      const ew = 26
      const eh = 24
      if (!overlaps(run, e.x - ew / 2, e.y - eh, ew, eh)) continue
      if (run.vy > 80 && run.y - PLAYER_H / 2 < e.y - eh / 2) {
        // 踏みつけ: 倒して跳ね、空中ジャンプ回復
        e.dead = true
        run.vy = -STOMP_BOUNCE
        run.cutJump = false
        run.airLeft = tr.airJumps
        run.events.push({ type: 'stomp', x: e.x, y: e.y - eh })
      } else {
        respawn(run)
        return
      }
    }
  }

  // --- コイン ---
  const pickR = PICKUP_R + tr.magnet
  const cx = run.x
  const cy = run.y - PLAYER_H / 2
  run.level.coins.forEach((c, i) => {
    if (run.coins[i]) return
    const dx = c.x - cx
    const dy = c.y - cy
    if (dx * dx + dy * dy <= pickR * pickR) {
      run.coins[i] = true
      run.coinCount += 1
      run.events.push({ type: 'coin', x: c.x, y: c.y })
    }
  })

  // --- ゴール ---
  const g2 = run.level.goal
  if (overlaps(run, g2.x, g2.y, g2.w, g2.h)) {
    run.status = 'clear'
    run.events.push({ type: 'clear', x: run.x, y: run.y })
  }
}
