// 全コーデ写真の「頭まわり」をクロップしてコンタクトシート（一覧画像）を作る。
// 個体分割（contact-sheet.mjs）と同じ流儀で、生成したシートを Claude が見て
// 髪色・髪型・帽子を判定し、判定結果を .cache/sheets/hair-decisions.json に書く。
// その後 apply-hair.mjs で src/data/hair.json に反映する。
//
// usage:
//   node scripts/hair-sheets.mjs                 # 全コーデ分のシートを生成
//   node scripts/hair-sheets.mjs --per 24        # 1シートあたりの枚数（デフォルト 24）
//   node scripts/hair-sheets.mjs --only 1,2      # 指定シート番号だけ作り直す
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.cache', 'sheets')
const IMG_CACHE = path.join(ROOT, '.cache', 'images')

// 写真は毎回ほぼ同じ構図（全身・正面）なので頭部の固定領域クロップで足りる。
// 髪型・帽子が分かるよう頭＋肩までを広めに取る。
const REGION = { left: 0.28, top: 0.0, width: 0.44, height: 0.3 }

const CELL = 300
const COLS = 5
const LABEL_H = 28

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const PER = Number(argValue('--per', 20)) || 20
const ONLY = argValue('--only', null)
  ?.split(',')
  .map((n) => Number(n.trim()))
  .filter(Boolean)

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

async function cropCell(t) {
  const img = await fetchImage(t.url)
  const meta = await img.metadata()
  const left = Math.round(meta.width * REGION.left)
  const top = Math.round(meta.height * REGION.top)
  const width = Math.min(Math.round(meta.width * REGION.width), meta.width - left)
  const height = Math.min(Math.round(meta.height * REGION.height), meta.height - top)
  const cell = await img
    .extract({ left, top, width, height })
    .resize(CELL, CELL, { fit: 'cover', position: 'top' })
    .toBuffer()
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL_H}">
      <rect width="100%" height="100%" fill="#111"/>
      <text x="8" y="20" font-family="Menlo, monospace" font-size="15" fill="#fff">#${t.no}  ${t.date}</text>
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

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'outfits.json'), 'utf8'))
// 新しい順（outfits の並び）で、画像のあるコーデだけ
const targets = outfits
  .filter((o) => o.images?.[0]?.url)
  .map((o) => ({ no: o.no, date: o.date, key: o.key, url: o.images[0].url }))

const sheetCount = Math.ceil(targets.length / PER)
console.log(`${targets.length} コーデ → ${sheetCount} シート（${COLS}列 × ${PER}枚/シート）`)

// シートと、各セルの no→key 対応表（manifest）を書き出す
const manifest = []
for (let s = 0; s < sheetCount; s++) {
  const sheetNo = s + 1
  if (ONLY && !ONLY.includes(sheetNo)) continue
  const chunk = targets.slice(s * PER, (s + 1) * PER)
  const cells = []
  for (const t of chunk) {
    try {
      cells.push({ t, buf: await cropCell(t) })
    } catch (e) {
      console.error(`  skip #${t.no}: ${e.message}`)
    }
  }
  const rows = Math.ceil(cells.length / COLS)
  const W = COLS * (CELL + 8) + 8
  const H = rows * (CELL + LABEL_H + 8) + 8
  const composites = cells.map((c, i) => ({
    input: c.buf,
    left: 8 + (i % COLS) * (CELL + 8),
    top: 8 + Math.floor(i / COLS) * (CELL + LABEL_H + 8),
  }))
  await sharp({ create: { width: W, height: H, channels: 3, background: '#2a2a2a' } })
    .composite(composites)
    .png()
    .toFile(path.join(OUT, `hair-${sheetNo}.png`))
  console.log(`  hair-${sheetNo}.png (${cells.length}枚)`)
}

// manifest は全シート分を常に書き出す（apply 時の no→key 変換に使う）
for (let s = 0; s < sheetCount; s++) {
  for (const t of targets.slice(s * PER, (s + 1) * PER)) {
    manifest.push({ sheet: s + 1, no: t.no, date: t.date, key: t.key })
  }
}
await writeFile(
  path.join(OUT, 'hair-manifest.json'),
  JSON.stringify({ per: PER, cols: COLS, sheetCount, cells: manifest }, null, 2),
  'utf8',
)
console.log(`manifest: .cache/sheets/hair-manifest.json`)
