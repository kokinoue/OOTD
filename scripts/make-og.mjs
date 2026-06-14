// OGP画像 public/og.png (1200x630) を生成する。
// コーデ写真を時系列に等間隔サンプリングして帯状に並べ、左下にタイトルを重ねる。
import { createHash } from 'node:crypto'
import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')
const W = 1200
const H = 630
const COLS = 8
const ROWS = 3

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src/data/outfits.json'), 'utf8'))
const withImg = outfits.filter((o) => o.images[0]).sort((a, b) => (a.publishAt < b.publishAt ? -1 : 1))

async function fetchImage(url) {
  const file = path.join(IMG_CACHE, createHash('sha1').update(url).digest('hex') + '.jpg')
  try {
    await access(file)
    return file
  } catch {}
  const res = await fetch(`${url}?fit=bounds&quality=85&width=400`)
  if (!res.ok) throw new Error(`${res.status}`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  return file
}

await mkdir(IMG_CACHE, { recursive: true })

// 等間隔サンプリングで COLS*ROWS 枚
const n = COLS * ROWS
const picks = Array.from({ length: n }, (_, i) =>
  withImg[Math.floor((i / n) * withImg.length)],
)

const cw = Math.ceil(W / COLS)
const ch = Math.ceil(H / ROWS)
const tiles = []
for (let i = 0; i < picks.length; i++) {
  const src = await fetchImage(picks[i].images[0].url)
  const buf = await sharp(src).resize(cw, ch, { fit: 'cover', position: 'top' }).toBuffer()
  tiles.push({ input: buf, left: (i % COLS) * cw, top: Math.floor(i / COLS) * ch })
}

// 下半分を暗くするグラデーション + タイトル
const overlay = Buffer.from(
  `<svg width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.45" stop-color="rgba(0,0,0,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0.82)"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <text x="60" y="${H - 96}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="600" fill="#fff" letter-spacing="6">出勤服アーカイブ</text>
    <text x="62" y="${H - 52}" font-family="Menlo, monospace" font-size="24" fill="#fff" opacity="0.85" letter-spacing="3">DAILY FITS ARCHIVE · ${withImg.length} days · koki inoue</text>
  </svg>`,
)

await mkdir(path.join(ROOT, 'public'), { recursive: true })
await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } })
  .composite([...tiles, { input: overlay, left: 0, top: 0 }])
  .png()
  .toFile(path.join(ROOT, 'public', 'og.png'))

console.log(`public/og.png (${W}x${H}, ${withImg.length} outfits sampled)`)
