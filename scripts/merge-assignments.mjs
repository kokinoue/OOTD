// 判定結果（assignments.json）を splits.json の既存 subs に「追記のみ」でマージする。
// apply-splits.mjs と違い splits.json を上書きせず、既存の割当は一切変更しない。
// assignments.json 形式: { "<itemId>": { "<subKey>": [no, no, ...] } }
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPLITS = path.join(ROOT, 'src', 'data', 'splits.json')

const outfits = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'outfits.json'), 'utf8'))
const splits = JSON.parse(await readFile(SPLITS, 'utf8'))
const assignments = JSON.parse(
  await readFile(process.argv[2] ?? path.join(ROOT, '.cache', 'sheets', 'assignments.json'), 'utf8'),
)

const byNo = new Map(outfits.map((o) => [o.no, o]))
let applied = 0
let warned = 0

for (const [itemId, subMap] of Object.entries(assignments)) {
  const def = splits.items[itemId]
  if (!def) {
    console.warn(`WARN ${itemId}: splits.json にない`)
    warned++
    continue
  }
  const assigned = new Set(def.subs.flatMap((s) => s.outfits))
  for (const [subSpec, nos] of Object.entries(subMap)) {
    // "key" で既存subへ、"key|ラベル" なら無ければ新規subを作る
    const [subKey, newLabel] = subSpec.split('|')
    let sub = def.subs.find((s) => s.key === subKey)
    if (!sub && newLabel) {
      sub = { key: subKey, label: newLabel, outfits: [] }
      def.subs.push(sub)
      console.log(`${itemId}: 新規sub "${subKey}" (${newLabel}) を作成`)
    }
    if (!sub) {
      console.warn(`WARN ${itemId}: sub "${subKey}" がない`)
      warned++
      continue
    }
    for (const no of nos) {
      const o = byNo.get(no)
      if (!o) {
        console.warn(`WARN ${itemId}: #${no} が outfits にない`)
        warned++
        continue
      }
      if (!o.images.some((im) => im.itemIds.includes(itemId))) {
        console.warn(`WARN ${itemId}: #${no} はこのアイテムを着用していない`)
        warned++
        continue
      }
      if (assigned.has(o.key)) {
        console.warn(`WARN ${itemId}: #${no} は割当済み（スキップ）`)
        warned++
        continue
      }
      assigned.add(o.key)
      sub.outfits.push(o.key)
      applied++
    }
  }
}

await writeFile(SPLITS, JSON.stringify(splits, null, 2), 'utf8')
console.log(`${applied} 件を splits.json に追記（警告 ${warned}）`)
