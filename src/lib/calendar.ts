// FITS のカレンダー表示用。日付は 'YYYY-MM-DD'、月は 'YYYY-MM' の文字列で扱う（タイムゾーンの影響を受けない）。

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 月曜始まりの月カレンダーのマス目。前月・翌月にはみ出す部分は null で埋め、7の倍数の長さにする。
 */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  // getUTCDay: 日=0 … 土=6 → 月曜始まりのオフセット（月=0 … 日=6）に直す
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${y}-${pad2(m)}-${pad2(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** 日付ごとにコーデをまとめる（同じ日に複数あれば元の並び順のまま入る） */
export function groupByDate<T extends { date: string }>(list: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const o of list) {
    const bucket = map.get(o.date)
    if (bucket) bucket.push(o)
    else map.set(o.date, [o])
  }
  return map
}

/** コーデのある月を新しい順に並べる */
export function monthsWithOutfits(list: { date: string }[]): string[] {
  return [...new Set(list.map((o) => o.date.slice(0, 7)))].sort().reverse()
}
