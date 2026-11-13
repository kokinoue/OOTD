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
