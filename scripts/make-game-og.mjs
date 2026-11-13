// ゲーム別OGP画像 public/og-{memory,duel,platform,tower,chari,quiz,slot,shiki}.png (1200x630) を生成する。
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

// ---- チャリ通: 朝の通勤路を自転車で跳ぶ主人公 ------------------------------
async function chari() {
  const roadY = 455
  const scene = svg(`
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#b9dcf2"/><stop offset="0.72" stop-color="#f3e7d3"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${roadY}" fill="url(#sky)"/>
    <circle cx="940" cy="105" r="52" fill="#ffefb7" opacity=".72"/>
    ${Array.from({ length: 10 }, (_, i) => {
      const x = i * 132 - 20
      const h = 55 + (i * 37) % 105
      return `<rect x="${x}" y="${roadY - 58 - h}" width="82" height="${h}" fill="#a8b2b3"/>
        <rect x="${x + 13}" y="${roadY - 45 - h}" width="10" height="${Math.max(18, h - 28)}" fill="#fff3c8" opacity=".35"/>`
    }).join('')}
    <rect x="0" y="${roadY}" width="500" height="${H - roadY}" fill="#3a3a41"/>
    <rect x="650" y="${roadY}" width="550" height="${H - roadY}" fill="#3a3a41"/>
    <rect x="0" y="${roadY}" width="500" height="11" fill="#4d4d57"/>
    <rect x="650" y="${roadY}" width="550" height="11" fill="#4d4d57"/>
    ${[0, 1, 2, 3].map((i) => `<circle cx="${515 + i * 42}" cy="${383 - Math.sin((i / 3) * Math.PI) * 62}" r="13" fill="#e8a33d" stroke="#f8d784" stroke-width="3"/>`).join('')}
    <path d="M 865 ${roadY} L 880 ${roadY - 40} L 895 ${roadY} Z" fill="#ed713e"/>
    <rect x="871" y="${roadY - 20}" width="18" height="6" fill="#f6eee0"/>
  `)
  const hero = await sprite(PICKS[4], 220, -10)
  const bike = svg(`
    <g transform="translate(350 386) rotate(-8)">
      <circle cx="-48" cy="20" r="39" fill="none" stroke="#202126" stroke-width="8"/>
      <circle cx="54" cy="20" r="39" fill="none" stroke="#202126" stroke-width="8"/>
      <path d="M-48 20 L-8 -25 L28 20 L-48 20 M-8 -25 L32 -31 L54 20 M-8 -25 L4 20 L28 20" fill="none" stroke="#436d78" stroke-width="8" stroke-linecap="round"/>
      <path d="M31 -31 L47 -48 L65 -48 M-20 -28 L0 -28" fill="none" stroke="#202126" stroke-width="6" stroke-linecap="round"/>
    </g>
  `)
  const title = svg(`
    <text x="60" y="${H - 78}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="600" fill="#f1eee3" letter-spacing="8">チャリ通</text>
    <text x="62" y="${H - 36}" font-family="Menlo, monospace" font-size="23" fill="#f1eee3" opacity="0.8" letter-spacing="3">ENDLESS RUNNER · 出勤服アーカイブ GAME</text>
  `)
  await save(
    'chari',
    '#b9dcf2',
    [{ input: scene, left: 0, top: 0 }, { input: bike, left: 0, top: 0 }, at(hero, 345, 260)],
    title,
  )
}

// ---- 性格診断: クリーム地に「？」を浮かべ、切り抜き数体を並べる ------------
async function quiz() {
  const qMark = svg(`
    <text x="${W / 2}" y="330" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="300" font-weight="700" fill="rgba(59,91,219,0.14)">?</text>
  `)
  const n = 5
  const layers = [{ input: qMark, left: 0, top: 0 }]
  const startX = Math.round((W - (n - 1) * 190) / 2)
  for (let i = 0; i < n; i++) {
    const cx = startX + i * 190
    const cy = i % 2 === 0 ? 300 : 260
    const rot = i % 2 === 0 ? -5 : 6
    const sp = await sprite(PICKS[i], 250, rot)
    layers.push(at(sp, cx, cy))
  }
  const title = svg(`
    <text x="60" y="${H - 78}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="600" fill="#161616" letter-spacing="8">性格診断</text>
    <text x="62" y="${H - 36}" font-family="Menlo, monospace" font-size="23" fill="#161616" opacity="0.7" letter-spacing="3">PERSONALITY TEST · 出勤服アーカイブ GAME</text>
  `)
  await save('quiz', '#f1eee3', layers, title)
}

// ---- 俺スロ: 暗い筐体のリール窓。中段に同じ俺が3人揃っている ----------------
async function slot() {
  const CELL_W = 190
  const CELL_H = 250
  const GAP = 16
  const startX = Math.round((W - (CELL_W * 3 + GAP * 2)) / 2)
  const midY = 180 // 中段の上端
  const plate = (color, deep) =>
    Buffer.from(`<svg width="${CELL_W}" height="${CELL_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${deep}"/>
      </linearGradient></defs>
      <rect x="10" y="8" width="${CELL_W - 20}" height="${CELL_H - 16}" rx="24" fill="url(#p)"/>
      <rect x="13" y="11" width="${CELL_W - 26}" height="${CELL_H - 22}" rx="21" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="3"/>
    </svg>`)
  const RED = ['#ea5a3c', '#c53a22']
  // 上段・下段はリールごとに違う色（＝揃っていない）
  const others = [
    [['#4c8fd0', '#3470ae'], ['#58ad7c', '#3d8c5f']],
    [['#f0bb33', '#d6961a'], ['#a8a394', '#858072']],
    [['#58ad7c', '#3d8c5f'], ['#46568c', '#2b3763']],
  ]
  const hero = await sprite(PICKS[0], 218)
  const layers = [
    {
      input: svg(`
        <rect x="${startX - 22}" y="0" width="${CELL_W * 3 + GAP * 2 + 44}" height="${H}" fill="#0d0d10"/>
        ${[0, 1, 2]
          .map((r) => `<rect x="${startX + r * (CELL_W + GAP)}" y="0" width="${CELL_W}" height="${H}" fill="#f1eee3"/>`)
          .join('')}
      `),
      left: 0,
      top: 0,
    },
  ]
  for (let r = 0; r < 3; r++) {
    const left = startX + r * (CELL_W + GAP)
    const rows = [
      { top: midY - CELL_H, colors: others[r][0], sp: await sprite(PICKS[1 + r * 2], 218) },
      { top: midY, colors: RED, sp: hero },
      { top: midY + CELL_H, colors: others[r][1], sp: await sprite(PICKS[2 + r * 2], 218) },
    ]
    for (const row of rows) {
      const cell = await sharp(plate(...row.colors))
        .composite([at(row.sp, CELL_W / 2, CELL_H / 2 + 4)])
        .png()
        .toBuffer()
      // 画面外にはみ出す上下段は、見える範囲だけ切り出して貼る
      const cut = Math.max(0, -row.top)
      const height = Math.min(CELL_H - cut, H - Math.max(0, row.top))
      const visible = await sharp(cell).extract({ left: 0, top: cut, width: CELL_W, height }).toBuffer()
      layers.push({ input: visible, left, top: Math.max(0, row.top) })
    }
  }
  // 上下段を沈めて中段を際立たせ、左右に中段の目印を置く
  layers.push({
    input: svg(`
      <rect x="${startX - 22}" y="0" width="${CELL_W * 3 + GAP * 2 + 44}" height="${midY}" fill="rgba(13,13,16,0.62)"/>
      <rect x="${startX - 22}" y="${midY + CELL_H}" width="${CELL_W * 3 + GAP * 2 + 44}" height="${H - midY - CELL_H}" fill="rgba(13,13,16,0.62)"/>
      <path d="M ${startX - 58} ${midY + CELL_H / 2 - 20} l 30 20 l -30 20 Z" fill="#ea5a3c"/>
      <path d="M ${startX + CELL_W * 3 + GAP * 2 + 58} ${midY + CELL_H / 2 - 20} l -30 20 l 30 20 Z" fill="#ea5a3c"/>
      <circle cx="150" cy="150" r="74" fill="#ffd557"/>
      <circle cx="150" cy="150" r="74" fill="none" stroke="#fff1bf" stroke-width="6"/>
      <text x="150" y="182" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="700" fill="#7a2a00">俺</text>
    `),
    left: 0,
    top: 0,
  })
  const title = svg(`
    <text x="60" y="${H - 78}" font-family="Helvetica, Arial, sans-serif" font-size="68" font-weight="600" fill="#fff" letter-spacing="8">俺スロ</text>
    <text x="62" y="${H - 34}" font-family="Menlo, monospace" font-size="23" fill="#fff" opacity="0.85" letter-spacing="3">SLOT MACHINE</text>
  `)
  await save('slot', '#1b1b1f', layers, title)
}

// ---- 四季通勤: 春夏秋冬の街に、その季節に実際に着た服の切り抜きを立たせる ----
async function shiki() {
  const outfits = JSON.parse(await readFile(path.join(ROOT, 'src/data/outfits.json'), 'utf8'))
  // 季節ごとに、その月に着た服から立ち姿の切り抜きを1体選ぶ（決定的）
  const pickFor = (month) =>
    outfits
      .filter((o) => Number(o.date.slice(5, 7)) === month && keys.includes(o.key))
      .sort((a, b) => (a.key < b.key ? -1 : 1))[0].key
  const seasons = [
    { key: pickFor(4), sky: ['#f6d9e4', '#fdf1ea'], ground: '#9bcb68', tree: '#f7bfd2', dot: '#ffffff', kind: 'petal' },
    { key: pickFor(7), sky: ['#4f97e6', '#cfe8fb'], ground: '#6aab52', tree: '#58a04a', dot: '#ffffff', kind: 'cloud' },
    { key: pickFor(11), sky: ['#f0a875', '#fbe2c4'], ground: '#b6a85e', tree: '#d9743a', dot: '#e3b23c', kind: 'petal' },
    { key: pickFor(1), sky: ['#8f9db2', '#dfe6ec'], ground: '#e9eef0', tree: '#8a7460', dot: '#ffffff', kind: 'snow' },
  ]
  const PW = W / seasons.length
  const groundY = 470
  const rnd = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  const scene = svg(
    seasons
      .map((s, i) => {
        const x0 = i * PW
        const dots = Array.from({ length: 26 }, (_, k) => {
          const x = x0 + rnd(i * 100 + k) * PW
          const y = 30 + rnd(i * 200 + k) * (groundY - 60)
          return s.kind === 'cloud'
            ? ''
            : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.kind === 'snow' ? 4 : 3.2}" fill="${s.dot}" opacity="0.85"/>`
        }).join('')
        const cloud =
          s.kind === 'cloud'
            ? `<g fill="#ffffff" opacity="0.92"><circle cx="${x0 + 200}" cy="120" r="42"/><circle cx="${x0 + 240}" cy="138" r="34"/><circle cx="${x0 + 162}" cy="140" r="30"/><rect x="${x0 + 150}" y="140" width="110" height="30" rx="15"/></g>`
            : ''
        const bare = s.kind === 'snow'
        const crown = bare
          ? `<path d="M ${x0 + 62} 330 L ${x0 + 40} 270 M ${x0 + 62} 330 L ${x0 + 88} 262 M ${x0 + 62} 345 L ${x0 + 62} 255" stroke="${s.tree}" stroke-width="7" stroke-linecap="round"/>`
          : `<g fill="${s.tree}"><circle cx="${x0 + 62}" cy="290" r="52"/><circle cx="${x0 + 28}" cy="318" r="34"/><circle cx="${x0 + 98}" cy="316" r="36"/></g>`
        return `
          <defs><linearGradient id="sk${i}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/>
          </linearGradient></defs>
          <rect x="${x0}" y="0" width="${PW}" height="${groundY}" fill="url(#sk${i})"/>
          <rect x="${x0 + 150}" y="${groundY - 190}" width="110" height="190" fill="#9fb0c2" opacity="0.55"/>
          <rect x="${x0 + 215}" y="${groundY - 120}" width="85" height="120" fill="#e8d9bf" opacity="0.7"/>
          ${cloud}
          <rect x="${x0 + 56}" y="330" width="12" height="${groundY - 330}" fill="#6b4f3a"/>
          ${crown}
          ${dots}
          <rect x="${x0}" y="${groundY}" width="${PW}" height="34" fill="#d8d3c6"/>
          <rect x="${x0}" y="${groundY + 34}" width="${PW}" height="${H - groundY - 34}" fill="${s.ground}"/>`
      })
      .join(''),
  )
  const layers = [{ input: scene, left: 0, top: 0 }]
  for (const [i, s] of seasons.entries()) {
    const sp = await sprite(s.key, 290)
    layers.push(at(sp, i * PW + PW * 0.56, groundY + 20 - sp.h / 2))
  }
  await save('shiki', '#cfe6fb', layers, darkTitle('四季通勤', 'WARDROBE STRATEGY'))
}

// 引数でゲーム名を渡すと、そのゲームの画像だけ作り直す（例: node scripts/make-game-og.mjs slot）。
// 引数なしなら全部。くり抜きが増えると選ばれる素材が変わるので、既存の画像を動かしたくないときは名前を指定する
const GAMES = { memory, duel, platform, tower, chari, quiz, slot, shiki }
const only = process.argv.slice(2)
for (const [name, make] of Object.entries(GAMES)) {
  if (only.length === 0 || only.includes(name)) await make()
}
