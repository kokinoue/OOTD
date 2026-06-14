// 指定アイテムの着用コーデ写真から該当部位をクロップして一覧画像を作る
// usage: node scripts/contact-sheet.mjs "pants|maisonmartinmargiela" ["shoes|adidas" ...]
//        node scripts/contact-sheet.mjs --min-count 12   # 対象アイテム一括生成
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.cache', 'sheets')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')

// 写真は毎回ほぼ同じ構図（全身・正面）なので、カテゴリごとの固定領域クロップで足りる
const REGIONS = {
  pants: { left: 0.28, top: 0.42, width: 0.44, height: 0.46 },
  shorts: { left: 0.28, top: 0.42, width: 0.44, height: 0.34 },
  shoes: { left: 0.28, top: 0.76, width: 0.44, height: 0.24 },
  boots: { left: 0.28, top: 0.74, width: 0.44, height: 0.26 },
  cap: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  hat: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  'knit cap': { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  beanie: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  glasses: { left: 0.34, top: 0.06, width: 0.32, height: 0.18 },
  bag: { left: 0.08, top: 0.28, width: 0.84, height: 0.5 },
  default: { left: 0.22, top: 0.12, width: 0.56, height: 0.46 }, // トップス類
}

const CELL = 240
const COLS = 5
const ROWS = 5
const LABEL_H = 26

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'outfits.json'), 'utf8'))
await mkdir(OUT, { recursive: true })
await mkdir(IMG_CACHE, { recursive: true })

async function fetchImage(url) {
  const file = path.join(IMG_CACHE, createHash('sha1').update(url).digest('hex') + '.jpg')
  try {
    await access(file)
    return sharp(file)
  } catch {}
  const res = await fetch(`${url}?fit=bounds&quality=85&width=900`)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(file, buf)
  return sharp(buf)
}

async function cropCell(t, region) {
  const img = await fetchImage(t.url)
  const meta = await img.metadata()
  const left = Math.round(meta.width * region.left)
  const top = Math.round(meta.height * region.top)
  const width = Math.min(Math.round(meta.width * region.width), meta.width - left)
  const height = Math.min(Math.round(meta.height * region.height), meta.height - top)
  const cell = await img
    .extract({ left, top, width, height })
    .resize(CELL, CELL, { fit: 'cover', position: 'centre' })
    .toBuffer()
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL_H}">
      <rect width="100%" height="100%" fill="#111"/>
      <text x="8" y="18" font-family="Menlo, monospace" font-size="14" fill="#fff">#${t.no}  ${t.date}</text>
    </svg>`,
  )
  return sharp({
    create: { width: CELL, height: CELL + LABEL_H, channels: 3, background: '#111' },
  })
    .composite([
      { input: cell, top: 0, left: 0 },
      { input: label, top: CELL, left: 0 },
    ])
    .png()
    .toBuffer()
}

async function generate(itemId) {
  const category = itemId.split('|')[0]
  const region = REGIONS[category] ?? REGIONS.default

  // このアイテムが写っている画像（itemIdsに含まれるfigure）を新しい順に集める
  const targets = []
  for (const o of outfits) {
    const img = o.images.find((im) => im.itemIds.includes(itemId))
    if (img) targets.push({ no: o.no, date: o.date, key: o.key, url: img.url })
  }
  if (targets.length === 0) {
    console.error('no outfits found for', itemId)
    return
  }

  const cells = []
  for (const t of targets) {
    try {
      cells.push({ t, buf: await cropCell(t, region) })
    } catch (e) {
      console.error(`skip #${t.no}: ${e.message}`)
    }
  }

  const perSheet = COLS * ROWS
  const safeName = itemId.replace(/[^a-z0-9]+/gi, '_')
  const sheetCount = Math.ceil(cells.length / perSheet)
  for (let s = 0; s * perSheet < cells.length; s++) {
    const chunk = cells.slice(s * perSheet, (s + 1) * perSheet)
    const rows = Math.ceil(chunk.length / COLS)
    const W = COLS * (CELL + 8) + 8
    const H = rows * (CELL + LABEL_H + 8) + 8
    const composites = chunk.map((c, i) => ({
      input: c.buf,
      left: 8 + (i % COLS) * (CELL + 8),
      top: 8 + Math.floor(i / COLS) * (CELL + LABEL_H + 8),
    }))
    await sharp({ create: { width: W, height: H, channels: 3, background: '#2a2a2a' } })
      .composite(composites)
      .png()
      .toFile(path.join(OUT, `${safeName}-${s + 1}.png`))
  }
  await writeFile(
    path.join(OUT, `${safeName}.json`),
    JSON.stringify({ itemId, targets: targets.map(({ no, date, key }) => ({ no, date, key })) }),
    'utf8',
  )
  console.log(`${itemId}: ${targets.length} outfits -> ${sheetCount} sheets`)
}

// --- main ---
const args = process.argv.slice(2)
let ids = []
if (args[0] === '--min-count') {
  const min = Number(args[1] ?? 12)
  const items = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'items.json'), 'utf8'))
  ids = items.filter((it) => it.count >= min).map((it) => it.id)
  console.log(`${ids.length} items with count >= ${min}`)
} else {
  ids = args
}
if (ids.length === 0) {
  console.error('usage: node scripts/contact-sheet.mjs "<itemId>" [...] | --min-count N')
  process.exit(1)
}
for (const id of ids) await generate(id)
