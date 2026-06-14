// コーデ写真をつないでタイムラプス動画(MP4/GIF)を書き出す
// usage:
//   node scripts/timelapse.mjs                                  # 全コーデ、約90秒のMP4
//   node scripts/timelapse.mjs --item "shoes|jmweston#black-loafer" --duration 15
//   node scripts/timelapse.mjs --from 2024-01-01 --to 2024-12-31 --format gif
// options:
//   --item <id>        アイテムID or 個体ID（"base#sub"）で絞り込み。その部位が写っている画像を優先
//   --from / --to      日付範囲 (YYYY-MM-DD)
//   --duration <sec>   全体の長さ（fpsを自動計算、デフォルト90秒）
//   --fps <n>          フレームレート直接指定（--durationより優先）
//   --width <px>       出力幅（正方形、デフォルト720）
//   --format mp4|gif   デフォルトmp4
//   --out <path>       出力先（デフォルト exports/timelapse-*.mp4）
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')
const FRAMES_DIR = path.join(ROOT, '.cache', 'timelapse-frames')
const EXPORTS = path.join(ROOT, 'exports')

// --- 引数 ---
const args = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const itemArg = opt('item')
const from = opt('from')
const to = opt('to')
const width = Number(opt('width', '720'))
const format = opt('format', 'mp4')
const duration = Number(opt('duration', '90'))

// --- データ読み込み ---
const outfits = JSON.parse(await readFile(path.join(ROOT, 'src/data/outfits.json'), 'utf8'))
let splits = { items: {} }
try {
  splits = JSON.parse(await readFile(path.join(ROOT, 'src/data/splits.json'), 'utf8'))
} catch {}

// 個体割当: baseId -> (outfitKey -> subId)
const splitAssign = new Map()
for (const [baseId, def] of Object.entries(splits.items ?? {})) {
  const m = new Map()
  for (const sub of def.subs) for (const k of sub.outfits) m.set(k, `${baseId}#${sub.key}`)
  splitAssign.set(baseId, m)
}

// --- フレーム選定（時系列昇順）---
const baseOfArg = itemArg?.split('#')[0]
const frames = outfits
  .slice()
  .sort((a, b) => (a.publishAt < b.publishAt ? -1 : 1))
  .filter((o) => {
    if (from && o.date < from) return false
    if (to && o.date > to) return false
    if (itemArg) {
      return o.itemIds.some((id) => {
        if (id !== baseOfArg && id !== itemArg) return false
        const resolved = splitAssign.get(id)?.get(o.key) ?? id
        return resolved === itemArg || id === itemArg
      })
    }
    return true
  })
  .map((o) => {
    // アイテム指定時はその部位が写っているfigureを優先
    const img = itemArg
      ? (o.images.find((im) => im.itemIds.includes(baseOfArg)) ?? o.images[0])
      : o.images[0]
    return img ? { no: o.no, date: o.date, url: img.url } : null
  })
  .filter(Boolean)

if (frames.length < 2) {
  console.error(`対象コーデが${frames.length}件しかありません`)
  process.exit(1)
}
const fps = Number(opt('fps')) || Math.max(2, Math.round(frames.length / duration))
console.log(`frames: ${frames.length} / fps: ${fps} → 約${Math.round(frames.length / fps)}秒`)

// --- 画像取得（contact-sheetと同じキャッシュ）---
async function fetchImage(url) {
  const file = path.join(IMG_CACHE, createHash('sha1').update(url).digest('hex') + '.jpg')
  try {
    await access(file)
    return file
  } catch {}
  const res = await fetch(`${url}?fit=bounds&quality=85&width=900`)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  await new Promise((r) => setTimeout(r, 100))
  return file
}

await mkdir(IMG_CACHE, { recursive: true })
await mkdir(EXPORTS, { recursive: true })
await rm(FRAMES_DIR, { recursive: true, force: true })
await mkdir(FRAMES_DIR, { recursive: true })

// --- フレーム生成（正方形cover + 日付焼き込み）---
const labelH = Math.round(width * 0.06)
const fontSize = Math.round(labelH * 0.62)
for (let i = 0; i < frames.length; i++) {
  const f = frames[i]
  const src = await fetchImage(f.url)
  const label = Buffer.from(
    `<svg width="${width}" height="${width}">
      <rect x="${width * 0.02}" y="${width - labelH * 1.5}" rx="${labelH * 0.5}" width="${fontSize * 8.2}" height="${labelH}" fill="rgba(0,0,0,0.55)"/>
      <text x="${width * 0.02 + fontSize * 0.7}" y="${width - labelH * 1.5 + labelH * 0.7}" font-family="Menlo, monospace" font-size="${fontSize}" fill="#fff">${f.date.replaceAll('-', '.')}</text>
    </svg>`,
  )
  await sharp(src)
    .resize(width, width, { fit: 'cover', position: 'centre' })
    .composite([{ input: label, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toFile(path.join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.jpg`))
  if (i % 25 === 0) process.stdout.write(`\rframe ${i + 1}/${frames.length}`)
}
console.log(`\rframes done: ${frames.length}        `)

// --- ffmpeg ---
const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '')
const slug = itemArg ? itemArg.replace(/[^a-z0-9]+/gi, '_') : 'all'
const outPath = opt('out') ?? path.join(EXPORTS, `timelapse-${slug}-${stamp}.${format}`)
const input = ['-framerate', String(fps), '-i', path.join(FRAMES_DIR, 'frame-%04d.jpg')]

let ff
if (format === 'gif') {
  const palette = path.join(FRAMES_DIR, 'palette.png')
  spawnSync('ffmpeg', ['-y', ...input, '-vf', 'scale=480:-1,palettegen', palette], { stdio: 'inherit' })
  ff = spawnSync(
    'ffmpeg',
    ['-y', ...input, '-i', palette, '-lavfi', 'scale=480:-1 [x]; [x][1:v] paletteuse', outPath],
    { stdio: 'inherit' },
  )
} else {
  ff = spawnSync(
    'ffmpeg',
    ['-y', ...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath],
    { stdio: 'inherit' },
  )
}
if (ff.status !== 0) {
  console.error('ffmpeg failed')
  process.exit(1)
}
console.log(`\n→ ${outPath}`)
