export type OutfitImage = {
  url: string
  width: number | null
  height: number | null
  caption: string
  itemIds: string[]
}

export type Outfit = {
  key: string
  no: number | null
  title: string
  date: string // YYYY-MM-DD
  publishAt: string
  like: number
  comment: string
  noteUrl: string
  images: OutfitImage[]
  itemIds: string[]
}

export type Item = {
  id: string
  category: string
  label: string
  count: number
  firstDate: string
  lastDate: string
}

/** localStorage に保存するユーザー編集（元データは書き換えない） */
export type Overrides = {
  renames: Record<string, string>
  categories: Record<string, string>
  merges: Record<string, string> // fromId -> toId
  hidden: string[]
}

/** マージ解決・編集適用後の表示用アイテム */
export type EffectiveItem = {
  id: string
  category: string
  label: string
  count: number // 着用コーデ数（編集適用後に再計算）
  firstDate: string
  lastDate: string
  hidden: boolean
  mergedFrom: string[] // このアイテムに統合された元アイテムのラベル
  /** 最新着用コーデの該当figure画像（一覧サムネ用） */
  rep?: { url: string; outfitKey: string }
}

/** 1コーデの髪まわりタグ（髪色・髪型・帽子）。各フィールドは null=未設定/該当なし */
export type HairTag = {
  color: string | null // 髪色（例: 黒 / 茶 / 明るめ / 白髪まじり）。帽子で隠れて不明なら null
  style: string | null // 髪型（例: ショート / ミディアム / パーマ / 刈り上げ / 結び）
  hat: string | null // 帽子（例: キャップ / ニット帽 / ハット）。かぶっていなければ null
}

/**
 * 髪タグの保存ファイル（src/data/hair.json）。
 * auto = 画像AIの推定（scripts/classify-hair.mjs が書き込む）
 * manual = UIでの手動修正（auto より優先。outfit.key 単位）
 */
export type HairFile = {
  version: number
  auto: Record<string, HairTag>
  manual: Record<string, HairTag>
}

export type Meta = {
  scrapedAt: string
  outfitCount: number
  itemCount: number
  magazineUrl: string
}

/** 画像判定による個体分割の定義（src/data/splits.json） */
export type SplitSub = {
  key: string
  label: string
  outfits: string[] // 割り当てたコーデのkey
}

export type SplitsFile = {
  version: number
  items: Record<string, { subs: SplitSub[] }>
  /** 確認済みで単一個体と判断したアイテム（メンテ用メモ） */
  noSplit?: string[]
  /** 1着用だけを別アイテムへ付け替える（画像判定の訂正）: baseId -> (outfitKey -> 付け替え先ID) */
  moves?: Record<string, Record<string, string>>
}
