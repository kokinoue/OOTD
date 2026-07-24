// タワーのスコア別OGP（ページ + 画像）を事前生成する。
// GitHub Pages は静的ホスティングなので、共有されうるスコア 1〜MAX_SCORE の
// ぶんだけ public/game/tower/r/<n>/index.html と public/og-tower-r/<n>.png を用意し、
// 共有URLをスコア別ページに向けることで X のカードに結果を出す。
// 画像は既存の public/og-tower.png にスコア文字を合成するだけ（素材再生成なし）。
// 生成物は .gitignore 済み。pnpm build から呼ばれ、CI ビルドのたびに作り直す。
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://kokinoue.github.io/OOTD'
// TowerGameView.tsx の共有URL生成と合わせること（これを超えるスコアは汎用ページで共有）
const MAX_SCORE = 50

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const pageHtml = (n) => {
  const title = `タワーで ${n}体 積み上げました！ — 出勤服アーカイブ GAME`
  const desc = '出勤服のくり抜きをどこまで高く積めるか。シルエットの凹凸が物理に効く、どうぶつタワーバトル風スコアアタック。'
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta name="theme-color" content="#fafafa" />
    <link rel="icon" type="image/png" href="../../../../favicon.png" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SITE}/game/tower/r/${n}/" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${SITE}/og-tower-r/${n}.png" />
    <meta property="og:site_name" content="出勤服アーカイブ" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="きみは何体積める？" />
    <meta name="twitter:image" content="${SITE}/og-tower-r/${n}.png" />

    <!-- クローラー向けOGP専用ページ。人間はアプリ本体のハッシュルートへ送る -->
    <script>location.replace('../../../../#/tower')</script>
    <noscript><meta http-equiv="refresh" content="0;url=../../../../#/tower" /></noscript>
  </head>
  <body>
    <p><a href="../../../../#/tower">タワーをひらく</a></p>
  </body>
</html>
`
}

// og-tower.png の左中央の余白（タイトルの上、積みタワーの左）にスコアを載せる
const scoreOverlay = (n) =>
  Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <text x="90" y="330" font-family="Helvetica, Arial, sans-serif" font-size="150" font-weight="700" fill="#161616">${n}<tspan font-size="64" font-weight="600" dx="8">体</tspan></text>
    <text x="94" y="396" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="600" fill="#161616" opacity="0.75" letter-spacing="4">積み上げました！</text>
  </svg>`)

const base = await sharp(path.join(ROOT, 'public/og-tower.png')).png().toBuffer()
await mkdir(path.join(ROOT, 'public/og-tower-r'), { recursive: true })

for (let n = 1; n <= MAX_SCORE; n++) {
  const dir = path.join(ROOT, 'public/game/tower/r', String(n))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), pageHtml(n))
  await sharp(base)
    .composite([{ input: scoreOverlay(n), left: 0, top: 0 }])
    .png()
    .toFile(path.join(ROOT, 'public/og-tower-r', `${n}.png`))
}
console.log(`tower score OGP: ${MAX_SCORE} pages + images generated`)
