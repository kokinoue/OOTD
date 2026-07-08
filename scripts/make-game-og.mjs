// ゲーム別OGP画像 public/og-{memory,duel,platform,tower}.png (1200x630) を生成する。
// 素材はローカルの public/cutouts/*.webp（透過切り抜き）のみ。ネットワーク不要。
// 各ゲームの実際の配色（カード裏の濃紺・季節色・Canvasのクリーム地など）を再現する。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200
const H = 630

const cutouts = JSON.parse(await readFile(path.join(ROOT, 'src/data/cutouts.json'), 'utf8'))

// 立ち姿として使いやすい縦長シルエットだけに絞り、全体から等間隔に選ぶ（決定的）
const keys = Object.keys(cutouts.sprites)
  .filter((k) => {
    const s = cutouts.sprites[k]
    return s.w >= 70 && s.w <= 135
  })
  .sort()
const pick = (i, count) => keys[Math.floor(((i + 0.5) / count) * keys.length)]
const PICKS = Array.from({ length: 9 }, (_, i) => pick(i, 9))

async function sprite(key, height, rotate = 0) {
  let img = sharp(path.join(ROOT, 'public/cutouts', `${key}.webp`)).resize({ height })
  if (rotate) {
    const buf = await img.png().toBuffer()
    img = sharp(buf).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  }
  const buf = await img.png().toBuffer()
  const meta = await sharp(buf).metadata()
  return { buf, w: meta.width, h: meta.height }
}

// 中心座標で composite の left/top を算出
const at = (s, cx, cy) => ({ input: s.buf, left: Math.round(cx - s.w / 2), top: Math.round(cy - s.h / 2) })

const svg = (body) => Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)

// 下部を暗くして白タイトルを載せる（ダーク背景用）
const darkTitle = (title, tag) =>
  svg(`
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.5" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.78)"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <text x="60" y="${H - 78}" font-family="Helvetica, Arial, sans-serif" font-size="68" font-weight="600" fill="#fff" letter-spacing="8">${title}</text>
    <text x="62" y="${H - 34}" font-family="Menlo, monospace" font-size="23" fill="#fff" opacity="0.85" letter-spacing="3">${tag} · 出勤服アーカイブ GAME</text>
  `)

async function save(name, background, layers, overlay) {
  await sharp({ create: { width: W, height: H, channels: 4, background } })
    .composite([...layers, { input: overlay, left: 0, top: 0 }])
    .png()
    .toFile(path.join(ROOT, 'public', `og-${name}.png`))
  console.log(`public/og-${name}.png`)
}

// ---- 神経衰弱: 濃紺のカード裏がならぶ場に2枚だけ表 --------------------------
async function memory() {
  const CARD_W = 150
  const CARD_H = 200
  const GAP = 20
  const cardBack = `
    <defs><linearGradient id="cb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2e48"/><stop offset="1" stop-color="#181a2b"/>
    </linearGradient></defs>
    <rect x="1" y="1" width="${CARD_W - 2}" height="${CARD_H - 2}" rx="14" fill="url(#cb)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
    <path d="M ${CARD_W / 2} 55 L ${CARD_W / 2 + 34} ${CARD_H / 2} L ${CARD_W / 2} ${CARD_H - 55} L ${CARD_W / 2 - 34} ${CARD_H / 2} Z" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>`
  const cardFace = `<rect x="1" y="1" width="${CARD_W - 2}" height="${CARD_H - 2}" rx="14" fill="#f6f5f0" stroke="#3b5bdb" stroke-width="4"/>`
  const cardSvg = (body) =>
    Buffer.from(`<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)

  const flipped = new Set([2, 10]) // (row0,col2) と (row1,col4)
  const layers = []
  const startX = Math.round((W - (CARD_W * 6 + GAP * 5)) / 2)
  for (let i = 0; i < 12; i++) {
    const col = i % 6
    const row = Math.floor(i / 6)
    const left = startX + col * (CARD_W + GAP)
    const top = 36 + row * (CARD_H + GAP)
    if (flipped.has(i)) {
      const sp = await sprite(PICKS[flipped.size === 2 && i === 2 ? 0 : 1], 168)
      const face = await sharp(cardSvg(cardFace))
        .composite([at(sp, CARD_W / 2, CARD_H / 2 + 4)])
        .png()
        .toBuffer()
      layers.push({ input: face, left, top })
    } else {
      layers.push({ input: cardSvg(cardBack), left, top })
    }
  }
  await save('memory', '#14162b', layers, darkTitle('神経衰弱', 'CONCENTRATION'))
}

// ---- デュエル: 季節色フレームのカード2枚が対峙 ------------------------------
async function duel() {
  const CARD_W = 290
  const CARD_H = 400
  const card = async (key, color, season, atk, hp) => {
    const face = Buffer.from(`<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="${CARD_W - 4}" height="${CARD_H - 4}" rx="18" fill="#ffffff" stroke="${color}" stroke-width="5"/>
      <rect x="18" y="18" width="${CARD_W - 36}" height="34" rx="8" fill="${color}"/>
      <text x="${CARD_W / 2}" y="42" text-anchor="middle" font-family="Menlo, monospace" font-size="19" font-weight="bold" fill="#fff" letter-spacing="4">${season}</text>
      <rect x="18" y="${CARD_H - 54}" width="${CARD_W - 36}" height="36" rx="8" fill="#f1f0ea"/>
      <text x="34" y="${CARD_H - 28}" font-family="Menlo, monospace" font-size="21" font-weight="bold" fill="#161616">ATK ${atk}</text>
      <text x="${CARD_W - 34}" y="${CARD_H - 28}" text-anchor="end" font-family="Menlo, monospace" font-size="21" font-weight="bold" fill="#c0392b">HP ${hp}</text>
    </svg>`)
    const sp = await sprite(key, 270)
    return sharp(face)
      .composite([at(sp, CARD_W / 2, CARD_H / 2 + 6)])
      .png()
      .toBuffer()
  }
  const rot = async (buf, angle) => {
    const b = await sharp(buf).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
    const m = await sharp(b).metadata()
    return { buf: b, w: m.width, h: m.height }
  }
  const left = await rot(await card(PICKS[2], '#2f93c8', 'SUMMER', 5, 7), -8)
  const right = await rot(await card(PICKS[3], '#cf7b3a', 'AUTUMN', 6, 6), 8)
  const vs = svg(`
    <text x="${W / 2}" y="300" text-anchor="middle" font-family="Menlo, monospace" font-size="96" font-weight="bold" fill="#fff" opacity="0.95" letter-spacing="6">VS</text>
    <rect x="60" y="48" width="300" height="16" rx="8" fill="rgba(255,255,255,0.25)"/>
    <rect x="60" y="48" width="220" height="16" rx="8" fill="#2e8b6f"/>
    <rect x="${W - 360}" y="48" width="300" height="16" rx="8" fill="rgba(255,255,255,0.25)"/>
    <rect x="${W - 360 + 90}" y="48" width="210" height="16" rx="8" fill="#c0392b"/>
  `)
  const layers = [
    { input: vs, left: 0, top: 0 },
    at(left, 310, 285),
    at(right, 890, 285),
  ]
  await save('duel', '#181a20', layers, darkTitle('デュエル', 'CARD BATTLE'))
}

// ---- ランウェイ: クリーム地にタイル・コイン・ドア、跳ぶ主人公 ----------------
async function platform() {
  const GROUND_Y = 480
  const scene = svg(`
    <rect x="0" y="${GROUND_Y}" width="${W}" height="${H - GROUND_Y}" fill="#3a3a41"/>
    <rect x="0" y="${GROUND_Y}" width="${W}" height="12" fill="#4d4d57"/>
    <rect x="660" y="300" width="230" height="34" rx="4" fill="#3a3a41"/>
    <rect x="660" y="300" width="230" height="10" rx="4" fill="#4d4d57"/>
    ${[0, 1, 2]
      .map((i) => {
        const cx = 420 + i * 70
        const cy = i === 1 ? 208 : 240
        return `<circle cx="${cx}" cy="${cy}" r="19" fill="#e8a33d"/><circle cx="${cx}" cy="${cy}" r="10" fill="#f6c86a"/>`
      })
      .join('')}
    ${[0, 1, 2]
      .map((i) => `<path d="M ${840 + i * 44} ${GROUND_Y} L ${862 + i * 44} ${GROUND_Y - 38} L ${884 + i * 44} ${GROUND_Y} Z" fill="#a34040"/>`)
      .join('')}
    <rect x="1044" y="${GROUND_Y - 118}" width="76" height="118" rx="6" fill="#69ac6c"/>
    <rect x="1054" y="${GROUND_Y - 108}" width="56" height="108" rx="4" fill="#4c8a50"/>
    <circle cx="1102" cy="${GROUND_Y - 58}" r="5" fill="#f1eee3"/>
  `)
  const hero = await sprite(PICKS[4], 265, -14)
  const title = svg(`
    <text x="60" y="${H - 68}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="600" fill="#f1eee3" letter-spacing="8">ランウェイ</text>
    <text x="62" y="${H - 26}" font-family="Menlo, monospace" font-size="23" fill="#f1eee3" opacity="0.8" letter-spacing="3">PLATFORMER · 出勤服アーカイブ GAME</text>
  `)
  await save('platform', '#f1eee3', [{ input: scene, left: 0, top: 0 }, at(hero, 250, 235)], title)
}

// ---- タワー: 台座の上にくり抜きを物理積み ------------------------------------
async function tower() {
  const scene = svg(`
    <rect x="660" y="556" width="340" height="74" fill="#3a3a41"/>
    <rect x="660" y="556" width="340" height="12" fill="#4d4d57"/>
    <line x1="80" y1="86" x2="${W - 80}" y2="86" stroke="rgba(0,0,0,0.28)" stroke-width="3" stroke-dasharray="14 12"/>
    <text x="${W - 84}" y="70" text-anchor="end" font-family="Menlo, monospace" font-size="24" fill="#3a3a41" letter-spacing="3">BEST 4.2m</text>
  `)
  const stack = [
    { key: PICKS[5], h: 165, rot: 4, cx: 826, cy: 482 },
    { key: PICKS[6], h: 160, rot: -9, cx: 848, cy: 386 },
    { key: PICKS[7], h: 158, rot: 12, cx: 816, cy: 290 },
    { key: PICKS[8], h: 150, rot: -6, cx: 842, cy: 196 },
  ]
  const layers = [{ input: scene, left: 0, top: 0 }]
  for (const s of stack) layers.push(at(await sprite(s.key, s.h, s.rot), s.cx, s.cy))
  const title = svg(`
    <text x="60" y="${H - 78}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="600" fill="#161616" letter-spacing="8">タワー</text>
    <text x="62" y="${H - 36}" font-family="Menlo, monospace" font-size="23" fill="#161616" opacity="0.7" letter-spacing="3">PHYSICS PUZZLE · 出勤服アーカイブ GAME</text>
  `)
  await save('tower', '#f1eee3', layers, title)
}

await memory()
await duel()
await platform()
await tower()
