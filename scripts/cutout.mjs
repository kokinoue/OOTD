// コーデ写真から人物をくり抜いた透過スプライトを生成する（プラットフォームゲーム用）
// usage:
//   node scripts/cutout.mjs                 # 全コーデ（生成済みはスキップ）
//   node scripts/cutout.mjs --key n6b36339c3482
//   node scripts/cutout.mjs --limit 10      # 新しい順に10件だけ
//   node scripts/cutout.mjs --force         # 生成済みも作り直す
// 出力:
//   public/cutouts/{outfitKey}.webp  … 透過スプライト（高さ SPRITE_H px、余白トリム済み）
//   src/data/cutouts.json            … マニフェスト（key -> {w,h}）
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { removeBackground } from '@imgly/background-removal-node'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')
const OUT_DIR = path.join(ROOT, 'public', 'cutouts')
const MANIFEST = path.join(ROOT, 'src', 'data', 'cutouts.json')

const SPRITE_H = 240 // ゲーム内で縮小して使うので原寸は持たない

const args = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const keyArg = opt('key')
const limit = Number(opt('limit', '0'))
const force = args.includes('--force')

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src/data/outfits.json'), 'utf8'))

let targets = outfits
  .slice()
  .sort((a, b) => (a.publishAt < b.publishAt ? 1 : -1))
  .map((o) => ({ key: o.key, url: o.images[0]?.url }))
  .filter((t) => t.url)
if (keyArg) targets = targets.filter((t) => t.key === keyArg)
if (limit > 0) targets = targets.slice(0, limit)

await mkdir(IMG_CACHE, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })

let manifest = { version: 1, spriteHeight: SPRITE_H, sprites: {} }
try {
  manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
} catch {}

const exists = (p) => access(p).then(() => true, () => false)

async function fetchImage(url) {
  const file = path.join(IMG_CACHE, createHash('sha1').update(url).digest('hex') + '.jpg')
  if (!(await exists(file))) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${res.status}: ${url}`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}

let done = 0
let skipped = 0
let failed = 0
for (const t of targets) {
  const outFile = path.join(OUT_DIR, `${t.key}.webp`)
  if (!force && (await exists(outFile)) && manifest.sprites[t.key]) {
    skipped++
    continue
  }
  try {
    const src = await fetchImage(t.url)
    const blob = await removeBackground(src, { output: { format: 'image/png' } })
    const png = Buffer.from(await blob.arrayBuffer())
    // 透過部分をトリムして人物のバウンディングボックスだけにし、ゲーム用サイズへ縮小
    const sprite = sharp(png).trim().resize({ height: SPRITE_H, fit: 'inside' })
    const { data, info } = await sprite
      .webp({ quality: 82, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true })
    // 人物がほぼ検出できなかった画像（極端に細い/小さい）はゲームに出さない
    if (info.width < 40) {
      failed++
      console.log(`skip (too narrow: ${info.width}px) ${t.key}`)
      continue
    }
    await writeFile(outFile, data)
    manifest.sprites[t.key] = { w: info.width, h: info.height }
    done++
    if (done % 10 === 0) {
      await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
      console.log(`... ${done} done / ${skipped} skipped / ${failed} failed`)
    }
  } catch (e) {
    failed++
    console.log(`fail ${t.key}: ${e.message}`)
  }
}

// キーを安定した順序（outfits.json の順）で書き出す
const order = new Map(outfits.map((o, i) => [o.key, i]))
manifest.sprites = Object.fromEntries(
  Object.entries(manifest.sprites).sort(
    (a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9),
  ),
)
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`cutout: ${done} generated, ${skipped} skipped, ${failed} failed → ${OUT_DIR}`)
