import type { EffectiveItem, Item, Outfit } from '../types'
import colorsJson from '../data/colors.json'
import type { ColorsFile } from '../types'

// 性格診断「あなたのkokiはこれ！」— 乱数を使わない決定的なMBTI風診断。
// 回答 → 5軸スコア → 16タイプ判定（4軸の正負） + 実データからの出勤服マッチング。

export type Trait = 'colorful' | 'formal' | 'adventurous' | 'layered' | 'warm'

export const TRAITS: Trait[] = ['colorful', 'formal', 'adventurous', 'layered', 'warm']

export const TRAIT_LABEL: Record<Trait, { neg: string; pos: string }> = {
  colorful: { neg: 'モノトーン', pos: 'カラフル' },
  formal: { neg: 'カジュアル', pos: 'きれいめ' },
  adventurous: { neg: '定番派', pos: '冒険派' },
  layered: { neg: '身軽', pos: 'マシマシ' },
  warm: { neg: '寒がり', pos: '暑がり' },
}

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
// 回答のURLエンコード（結果の再現・シェア用）
// ---------------------------------------------------------------------------

/** answers を各桁が選択肢インデックスの数字列にエンコードする（例: [0,2,1,3,...] → "0213..."） */
export function encodeAnswers(answers: number[]): string {
  return QUESTIONS.map((_, i) => String(answers[i] ?? 0)).join('')
}

/** エンコード文字列を answers[] に戻す。桁数・範囲が不正な場合は null */
export function decodeAnswers(s: string): number[] | null {
  if (!new RegExp(`^\\d{${QUESTIONS.length}}$`).test(s)) return null
  const digits = s.split('').map(Number)
  for (let i = 0; i < QUESTIONS.length; i++) {
    if (digits[i] >= QUESTIONS[i].choices.length) return null
  }
  return digits
}

// ---------------------------------------------------------------------------
// タイプ判定（colorful / formal / adventurous / layered の正負 2^4 = 16通り）
// ---------------------------------------------------------------------------

export type QuizType = {
  id: string
  name: string
  tagline: string
  description: string
}

// id は c/f/a/l の正負を並べた4文字（+ / -）で表す。
// 例: '++++' = colorful+, formal+, adventurous+, layered+
export const QUIZ_TYPES: Record<string, QuizType> = {
  '++++': {
    id: '++++',
    name: '重彩職人koki',
    tagline: '色も仕立ても重ねて完成させる、攻めの盛装派',
    description:
      '差し色、素材、小物を幾層にも重ねながら、全体は端正に着地させるタイプ。新しい組み合わせを試す大胆さと、着崩れて見せない構成力を併せ持つ。足すほど完成度が上がる、根っからのスタイリスト気質。',
  },
  '+++-': {
    id: '+++-',
    name: '彩職人koki',
    tagline: '色と仕立てを一手で決める、攻めの正装派',
    description:
      '差し色を効かせながらも、要素数は絞ってきちんと感を崩さないタイプ。新しい形や色を試すことを恐れず、一着の強さで装いを完成させる。周りから「今日も決まってるね」と言われがち。',
  },
  '++-+': {
    id: '++-+',
    name: '定番重彩koki',
    tagline: '安心できる型に、色と小物を丁寧に重ねる',
    description:
      '自分の中で固まった端正な型を土台に、好きな色や小物を少しずつ積み上げるタイプ。冒険はしすぎないが、レイヤードの組み替えで毎日に変化をつくる。準備のよさと遊び心が同居している。',
  },
  '++--': {
    id: '++--',
    name: '定番彩色koki',
    tagline: 'カラーはきちんと、でも安心できる型を貫く',
    description:
      '色使いはカラフルで気分が上がるものを選びつつ、シルエットや組み合わせは自分の中で固まった「勝ちパターン」を持っている。余計なものは足さず、冒険は色だけで十分という堅実な遊び心の持ち主。',
  },
  '+-++': {
    id: '+-++',
    name: '自由積層koki',
    tagline: '色も柄も小物も重ねる、即興アーティスト',
    description:
      '力の抜けた服をキャンバスに、大胆な色や柄、小物を思うまま重ねるタイプ。ルールよりその日の気分を信じ、丈や素材の違いまで遊びに変える。同じ格好を二度つくらない即興性が魅力。',
  },
  '+-+-': {
    id: '+-+-',
    name: '自由配色koki',
    tagline: 'ラフな空気に色を効かせる、気分屋アーティスト',
    description:
      'かっちりした服よりも身軽で力の抜けた格好が好きで、そこに毎回新しい色や柄を投入してくる。少ない要素で印象を変える気まぐれさがあり、周りを飽きさせない。',
  },
  '+--+': {
    id: '+--+',
    name: '色盛りkoki',
    tagline: 'いつものラフさに、好きな色を重ねていく',
    description:
      '着慣れたカジュアルを土台に、好きな色とレイヤードをたっぷり楽しむタイプ。新奇さを追うより、自分に馴染んだアイテムを重ねて気分を上げる。荷物も装いも、好きなものは多めが落ち着く。',
  },
  '+---': {
    id: '+---',
    name: '色好きkoki',
    tagline: 'いつもの形に、いつもの好きな色を',
    description:
      'カジュアルで身軽な服を定番として持ちつつ、色選びだけは譲らないこだわり派。奇をてらうことはないが、鮮やかな一色が毎回どこかに効いている。',
  },
  '-+++': {
    id: '-+++',
    name: '積層求道者koki',
    tagline: 'モノトーンを幾層にも組み、更新し続ける',
    description:
      '白黒グレーを軸に、素材、丈、シルエットの差を幾層にも重ねて新しい表現を探す研究肌。色を抑えるぶん構成には妥協せず、重ねる一枚ごとに意味を持たせる。静かに見えて、発想はかなり攻めている。',
  },
  '-++-': {
    id: '-++-',
    name: '求道者koki',
    tagline: '研ぎ澄ましたモノトーンを、更新し続ける',
    description:
      '白黒グレーを軸にした引き算の美学を持ちながら、一着の素材やシルエットで新しい表現を探し続ける研究肌。要素数は少なくても、着る服の完成度には常に貪欲で妥協を良しとしない。',
  },
  '-+-+': {
    id: '-+-+',
    name: '静謐積層koki',
    tagline: '整えたモノトーンを、静かに重ねる',
    description:
      'モノトーンの端正な型を守りながら、ベストやストール、小物を丁寧に重ねるタイプ。目立つ変化より奥行きを好み、いつもの装いを少しずつ整えていく。準備周到で、静かな安定感がある。',
  },
  '-+--': {
    id: '-+--',
    name: '静謐派koki',
    tagline: '磨き上げた「いつもの正装」を崩さない',
    description:
      'モノトーンできちんと感のある装いを、身軽で確立した型のまま淡々と継続するタイプ。飾らないが隙もない、静かな安定感が最大の武器。周囲からの信頼も厚い。',
  },
  '--++': {
    id: '--++',
    name: '脱力積層koki',
    tagline: 'ラフなモノトーンに、発見を重ねる',
    description:
      'ラフなモノトーンをキャンバスに、丈の差や素材感、小物の組み合わせを次々と試すタイプ。気負いはないのに仕掛けは多く、重ねるほど個性が現れる。見る人が見ればわかる実験精神の持ち主。',
  },
  '--+-': {
    id: '--+-',
    name: '脱力実験koki',
    tagline: '身軽なモノトーンに、毎回新しい発見を',
    description:
      '力の抜けた身軽な格好を好みつつ、素材感や主役アイテムでは常に新しいものを試したがる。飾らない中に潜む一手を、見る人が見ればわかるタイプ。',
  },
  '---+': {
    id: '---+',
    name: '快適重ねkoki',
    tagline: '着心地のいい定番を、安心できるだけ重ねる',
    description:
      'モノトーンの着慣れた服を重ね、気温差や予定の変化にも備えておきたい安定志向。おしゃれのために無理はしないが、羽織りものや小物があると落ち着く。快適さを積み上げるのが得意。',
  },
  '----': {
    id: '----',
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
    (scores.adventurous >= 0 ? '+' : '-') +
    (scores.layered >= 0 ? '+' : '-')
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
