// アイテムの代表画像（最新着用コーデの該当部位）から主要色を判定し、src/data/colors.json を生成する。
// useData.ts の rep 画像選択ロジックを splits 適用で再現し、表示IDごとに色を付ける。
// usage: node scripts/extract-colors.mjs
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'src', 'data')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')

// regions.ts / contact-sheet.mjs と同じ意図のカテゴリ別クロップ領域（割合）
const REGIONS = {
  pants: { left: 0.28, top: 0.42, width: 0.44, height: 0.46 },
  shorts: { left: 0.28, top: 0.42, width: 0.44, height: 0.34 },
  shoes: { left: 0.28, top: 0.76, width: 0.44, height: 0.24 },
  boots: { left: 0.28, top: 0.74, width: 0.44, height: 0.26 },
  cap: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  hat: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  'knit cap': { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  beanie: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  glasses: { left: 0.34, top: 0.06, width: 0.32, height: 0.18 },
  bag: { left: 0.08, top: 0.3, width: 0.84, height: 0.5 },
  default: { left: 0.22, top: 0.12, width: 0.56, height: 0.46 },
}
const regionFor = (category) => REGIONS[category] ?? REGIONS.default

// UI に出す色バケツ。順序は表示順。swatch はバケツの代表色（実際の平均色ではなく見やすい固定色）
export const COLOR_BUCKETS = [
  { name: 'white', label: '白', swatch: '#f4f2ec' },
  { name: 'beige', label: 'ベージュ', swatch: '#cbb893' },
  { name: 'gray', label: 'グレー', swatch: '#9a9a9a' },
  { name: 'black', label: '黒', swatch: '#2a2a2a' },
  { name: 'brown', label: '茶', swatch: '#7a513a' },
  { name: 'navy', label: 'ネイビー', swatch: '#27324f' },
  { name: 'blue', label: '青', swatch: '#3f6fb0' },
  { name: 'green', label: '緑', swatch: '#5a7d54' },
  { name: 'yellow', label: '黄', swatch: '#d8c24a' },
  { name: 'orange', label: 'オレンジ', swatch: '#cf7b3a' },
  { name: 'red', label: '赤', swatch: '#b5453f' },
  { name: 'pink', label: 'ピンク', swatch: '#d68aa0' },
  { name: 'purple', label: '紫', swatch: '#7a5a93' },
]

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h * 360, s, l]
}

// 1ピクセルの色を13バケツのどれかに分類する
function classifyPixel(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  // 無彩色系（彩度が低い）。暖色寄りの低彩度はベージュ／茶として救う
  if (s < 0.18) {
    if (l >= 0.74) return 'white'
    if (l <= 0.28) return 'black'
    return 'gray'
  }
  // 暖色帯（赤橙〜黄）の中・低彩度はベージュ／茶（生地の地色になりやすい）
  if (h >= 16 && h <= 55 && s < 0.5) {
    if (l >= 0.6) return 'beige'
    if (l <= 0.34) return 'brown'
    return s < 0.32 ? (l >= 0.5 ? 'beige' : 'brown') : 'brown'
  }
  // 有彩色を色相で分類
  if (h < 16 || h >= 345) return 'red'
  if (h < 45) return 'orange'
  if (h < 68) return 'yellow'
  if (h < 165) return 'green'
  if (h < 255) {
    // 青系。暗めかつ彩度が高すぎないものはネイビー
    return l <= 0.34 && s <= 0.75 ? 'navy' : 'blue'
  }
  if (h < 295) return 'purple'
  return 'pink'
}

async function fetchImage(url) {
  const file = path.join(IMG_CACHE, createHash('sha1').update(url).digest('hex') + '.jpg')
  try {
    await access(file)
    return sharp(file)
  } catch {}
  const res = await fetch(`${url}?fit=bounds&quality=85&width=600`)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(file, buf)
  return sharp(buf)
}

// 代表画像の該当領域の中央寄りをクロップ→小さくリサイズ→彩度重み付き多数決でバケツを決める。
// 領域端には背景や舗装が入りやすいので中央 64% に絞る。彩度の高い画素は重みを増やし、
// 明確な色物が地色ノイズに負けないようにする（無彩色が本当に多数なら無彩色が勝つ）。
async function dominantColor(url, category) {
  const img = await fetchImage(url)
  const meta = await img.metadata()
  const region = regionFor(category)
  const left = Math.round(meta.width * (region.left + region.width * 0.18))
  const top = Math.round(meta.height * (region.top + region.height * 0.18))
  const width = Math.min(Math.round(meta.width * region.width * 0.64), meta.width - left)
  const height = Math.min(Math.round(meta.height * region.height * 0.64), meta.height - top)
  const { data, info } = await img
    .extract({ left, top, width, height })
    .resize(20, 20, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const ch = info.channels
  const weights = new Map()
  for (let i = 0; i < data.length; i += ch) {
    const a = ch === 4 ? data[i + 3] : 255
    if (a < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const bucket = classifyPixel(r, g, b)
    const [, s] = rgbToHsl(r, g, b)
    // 彩度が高い画素ほど「その色を意図して着ている」可能性が高いので重みを上げる
    const w = 1 + s * 4
    weights.set(bucket, (weights.get(bucket) ?? 0) + w)
  }
  let best = null
  let bestW = -1
  for (const [bucket, w] of weights) {
    if (w > bestW) {
      best = bucket
      bestW = w
    }
  }
  return best
}

// --- useData.ts の rep 画像選択を splits 適用で再現（merges/rename は色に無関係なので未適用） ---
const outfits = JSON.parse(await readFile(path.join(DATA, 'outfits.json'), 'utf8'))
const splits = JSON.parse(await readFile(path.join(DATA, 'splits.json'), 'utf8'))

const splitAssign = new Map() // baseId -> Map(outfitKey -> subId)
for (const [baseId, def] of Object.entries(splits.items ?? {})) {
  const assign = new Map()
  for (const sub of def.subs) for (const key of sub.outfits) assign.set(key, `${baseId}#${sub.key}`)
  if (def.subs.length > 0) splitAssign.set(baseId, assign)
}
const resolveDisplayId = (baseId, outfitKey) =>
  splits.moves?.[baseId]?.[outfitKey] ?? splitAssign.get(baseId)?.get(outfitKey) ?? baseId

// 表示ID -> { url, category }（最初に出会った＝最新の着用が代表）
const rep = new Map()
for (const o of outfits) {
  for (const baseId of o.itemIds) {
    const displayId = resolveDisplayId(baseId, o.key)
    if (rep.has(displayId)) continue
    const img = o.images.find((im) => im.itemIds.includes(baseId))
    if (img) rep.set(displayId, { url: img.url, category: displayId.split('|')[0] })
  }
}

await mkdir(IMG_CACHE, { recursive: true })

const colors = {}
let done = 0
const entries = [...rep.entries()]
for (const [id, { url, category }] of entries) {
  try {
    const name = await dominantColor(url, category)
    if (name) colors[id] = name
  } catch (e) {
    console.error(`skip ${id}: ${e.message}`)
  }
  if (++done % 25 === 0) console.log(`  ${done}/${entries.length}`)
}

// バケツ定義も同梱して UI 側のチップ生成に使う
const out = {
  version: 1,
  buckets: COLOR_BUCKETS,
  items: Object.fromEntries(Object.entries(colors).sort(([a], [b]) => a.localeCompare(b))),
}
await writeFile(path.join(DATA, 'colors.json'), JSON.stringify(out), 'utf8')
console.log(`colors.json: ${Object.keys(colors).length} items`)
