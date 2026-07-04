import { describe, expect, it } from 'vitest'
import type { Outfit } from '../../types'
import {
  ATTR_BONUS,
  BACK_ZONES,
  DECK_SIZE,
  MONSTER_COUNT,
  MONSTER_ZONES,
  SPELL_TRAP_DEFS,
  START_HAND,
  START_LP,
  applyAction,
  buildAutoDeck,
  buildLevelScale,
  canSummon,
  cpuNextAction,
  createGame,
  deriveMonster,
  ensureUniqueNames,
  isMonster,
  matchup,
  materializeDeck,
  seasonOf,
  tributesNeeded,
  type Card,
  type FieldSlot,
  type GameState,
  type MonsterCard,
  type MonsterTemplate,
  type PlayerState,
  type Season,
  type SpellTrapCard,
  type SpellTrapId,
} from '../duel'

// ----------------------------------------------------------------------------
// フィクスチャ
// ----------------------------------------------------------------------------
let seq = 0

const mkMonster = (over: Partial<MonsterCard> = {}): MonsterCard => {
  const n = seq++
  return {
    kind: 'monster',
    outfitKey: `key-${n}`,
    name: `モンスター${n}`,
    img: '',
    title: '',
    date: '2025-01-15',
    likes: 1,
    atk: 1000,
    def: 800,
    level: 4,
    season: 'winter',
    race: '戦衣族',
    ability: 'formation',
    uid: `u${n}`,
    ...over,
  }
}

const mkSpellTrap = (id: SpellTrapId): SpellTrapCard => ({
  ...SPELL_TRAP_DEFS[id],
  uid: `st${seq++}`,
})

const mkSlot = (card: MonsterCard, over: Partial<FieldSlot> = {}): FieldSlot => ({
  card,
  orientation: 'attack',
  faceDown: false,
  atkBuff: 0,
  season: card.season,
  summonedThisTurn: false,
  hasAttacked: false,
  posChangedThisTurn: false,
  ...over,
})

const mkPlayer = (over: Partial<PlayerState> = {}): PlayerState => ({
  name: 'P',
  lp: START_LP,
  deck: [],
  hand: [],
  field: Array(MONSTER_ZONES).fill(null),
  back: Array(BACK_ZONES).fill(null),
  graveyard: [],
  ...over,
})

const mkState = (over: Partial<GameState> = {}): GameState => ({
  sides: [mkPlayer({ name: 'あなた' }), mkPlayer({ name: 'CP' })],
  turn: 0,
  phase: 'main',
  turnNo: 2, // 既定で「先攻1ターン目制限」を外しておく
  normalSummonUsed: false,
  winner: null,
  log: [],
  flash: null,
  ...over,
})

const mkOutfit = (over: Partial<Outfit> = {}): Outfit => ({
  key: `outfit-${seq++}`,
  no: 1,
  title: 'テストコーデ',
  date: '2025-06-15',
  publishAt: '2025-06-15',
  like: 5,
  comment: '',
  noteUrl: '',
  images: [{ url: 'https://example.com/a.png', width: 100, height: 100, caption: '', itemIds: [] }],
  itemIds: [],
  ...over,
})

const fieldCount = (p: PlayerState) => p.field.filter(Boolean).length

// ----------------------------------------------------------------------------
// カード導出（純粋関数）
// ----------------------------------------------------------------------------
describe('seasonOf', () => {
  it('月から季節を判定する', () => {
    expect(seasonOf('2025-03-01')).toBe('spring')
    expect(seasonOf('2025-05-31')).toBe('spring')
    expect(seasonOf('2025-06-01')).toBe('summer')
    expect(seasonOf('2025-08-20')).toBe('summer')
    expect(seasonOf('2025-09-01')).toBe('autumn')
    expect(seasonOf('2025-11-30')).toBe('autumn')
    expect(seasonOf('2025-12-01')).toBe('winter')
    expect(seasonOf('2025-01-15')).toBe('winter')
    expect(seasonOf('2025-02-28')).toBe('winter')
  })
})

describe('matchup: 季節の四すくみ（春→夏→秋→冬→春）', () => {
  it('順方向は有利(1)、逆方向は不利(-1)', () => {
    expect(matchup('spring', 'summer')).toBe(1)
    expect(matchup('summer', 'autumn')).toBe(1)
    expect(matchup('autumn', 'winter')).toBe(1)
    expect(matchup('winter', 'spring')).toBe(1)
    expect(matchup('summer', 'spring')).toBe(-1)
    expect(matchup('spring', 'winter')).toBe(-1)
  })

  it('同属性と対角は相性なし(0)', () => {
    const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter']
    for (const s of seasons) expect(matchup(s, s)).toBe(0)
    expect(matchup('spring', 'autumn')).toBe(0)
    expect(matchup('autumn', 'spring')).toBe(0)
    expect(matchup('summer', 'winter')).toBe(0)
  })

  it('全ペアで反対称: matchup(a,b) + matchup(b,a) === 0', () => {
    const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter']
    for (const a of seasons)
      for (const b of seasons) expect(matchup(a, b) + matchup(b, a)).toBe(0)
  })
})

describe('tributesNeeded', () => {
  it('レベル帯でリリース数が決まる（〜4:0 / 5-6:1 / 7-8:2）', () => {
    expect(tributesNeeded(1)).toBe(0)
    expect(tributesNeeded(4)).toBe(0)
    expect(tributesNeeded(5)).toBe(1)
    expect(tributesNeeded(6)).toBe(1)
    expect(tributesNeeded(7)).toBe(2)
    expect(tributesNeeded(8)).toBe(2)
  })
})

describe('buildLevelScale: 人気ランクによる★レベル', () => {
  const pop = Array.from({ length: 100 }, (_, i) => ({ key: `k${i}`, like: i }))
  const scale = buildLevelScale(pop)

  it('全カードに 1〜8 のレベルが振られる', () => {
    expect(scale.size).toBe(100)
    for (const lv of scale.values()) {
      expect(lv).toBeGreaterThanOrEqual(1)
      expect(lv).toBeLessThanOrEqual(8)
    }
  })

  it('スキ数が多いほどレベルが下がらない（単調）', () => {
    for (let i = 1; i < 100; i++) {
      expect(scale.get(`k${i}`)!).toBeGreaterThanOrEqual(scale.get(`k${i - 1}`)!)
    }
  })

  it('最下位は★1、最上位は★8 のピラミッドになる', () => {
    expect(scale.get('k0')).toBe(1)
    expect(scale.get('k99')).toBe(8)
    // ★8 は上位3%（frac > 0.97）だけ
    const lv8 = [...scale.values()].filter((v) => v === 8).length
    expect(lv8).toBe(3)
  })

  it('決定的（同じ母集団なら同じ結果）', () => {
    expect(buildLevelScale(pop)).toEqual(scale)
  })
})

describe('ensureUniqueNames', () => {
  it('重複名にだけ漢数字の連番を付ける', () => {
    const t = (name: string): MonsterTemplate => ({ ...mkMonster(), name })
    const list = [t('漆黒の外套'), t('漆黒の外套'), t('漆黒の外套'), t('白銀の織衣')]
    ensureUniqueNames(list)
    expect(list.map((m) => m.name)).toEqual([
      '漆黒の外套',
      '漆黒の外套 弐',
      '漆黒の外套 参',
      '白銀の織衣',
    ])
  })
})

describe('deriveMonster', () => {
  const items = [
    { category: 'coat', count: 9, color: 'black' },
    { category: 'pants', count: 4, color: 'navy' },
    { category: 'shoes', count: 4, color: 'navy' },
  ]

  it('季節・種族・レベル・ステータスを決定的に導出する', () => {
    const outfit = mkOutfit({ key: 'stable-key', date: '2025-06-15', like: 5 })
    const m = deriveMonster(outfit, items, { level: 5 })
    expect(m.kind).toBe('monster')
    expect(m.season).toBe('summer')
    expect(m.level).toBe(5)
    expect(m.race).toBe('戦衣族') // 主役は outer グループ（coat）
    expect(m.colorBucket).toBe('black') // 主役アイテムの色
    // ATK はレベル基準値 1900 + ジッタ(0〜400)、上限3000
    expect(m.atk).toBeGreaterThanOrEqual(1900)
    expect(m.atk).toBeLessThanOrEqual(2300)
    expect(m.atk % 50).toBe(0)
    // DEF は 300〜2800 の50刻み
    expect(m.def).toBeGreaterThanOrEqual(300)
    expect(m.def).toBeLessThanOrEqual(2800)
    expect(m.def % 50).toBe(0)
    expect(m.name.length).toBeGreaterThan(0)
    expect(m.img).toBe('https://example.com/a.png')
  })

  it('同じ key・入力なら名前もATKも同一（安定）', () => {
    const outfit = mkOutfit({ key: 'stable-key', date: '2025-06-15', like: 5 })
    const a = deriveMonster(outfit, items, { level: 5 })
    const b = deriveMonster(outfit, items, { level: 5 })
    expect(b.name).toBe(a.name)
    expect(b.atk).toBe(a.atk)
    expect(b.def).toBe(a.def)
  })

  it('ctx.level が無ければスキ数から簡易レベルを引く', () => {
    expect(deriveMonster(mkOutfit({ like: 1 }), items).level).toBe(1)
    expect(deriveMonster(mkOutfit({ like: 16 }), items).level).toBe(8)
  })

  it('レベルが高いほど ATK 基準値が高い', () => {
    const outfit = mkOutfit({ key: 'atk-key' })
    const low = deriveMonster(outfit, items, { level: 1 })
    const high = deriveMonster(outfit, items, { level: 8 })
    expect(high.atk).toBeGreaterThan(low.atk)
    expect(high.atk).toBeLessThanOrEqual(3000)
  })

  it('アイテムが空でも壊れない（accにフォールバック）', () => {
    const m = deriveMonster(mkOutfit({ images: [] }), [])
    expect(m.race).toBe('装具族')
    expect(m.img).toBe('')
  })
})

// ----------------------------------------------------------------------------
// デッキ構築・初期化
// ----------------------------------------------------------------------------
describe('buildAutoDeck / materializeDeck / createGame', () => {
  const pool: MonsterTemplate[] = []
  for (let lv = 1; lv <= 8; lv++) {
    for (let i = 0; i < 5; i++) pool.push(mkMonster({ level: lv }))
  }

  it('buildAutoDeck は常に MONSTER_COUNT 枚・重複なし（乱数の結果によらず）', () => {
    for (let trial = 0; trial < 5; trial++) {
      const deck = buildAutoDeck(pool)
      expect(deck).toHaveLength(MONSTER_COUNT)
      const keys = new Set(deck.map((m) => m.outfitKey))
      expect(keys.size).toBe(MONSTER_COUNT)
      const poolKeys = new Set(pool.map((m) => m.outfitKey))
      for (const k of keys) expect(poolKeys.has(k)).toBe(true)
    }
  })

  it('materializeDeck はモンスター32+魔法罠8=40枚で uid が全て一意', () => {
    const monsters = buildAutoDeck(pool)
    const deck = materializeDeck(monsters, 0)
    expect(deck).toHaveLength(DECK_SIZE)
    expect(deck.filter((c) => isMonster(c))).toHaveLength(MONSTER_COUNT)
    expect(deck.filter((c) => !isMonster(c))).toHaveLength(DECK_SIZE - MONSTER_COUNT)
    const uids = new Set(deck.map((c) => c.uid))
    expect(uids.size).toBe(DECK_SIZE)
    expect(deck.every((c) => c.uid.startsWith('p'))).toBe(true)
  })

  it('createGame: 初手5枚・残り35枚・LP8000・先攻はあなた', () => {
    const p = materializeDeck(buildAutoDeck(pool), 0)
    const e = materializeDeck(buildAutoDeck(pool), 1)
    const g = createGame(p, e)
    for (const side of g.sides) {
      expect(side.lp).toBe(START_LP)
      expect(side.hand).toHaveLength(START_HAND)
      expect(side.deck).toHaveLength(DECK_SIZE - START_HAND)
      expect(fieldCount(side)).toBe(0)
      expect(side.graveyard).toHaveLength(0)
    }
    expect(g.turn).toBe(0)
    expect(g.turnNo).toBe(1)
    expect(g.phase).toBe('main')
    expect(g.winner).toBeNull()
    expect(g.normalSummonUsed).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// applyAction: 召喚
// ----------------------------------------------------------------------------
describe('applyAction: summon', () => {
  it('下級モンスターの通常召喚: 手札→フィールド・召喚権消費', () => {
    const card = mkMonster({ level: 4 })
    const s0 = mkState()
    s0.sides[0].hand = [card]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [],
    })
    expect(s1.sides[0].hand).toHaveLength(0)
    expect(fieldCount(s1.sides[0])).toBe(1)
    const slot = s1.sides[0].field.find(Boolean)!
    expect(slot.card.uid).toBe(card.uid)
    expect(slot.orientation).toBe('attack')
    expect(slot.faceDown).toBe(false)
    expect(slot.summonedThisTurn).toBe(true)
    expect(slot.hasAttacked).toBe(false)
    expect(slot.atkBuff).toBe(0)
    expect(slot.season).toBe(card.season)
    expect(s1.normalSummonUsed).toBe(true)
  })

  it('入力の state を破壊しない（イミュータブル）', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster()]
    applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [],
    })
    expect(s0.sides[0].hand).toHaveLength(1)
    expect(fieldCount(s0.sides[0])).toBe(0)
    expect(s0.normalSummonUsed).toBe(false)
  })

  it('裏側守備は defense のときだけ有効（attack 指定なら faceDown は無視）', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster(), mkMonster()]
    const def = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'defense', faceDown: true, tributes: [],
    })
    expect(def.sides[0].field.find(Boolean)!.faceDown).toBe(true)
    const atk = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 1, orientation: 'attack', faceDown: true, tributes: [],
    })
    expect(atk.sides[0].field.find(Boolean)!.faceDown).toBe(false)
  })

  it('アドバンス召喚: リリースが墓地へ行き、上級が場に出る', () => {
    const big = mkMonster({ level: 7 })
    const t1 = mkMonster()
    const t2 = mkMonster()
    const s0 = mkState()
    s0.sides[0].hand = [big]
    s0.sides[0].field = [mkSlot(t1), mkSlot(t2), null]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [0, 1],
    })
    expect(fieldCount(s1.sides[0])).toBe(1)
    expect(s1.sides[0].field.find(Boolean)!.card.uid).toBe(big.uid)
    expect(s1.sides[0].graveyard.map((c) => c.uid).sort()).toEqual([t1.uid, t2.uid].sort())
  })

  it('リリース不足の上級召喚は拒否（元の state をそのまま返す）', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster({ level: 7 })]
    s0.sides[0].field = [mkSlot(mkMonster()), null, null]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [0],
    })
    expect(s1).toBe(s0)
  })

  it('重複したリリース指定は1体分として扱う（水増し不可）', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster({ level: 7 })]
    s0.sides[0].field = [mkSlot(mkMonster()), null, null]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [0, 0],
    })
    expect(s1).toBe(s0)
  })

  it('フィールドが満杯なら下級は召喚できない', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster({ level: 4 })]
    s0.sides[0].field = [mkSlot(mkMonster()), mkSlot(mkMonster()), mkSlot(mkMonster())]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [],
    })
    expect(s1).toBe(s0)
  })

  it('魔法カードを summon しようとしても拒否される', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('closet')]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [],
    })
    expect(s1).toBe(s0)
  })

  it('召喚権を使用済みなら summon は拒否される', () => {
    const s0 = mkState({ normalSummonUsed: true })
    s0.sides[0].hand = [mkMonster()]
    const s1 = applyAction(s0, {
      type: 'summon', side: 0, handIndex: 0, orientation: 'attack', faceDown: false, tributes: [],
    })
    expect(s1).toBe(s0)
  })
})

// ----------------------------------------------------------------------------
// applyAction: 魔法・罠
// ----------------------------------------------------------------------------
describe('applyAction: spell / setTrap', () => {
  it('クローゼット整理: 2枚ドローして手札は差し引き+1、カードは墓地へ', () => {
    const spell = mkSpellTrap('closet')
    const s0 = mkState()
    s0.sides[0].hand = [spell]
    s0.sides[0].deck = [mkMonster(), mkMonster(), mkMonster()]
    const s1 = applyAction(s0, { type: 'spell', side: 0, handIndex: 0 })
    expect(s1.sides[0].hand).toHaveLength(2)
    expect(s1.sides[0].deck).toHaveLength(1)
    expect(s1.sides[0].graveyard.map((c) => c.uid)).toContain(spell.uid)
  })

  it('デッキが尽きるとデッキアウトで相手の勝ち', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('closet')]
    s0.sides[0].deck = [mkMonster()] // 2枚引けない
    const s1 = applyAction(s0, { type: 'spell', side: 0, handIndex: 0 })
    expect(s1.winner).toBe(1)
  })

  it('ご褒美コーデ: 対象の atkBuff が +800（永続）', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('reward')]
    s0.sides[0].field = [mkSlot(mkMonster({ atk: 1000 })), null, null]
    const s1 = applyAction(s0, { type: 'spell', side: 0, handIndex: 0, targetZone: 0 })
    expect(s1.sides[0].field[0]!.atkBuff).toBe(800)
    expect(s1.sides[0].hand).toHaveLength(0)
  })

  it('ご褒美コーデ: 対象がいなければ拒否', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('reward')]
    expect(applyAction(s0, { type: 'spell', side: 0, handIndex: 0, targetZone: 0 })).toBe(s0)
    expect(applyAction(s0, { type: 'spell', side: 0, handIndex: 0 })).toBe(s0)
  })

  it('重ね着: 実効属性だけが変わり、カード本体の season は変わらない', () => {
    const card = mkMonster({ season: 'winter' })
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('layering')]
    s0.sides[0].field = [mkSlot(card), null, null]
    const s1 = applyAction(s0, {
      type: 'spell', side: 0, handIndex: 0, targetZone: 0, season: 'summer',
    })
    expect(s1.sides[0].field[0]!.season).toBe('summer')
    expect(s1.sides[0].field[0]!.card.season).toBe('winter')
  })

  it('罠のセット: バックゾーンに置かれ手札から消える', () => {
    const trap = mkSpellTrap('downpour')
    const s0 = mkState()
    s0.sides[0].hand = [trap]
    const s1 = applyAction(s0, { type: 'setTrap', side: 0, handIndex: 0 })
    expect(s1.sides[0].hand).toHaveLength(0)
    expect(s1.sides[0].back.filter(Boolean)).toHaveLength(1)
    expect(s1.sides[0].back.find(Boolean)!.card.uid).toBe(trap.uid)
  })

  it('バックゾーンが満杯なら罠はセットできない', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkSpellTrap('downpour')]
    s0.sides[0].back = [
      { card: mkSpellTrap('mismatch') },
      { card: mkSpellTrap('refund') },
      { card: mkSpellTrap('downpour') },
    ]
    expect(applyAction(s0, { type: 'setTrap', side: 0, handIndex: 0 })).toBe(s0)
  })

  it('モンスターは setTrap できない・罠は spell として発動できない', () => {
    const s0 = mkState()
    s0.sides[0].hand = [mkMonster(), mkSpellTrap('downpour')]
    expect(applyAction(s0, { type: 'setTrap', side: 0, handIndex: 0 })).toBe(s0)
    expect(applyAction(s0, { type: 'spell', side: 0, handIndex: 1 })).toBe(s0)
  })
})

// ----------------------------------------------------------------------------
// applyAction: バトル
// ----------------------------------------------------------------------------
describe('applyAction: battle', () => {
  /** 攻撃側(0)にモンスター1体・battleフェイズの状態を作る */
  const battleState = (attacker: FieldSlot, defenderSlots: (FieldSlot | null)[] = [null, null, null]) => {
    const s = mkState({ phase: 'battle' })
    s.sides[0].field = [attacker, null, null]
    s.sides[1].field = defenderSlots
    return s
  }

  it('先攻1ターン目はバトルフェイズに入れない', () => {
    const s0 = mkState({ turnNo: 1 })
    expect(applyAction(s0, { type: 'toBattle', side: 0 })).toBe(s0)
    const s1 = applyAction(mkState({ turnNo: 2 }), { type: 'toBattle', side: 0 })
    expect(s1.phase).toBe('battle')
  })

  it('mainフェイズ中の攻撃は拒否', () => {
    const s0 = mkState({ phase: 'main' })
    s0.sides[0].field = [mkSlot(mkMonster()), null, null]
    expect(applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })).toBe(s0)
  })

  it('攻撃表示同士: ATKが高い方が勝ち、差分がLPダメージ', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 2000 })),
      [mkSlot(mkMonster({ atk: 1500 })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[1].field[0]).toBeNull()
    expect(s1.sides[1].graveyard).toHaveLength(1)
    expect(s1.sides[1].lp).toBe(START_LP - 500)
    expect(s1.sides[0].lp).toBe(START_LP)
    expect(s1.sides[0].field[0]!.hasAttacked).toBe(true)
    expect(s1.flash!.result).toBe('destroy-target')
    expect(s1.flash!.damage).toBe(500)
    expect(s1.flash!.damageTo).toBe(1)
  })

  it('攻撃表示同士: ATKが低いと自分が破壊されて自分がダメージ', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1000 })),
      [mkSlot(mkMonster({ atk: 1600 })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[0].field[0]).toBeNull()
    expect(s1.sides[0].graveyard).toHaveLength(1)
    expect(s1.sides[0].lp).toBe(START_LP - 600)
    expect(s1.sides[1].lp).toBe(START_LP)
    expect(s1.flash!.result).toBe('destroy-attacker')
  })

  it('攻撃表示同士: 同値は相打ち・ダメージなし', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1500 })),
      [mkSlot(mkMonster({ atk: 1500 })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[0].field[0]).toBeNull()
    expect(s1.sides[1].field[0]).toBeNull()
    expect(s1.sides[0].lp).toBe(START_LP)
    expect(s1.sides[1].lp).toBe(START_LP)
    expect(s1.flash!.result).toBe('both')
  })

  it('守備表示への攻撃: DEFを超えれば破壊・LPダメージなし', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 2000 })),
      [mkSlot(mkMonster({ def: 1500 }), { orientation: 'defense' }), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[1].field[0]).toBeNull()
    expect(s1.sides[1].lp).toBe(START_LP)
    expect(s1.sides[0].lp).toBe(START_LP)
    expect(s1.flash!.result).toBe('destroy-target')
    expect(s1.flash!.damage).toBe(0)
  })

  it('守備表示への攻撃: DEF未満なら反射ダメージを自分が受ける（守備側は残る）', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1000 })),
      [mkSlot(mkMonster({ def: 1800 }), { orientation: 'defense' }), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[0].lp).toBe(START_LP - 800)
    expect(s1.sides[0].field[0]).not.toBeNull() // 攻撃側は破壊されない
    expect(s1.sides[0].field[0]!.hasAttacked).toBe(true)
    expect(s1.sides[1].field[0]).not.toBeNull()
    expect(s1.flash!.result).toBe('recoil')
  })

  it('裏側守備への攻撃でリバース（表向きになる）', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1000 })),
      [mkSlot(mkMonster({ def: 1800 }), { orientation: 'defense', faceDown: true }), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[1].field[0]!.faceDown).toBe(false)
  })

  it('属性相性: 有利なら+500されて弱いモンスターでも勝てる', () => {
    // spring は summer に有利: 1000 + 500 = 1500 > 1300
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1000, season: 'spring' })),
      [mkSlot(mkMonster({ atk: 1300, season: 'summer' })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.flash!.matchup).toBe(1)
    expect(s1.flash!.atkValue).toBe(1000 + ATTR_BONUS)
    expect(s1.flash!.result).toBe('destroy-target')
    expect(s1.sides[1].lp).toBe(START_LP - 200)
  })

  it('属性相性: 不利なら-500されて強いモンスターでも負ける', () => {
    // summer は spring に不利: 1300 - 500 = 800 < 1000
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1300, season: 'summer' })),
      [mkSlot(mkMonster({ atk: 1000, season: 'spring' })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.flash!.matchup).toBe(-1)
    expect(s1.flash!.result).toBe('destroy-attacker')
    expect(s1.sides[0].lp).toBe(START_LP - 200)
  })

  it('重ね着後の実効属性（slot.season）で相性が計算される', () => {
    // カード本体は winter だが slot.season を spring に変更済み → summer に有利
    const attacker = mkSlot(mkMonster({ atk: 1000, season: 'winter' }), { season: 'spring' })
    const s0 = battleState(attacker, [mkSlot(mkMonster({ atk: 1300, season: 'summer' })), null, null])
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.flash!.matchup).toBe(1)
    expect(s1.flash!.result).toBe('destroy-target')
  })

  it('atkBuff は戦闘値に加算される', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1000 }), { atkBuff: 800 }),
      [mkSlot(mkMonster({ atk: 1500 })), null, null],
    )
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.flash!.atkValue).toBe(1800)
    expect(s1.flash!.result).toBe('destroy-target')
  })

  it('ダイレクトアタック: 相手フィールドが空ならATK分のダメージ', () => {
    const s0 = battleState(mkSlot(mkMonster({ atk: 1700 })))
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })
    expect(s1.sides[1].lp).toBe(START_LP - 1700)
    expect(s1.flash!.result).toBe('direct')
    expect(s1.sides[0].field[0]!.hasAttacked).toBe(true)
  })

  it('相手モンスターがいるとダイレクトアタックは不可', () => {
    const s0 = battleState(
      mkSlot(mkMonster({ atk: 1700 })),
      [mkSlot(mkMonster()), null, null],
    )
    expect(applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })).toBe(s0)
  })

  it('攻撃済み・守備表示・裏側のモンスターは攻撃できない', () => {
    const attacked = battleState(mkSlot(mkMonster(), { hasAttacked: true }))
    expect(applyAction(attacked, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })).toBe(attacked)
    const defense = battleState(mkSlot(mkMonster(), { orientation: 'defense' }))
    expect(applyAction(defense, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })).toBe(defense)
    const faceDown = battleState(mkSlot(mkMonster(), { orientation: 'defense', faceDown: true }))
    expect(applyAction(faceDown, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })).toBe(faceDown)
  })

  it('LPが0以下になったら勝敗が決まり、以後のアクションは無視される', () => {
    const s0 = battleState(mkSlot(mkMonster({ atk: 1700 })))
    s0.sides[1].lp = 1000
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: null })
    expect(s1.sides[1].lp).toBe(-700)
    expect(s1.winner).toBe(0)
    // 勝敗決定後は endTurn も何も起こさない
    const s2 = applyAction(s1, { type: 'endTurn', side: 0 })
    expect(s2.turnNo).toBe(s1.turnNo)
    expect(s2.turn).toBe(s1.turn)
  })
})

describe('applyAction: 罠の発動（攻撃宣言時）', () => {
  const trapState = (trapId: SpellTrapId) => {
    const s = mkState({ phase: 'battle' })
    s.sides[0].field = [mkSlot(mkMonster({ atk: 2000 })), null, null]
    s.sides[1].field = [mkSlot(mkMonster({ atk: 1500 })), null, null]
    s.sides[1].back = [{ card: mkSpellTrap(trapId) }, null, null]
    return s
  }

  it('ゲリラ豪雨: 攻撃モンスターを破壊して攻撃無効・LP変動なし', () => {
    const s1 = applyAction(trapState('downpour'), { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[0].field[0]).toBeNull()
    expect(s1.sides[0].graveyard).toHaveLength(1)
    expect(s1.sides[1].field[0]).not.toBeNull() // 対象は無傷
    expect(s1.sides[0].lp).toBe(START_LP)
    expect(s1.sides[1].lp).toBe(START_LP)
    expect(s1.flash!.result).toBe('negate')
    // 罠は使い捨て（バックから墓地へ）
    expect(s1.sides[1].back.filter(Boolean)).toHaveLength(0)
    expect(s1.sides[1].graveyard.some((c) => !isMonster(c) && c.id === 'downpour')).toBe(true)
  })

  it('タグ付き返品: 攻撃モンスターが手札に戻り攻撃無効', () => {
    const s0 = trapState('refund')
    const attackerUid = s0.sides[0].field[0]!.card.uid
    const s1 = applyAction(s0, { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.sides[0].field[0]).toBeNull()
    expect(s1.sides[0].hand.map((c) => c.uid)).toContain(attackerUid)
    expect(s1.sides[0].graveyard).toHaveLength(0)
    expect(s1.flash!.result).toBe('bounce')
    expect(s1.sides[1].lp).toBe(START_LP)
  })

  it('サイズ違い: この戦闘だけATK半減（2000→1000 < 1500 で返り討ち）', () => {
    const s1 = applyAction(trapState('mismatch'), { type: 'attack', side: 0, attackerZone: 0, targetZone: 0 })
    expect(s1.flash!.atkValue).toBe(1000)
    expect(s1.flash!.trap).toBe('サイズ違い')
    expect(s1.flash!.result).toBe('destroy-attacker')
    expect(s1.sides[0].lp).toBe(START_LP - 500)
    // 恒久的な弱体化ではない（カード本体のATKは不変）
    expect(s1.sides[0].graveyard.find((c) => isMonster(c))!.atk).toBe(2000)
  })
})

// ----------------------------------------------------------------------------
// applyAction: ターン進行
// ----------------------------------------------------------------------------
describe('applyAction: endTurn', () => {
  it('ターンが交代し、次プレイヤーが1枚ドロー・フラグがリセットされる', () => {
    const s0 = mkState({ turn: 0, turnNo: 2, phase: 'battle', normalSummonUsed: true })
    s0.sides[1].deck = [mkMonster(), mkMonster()]
    s0.sides[1].field = [mkSlot(mkMonster(), { hasAttacked: true, summonedThisTurn: true }), null, null]
    const s1 = applyAction(s0, { type: 'endTurn', side: 0 })
    expect(s1.turn).toBe(1)
    expect(s1.turnNo).toBe(3)
    expect(s1.phase).toBe('main')
    expect(s1.normalSummonUsed).toBe(false)
    expect(s1.sides[1].hand).toHaveLength(1)
    expect(s1.sides[1].deck).toHaveLength(1)
    expect(s1.sides[1].field[0]!.hasAttacked).toBe(false)
    expect(s1.sides[1].field[0]!.summonedThisTurn).toBe(false)
  })

  it('ターン開始ドローでデッキが空ならデッキアウト負け', () => {
    const s0 = mkState({ turn: 0, turnNo: 2 })
    s0.sides[1].deck = []
    const s1 = applyAction(s0, { type: 'endTurn', side: 0 })
    expect(s1.winner).toBe(0) // ドローできない side 1 の負け
  })
})

// ----------------------------------------------------------------------------
// canSummon / CPU AI
// ----------------------------------------------------------------------------
describe('canSummon', () => {
  it('召喚権を使用済みなら false', () => {
    const s = mkState({ normalSummonUsed: true })
    s.sides[0].hand = [mkMonster()]
    expect(canSummon(s, 0, 0)).toBe(false)
  })

  it('下級は空きゾーンがあれば true・満杯なら false', () => {
    const s = mkState()
    s.sides[0].hand = [mkMonster({ level: 4 })]
    expect(canSummon(s, 0, 0)).toBe(true)
    s.sides[0].field = [mkSlot(mkMonster()), mkSlot(mkMonster()), mkSlot(mkMonster())]
    expect(canSummon(s, 0, 0)).toBe(false)
  })

  it('上級はリリース要員が足りなければ false', () => {
    const s = mkState()
    s.sides[0].hand = [mkMonster({ level: 5 }), mkMonster({ level: 7 })]
    expect(canSummon(s, 0, 0)).toBe(false) // lv5 は1体必要
    expect(canSummon(s, 0, 1)).toBe(false) // lv7 は2体必要
    s.sides[0].field = [mkSlot(mkMonster()), null, null]
    expect(canSummon(s, 0, 0)).toBe(true)
    expect(canSummon(s, 0, 1)).toBe(false)
  })

  it('魔法・罠や存在しない手札インデックスは false', () => {
    const s = mkState()
    s.sides[0].hand = [mkSpellTrap('closet')]
    expect(canSummon(s, 0, 0)).toBe(false)
    expect(canSummon(s, 0, 5)).toBe(false)
  })
})

describe('cpuNextAction（貪欲AI）', () => {
  it('勝敗決定後は null', () => {
    expect(cpuNextAction(mkState({ winner: 0 }), 1)).toBeNull()
  })

  it('1ターン目・打つ手なしなら endTurn（バトルには入らない）', () => {
    const a = cpuNextAction(mkState({ turnNo: 1, turn: 1 }), 1)
    expect(a).toEqual({ type: 'endTurn', side: 1 })
  })

  it('2ターン目以降・メインで打つ手なしなら toBattle', () => {
    const a = cpuNextAction(mkState({ turn: 1 }), 1)
    expect(a).toEqual({ type: 'toBattle', side: 1 })
  })

  it('手札にモンスターがあれば召喚する（相手の場が空なら攻撃表示）', () => {
    const s = mkState({ turn: 1 })
    s.sides[1].hand = [mkMonster({ atk: 1200 })]
    const a = cpuNextAction(s, 1)
    expect(a).toMatchObject({ type: 'summon', side: 1, handIndex: 0, orientation: 'attack' })
  })

  it('相手最強より弱いモンスターは裏側守備でセットする', () => {
    const s = mkState({ turn: 1 })
    s.sides[1].hand = [mkMonster({ atk: 800 })]
    s.sides[0].field = [mkSlot(mkMonster({ atk: 2500 })), null, null]
    const a = cpuNextAction(s, 1)
    expect(a).toMatchObject({ type: 'summon', orientation: 'defense', faceDown: true })
  })

  it('デッキに余裕があればクローゼット整理を最優先で使う', () => {
    const s = mkState({ turn: 1 })
    s.sides[1].hand = [mkMonster(), mkSpellTrap('closet')]
    s.sides[1].deck = [mkMonster(), mkMonster(), mkMonster(), mkMonster()]
    const a = cpuNextAction(s, 1)
    expect(a).toMatchObject({ type: 'spell', side: 1, handIndex: 1 })
  })

  it('バトル: 相手の場が空ならダイレクトアタック', () => {
    const s = mkState({ turn: 1, phase: 'battle' })
    s.sides[1].field = [mkSlot(mkMonster({ atk: 1500 })), null, null]
    const a = cpuNextAction(s, 1)
    expect(a).toEqual({ type: 'attack', side: 1, attackerZone: 0, targetZone: null })
  })

  it('バトル: 勝てる相手がいれば攻撃、損しかない相手には攻撃しない', () => {
    const s = mkState({ turn: 1, phase: 'battle' })
    s.sides[1].field = [mkSlot(mkMonster({ atk: 1500 })), null, null]
    s.sides[0].field = [mkSlot(mkMonster({ atk: 1000 })), null, null]
    expect(cpuNextAction(s, 1)).toEqual({ type: 'attack', side: 1, attackerZone: 0, targetZone: 0 })
    // 相手が強すぎる場合は攻撃せずターン終了
    s.sides[0].field = [mkSlot(mkMonster({ atk: 2800 })), null, null]
    expect(cpuNextAction(s, 1)).toEqual({ type: 'endTurn', side: 1 })
  })

  it('バトル: 攻撃可能なモンスターがいなければ endTurn', () => {
    const s = mkState({ turn: 1, phase: 'battle' })
    s.sides[1].field = [mkSlot(mkMonster(), { hasAttacked: true }), null, null]
    expect(cpuNextAction(s, 1)).toEqual({ type: 'endTurn', side: 1 })
  })

  it('cpuNextAction が返す手は必ず適用可能（stateが前進するか合法なターン終了）', () => {
    // 乱数を含むデッキでも「返した手が拒否されない」ことを数手分検証する
    const pool: MonsterTemplate[] = []
    for (let lv = 1; lv <= 8; lv++) for (let i = 0; i < 5; i++) pool.push(mkMonster({ level: lv }))
    let s = createGame(materializeDeck(buildAutoDeck(pool), 0), materializeDeck(buildAutoDeck(pool), 1))
    // あなたのターンを即終了して CP のターンへ
    s = applyAction(s, { type: 'endTurn', side: 0 })
    for (let i = 0; i < 30 && s.winner === null; i++) {
      const a = cpuNextAction(s, 1)
      expect(a).not.toBeNull()
      const next = applyAction(s, a!)
      // 拒否された手（同一参照が返る）を CPU が出さないこと
      expect(next).not.toBe(s)
      s = next
      if (a!.type === 'endTurn') break
    }
    // 不変条件: LPは初期値以下・手札とフィールドの整合
    for (const p of s.sides) {
      expect(p.lp).toBeLessThanOrEqual(START_LP)
      expect(p.field.length).toBe(MONSTER_ZONES)
      expect(p.hand.length + p.deck.length + p.graveyard.length + fieldCount(p) + p.back.filter(Boolean).length,
      ).toBe(DECK_SIZE)
    }
  })
})

// ----------------------------------------------------------------------------
// 型ガード
// ----------------------------------------------------------------------------
describe('isMonster', () => {
  it('モンスターと魔法罠を判別する', () => {
    const m: Card = mkMonster()
    const t: Card = mkSpellTrap('downpour')
    expect(isMonster(m)).toBe(true)
    expect(isMonster(t)).toBe(false)
  })
})
