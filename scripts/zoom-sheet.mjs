// 指定コーデ#番号の該当部位を大きめセルで並べる確認用シート
// usage: node scripts/zoom-sheet.mjs "<itemId>" <no,no,...> [outName]
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
  shoes: { left: 0.28, top: 0.76, width: 0.44, height: 0.24 },
  cap: { left: 0.32, top: 0.02, width: 0.36, height: 0.22 },
  bag: { left: 0.08, top: 0.28, width: 0.84, height: 0.5 },
  default: { left: 0.22, top: 0.12, width: 0.56, height: 0.46 },
}
const CELL = 440
const COLS = 4
const LABEL_H = 30

const [itemId, nosArg, outName] = process.argv.slice(2)
const nos = nosArg.split(',').map(Number)
const region = REGIONS[itemId.split('|')[0]] ?? REGIONS.default

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

const cells = []
for (const no of nos) {
  const o = outfits.find((x) => x.no === no)
  const img = o?.images.find((im) => im.itemIds.includes(itemId)) ?? o?.images[0]
  if (!img) continue
  const im = await fetchImage(img.url)
  const meta = await im.metadata()
  const left = Math.round(meta.width * region.left)
  const top = Math.round(meta.height * region.top)
  const width = Math.min(Math.round(meta.width * region.width), meta.width - left)
  const height = Math.min(Math.round(meta.height * region.height), meta.height - top)
  const cell = await im
    .extract({ left, top, width, height })
    .resize(CELL, CELL, { fit: 'cover', position: 'centre' })
    .toBuffer()
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#111"/><text x="8" y="21" font-family="Menlo, monospace" font-size="16" fill="#fff">#${no}  ${o.date}</text></svg>`,
  )
  cells.push(
    await sharp({ create: { width: CELL, height: CELL + LABEL_H, channels: 3, background: '#111' } })
      .composite([
        { input: cell, top: 0, left: 0 },
        { input: label, top: CELL, left: 0 },
      ])
      .png()
      .toBuffer(),
  )
}
const rows = Math.ceil(cells.length / COLS)
const W = COLS * (CELL + 8) + 8
const H = rows * (CELL + LABEL_H + 8) + 8
await sharp({ create: { width: W, height: H, channels: 3, background: '#2a2a2a' } })
  .composite(cells.map((c, i) => ({ input: c, left: 8 + (i % COLS) * (CELL + 8), top: 8 + Math.floor(i / COLS) * (CELL + LABEL_H + 8) })))
  .png()
  .toFile(path.join(OUT, `${outName ?? 'zoom'}.png`))
console.log(`.cache/sheets/${outName ?? 'zoom'}.png (${cells.length} cells)`)
