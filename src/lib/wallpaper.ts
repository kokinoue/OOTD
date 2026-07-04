// お気に入りコーデを「スマホのロック画面（壁紙）」向けに整形して共有/保存する。
//
// 前提となる制約: Web からロック画面を直接設定する API は iOS/Android とも存在しない。
// そこで「端末解像度・iOSの時計を避けた構図に整形した画像を生成」→「ネイティブ共有シート
// （写真に保存→手動で壁紙設定）」へ渡す動線にする。共有シート非対応の環境はダウンロードで代替。
//
// note CDN (assets.st-note.com) は CORS 許可（access-control-allow-origin: *）なので
// crossOrigin で読み込めば canvas を汚さずに書き出せる。

// 縦長ポートレートの基準解像度（iPhone 13/14 相当）。OS側で各端末に合わせて拡縮される。
const CANVAS_W = 1170
const CANVAS_H = 2532

export type WallpaperResult = 'shared' | 'downloaded'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`画像を読み込めませんでした: ${url}`))
    img.src = url
  })
}

// 画像を領域いっぱいに COVER して描く（はみ出しはクロップ）。scale で気持ち大きめに。
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  scale = 1,
) {
  const r = Math.max(w / img.width, h / img.height) * scale
  const dw = img.width * r
  const dh = img.height * r
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

// 角丸矩形のパスを引く（前景画像のクリップ用）
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** コーデ写真をロック画面用に整形した JPEG Blob を生成する */
export async function composeWallpaper(opts: {
  imageUrl: string
  dateLabel: string
  caption?: string
}): Promise<Blob> {
  const img = await loadImage(opts.imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas を初期化できませんでした')

  // 1) 背景: 同じ写真を画面いっぱいに COVER してぼかし、色味のアンビエント背景にする
  const canBlur = 'filter' in ctx
  if (canBlur) ctx.filter = 'blur(60px)'
  drawCover(ctx, img, CANVAS_W, CANVAS_H, 1.18) // ぼかしの端欠けを避けて少し大きめ
  if (canBlur) ctx.filter = 'none'

  // 2) 暗めのオーバーレイで前景を引き立てる
  ctx.fillStyle = 'rgba(18,18,18,0.55)'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // 3) 前景: iOSの時計（上部）を避けて下寄せに、アスペクト維持で CONTAIN（角丸＋影）
  const boxX = CANVAS_W * 0.06
  const boxTop = CANVAS_H * 0.16
  const boxBottom = CANVAS_H * 0.9
  const boxW = CANVAS_W - boxX * 2
  const boxH = boxBottom - boxTop
  const fit = Math.min(boxW / img.width, boxH / img.height)
  const dw = img.width * fit
  const dh = img.height * fit
  const dx = (CANVAS_W - dw) / 2
  const dy = boxTop + (boxH - dh) / 2

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 48
  ctx.shadowOffsetY = 18
  roundRectPath(ctx, dx, dy, dw, dh, 44)
  ctx.fillStyle = '#000'
  ctx.fill() // 影を落とすための下地
  ctx.restore()

  ctx.save()
  roundRectPath(ctx, dx, dy, dw, dh, 44)
  ctx.clip()
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()

  // 4) 日付キャプション（前景画像の下）
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.font = '600 58px "Outfit", "Hiragino Sans", "Noto Sans JP", system-ui, -apple-system, sans-serif'
  const capY = Math.min(dy + dh + 96, CANVAS_H - 70)
  ctx.fillText(opts.dateLabel, CANVAS_W / 2, capY)
  if (opts.caption) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '500 34px "JetBrains Mono", ui-monospace, "Hiragino Sans", "Noto Sans JP", monospace'
    ctx.fillText(opts.caption, CANVAS_W / 2, capY + 46)
  }

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', 0.92),
  )
  if (!blob) throw new Error('画像の書き出しに失敗しました')
  return blob
}

/**
 * コーデ写真をロック画面用に整形し、共有シート（→写真に保存→手動で壁紙設定）へ渡す。
 * 共有シート非対応の環境ではダウンロードで代替する。
 */
export async function shareAsWallpaper(opts: {
  imageUrl: string
  dateLabel: string
  caption?: string
  fileBase: string
}): Promise<WallpaperResult> {
  const blob = await composeWallpaper(opts)
  const file = new File([blob], `${opts.fileBase}.jpg`, { type: 'image/jpeg' })

  // 共有シート: iOS Safari / Android Chrome。写真に保存→手動で壁紙に設定できる
  const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.dateLabel })
      return 'shared'
    } catch (err) {
      // ユーザーが共有シートを閉じただけなら成功扱い
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
      // それ以外（iOSのユーザー操作判定切れ等）はダウンロードへフォールバック
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
