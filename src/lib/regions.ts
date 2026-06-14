// アイテムのカテゴリ → 全身写真内の該当部位（割合, 0..1）
// scripts/contact-sheet.mjs の REGIONS と同じ意図。写真がほぼ定点なので固定領域で足りる
export type Region = { left: number; top: number; width: number; height: number }

const REGIONS: Record<string, Region> = {
  pants: { left: 0.28, top: 0.42, width: 0.44, height: 0.46 },
  shorts: { left: 0.28, top: 0.42, width: 0.44, height: 0.34 },
  shoes: { left: 0.28, top: 0.76, width: 0.44, height: 0.24 },
  boots: { left: 0.28, top: 0.74, width: 0.44, height: 0.26 },
  cap: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  hat: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  'knit cap': { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  beanie: { left: 0.32, top: 0.02, width: 0.36, height: 0.24 },
  glasses: { left: 0.34, top: 0.06, width: 0.32, height: 0.18 },
  bag: { left: 0.08, top: 0.3, width: 0.84, height: 0.5 },
  default: { left: 0.22, top: 0.12, width: 0.56, height: 0.46 }, // トップス類
}

export const regionFor = (category: string): Region => REGIONS[category] ?? REGIONS.default

/** 領域 r をコンテナ全体に cover 表示する CSS（background-image 用） */
export function regionBackgroundStyle(category: string, url: string): React.CSSProperties {
  const r = regionFor(category)
  // 領域の幅・高さがコンテナを満たすよう拡大（cover）。ほぼ正方形画像前提で一律倍率
  const scale = Math.max(1 / r.width, 1 / r.height)
  // 領域中心(画像内割合 c)をコンテナ中心(0.5)に合わせる position%: P = (0.5 - c*S)/(1 - S)
  const pos = (c: number) => ((0.5 - c * scale) / (1 - scale)) * 100
  const cxf = r.left + r.width / 2
  const cyf = r.top + r.height / 2
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${scale * 100}%`,
    backgroundPosition: `${pos(cxf)}% ${pos(cyf)}%`,
    backgroundRepeat: 'no-repeat',
  }
}
