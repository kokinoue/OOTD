// 出勤服デュエル — 遊戯王ライクなカードバトルのエンジン＋データ変換（Reactなし・純粋関数）
//
// ・1出勤服 = 1モンスターカード。ATK=スキ数、DEF=着用回数、属性=季節、種族=主カテゴリ、レベル=ATKの格。
// ・カード名は季節・色・カテゴリ・スキ数から中二病ジェネレータで自動生成（outfit.key で安定）。
// ・ルールはモンスター戦闘の核（通常召喚／リリース＝アドバンス召喚／攻撃・守備表示／戦闘ダメージ）＋
//   B案の属性相性（季節の四すくみ）＋シンプルな魔法・罠を少々。
// ・状態遷移はすべて applyAction(state, action) に集約（structuredClone でイミュータブル）。CPUは貪欲AI。

import type { Outfit } from '../types'

// ----------------------------------------------------------------------------
// 定数
// ----------------------------------------------------------------------------
export const START_LP = 8000
export const START_HAND = 5
export const DECK_SIZE = 40
export const MONSTER_ZONES = 3
export const BACK_ZONES = 3
export const ATTR_BONUS = 500 // 属性相性の有利／不利でATKに±

// ----------------------------------------------------------------------------
// 型
// ----------------------------------------------------------------------------
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export type MonsterTemplate = {
  kind: 'monster'
  outfitKey: string
  name: string
  img: string // 生URL（描画時に thumb を掛ける）
  title: string // 元コーデのタイトル
  date: string
  likes: number
  atk: number
  def: number
  level: number // 1-8
  season: Season
  race: string // 種族表示（例: 戦衣族）
  colorBucket?: string
}

export type SpellTrapId =
  | 'reward'
  | 'closet'
  | 'layering'
  | 'downpour'
  | 'mismatch'
  | 'refund'

export type SpellTrapDef = {
  id: SpellTrapId
  kind: 'spell' | 'trap'
  name: string
  text: string
}

export const SPELL_TRAP_DEFS: Record<SpellTrapId, SpellTrapDef> = {
  reward: {
    id: 'reward',
    kind: 'spell',
    name: 'ご褒美コーデ',
    text: '自分フィールドのモンスター1体の攻撃力を800上げる（永続）。',
  },
  closet: {
    id: 'closet',
    kind: 'spell',
    name: 'クローゼット整理',
    text: 'デッキから2枚ドローする。',
  },
  layering: {
    id: 'layering',
    kind: 'spell',
    name: '重ね着',
    text: '自分フィールドのモンスター1体の属性を、選んだ季節に変更する。',
  },
  downpour: {
    id: 'downpour',
    kind: 'trap',
    name: 'ゲリラ豪雨',
    text: '相手の攻撃モンスター1体を破壊する。その攻撃は無効になる。',
  },
  mismatch: {
    id: 'mismatch',
    kind: 'trap',
    name: 'サイズ違い',
    text: '攻撃モンスターの攻撃力を、この戦闘の間だけ半分にする。',
  },
  refund: {
    id: 'refund',
    kind: 'trap',
    name: 'タグ付き返品',
    text: '攻撃モンスターを持ち主の手札に戻す。その攻撃は無効になる。',
  },
}

// デッキ内訳（魔法・罠 8枚）
const SPELL_TRAP_DECKLIST: SpellTrapId[] = [
  'closet',
  'closet',
  'reward',
  'reward',
  'layering',
  'downpour',
  'mismatch',
  'refund',
]
export const MONSTER_COUNT = DECK_SIZE - SPELL_TRAP_DECKLIST.length // 32

export type Card =
  | (MonsterTemplate & { uid: string })
  | (SpellTrapDef & { uid: string })

export type MonsterCard = MonsterTemplate & { uid: string }
export type SpellTrapCard = SpellTrapDef & { uid: string }

export const isMonster = (c: Card): c is MonsterCard => c.kind === 'monster'

export type Orientation = 'attack' | 'defense'

export type FieldSlot = {
  card: MonsterCard
  orientation: Orientation
  faceDown: boolean // 裏側守備でセット中
  atkBuff: number
  season: Season // 重ね着で変化しうるので実効値を持つ
  summonedThisTurn: boolean
  hasAttacked: boolean
}

export type BackSlot = {
  card: SpellTrapCard
}

export type Side = 0 | 1 // 0 = あなた, 1 = CP

export type PlayerState = {
  name: string
  lp: number
  deck: Card[] // 先頭がドロー位置
  hand: Card[]
  field: (FieldSlot | null)[]
  back: (BackSlot | null)[]
  graveyard: Card[]
}

export type Phase = 'main' | 'battle'

export type LogLine = { side: Side | null; text: string }

export type BattleFlash = {
  attacker: string // カード名
  target: string | null // null = ダイレクト
  atkValue: number
  defValue: number
  matchup: -1 | 0 | 1
  trap?: string
  result: 'destroy-target' | 'destroy-attacker' | 'both' | 'recoil' | 'bounce' | 'negate' | 'direct' | 'none'
  damageTo: Side | null
  damage: number
  // 演出用: どのゾーンからどのゾーンへ攻撃したか（UIアニメーションが参照する）
  attackerSide: Side
  attackerZone: number
  targetZone: number | null
}

export type GameState = {
  sides: [PlayerState, PlayerState]
  turn: Side
  phase: Phase
  turnNo: number
  normalSummonUsed: boolean
  winner: Side | null
  log: LogLine[]
  flash: BattleFlash | null
}

// ----------------------------------------------------------------------------
// 決定的ハッシュ（カード名を outfit.key で安定させる）
// ----------------------------------------------------------------------------
function hash(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
const pick = <T>(arr: T[], h: number): T => arr[h % arr.length]

// ----------------------------------------------------------------------------
// 出勤服 → モンスターカードの導出
// ----------------------------------------------------------------------------
const round50 = (n: number) => Math.round(n / 50) * 50

export function seasonOf(date: string): Season {
  const m = Number(date.slice(5, 7))
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 11) return 'autumn'
  return 'winter'
}

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
}
export const SEASON_COLOR: Record<Season, string> = {
  spring: '#5a9e5a',
  summer: '#2f93c8',
  autumn: '#cf7b3a',
  winter: '#5b6b9a',
}
// 季節は巡る: 春→夏→秋→冬→春 の向きに「強い」
const STRONG_AGAINST: Record<Season, Season> = {
  spring: 'summer',
  summer: 'autumn',
  autumn: 'winter',
  winter: 'spring',
}
export function matchup(attacker: Season, defender: Season): -1 | 0 | 1 {
  if (STRONG_AGAINST[attacker] === defender) return 1
  if (STRONG_AGAINST[defender] === attacker) return -1
  return 0
}

// カテゴリ → 大グループ（主役判定と種族表示に使う）
type Group = 'outer' | 'tops' | 'bottom' | 'shoes' | 'acc'
const GROUP_OF: Record<string, Group> = {}
const reg = (g: Group, cats: string[]) => cats.forEach((c) => (GROUP_OF[c] = g))
reg('outer', ['jacket', 'coat', 'blouson', 'outer', 'down vest', 'cardigan', 'setup', 'suit', 'vest', 'smock', 'biaude'])
reg('tops', ['knit', 'sweat', 'hoodie', 't-shirt', 'shirt', 'tops', 'inner', 'tanktop'])
reg('bottom', ['pants', 'shorts', 'jumpsuit', 'all in one'])
reg('shoes', ['shoes', 'boots'])
reg('acc', ['bag', 'cap', 'hat', 'beanie', 'knit cap', 'glasses', 'scarf', 'stole', 'snood', 'gloves', 'tie', 'knit tie'])
const groupOf = (cat: string): Group => GROUP_OF[cat] ?? 'acc'
const GROUP_PRIORITY: Group[] = ['outer', 'bottom', 'tops', 'shoes', 'acc']
const RACE_LABEL: Record<Group, string> = {
  outer: '戦衣族',
  tops: '織衣族',
  bottom: '脚装族',
  shoes: '踏破族',
  acc: '装具族',
}

export function tributesNeeded(level: number): number {
  if (level >= 7) return 2
  if (level >= 5) return 1
  return 0
}

// ---- レアリティ（★レベル）は「スキ数の人気ランク」で決める ----
// note のスキ数は実測で 1〜31（中央値4）に収まり、絶対値だと ★6 以上が出ない。
// そこで母集団内の順位（パーセンタイル）で格付けし、★1〜★8 のピラミッドを作る。
// 同スキ数はキーのハッシュで決定的に散らし、どの帯も必ず埋まるようにする。
const LEVEL_BANDS: { level: number; top: number }[] = [
  { level: 1, top: 0.12 },
  { level: 2, top: 0.30 },
  { level: 3, top: 0.52 },
  { level: 4, top: 0.71 },
  { level: 5, top: 0.83 },
  { level: 6, top: 0.92 },
  { level: 7, top: 0.97 },
  { level: 8, top: 1.0 },
]

/** 母集団（key+スキ数）からカードごとの★レベル(1-8)を決める決定的マップを作る */
export function buildLevelScale(pop: { key: string; like: number }[]): Map<string, number> {
  const sorted = [...pop].sort((a, b) => a.like - b.like || hash(a.key) - hash(b.key))
  const n = Math.max(1, sorted.length)
  const map = new Map<string, number>()
  sorted.forEach((p, i) => {
    const frac = (i + 0.5) / n
    const band = LEVEL_BANDS.find((b) => frac <= b.top) ?? LEVEL_BANDS[LEVEL_BANDS.length - 1]
    map.set(p.key, band.level)
  })
  return map
}

// レベル → ATK の基準値。キー由来のジッタを足して同レベルでも少し散らす。
const ATK_BASE: Record<number, number> = { 1: 300, 2: 700, 3: 1100, 4: 1500, 5: 1900, 6: 2200, 7: 2500, 8: 2800 }
function atkForLevel(level: number, key: string): number {
  const base = ATK_BASE[level] ?? 1100
  const jitter = (hash(key + 'atk') % 9) * 50 // 0〜400
  return Math.min(3000, base + jitter)
}
// スキ数だけからの簡易レベル（母集団が無いときのフォールバック）
function levelFromLike(like: number): number {
  if (like >= 16) return 8
  if (like >= 11) return 7
  if (like >= 8) return 6
  if (like >= 6) return 5
  if (like >= 4) return 4
  if (like >= 3) return 3
  if (like >= 2) return 2
  return 1
}

// ---- カード名ジェネレータ ----
// 画像の特徴（季節・色・主役カテゴリ・帽子・髪色）を素材に中二病ネームを組む。
// outfit.key で安定。素材プールを厚くし、最後に ensureUniqueNames で重複を散らす。
const SEASON_WORDS: Record<Season, string[]> = {
  spring: ['芽吹', '桜花', '萌黄', '春陽', '若草', '霞', '花風'],
  summer: ['灼熱', '碧波', '陽炎', '常夏', '深緑', '驟雨', '南風'],
  autumn: ['黄昏', '紅葉', '錦秋', '枯野', '実りの', '月夜', '落葉'],
  winter: ['氷結', '凍て', '白雪', '極寒', '霜枯れ', '吹雪', '寒月'],
}
const COLOR_WORDS: Record<string, string[]> = {
  white: ['純白', '白銀', '雪白'],
  beige: ['砂漠', '琥珀', '亜麻'],
  gray: ['灰銀', '霧幻', '鈍色'],
  black: ['漆黒', '闇夜', '黒曜', '烏羽'],
  brown: ['土塊', '黄土', '鳶色'],
  navy: ['紺碧', '深淵', '濃紺'],
  blue: ['蒼天', '碧海', '群青'],
  green: ['翠緑', '常磐', '若苗'],
  yellow: ['金色', '向日', '山吹'],
  orange: ['夕焼', '焔', '橙'],
  red: ['緋色', '紅蓮', '朱'],
  pink: ['桜色', '薄紅', '撫子'],
  purple: ['紫紺', '菫', '藤'],
}
// 主役アイテムの「具体カテゴリ」を核名に反映（無ければグループ既定にフォールバック）
const CATEGORY_NOUN: Record<string, string[]> = {
  coat: ['外套', '羅紗', '長衣'],
  jacket: ['戦衣', '陣羽織', '上衣'],
  blouson: ['飛行衣', '風纏'],
  outer: ['鎧纏', '重衣'],
  'down vest': ['羽毛胴', '綿胴'],
  cardigan: ['編羽織', '柔衣'],
  setup: ['正装', '揃衣'],
  suit: ['礼装', '甲冑'],
  vest: ['胴衣', '胸当'],
  smock: ['作務衣', '前掛'],
  biaude: ['異邦衣'],
  knit: ['編衣', '毛織', '綟り'],
  sweat: ['綿鎧', '汗衣'],
  hoodie: ['頭巾衣', '兜衣'],
  't-shirt': ['布衣', '単衣'],
  shirt: ['織衣', '襟衣'],
  tops: ['上衣'],
  inner: ['肌着', '内衣'],
  tanktop: ['袖無'],
  pants: ['脚甲', '袴', '疾風脚'],
  shorts: ['短袴', '軽脚'],
  jumpsuit: ['全身衣', '一張羅'],
  'all in one': ['一体衣'],
  shoes: ['踏破者', '韋足', '軍靴'],
  boots: ['鉄長靴', '長靴聖'],
  bag: ['宝袋', '荷霊', '背嚢'],
  cap: ['鍔帽', '庇兜'],
  hat: ['広鍔', '中折'],
  beanie: ['丸帽'],
  'knit cap': ['毛糸頭巾'],
  glasses: ['透鏡', '眼鏡'],
  scarf: ['首巻', '襟巻'],
  stole: ['肩掛'],
  snood: ['輪巻'],
  gloves: ['手甲'],
  tie: ['首結'],
  'knit tie': ['編首結'],
}
const CORE_NOUN: Record<Group, string[]> = {
  outer: ['鎧纏', '外套', '戦衣', '陣羽織'],
  tops: ['織衣', '装束', '胸甲', '衣'],
  bottom: ['脚甲', '韋駄天', '疾風', '袴'],
  shoes: ['踏破者', '歩哨', '靴聖', '韋足'],
  acc: ['宝物', '護符', '装具', '小物霊'],
}
const TITLE_HIGH = ['皇', '覇王', '龍帝', '神', '帝', '大魔', '天王']
const TITLE_MID = ['騎士', '戦士', '使徒', '番人', '将', '剣聖']
const TITLE_LOW = ['兵', '従者', '見習', '童子', '足軽', '小姓']
const KATAKANA = ['・ノワール', '・ブラン', '・レックス', '・ジエンド', '・グランデ', '・ザ・ラスト', '・ルージュ', '・ヴェント', '・ネロ', '・ビアンコ', '・テラ', '・ソレイユ', '・ルーナ', '・フィナーレ']
// 帽子は見た目の象徴 → 冠詞に反映
const HAT_WORDS: Record<string, string[]> = {
  キャップ: ['鍔付', '庇'],
  ニット帽: ['毛糸冠', '丸頭巾'],
  ハット: ['広鍔', '中折れ'],
}
// 髪色（黒は多数派なので冠には使わない＝特徴の薄い名前を避ける）
const HAIR_WORDS: Record<string, string[]> = {
  金: ['金獅子', '黄金'],
  茶: ['鳶色', '栗毛'],
}

export type NameFeatures = {
  season: Season
  group: Group
  category: string
  color?: string
  color2?: string
  hat?: string | null
  hairColor?: string | null
  level: number
}

function genName(key: string, f: NameFeatures): string {
  const h = hash(key)
  const cores = CATEGORY_NOUN[f.category] ?? CORE_NOUN[f.group]
  const core = pick(cores, hash(key + 'n'))
  const titlePool = f.level >= 7 ? TITLE_HIGH : f.level >= 4 ? TITLE_MID : TITLE_LOW
  const title = pick(titlePool, hash(key + 't'))
  const kata = pick(KATAKANA, hash(key + 'k'))
  // 冠（プレフィックス）: 帽子＞色＞髪色＞季節 の優先で、見た目の特徴を前に出す
  let crown: string
  if (f.hat && HAT_WORDS[f.hat] && (h & 3) !== 0) crown = pick(HAT_WORDS[f.hat], hash(key + 'c'))
  else if (f.color && COLOR_WORDS[f.color] && (h & 1) === 0) crown = pick(COLOR_WORDS[f.color], hash(key + 'c'))
  else if (f.hairColor && HAIR_WORDS[f.hairColor] && h % 5 === 0) crown = pick(HAIR_WORDS[f.hairColor], hash(key + 'c'))
  else crown = pick(SEASON_WORDS[f.season], hash(key + 'c'))
  const twoTone = f.color && f.color2 && f.color !== f.color2 && COLOR_WORDS[f.color] && COLOR_WORDS[f.color2]
  switch (h % 7) {
    case 0:
      return `${crown}の${core}`
    case 1:
      return `${crown}の${core}・${title}`
    case 2:
      return `${core}${title}${kata}`
    case 3:
      return `${crown}${core}${kata}`
    case 4: {
      const hatW = f.hat && HAT_WORDS[f.hat] ? pick(HAT_WORDS[f.hat], hash(key + 'h')) : crown
      return `${hatW}${core}・${title}`
    }
    case 5:
      if (twoTone) {
        const a = pick(COLOR_WORDS[f.color!], hash(key + 'c'))
        const b = pick(COLOR_WORDS[f.color2!], hash(key + 'c2'))
        return `${a}と${b}の${core}`
      }
      return `${crown}${core}${title}`
    default:
      return `${title}${kata}・${core}`
  }
}

// 重複名を決定的に散らす（同名にだけ漢数字の連番を付ける）
const KANJI_NUM = ['', '弐', '参', '肆', '伍', '陸', '漆', '捌', '玖', '拾']
export function ensureUniqueNames(list: MonsterTemplate[]): void {
  const seen = new Map<string, number>()
  for (const m of list) {
    const n = (seen.get(m.name) ?? 0) + 1
    seen.set(m.name, n)
    if (n >= 2) m.name = `${m.name} ${KANJI_NUM[n - 1] ?? n}`
  }
}

export type ItemInfo = { category: string; count: number; color?: string }
export type DeriveContext = {
  /** 人気ランクで決めた★レベル（buildLevelScale）。無ければスキ数から簡易算出 */
  level?: number
  hat?: string | null
  hairColor?: string | null
}

/** 1出勤服を1モンスターカードのテンプレートに変換する */
export function deriveMonster(outfit: Outfit, items: ItemInfo[], ctx?: DeriveContext): MonsterTemplate {
  // ★レベルは人気ランク（ctx.level）で決め、ATKはレベルから引く＝高レベルほど大きい
  const level = ctx?.level ?? levelFromLike(outfit.like)
  const atk = atkForLevel(level, outfit.key)
  const avgWear = items.length ? items.reduce((s, it) => s + (it.count || 0), 0) / items.length : 1
  const def = Math.min(2800, Math.max(300, round50(400 + Math.sqrt(Math.max(1, avgWear)) * 150)))
  const season = seasonOf(outfit.date)

  // 主役アイテム: グループ優先度 → 着用回数 の順で1つ選ぶ
  const main = [...items].sort((a, b) => {
    const pa = GROUP_PRIORITY.indexOf(groupOf(a.category))
    const pb = GROUP_PRIORITY.indexOf(groupOf(b.category))
    return pa - pb || (b.count || 0) - (a.count || 0)
  })[0]
  const group = main ? groupOf(main.category) : 'acc'
  // 色の頻度（代表色＝主役の色 or 最頻色、副色＝2番目に多い色）
  const freq = new Map<string, number>()
  for (const it of items) if (it.color) freq.set(it.color, (freq.get(it.color) ?? 0) + 1)
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const color = main?.color ?? ranked[0]
  const color2 = ranked.find((c) => c !== color)

  return {
    kind: 'monster',
    outfitKey: outfit.key,
    name: genName(outfit.key, {
      season,
      group,
      category: main?.category ?? 'other',
      color,
      color2,
      hat: ctx?.hat,
      hairColor: ctx?.hairColor,
      level,
    }),
    img: outfit.images[0]?.url ?? '',
    title: outfit.title,
    date: outfit.date,
    likes: outfit.like,
    atk,
    def,
    level,
    season,
    race: RACE_LABEL[group],
    colorBucket: color,
  }
}

// ----------------------------------------------------------------------------
// デッキ構築
// ----------------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// おまかせデッキの理想カーブ（合計＝MONSTER_COUNT=32）。少数の大型＋厚い中低層。
const DECK_CURVE: Record<number, number> = { 8: 1, 7: 2, 6: 3, 5: 5, 4: 7, 3: 8, 2: 4, 1: 2 }

/** おまかせ40枚: レベルカーブに沿ってモンスター32 + 魔法罠8 を組む */
export function buildAutoDeck(pool: MonsterTemplate[]): MonsterTemplate[] {
  const byLevel = new Map<number, MonsterTemplate[]>()
  for (const m of pool) {
    const a = byLevel.get(m.level) ?? []
    a.push(m)
    byLevel.set(m.level, a)
  }
  for (const a of byLevel.values()) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
  }
  const out: MonsterTemplate[] = []
  for (let lv = 8; lv >= 1; lv--) {
    const want = DECK_CURVE[lv] ?? 0
    out.push(...(byLevel.get(lv) ?? []).slice(0, want))
  }
  // 端数はプールの残りから埋める（カーブどおりに揃わない／プールが小さい場合の保険）
  if (out.length < MONSTER_COUNT) {
    const used = new Set(out.map((m) => m.outfitKey))
    out.push(...shuffle(pool.filter((m) => !used.has(m.outfitKey))).slice(0, MONSTER_COUNT - out.length))
  }
  return shuffle(out).slice(0, MONSTER_COUNT)
}

let uidSeq = 0
const nextUid = (side: Side) => `${side === 0 ? 'p' : 'e'}${uidSeq++}`

/** モンスターテンプレ配列 → 実プレイ用デッキ（魔法罠を混ぜて uid 付与・シャッフル） */
export function materializeDeck(monsters: MonsterTemplate[], side: Side): Card[] {
  const cards: Card[] = monsters.map((m) => ({ ...m, uid: nextUid(side) }))
  for (const id of SPELL_TRAP_DECKLIST) {
    cards.push({ ...SPELL_TRAP_DEFS[id], uid: nextUid(side) })
  }
  return shuffle(cards)
}

// ----------------------------------------------------------------------------
// 初期化
// ----------------------------------------------------------------------------
function emptyPlayer(name: string, deck: Card[]): PlayerState {
  return {
    name,
    lp: START_LP,
    deck,
    hand: [],
    field: Array(MONSTER_ZONES).fill(null),
    back: Array(BACK_ZONES).fill(null),
    graveyard: [],
  }
}

export function createGame(playerDeck: Card[], cpuDeck: Card[]): GameState {
  const you = emptyPlayer('あなた', playerDeck)
  const cpu = emptyPlayer('CP', cpuDeck)
  // 初手5枚（先攻のドローはなし）
  you.hand = you.deck.splice(0, START_HAND)
  cpu.hand = cpu.deck.splice(0, START_HAND)
  return {
    sides: [you, cpu],
    turn: 0,
    phase: 'main',
    turnNo: 1,
    normalSummonUsed: false,
    winner: null,
    log: [{ side: null, text: 'デュエルスタート — 先攻はあなた（初手5枚／先攻1ターン目はバトル・ドローなし）' }],
    flash: null,
  }
}

// ----------------------------------------------------------------------------
// アクション
// ----------------------------------------------------------------------------
export type Action =
  | { type: 'summon'; side: Side; handIndex: number; orientation: Orientation; faceDown: boolean; tributes: number[] }
  | { type: 'spell'; side: Side; handIndex: number; targetZone?: number; season?: Season }
  | { type: 'setTrap'; side: Side; handIndex: number }
  | { type: 'attack'; side: Side; attackerZone: number; targetZone: number | null }
  | { type: 'toBattle'; side: Side }
  | { type: 'endTurn'; side: Side }

const other = (s: Side): Side => (s === 0 ? 1 : 0)
const freeIndex = (arr: (unknown | null)[]) => arr.findIndex((x) => x === null)
const log = (s: GameState, side: Side | null, text: string) => s.log.push({ side, text })

function checkWin(s: GameState) {
  if (s.sides[0].lp <= 0 && s.winner === null) s.winner = 1
  if (s.sides[1].lp <= 0 && s.winner === null) s.winner = 0
}

function drawN(s: GameState, side: Side, n: number) {
  const p = s.sides[side]
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      // デッキ切れ＝デッキアウトで敗北
      if (s.winner === null) s.winner = other(side)
      log(s, null, `${p.name}はデッキが尽きた — デッキアウト`)
      return
    }
    p.hand.push(p.deck.shift()!)
  }
}

// 攻撃側の実効ATK（バフ＋相性＋半減）
function effAtk(slot: FieldSlot, opponent: FieldSlot | null, half: boolean): { value: number; m: -1 | 0 | 1 } {
  let v = slot.card.atk + slot.atkBuff
  let m: -1 | 0 | 1 = 0
  if (opponent) {
    m = matchup(slot.season, opponent.season)
    v += m * ATTR_BONUS
  }
  if (half) v = Math.floor(v / 2)
  return { value: Math.max(0, v), m }
}

/** 防御側のバックローから発動可能な罠を1つ取り出して適用する（攻撃宣言時） */
function triggerTrap(
  s: GameState,
  defender: Side,
  attackerSlotRef: { zone: number },
): { negate: boolean; half: boolean; trapName?: string } {
  const def = s.sides[defender]
  const idx = def.back.findIndex((b) => b !== null)
  if (idx < 0) return { negate: false, half: false }
  const trap = def.back[idx]!.card
  def.back[idx] = null
  def.graveyard.push(trap)
  const atkSide = s.sides[other(defender)]
  const aSlot = atkSide.field[attackerSlotRef.zone]
  switch (trap.id as SpellTrapId) {
    case 'downpour': {
      if (aSlot) {
        atkSide.graveyard.push(aSlot.card)
        atkSide.field[attackerSlotRef.zone] = null
      }
      log(s, defender, `罠「ゲリラ豪雨」発動 — 攻撃モンスターを破壊`)
      return { negate: true, half: false, trapName: trap.name }
    }
    case 'refund': {
      if (aSlot) {
        atkSide.hand.push(aSlot.card)
        atkSide.field[attackerSlotRef.zone] = null
      }
      log(s, defender, `罠「タグ付き返品」発動 — 攻撃モンスターを手札へ`)
      return { negate: true, half: false, trapName: trap.name }
    }
    case 'mismatch': {
      log(s, defender, `罠「サイズ違い」発動 — 攻撃力を半分に`)
      return { negate: false, half: true, trapName: trap.name }
    }
    default:
      // 攻撃に反応しない罠は素通り（このゲームでは全部反応するが保険）
      def.back[idx] = { card: trap }
      def.graveyard.pop()
      return { negate: false, half: false }
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const s = structuredClone(state) as GameState
  s.flash = null
  if (s.winner !== null) return s
  const me = s.sides[action.side]
  const opp = s.sides[other(action.side)]

  switch (action.type) {
    case 'summon': {
      const card = me.hand[action.handIndex]
      if (!card || !isMonster(card)) return state
      const need = tributesNeeded(card.level)
      const tributes = [...new Set(action.tributes)].filter((z) => me.field[z])
      if (tributes.length < need) return state
      // リリース
      for (const z of tributes) {
        me.graveyard.push(me.field[z]!.card)
        me.field[z] = null
      }
      const zone = freeIndex(me.field)
      if (zone < 0) return state
      me.hand.splice(action.handIndex, 1)
      me.field[zone] = {
        card,
        orientation: action.orientation,
        faceDown: action.orientation === 'defense' && action.faceDown,
        atkBuff: 0,
        season: card.season,
        summonedThisTurn: true,
        hasAttacked: false,
      }
      s.normalSummonUsed = true
      const how = need > 0 ? `${need}体をリリースして` : ''
      const pos = action.orientation === 'attack' ? '攻撃表示' : action.faceDown ? '裏側守備' : '守備表示'
      log(s, action.side, `${how}「${card.name}」を${pos}で召喚`)
      return s
    }

    case 'spell': {
      const card = me.hand[action.handIndex]
      if (!card || isMonster(card) || card.kind !== 'spell') return state
      const id = card.id as SpellTrapId
      if (id === 'closet') {
        me.hand.splice(action.handIndex, 1)
        me.graveyard.push(card)
        log(s, action.side, `魔法「クローゼット整理」 — 2枚ドロー`)
        drawN(s, action.side, 2)
        return s
      }
      if (id === 'reward') {
        const z = action.targetZone
        if (z == null || !me.field[z]) return state
        me.hand.splice(action.handIndex, 1)
        me.graveyard.push(card)
        me.field[z]!.atkBuff += 800
        log(s, action.side, `魔法「ご褒美コーデ」 — 「${me.field[z]!.card.name}」のATK+800`)
        return s
      }
      if (id === 'layering') {
        const z = action.targetZone
        if (z == null || !me.field[z] || !action.season) return state
        me.hand.splice(action.handIndex, 1)
        me.graveyard.push(card)
        me.field[z]!.season = action.season
        log(s, action.side, `魔法「重ね着」 — 「${me.field[z]!.card.name}」を${SEASON_LABEL[action.season]}属性に`)
        return s
      }
      return state
    }

    case 'setTrap': {
      const card = me.hand[action.handIndex]
      if (!card || isMonster(card) || card.kind !== 'trap') return state
      const zone = freeIndex(me.back)
      if (zone < 0) return state
      me.hand.splice(action.handIndex, 1)
      me.back[zone] = { card }
      log(s, action.side, `伏せカードをセット`)
      return s
    }

    case 'toBattle': {
      if (s.turnNo === 1) return state // 先攻1ターン目はバトルなし
      s.phase = 'battle'
      log(s, action.side, `バトルフェイズ`)
      return s
    }

    case 'attack': {
      if (s.phase !== 'battle') return state
      const aSlot = me.field[action.attackerZone]
      if (!aSlot || aSlot.orientation !== 'attack' || aSlot.faceDown || aSlot.hasAttacked) {
        return state
      }

      // 罠の発動（防御側のバックロー）
      const tr = triggerTrap(s, other(action.side), { zone: action.attackerZone })
      if (tr.negate) {
        s.flash = {
          attacker: aSlot.card.name,
          target: null,
          atkValue: 0,
          defValue: 0,
          matchup: 0,
          trap: tr.trapName,
          result: tr.trapName === 'タグ付き返品' ? 'bounce' : 'negate',
          damageTo: null,
          damage: 0,
          attackerSide: action.side,
          attackerZone: action.attackerZone,
          targetZone: action.targetZone,
        }
        return s
      }

      const target = action.targetZone == null ? null : opp.field[action.targetZone]

      // ダイレクトアタック（相手フィールドにモンスターなし）
      if (target == null) {
        const hasMonster = opp.field.some((f) => f)
        if (hasMonster) return state // モンスターがいるならダイレクト不可
        const { value } = effAtk(aSlot, null, tr.half)
        opp.lp -= value
        aSlot.hasAttacked = true
        s.flash = {
          attacker: aSlot.card.name,
          target: null,
          atkValue: value,
          defValue: 0,
          matchup: 0,
          trap: tr.trapName,
          result: 'direct',
          damageTo: other(action.side),
          damage: value,
          attackerSide: action.side,
          attackerZone: action.attackerZone,
          targetZone: null,
        }
        log(s, action.side, `ダイレクトアタック — ${value} ダメージ`)
        checkWin(s)
        return s
      }

      // モンスター同士の戦闘
      const { value: atkVal, m } = effAtk(aSlot, target, tr.half)
      const wasFaceDown = target.faceDown
      if (wasFaceDown) {
        target.faceDown = false // リバース（このゲームに効果はないが表向きに）
      }
      const defending = target.orientation === 'defense'
      const targetVal = defending ? target.card.def : target.card.atk + target.atkBuff

      let result: BattleFlash['result'] = 'none'
      let damageTo: Side | null = null
      let damage = 0

      if (defending) {
        if (atkVal > targetVal) {
          opp.graveyard.push(target.card)
          opp.field[action.targetZone!] = null
          result = 'destroy-target'
        } else if (atkVal < targetVal) {
          // 守備モンスターより弱い攻撃: 攻撃側は破壊されず、差分を自分が受ける
          damage = targetVal - atkVal
          me.lp -= damage
          damageTo = action.side
          result = 'recoil'
        } else {
          result = 'none'
        }
      } else {
        // 攻撃表示同士
        if (atkVal > targetVal) {
          damage = atkVal - targetVal
          opp.lp -= damage
          damageTo = other(action.side)
          opp.graveyard.push(target.card)
          opp.field[action.targetZone!] = null
          result = 'destroy-target'
        } else if (atkVal < targetVal) {
          damage = targetVal - atkVal
          me.lp -= damage
          damageTo = action.side
          me.graveyard.push(aSlot.card)
          me.field[action.attackerZone] = null
          result = 'destroy-attacker'
        } else {
          // 相打ち
          opp.graveyard.push(target.card)
          opp.field[action.targetZone!] = null
          me.graveyard.push(aSlot.card)
          me.field[action.attackerZone] = null
          result = 'both'
        }
      }

      if (me.field[action.attackerZone]) me.field[action.attackerZone]!.hasAttacked = true
      s.flash = {
        attacker: aSlot.card.name,
        target: target.card.name,
        atkValue: atkVal,
        defValue: targetVal,
        matchup: m,
        trap: tr.trapName,
        result,
        damageTo,
        damage,
        attackerSide: action.side,
        attackerZone: action.attackerZone,
        targetZone: action.targetZone,
      }
      const matchTxt = m === 1 ? `（相性○ +${ATTR_BONUS}）` : m === -1 ? `（相性× -${ATTR_BONUS}）` : ''
      log(s, action.side, `「${aSlot.card.name}」が「${target.card.name}」へ攻撃 ${matchTxt}`)
      checkWin(s)
      return s
    }

    case 'endTurn': {
      const next = other(action.side)
      s.turn = next
      s.turnNo += 1
      s.phase = 'main'
      s.normalSummonUsed = false
      // 次プレイヤーのモンスターの行動済みフラグをリセット
      for (const slot of s.sides[next].field) {
        if (slot) {
          slot.hasAttacked = false
          slot.summonedThisTurn = false
        }
      }
      log(s, null, `— ${s.sides[next].name} のターン（T${s.turnNo}）`)
      drawN(s, next, 1)
      return s
    }

    default:
      return state
  }
}

// ----------------------------------------------------------------------------
// 召喚可否などの判定ヘルパー（UI/AI共用）
// ----------------------------------------------------------------------------
export function canSummon(s: GameState, side: Side, handIndex: number): boolean {
  if (s.normalSummonUsed) return false
  const card = s.sides[side].hand[handIndex]
  if (!card || !isMonster(card)) return false
  const need = tributesNeeded(card.level)
  const onField = s.sides[side].field.filter((f) => f).length
  const freeAfter = onField - need
  if (freeAfter < 0) return false
  // 空きゾーン（リリース後に置けるか）
  if (need === 0 && freeIndex(s.sides[side].field) < 0) return false
  return true
}

// ----------------------------------------------------------------------------
// CPU（貪欲AI）— 現局面から「次の一手」を1つ返す。null でそのフェイズ終了。
// ----------------------------------------------------------------------------
function bestSummonChoice(s: GameState, side: Side): { handIndex: number; tributes: number[]; orientation: Orientation; faceDown: boolean } | null {
  const me = s.sides[side]
  const candidates: { handIndex: number; level: number; atk: number }[] = []
  me.hand.forEach((c, i) => {
    if (isMonster(c)) candidates.push({ handIndex: i, level: c.level, atk: c.atk })
  })
  if (!candidates.length) return null
  // ATKの高い順に、召喚可能なものを探す
  candidates.sort((a, b) => b.atk - a.atk)
  const oppBest = Math.max(0, ...s.sides[other(side)].field.filter((f) => f && f.orientation === 'attack').map((f) => f!.card.atk + f!.atkBuff))
  for (const cand of candidates) {
    if (!canSummon(s, side, cand.handIndex)) continue
    const need = tributesNeeded(cand.level)
    // 最弱モンスターをリリース候補に
    const tributeZones = me.field
      .map((f, z) => ({ f, z }))
      .filter((x) => x.f)
      .sort((a, b) => a.f!.card.atk + a.f!.atkBuff - (b.f!.card.atk + b.f!.atkBuff))
      .slice(0, need)
      .map((x) => x.z)
    if (tributeZones.length < need) continue
    // リリースで損するなら見送り（アドバンス召喚は得な時だけ）
    if (need > 0) {
      const lost = tributeZones.reduce((sum, z) => sum + me.field[z]!.card.atk + me.field[z]!.atkBuff, 0)
      if (cand.atk <= lost) continue
    }
    const card = me.hand[cand.handIndex] as MonsterCard
    // 相手最強より強い or 場が空 → 攻撃表示、弱いなら裏守備
    const aggressive = card.atk >= oppBest || s.sides[other(side)].field.every((f) => !f)
    const orientation: Orientation = aggressive ? 'attack' : 'defense'
    return { handIndex: cand.handIndex, tributes: tributeZones, orientation, faceDown: orientation === 'defense' }
  }
  return null
}

function cpuMainAction(s: GameState, side: Side): Action | null {
  const me = s.sides[side]
  const handHas = (id: SpellTrapId) => me.hand.findIndex((c) => !isMonster(c) && c.id === id)

  // 1) クローゼット整理（デッキに余裕があれば掘る）
  const closet = handHas('closet')
  if (closet >= 0 && me.deck.length > 3) return { type: 'spell', side, handIndex: closet }

  // 2) 召喚（メインの主役）
  if (!s.normalSummonUsed) {
    const sum = bestSummonChoice(s, side)
    if (sum) return { type: 'summon', side, handIndex: sum.handIndex, orientation: sum.orientation, faceDown: sum.faceDown, tributes: sum.tributes }
  }

  // 3) ご褒美コーデ（攻撃表示の最強モンスターを強化）
  const reward = handHas('reward')
  if (reward >= 0) {
    const best = me.field
      .map((f, z) => ({ f, z }))
      .filter((x) => x.f && x.f.orientation === 'attack')
      .sort((a, b) => b.f!.card.atk + b.f!.atkBuff - (a.f!.card.atk + a.f!.atkBuff))[0]
    if (best) return { type: 'spell', side, handIndex: reward, targetZone: best.z }
  }

  // 4) 重ね着（自分の攻撃役を相手最強に有利な季節へ）
  const layering = handHas('layering')
  if (layering >= 0) {
    const myAtkr = me.field.map((f, z) => ({ f, z })).filter((x) => x.f && x.f.orientation === 'attack')[0]
    const oppBest = s.sides[other(side)].field
      .map((f) => f)
      .filter((f): f is FieldSlot => !!f)
      .sort((a, b) => b.card.atk + b.atkBuff - (a.card.atk + a.atkBuff))[0]
    if (myAtkr && oppBest) {
      // oppBest に強くなる季節 = STRONG_AGAINST[?] === oppBest.season
      const want = (Object.keys(STRONG_AGAINST) as Season[]).find((k) => STRONG_AGAINST[k] === oppBest.season)
      if (want && myAtkr.f!.season !== want) return { type: 'spell', side, handIndex: layering, targetZone: myAtkr.z, season: want }
    }
  }

  // 5) 罠をセット
  const trapIdx = me.hand.findIndex((c) => !isMonster(c) && c.kind === 'trap')
  if (trapIdx >= 0 && freeIndex(me.back) >= 0) return { type: 'setTrap', side, handIndex: trapIdx }

  // 6) バトルへ（1ターン目は不可）
  if (s.turnNo > 1) return { type: 'toBattle', side }
  return null
}

function cpuBattleAction(s: GameState, side: Side): Action | null {
  const me = s.sides[side]
  const oppSide = other(side)
  const opp = s.sides[oppSide]
  const attackers = me.field
    .map((f, z) => ({ f, z }))
    .filter((x) => x.f && x.f.orientation === 'attack' && !x.f.faceDown && !x.f.hasAttacked) as { f: FieldSlot; z: number }[]
  if (!attackers.length) return null

  const oppMonsters = opp.field.map((f, z) => ({ f, z })).filter((x) => x.f) as { f: FieldSlot; z: number }[]

  // ATKの高い攻撃役から動かす
  attackers.sort((a, b) => b.f.card.atk + b.f.atkBuff - (a.f.card.atk + a.f.atkBuff))
  for (const atk of attackers) {
    if (!oppMonsters.length) {
      return { type: 'attack', side, attackerZone: atk.z, targetZone: null } // ダイレクト
    }
    // 各ターゲットの損得を評価（罠は見えない前提）
    let best: { zone: number; gain: number } | null = null
    for (const t of oppMonsters) {
      const { value } = effAtk(atk.f, t.f, false)
      const defVal = t.f.orientation === 'defense' ? t.f.card.def : t.f.card.atk + t.f.atkBuff
      let gain: number
      if (t.f.orientation === 'defense') {
        gain = value > defVal ? 200 + (value - defVal) * 0.1 : value < defVal ? -(defVal - value) : 0
      } else {
        gain = value > defVal ? value - defVal : value < defVal ? -(defVal - value) * 2 : 50
      }
      if (best === null || gain > best.gain) best = { zone: t.z, gain }
    }
    if (best && best.gain > 0) {
      return { type: 'attack', side, attackerZone: atk.z, targetZone: best.zone }
    }
  }
  return null
}

/** CPUの次の一手。null ならターン終了すべき。 */
export function cpuNextAction(s: GameState, side: Side): Action | null {
  if (s.winner !== null) return null
  if (s.phase === 'main') {
    const a = cpuMainAction(s, side)
    if (a) return a
    if (s.turnNo === 1) return { type: 'endTurn', side } // 1ターン目はバトルなしで終了
    return { type: 'toBattle', side }
  }
  // battle
  const a = cpuBattleAction(s, side)
  if (a) return a
  return { type: 'endTurn', side }
}
