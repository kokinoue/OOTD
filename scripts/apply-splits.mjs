// 画像判定の結果（.cache/sheets/decisions.json）を src/data/splits.json に展開する
//
// decisions.json の形式:
// {
//   "pants|maisonmartinmargiela": {
//     "subs": [
//       { "key": "indigo-flare", "label": "紺フレアデニム", "nos": [639, 636] }
//     ],
//     "rest": "indigo-flare"   // 任意: 未列挙の残り全コーデをこのsubへ
//   },
//   "shoes|oofos": "noSplit"   // 確認済み・単一個体
// }
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHEETS = path.join(ROOT, '.cache', 'sheets')

const decisions = JSON.parse(await readFile(path.join(SHEETS, 'decisions.json'), 'utf8'))
const out = { version: 1, items: {}, noSplit: [] }
let warnings = 0

for (const [itemId, dec] of Object.entries(decisions)) {
  if (dec === 'noSplit') {
    out.noSplit.push(itemId)
    continue
  }
  const safeName = itemId.replace(/[^a-z0-9]+/gi, '_')
  const { targets } = JSON.parse(await readFile(path.join(SHEETS, `${safeName}.json`), 'utf8'))
  const byNo = new Map(targets.map((t) => [t.no, t.key]))
  const assigned = new Set()
  const subs = []

  for (const sub of dec.subs) {
    const keys = []
    for (const no of sub.nos ?? []) {
      const key = byNo.get(no)
      if (!key) {
        console.warn(`WARN ${itemId}: #${no} はこのアイテムの着用一覧にない`)
        warnings++
        continue
      }
      if (assigned.has(key)) {
        console.warn(`WARN ${itemId}: #${no} が複数のsubに割り当てられている`)
        warnings++
        continue
      }
      assigned.add(key)
      keys.push(key)
    }
    subs.push({ key: sub.key, label: sub.label, outfits: keys })
  }

  if (dec.rest) {
    const restSub = subs.find((s) => s.key === dec.rest)
    if (!restSub) {
      console.warn(`WARN ${itemId}: rest先 "${dec.rest}" が subs にない`)
      warnings++
    } else {
      for (const t of targets) {
        if (!assigned.has(t.key)) {
          assigned.add(t.key)
          restSub.outfits.push(t.key)
        }
      }
    }
  }

  // 番号の転記ミス等で空になったsubは出力しない
  const nonEmpty = subs.filter((s) => s.outfits.length > 0)
  if (nonEmpty.length === 0) {
    console.warn(`WARN ${itemId}: 有効なsubがないためスキップ`)
    warnings++
    continue
  }
  out.items[itemId] = { subs: nonEmpty }
  const unassigned = targets.length - assigned.size
  console.log(
    `${itemId}: ${subs.length} subs (${subs.map((s) => `${s.label}=${s.outfits.length}`).join(', ')})` +
      (unassigned > 0 ? ` / 未分類 ${unassigned}` : ''),
  )
}

await writeFile(
  path.join(ROOT, 'src', 'data', 'splits.json'),
  JSON.stringify(out, null, 2),
  'utf8',
)
console.log(
  `\nsplits.json: ${Object.keys(out.items).length} split items, ${out.noSplit.length} no-split, warnings: ${warnings}`,
)
