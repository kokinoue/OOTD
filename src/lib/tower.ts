// タワー: 出勤服のくり抜きを積む物理パズル（どうぶつタワーバトル風・1人スコアアタック）。
// このファイルは純粋ロジック（アルファ→衝突矩形の抽出、スコア計算）。物理と描画は View 側。
//
// 衝突形状はビルド時に持たず、スプライト画像のアルファチャンネルを実行時にスキャンして
// 水平バンドごとの不透明区間 → 矩形群として抽出する（1ターンに1体なので実行時で十分速い）。
// 矩形の集合を compound body にすると、脚の間の隙間・腕と胴の凹みが物理に反映されて
// 「シルエットで積む」面白さが出る。

export type ShapeRect = {
  // スプライト画像ピクセル座標系（左上原点）での矩形
  x: number
  y: number
  w: number
  h: number
}

export const BAND_COUNT = 16 // 水平バンド数（縦方向の分割）。多いほど形が正確、fixture 数は増える
export const ALPHA_THRESHOLD = 96 // これ以上のアルファを「不透明」とみなす (0-255)
export const MIN_RUN_PX = 3 // これより狭い不透明区間はノイズとして捨てる（サンプル座標系）
export const MAX_GAP_PX = 2 // これ以下の透明ギャップは同一区間として連結（アンチエイリアス対策）

/**
 * ImageData 相当の RGBA 配列から、水平バンドごとの不透明区間を矩形群として抽出する。
 * 返り値はサンプル座標系（width×height）の矩形。呼び出し側でスプライト実寸に拡縮する。
 */
export function extractShapeRects(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  bands = BAND_COUNT,
): ShapeRect[] {
  const rects: ShapeRect[] = []
  const bandH = height / bands
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor(b * bandH)
    const y1 = Math.min(height, Math.ceil((b + 1) * bandH))
    // バンド内の列ごとに「不透明ピクセルを含むか」を調べる
    const colOpaque = new Uint8Array(width)
    for (let y = y0; y < y1; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        if (rgba[(row + x) * 4 + 3]! >= ALPHA_THRESHOLD) colOpaque[x] = 1
      }
    }
    // 不透明列の連続区間を矩形化（小ギャップは連結、細切れは捨てる）
    let runStart = -1
    let gap = 0
    for (let x = 0; x <= width; x++) {
      const opaque = x < width && colOpaque[x] === 1
      if (opaque) {
        if (runStart < 0) runStart = x
        gap = 0
      } else if (runStart >= 0) {
        gap++
        if (gap > MAX_GAP_PX || x === width) {
          const runEnd = x - gap + 1 // gap 分戻す
          const w = runEnd - runStart
          if (w >= MIN_RUN_PX) rects.push({ x: runStart, y: y0, w, h: y1 - y0 })
          runStart = -1
          gap = 0
        }
      }
    }
  }
  return rects
}

/** 矩形群の被覆面積（サンプル座標系, px^2）。テストとデバッグ用 */
export function coveredArea(rects: ShapeRect[]): number {
  return rects.reduce((a, r) => a + r.w * r.h, 0)
}

// ----------------------------------------------------------------------------
// 物理の定数（planck は m 単位。スプライトは px なので換算する）
// ----------------------------------------------------------------------------
export const PPM = 60 // pixels per meter（240px の人物 = 4m 相当。Box2D の得意レンジに収める）
export const SPRITE_H_PX = 150 // 場に出すときの人物の高さ（表示px）。原寸240pxを少し縮める
export const GRAVITY = 10 // m/s^2
export const FRICTION = 0.9 // 布同士なので高摩擦
export const DENSITY = 1.0
export const RESTITUTION = 0 // 跳ねない（DTB の挙動）

// 静止判定: 速度がこの閾値未満のフレームがこの回数続いたら「積めた」
export const SETTLE_SPEED = 0.08 // m/s
export const SETTLE_ANGULAR = 0.06 // rad/s
export const SETTLE_FRAMES = 45 // 60fps で 0.75 秒

/** ベストスコアの localStorage キー */
export const BEST_KEY = 'tower.best'

export function loadBest(): number {
  try {
    const n = Number(localStorage.getItem(BEST_KEY) ?? '0')
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function saveBest(score: number): void {
  try {
    const prev = loadBest()
    if (score > prev) localStorage.setItem(BEST_KEY, String(score))
  } catch {
    // localStorage が使えない環境では何もしない
  }
}
