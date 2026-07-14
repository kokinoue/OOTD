import { TRAITS, TRAIT_LABEL, type Scores, type QuizType } from './quiz'
import type { CutoutsFile } from './platform'
import cutoutsJson from '../data/cutouts.json'

// 性格診断のストーリー用シェア画像（1080x1920）を Canvas 2D で生成する。
// note CDN 上の服写真は CORS でキャンバスが汚染されるため、絵は同一オリジンの
// public/cutouts/{outfitKey}.webp（くり抜き）だけを使う。

const cutouts = cutoutsJson as CutoutsFile

const W = 1080
const H = 1920
const BG = '#f1eee3'
const INK = '#161616'
const SUB = 'rgba(22,22,22,0.55)'

const SPRITE_TOP_GAP = 60
const SPRITE_MAX_H = 720
const SPRITE_BARS_GAP = 70
const BARS_PAD = 100
const BARS_ROW_H = 84
const BARS_CARD_TOP_INSET = 24
const BARS_H = TRAITS.length * BARS_ROW_H + 48
const FOOTER_HEADING_Y = H - 130
const FOOTER_HEADING_SIZE = 32
const FOOTER_GAP = 40

const FONT_SANS =
  "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', 'Helvetica Neue', Arial, sans-serif"

const barRatio = (v: number) => Math.max(-1, Math.min(1, v / 6))

export function getStoryVerticalLayout(contentBottom: number) {
  const footerTop = FOOTER_HEADING_Y - FOOTER_HEADING_SIZE
  const barsCardBottom = footerTop - FOOTER_GAP
  const barsTop = barsCardBottom - BARS_H + BARS_CARD_TOP_INSET
  const spriteTop = contentBottom + SPRITE_TOP_GAP
  const spriteHeight = Math.max(0, Math.min(SPRITE_MAX_H, barsTop - SPRITE_BARS_GAP - spriteTop))

  return {
    spriteTop,
    spriteHeight,
    barsTop,
    barsCardBottom,
    footerTop,
  }
}

export type StoryImageParams = {
  type: QuizType
  scores: Scores
  outfitKey: string
}

function spriteUrl(key: string): string {
  return `${import.meta.env.BASE_URL}cutouts/${key}.webp`
}

// fetch + createImageBitmap を使う（new Image().decode() は環境によってはハングすることがあるため）。
// 同一オリジンの cutouts 画像だけを扱うので CORS でキャンバスが汚染される心配もない。
async function loadImage(src: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 折り返し付きテキスト描画。中央揃え・行間指定。戻り値は描画後のy座標 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const chars = [...text]
  let line = ''
  let cursorY = y
  for (const ch of chars) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, cx, cursorY)
      line = ch
      cursorY += lineHeight
    } else {
      line = test
    }
  }
  if (line) {
    ctx.fillText(line, cx, cursorY)
    cursorY += lineHeight
  }
  return cursorY
}

export async function generateStoryImage(params: StoryImageParams): Promise<Blob> {
  const { type, scores, outfitKey } = params
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context is not available')

  // 背景
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // 上部: 小見出し
  ctx.textAlign = 'center'
  ctx.fillStyle = SUB
  ctx.font = `600 30px ${FONT_SANS}`
  ctx.fillText('性格診断', W / 2, 130)
  ctx.font = `400 24px 'JetBrains Mono', Menlo, monospace`
  ctx.fillText('PERSONALITY TEST — 出勤服アーカイブ', W / 2, 172)

  // 中央: 4文字コード + タイプ名 + タグライン
  ctx.fillStyle = INK
  ctx.font = `700 44px 'JetBrains Mono', Menlo, monospace`
  ctx.fillText(type.code, W / 2, 242)

  ctx.font = `700 84px ${FONT_SANS}`
  let y = wrapText(ctx, type.name, W / 2, 320, W - 160, 96)

  ctx.fillStyle = SUB
  ctx.font = `500 34px ${FONT_SANS}`
  y = wrapText(ctx, type.tagline, W / 2, y + 24, W - 220, 48)

  const layout = getStoryVerticalLayout(y)

  // 切り抜きスプライト
  const sp = cutouts.sprites[outfitKey]
  if (sp) {
    const img = await loadImage(spriteUrl(outfitKey))
    if (img) {
      const dispH = layout.spriteHeight
      const dispW = (sp.w / sp.h) * dispH
      const dx = (W - dispW) / 2
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, dx, layout.spriteTop, dispW, dispH)
    }
  }

  // 5軸スコアバー
  const barsW = W - BARS_PAD * 2

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  roundRect(ctx, BARS_PAD - 40, layout.barsTop - BARS_CARD_TOP_INSET, barsW + 80, BARS_H, 28)
  ctx.fill()

  TRAITS.forEach((t, i) => {
    const rowY = layout.barsTop + i * BARS_ROW_H + 24
    const label = TRAIT_LABEL[t]
    const ratio = barRatio(scores[t])

    ctx.font = `500 26px ${FONT_SANS}`
    ctx.fillStyle = SUB
    ctx.textAlign = 'left'
    ctx.fillText(label.neg, BARS_PAD, rowY)
    ctx.textAlign = 'right'
    ctx.fillText(label.pos, BARS_PAD + barsW, rowY)

    const barY = rowY + 16
    const barH = 10
    const barX = BARS_PAD
    ctx.fillStyle = 'rgba(22,22,22,0.12)'
    roundRect(ctx, barX, barY, barsW, barH, barH / 2)
    ctx.fill()

    const mid = barX + barsW / 2
    ctx.fillStyle = ratio >= 0 ? '#3b5bdb' : '#c0392b'
    const fillW = Math.abs(ratio) * (barsW / 2)
    const fillX = ratio >= 0 ? mid : mid - fillW
    roundRect(ctx, fillX, barY, Math.max(fillW, 2), barH, barH / 2)
    ctx.fill()
  })

  // 下部: サイトURL
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = `700 ${FOOTER_HEADING_SIZE}px ${FONT_SANS}`
  ctx.fillText('あなたのkokiはこれ！', W / 2, FOOTER_HEADING_Y)
  ctx.fillStyle = SUB
  ctx.font = `400 26px 'JetBrains Mono', Menlo, monospace`
  ctx.fillText('kokinoue.github.io/OOTD', W / 2, H - 88)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('failed to encode image'))
    }, 'image/png')
  })
}
