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
  /** 自動判定した色の手動補正: itemId -> 色バケツ名（'' で「色なし」に固定） */
  colors: Record<string, string>
}

/** 色バケツの定義（src/data/colors.json の buckets と一致） */
export type ColorBucket = {
  name: string // 内部名（white, navy など）
  label: string // 表示名（白, ネイビー など）
  swatch: string // チップに出す代表色 hex
}

/** 代表画像から自動判定した色（src/data/colors.json） */
export type ColorsFile = {
  version: number
  buckets: ColorBucket[]
  items: Record<string, string> // displayId -> 色バケツ名
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
  /** 色バケツ名（自動判定 + 手動補正後）。未判定は undefined */
  color?: string
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
