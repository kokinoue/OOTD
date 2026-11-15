// タワーの演出用の純粋ロジック（空の色・高さ換算・シルエットの最高点・効果音の音程）。
// ここにあるものは見た目と音だけに使い、物理・入力・スコアには一切関与しない。

import { SPRITE_H_PX } from './tower'

/** 表示上の 1m あたりの px。人物（150px）を身長 1.7m とみなす */
export const PX_PER_M = SPRITE_H_PX / 1.7

export const heightMeters = (px: number) => Math.max(0, px) / PX_PER_M

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** 出現時のポップ用（少し行き過ぎて戻る） */
export const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const u = clamp01(t) - 1
  return 1 + (c1 + 1) * u * u * u + c1 * u * u
}

type Rgb = [number, number, number]

const hex = (s: string): Rgb => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
]

// 積んだ高さで一日が進む: 朝の出勤（紙色）→ 昼 → 夕方の退勤 → 夜。
// 0m は従来どおりの紙色なので、序盤の見た目は変わらない。
const SKY_KEYS: Array<{ m: number; top: Rgb; bottom: Rgb }> = [
  { m: 0, top: hex('#f1eee3'), bottom: hex('#f1eee3') },
  { m: 3, top: hex('#dce9ef'), bottom: hex('#f1eee3') },
  { m: 7, top: hex('#8fc3ea'), bottom: hex('#dcecf2') },
  { m: 12, top: hex('#5b6fb5'), bottom: hex('#f6b98a') },
  { m: 16, top: hex('#1d2350'), bottom: hex('#c66a6e') },
  { m: 20, top: hex('#0b0e24'), bottom: hex('#272a55') },
]

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`

const luminance = (c: Rgb) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

export type Sky = {
  top: string
  bottom: string
  /** 背景が暗く、線や文字を白系にすべきか */
  dark: boolean
  /** 0..1 夜の深さ（星・月の濃さ） */
  night: number
}

export function skyAt(meters: number): Sky {
  const m = Math.max(0, meters)
  let i = 0
  while (i < SKY_KEYS.length - 2 && m >= SKY_KEYS[i + 1]!.m) i++
  const a = SKY_KEYS[i]!
  const b = SKY_KEYS[i + 1]!
  const t = clamp01((m - a.m) / (b.m - a.m))
  const top = mix(a.top, b.top, t)
  const bottom = mix(a.bottom, b.bottom, t)
  return {
    top: css(top),
    bottom: css(bottom),
    dark: luminance(mix(top, bottom, 0.4)) < 0.45,
    night: smoothstep(14, 20, m),
  }
}

/** スプライト中心基準の箱（px）。衝突矩形と同じ形を描画側の計測に使う */
export type LocalBox = { cx: number; cy: number; hw: number; hh: number }

/**
 * 回転した箱の集合の、中心から見た最上端（y は下向き正なので最小値）を返す。
 * 物理の AABB は余白つきなので、高さ表示にはこちらの正確な値を使う。
 */
export function topOffset(boxes: LocalBox[], angle: number): number {
  const s = Math.sin(angle)
  const c = Math.cos(angle)
  let top = Infinity
  for (const b of boxes) {
    const y = b.cx * s + b.cy * c - (Math.abs(b.hw * s) + Math.abs(b.hh * c))
    if (y < top) top = y
  }
  return Number.isFinite(top) ? top : 0
}

/** アルファスキャン用の RGBA から、上・中・下の平均色を取る（土煙と紙吹雪をその服の色にする） */
export function samplePalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string[] {
  const out: string[] = []
  for (let part = 0; part < 3; part++) {
    const y0 = Math.floor((height * part) / 3)
    const y1 = Math.floor((height * (part + 1)) / 3)
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (rgba[i + 3]! < 128) continue
        r += rgba[i]!
        g += rgba[i + 1]!
        b += rgba[i + 2]!
        n++
      }
    }
    if (n > 0) out.push(css([Math.round(r / n), Math.round(g / n), Math.round(b / n)]))
  }
  return out.length > 0 ? out : ['rgb(184, 178, 160)']
}

const PENTATONIC = [0, 2, 4, 7, 9]

/** n 体目が積めたときの音程（Hz）。ドレミソラで1体ごとに上がり、2オクターブ上で頭打ち */
export function settleNoteHz(n: number): number {
  const idx = Math.max(0, Math.floor(n) - 1)
  const octave = Math.min(2, Math.floor(idx / PENTATONIC.length))
  const semis = PENTATONIC[idx % PENTATONIC.length]! + 12 * octave
  return 261.63 * 2 ** (semis / 12)
}

// ----------------------------------------------------------------------------
// 記念写真の構図（world px の矩形）。写真は縦長 3:4 に固定する
// ----------------------------------------------------------------------------
export type Rect = { x: number; y: number; w: number; h: number }

export const PHOTO_ASPECT = 3 / 4

/** 積めた瞬間の構図: 台座を下端中央に置き、頂上まで入れる（低いタワーでも寄りすぎない） */
export function stackView(peakTop: number, groundTop: number, centerX: number): Rect {
  const bottom = groundTop + 50
  const top = Math.min(peakTop - 50, bottom - 506)
  const h = bottom - top
  const w = h * PHOTO_ASPECT
  return { x: centerX - w / 2, y: top, w, h }
}

/**
 * 崩れている最中の構図: 積めた瞬間の構図（base）を必ず含み、散らばったピースが入るぶんだけ引く。
 * ピースが base の中に収まっているうちは base と同じ。
 * 遠くへ飛んだ・台座の下まで落ちたピースは追わない（そのために全体が豆粒になるのを避ける）。
 */
export function collapseView(base: Rect, pieces: Array<{ x: number; y: number; r: number }>): Rect {
  const minX = base.x - base.w * 0.75
  const maxX = base.x + base.w * 1.75
  const minY = base.y - base.h * 0.25
  const maxY = base.y + base.h + 220
  let x0 = base.x
  let x1 = base.x + base.w
  let y0 = base.y
  let y1 = base.y + base.h
  for (const p of pieces) {
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue
    x0 = Math.min(x0, Math.max(minX, p.x - p.r))
    x1 = Math.max(x1, Math.min(maxX, p.x + p.r))
    y0 = Math.min(y0, Math.max(minY, p.y - p.r))
    y1 = Math.max(y1, Math.min(maxY, p.y + p.r))
  }
  // 3:4 に合わせて、足りない辺を中心から広げる
  let w = x1 - x0
  let h = y1 - y0
  if (w / h < PHOTO_ASPECT) w = h * PHOTO_ASPECT
  else h = w / PHOTO_ASPECT
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }
}

/**
 * コマごとの構図を前後 radius コマの平均でならす。ピースが範囲の外へ出た瞬間に
 * 構図が切り替わるので、コマを送ったときに画が飛ばないようにする。
 */
export function smoothRects(rects: Rect[], radius: number): Rect[] {
  return rects.map((_, i) => {
    const from = Math.max(0, i - radius)
    const to = Math.min(rects.length - 1, i + radius)
    const acc = { x: 0, y: 0, w: 0, h: 0 }
    for (let j = from; j <= to; j++) {
      const r = rects[j]!
      acc.x += r.x
      acc.y += r.y
      acc.w += r.w
      acc.h += r.h
    }
    const n = to - from + 1
    return { x: acc.x / n, y: acc.y / n, w: acc.w / n, h: acc.h / n }
  })
}

/**
 * コマ送り用の記録から、冒頭の「何も動いていないコマ」を落とす。
 * 各コマは [x, y, angle, x, y, angle, ...]。ピースが増えたコマは動きがあったとみなす。
 */
export function trimStillLead(frames: Float32Array[], eps = 0.5): Float32Array[] {
  let start = 0
  while (start < frames.length - 1) {
    const a = frames[start]!
    const b = frames[start + 1]!
    if (a.length !== b.length) break
    let moved = false
    for (let i = 0; i < a.length; i++) {
      // 角度（3つめごと）は rad なので px と同じ重みになるよう拡大して比べる
      const scale = i % 3 === 2 ? 60 : 1
      if (Math.abs(a[i]! - b[i]!) * scale > eps) {
        moved = true
        break
      }
    }
    if (moved) break
    start++
  }
  return frames.slice(start)
}
