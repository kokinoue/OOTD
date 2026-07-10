import type { EffectiveItem, Item, Outfit } from '../types'
import colorsJson from '../data/colors.json'
import type { ColorsFile } from '../types'

// 性格診断「あなたのkokiはこれ！」— 乱数を使わない決定的なMBTI風診断。
// 回答 → 5軸スコア → 8タイプ判定（3軸の正負） + 実データからの出勤服マッチング。

export type Trait = 'colorful' | 'formal' | 'adventurous' | 'layered' | 'warm'

export const TRAITS: Trait[] = ['colorful', 'formal', 'adventurous', 'layered', 'warm']

export type Scores = Record<Trait, number>

export type Choice = {
  text: string
  scores: Partial<Record<Trait, number>>
}

export type Question = {
  id: string
  text: string
  choices: Choice[]
}

// ---------------------------------------------------------------------------
// 質問
// ---------------------------------------------------------------------------

export const QUESTIONS: Question[] = [
  {
    id: 'morning',
    text: '朝、家を出る5分前。何をしてる？',
    choices: [
      { text: '昨日決めておいた服にそのまま袖を通す', scores: { adventurous: -2, layered: -1 } },
      { text: 'クローゼットの前で最終的に色を決める', scores: { colorful: 1, adventurous: 1 } },
      { text: '鏡の前で小物をあれこれ足したり引いたりしている', scores: { layered: 2 } },
      { text: 'まだ布団の中で、あと2分は粘る', scores: { formal: -1, layered: -1 } },
    ],
  },
  {
    id: 'convenience',
    text: '初めて入るコンビニでまず向かうのは？',
    choices: [
      { text: 'いつも買う定番のドリンクの棚', scores: { adventurous: -2 } },
      { text: '新商品・限定パッケージのコーナー', scores: { adventurous: 2, colorful: 1 } },
      { text: 'レジ横のホットスナック', scores: { warm: 1, layered: 1 } },
      { text: '会計だけ済ませてすぐ出る', scores: { formal: 1, adventurous: -1 } },
    ],
  },
  {
    id: 'closet',
    text: 'クローゼットを開けたときの理想の状態は？',
    choices: [
      { text: '白・黒・グレーで統一されている', scores: { colorful: -2, formal: 1 } },
      { text: '差し色になる一着が必ず目に入る', scores: { colorful: 2 } },
      { text: 'ジャケットやシャツがきれいに並んでいる', scores: { formal: 2 } },
      { text: 'とにかく着心地優先で畳まれてなくてもいい', scores: { formal: -2, layered: -1 } },
    ],
  },
  {
    id: 'holiday',
    text: '予定のない休日、気づいたら何をしている？',
    choices: [
      { text: '近所の知ってる店だけを回っている', scores: { adventurous: -1, layered: -1 } },
      { text: '前から気になっていた新しい店に足を伸ばす', scores: { adventurous: 2 } },
      { text: '家で映画を見ながらゴロゴロしている', scores: { formal: -2, layered: -2 } },
      { text: '小物や雑貨を見に出かけている', scores: { layered: 1, colorful: 1 } },
    ],
  },
  {
    id: 'meeting',
    text: '急な来客・大事な打ち合わせが入った。どうする？',
    choices: [
      { text: 'ジャケットを一枚羽織って引き締める', scores: { formal: 2 } },
      { text: 'いつもの服のままで特に変えない', scores: { formal: -1, adventurous: -1 } },
      { text: 'バッグや靴だけさっと変える', scores: { layered: 1, formal: 1 } },
      { text: '内心そわそわして時間ギリギリまで悩む', scores: { adventurous: 1, layered: 1 } },
    ],
  },
  {
    id: 'temperature',
    text: 'オフィスの空調、正直どう感じることが多い？',
    choices: [
      { text: '寒い。ひざ掛けか羽織りものが手放せない', scores: { warm: -2, layered: 1 } },
      { text: '暑い。すぐ薄着になりたくなる', scores: { warm: 2, layered: -1 } },
      { text: '特に気にならない。周りに合わせる', scores: { warm: 0 } },
      { text: '暑がりだけど冷房も苦手で毎回ちょうどいい一枚を探している', scores: { warm: 1, layered: 1 } },
    ],
  },
  {
    id: 'shopping',
    text: '服を買うとき、決め手になるのは？',
    choices: [
      { text: '長く着られる定番かどうか', scores: { adventurous: -2, formal: 1 } },
      { text: '今までにない形や色かどうか', scores: { adventurous: 2, colorful: 1 } },
      { text: '着心地と動きやすさ', scores: { formal: -1, layered: -1 } },
      { text: '小物やレイヤードでどう遊べるか', scores: { layered: 2 } },
    ],
  },
  {
    id: 'weekend-bag',
    text: '出かけるときの荷物、気づけばどうなっている？',
    choices: [
      { text: '財布とスマホだけで身軽に', scores: { layered: -2 } },
      { text: 'あれこれ持って結局パンパンになる', scores: { layered: 2 } },
      { text: '色や柄がはっきりしたバッグを選びがち', scores: { colorful: 2 } },
      { text: '主張しない無地のバッグに落ち着く', scores: { colorful: -1, formal: 1 } },
    ],
  },
]

// ---------------------------------------------------------------------------
// 回答集計
// ---------------------------------------------------------------------------

const zeroScores = (): Scores => ({ colorful: 0, formal: 0, adventurous: 0, layered: 0, warm: 0 })

/** answers[i] = QUESTIONS[i] で選んだ choice のインデックス */
export function tallyScores(answers: number[]): Scores {
  const s = zeroScores()
  QUESTIONS.forEach((q, i) => {
    const choice = q.choices[answers[i]]
    if (!choice) return
    for (const trait of TRAITS) {
      s[trait] += choice.scores[trait] ?? 0
    }
  })
  return s
}

// ---------------------------------------------------------------------------
// タイプ判定（colorful / formal / adventurous の正負 2^3 = 8通り）
// ---------------------------------------------------------------------------

export type QuizType = {
  id: string
  name: string
  tagline: string
  description: string
}

// id は c/f/a の正負を並べた3文字（+ / -）で表す。例: '+++' = colorful+, formal+, adventurous+
export const QUIZ_TYPES: Record<string, QuizType> = {
  '+++': {
    id: '+++',
    name: '彩職人koki',
    tagline: '色と仕立てで魅せる、攻めの正装派',
    description:
      '差し色を効かせながらもきちんと感を崩さない、いいとこ取りの一着を選ぶタイプ。新しい組み合わせを試すことを恐れず、それでいて着崩れた印象は残さない。周りから「今日も決まってるね」と言われがち。',
  },
  '++-': {
    id: '++-',
    name: '定番彩色koki',
    tagline: 'カラーはきちんと、でも安心できる型を貫く',
    description:
      '色使いはカラフルで気分が上がるものを選びつつ、シルエットや組み合わせは自分の中で固まった「勝ちパターン」を持っている。冒険は色だけで十分、という堅実な遊び心の持ち主。',
  },
  '+-+': {
    id: '+-+',
    name: '自由配色koki',
    tagline: 'ラフな空気に色を効かせる、気分屋アーティスト',
    description:
      'かっちりした服よりも力の抜けた格好が好きで、そこに毎回新しい色や柄を投入してくる。同じ格好を二度と繰り返さない気まぐれさがあり、周りを飽きさせない。',
  },
  '+--': {
    id: '+--',
    name: '色好きkoki',
    tagline: 'いつもの形に、いつもの好きな色を',
    description:
      'カジュアルで力の抜けた服を定番として持ちつつ、色選びだけは譲らないこだわり派。奇をてらうことはないが、鮮やかな一色が毎回どこかに効いている。',
  },
  '-++': {
    id: '-++',
    name: '求道者koki',
    tagline: 'モノトーンの正装を、常に更新し続ける',
    description:
      '白黒グレーを軸にした引き算の美学を持ちながら、素材やシルエットで新しい表現を探し続ける研究肌。着る服の完成度に対して常に貪欲で、妥協を良しとしない。',
  },
  '-+-': {
    id: '-+-',
    name: '静謐派koki',
    tagline: '磨き上げた「いつもの正装」を崩さない',
    description:
      'モノトーンできちんと感のある装いを、確立した型のまま淡々と継続するタイプ。飾らないが隙もない、静かな安定感が最大の武器。周囲からの信頼も厚い。',
  },
  '--+': {
    id: '--+',
    name: '脱力実験koki',
    tagline: 'モノトーンのラフさに、毎回新しい発見を',
    description:
      '力の抜けた格好を好みつつ、素材感やアイテムの組み合わせでは常に新しいものを試したがる。飾らない中に潜む工夫を、見る人が見ればわかるタイプ。',
  },
  '---': {
    id: '---',
    name: '省エネkoki',
    tagline: '着心地と定番、それさえあれば十分',
    description:
      'モノトーンでラフ、そして毎回似た組み合わせに落ち着く安定志向。派手さより快適さを選び、朝の意思決定コストを極限まで減らすことに長けている。何を着るか迷わないのが最大の強み。',
  },
}

export function resolveType(scores: Scores): QuizType {
  const key =
    (scores.colorful >= 0 ? '+' : '-') +
    (scores.formal >= 0 ? '+' : '-') +
    (scores.adventurous >= 0 ? '+' : '-')
  return QUIZ_TYPES[key]
}

// ---------------------------------------------------------------------------
// outfit マッチング
// ---------------------------------------------------------------------------

const colorsFile = colorsJson as ColorsFile
const colorNameToVal: Record<string, number> = {
  white: -1.5,
  beige: -0.6,
  gray: -1,
  black: -1.6,
  brown: -0.3,
  navy: -0.8,
  blue: 0.4,
  green: 0.6,
  yellow: 1.6,
  orange: 1.5,
  red: 1.8,
  pink: 1.4,
  purple: 1.2,
}

const FORMAL_CATEGORIES: Record<string, number> = {
  jacket: 1.6,
  shirt: 0.9,
  coat: 1.2,
  vest: 0.7,
  tie: 2,
  'knit tie': 2,
  suit: 2,
  boots: 0.4,
  shoes: 0.3, // ヒューリスティックで革靴寄りに少し加点（後述のlabelでも判定）
  blouson: -0.3,
  't-shirt': -1.6,
  sweat: -1.8,
  hoodie: -1.9,
  shorts: -1.2,
  tanktop: -1.4,
  cap: -0.8,
  'knit cap': -1,
  beanie: -1,
}

const FORMAL_LABEL_HINTS: [RegExp, number][] = [
  [/jmweston|churchs|churchbrothers|alden|crockett/i, 1.4],
  [/adidas|nike|newbalance|converse|vans|asics/i, -1.4],
]

const LAYERED_CATEGORIES = new Set([
  'bag',
  'scarf',
  'stole',
  'snood',
  'glasses',
  'hat',
  'cap',
  'knit cap',
  'beanie',
  'gloves',
  'tie',
  'knit tie',
  'vest',
  'down vest',
])

// 月ごとの「薄着っぽさ」(-1 寒い季節 〜 +1 暑い季節)
const monthWarmth: Record<number, number> = {
  1: -1,
  2: -0.9,
  3: -0.3,
  4: 0.2,
  5: 0.6,
  6: 0.9,
  7: 1,
  8: 1,
  9: 0.6,
  10: 0,
  11: -0.5,
  12: -0.9,
}

function itemInfoOf(id: string, itemsById: Map<string, Item | EffectiveItem>) {
  const it = itemsById.get(id)
  const category = it?.category ?? id.split('|')[0] ?? 'other'
  const label = it?.label ?? id.split('|')[1] ?? id
  const count = 'count' in (it ?? {}) ? (it as { count: number }).count : 30
  return { category, label, count }
}

type OutfitFeature = {
  outfit: Outfit
  colorful: number
  formal: number
  adventurous: number
  layered: number
  warm: number
}

function computeFeature(
  outfit: Outfit,
  itemIds: Set<string>,
  itemsById: Map<string, Item | EffectiveItem>,
): OutfitFeature {
  const ids = [...itemIds]
  if (ids.length === 0) {
    return { outfit, colorful: 0, formal: 0, adventurous: 0, layered: 0, warm: 0 }
  }

  let colorSum = 0
  let colorN = 0
  let formalSum = 0
  let rareSum = 0
  let layeredScore = 0

  for (const id of ids) {
    const { category, label, count } = itemInfoOf(id, itemsById)

    const colorName = colorsFile.items[id]
    if (colorName && colorName in colorNameToVal) {
      colorSum += colorNameToVal[colorName]
      colorN++
    }

    let formal = FORMAL_CATEGORIES[category] ?? 0
    for (const [re, bonus] of FORMAL_LABEL_HINTS) {
      if (re.test(label) || re.test(id)) formal += bonus
    }
    formalSum += formal

    // レア(着用数が少ない)ほど「冒険」寄り。定番アイテムは着用数が多い。
    rareSum += 1 / Math.max(1, count)

    if (LAYERED_CATEGORIES.has(category)) layeredScore += 1
  }

  const colorful = colorN > 0 ? colorSum / colorN : 0
  const formal = formalSum / ids.length
  const adventurous = (rareSum / ids.length) * 20 - 0.6 // 大体 -1〜+2 に収まるよう正規化
  const layered = layeredScore + Math.max(0, ids.length - 3) * 0.4

  const month = Number(outfit.date.slice(5, 7))
  const warm = monthWarmth[month] ?? 0

  return { outfit, colorful, formal, adventurous, layered, warm }
}

/** ベクトルの単純な重み付きコサイン類似度 */
function similarity(scores: Scores, f: OutfitFeature): number {
  const vecUser: number[] = [scores.colorful, scores.formal, scores.adventurous, scores.layered, scores.warm]
  const vecOutfit: number[] = [f.colorful, f.formal, f.adventurous, f.layered, f.warm]
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecUser.length; i++) {
    dot += vecUser[i] * vecOutfit[i]
    normA += vecUser[i] * vecUser[i]
    normB += vecOutfit[i] * vecOutfit[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function matchOutfit(
  scores: Scores,
  outfits: Outfit[],
  itemsById: Map<string, Item | EffectiveItem>,
  outfitItemIds: Map<string, Set<string>>,
): Outfit {
  const candidates = outfits.filter((o) => {
    if (!o.images[0]?.url) return false
    const ids = outfitItemIds.get(o.key)
    return ids != null && ids.size > 0
  })

  let best: { outfit: Outfit; score: number } | null = null
  for (const o of candidates) {
    const ids = outfitItemIds.get(o.key)!
    const feature = computeFeature(o, ids, itemsById)
    const score = similarity(scores, feature)
    if (
      best == null ||
      score > best.score ||
      (score === best.score &&
        (o.like > best.outfit.like || (o.like === best.outfit.like && o.no! > best.outfit.no!)))
    ) {
      best = { outfit: o, score }
    }
  }

  if (!best) {
    // 万一候補が空の場合のフォールバック（実データでは発生しない想定）
    return outfits[0]
  }
  return best.outfit
}
