// 個体分割の「未分類」判定用シートを作る（contact-sheet.mjs の差分版）。
// 各subの見本セル（最新3枚、青ラベル）＋未分類セル（赤ラベル・#番号付き）を1枚に並べ、
// Claude が見比べて既存個体への割当か新規個体かを判定できるようにする。
// 判定結果は .cache/sheets/assignments.json に書き、merge-assignments.mjs で反映する。
// usage: node scripts/assign-sheet.mjs "<itemId>" [...]
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.cache', 'sheets')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')

const REGIONS = {
  pants: { left: 0.28, top: 0.42, width: 0.44, height: 0.46 },
  shorts: { left: 0.28, top: 0.42, width: 0.44, height: 0.34 },
  shoes: { left: 0.28, top: 0.76, width: 0.44, height: 0.24 },
  boots: { left: 0.28, top: 0.74, width: 0.44, height: 0.26 },
  cap: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  hat: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  bag: { left: 0.08, top: 0.28, width: 0.84, height: 0.5 },
  default: { left: 0.22, top: 0.12, width: 0.56, height: 0.46 },
}

const CELL = 240
const COLS = 6
const LABEL_H = 26

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'outfits.json'), 'utf8'))
const splits = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'splits.json'), 'utf8'))
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

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function cropCell(t, region, label, color) {
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
  const svg = Buffer.from(
    `<svg width="${CELL}" height="${LABEL_H}">
      <rect width="100%" height="100%" fill="${color}"/>
      <text x="6" y="18" font-family="Menlo, monospace" font-size="13" fill="#fff">${esc(label)}</text>
    </svg>`,
  )
  return sharp({ create: { width: CELL, height: CELL + LABEL_H, channels: 3, background: '#111' } })
    .composite([
      { input: cell, top: 0, left: 0 },
      { input: svg, top: CELL, left: 0 },
    ])
    .png()
    .toBuffer()
}

async function generate(itemId) {
  const category = itemId.split('|')[0]
  const region = REGIONS[category] ?? REGIONS.default
  const def = splits.items[itemId]
  if (!def) {
    console.error('not a split item:', itemId)
    return
  }
  const byKey = new Map()
  for (const o of outfits) {
    const img = o.images.find((im) => im.itemIds.includes(itemId))
    if (img) byKey.set(o.key, { no: o.no, date: o.date, key: o.key, url: img.url })
  }
  const assigned = new Set(def.subs.flatMap((s) => s.outfits))
  const unassigned = [...byKey.values()].filter((t) => !assigned.has(t.key))
  if (unassigned.length === 0) {
    console.log(itemId, ': no unassigned')
    return
  }

  const cells = []
  for (const sub of def.subs) {
    const refs = sub.outfits
      .map((k) => byKey.get(k))
      .filter(Boolean)
      .sort((a, b) => b.no - a.no)
      .slice(0, 3)
    for (const t of refs) {
      cells.push(await cropCell(t, region, `[${sub.key}] #${t.no}`, '#1a4d8f'))
    }
  }
  for (const t of unassigned) {
    cells.push(await cropCell(t, region, `? #${t.no} ${t.date}`, '#8f1a1a'))
  }

  const safeName = 'assign_' + itemId.replace(/[^a-z0-9]+/gi, '_')
  const perSheet = COLS * 6
  for (let s = 0; s * perSheet < cells.length; s++) {
    const chunk = cells.slice(s * perSheet, (s + 1) * perSheet)
    const rows = Math.ceil(chunk.length / COLS)
    const W = COLS * (CELL + 8) + 8
    const H = rows * (CELL + LABEL_H + 8) + 8
    const composites = chunk.map((c, i) => ({
      input: c,
      left: 8 + (i % COLS) * (CELL + 8),
      top: 8 + Math.floor(i / COLS) * (CELL + LABEL_H + 8),
    }))
    await sharp({ create: { width: W, height: H, channels: 3, background: '#2a2a2a' } })
      .composite(composites)
      .png()
      .toFile(path.join(OUT, `${safeName}-${s + 1}.png`))
  }
  console.log(
    `${itemId}: subs=[${def.subs.map((s) => s.key).join(', ')}] unassigned=${unassigned.length} -> ${Math.ceil(cells.length / perSheet)} sheet(s) (${safeName}-*.png)`,
  )
}

for (const id of process.argv.slice(2)) await generate(id)
