// Claude が判定した髪タグ（.cache/sheets/hair-decisions.json）を
// src/data/hair.json の auto に反映する。手動修正（manual）はそのまま保持。
//
// hair-decisions.json の形式（コーデの #番号 をキーに [髪色, 髪型, 帽子] の配列）:
//   { "643": ["黒", "ショート", null], "642": ["黒", "ミディアム", "キャップ"], ... }
// 帽子なしは null か "なし"、隠れて不明な軸は null か "不明" でよい（保存時に畳む）。
//
// usage: node scripts/apply-hair.mjs [path/to/decisions.json]
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const HAIR = path.join(DATA_DIR, 'hair.json')
const DECISIONS = process.argv[2] ?? path.join(ROOT, '.cache', 'sheets', 'hair-decisions.json')

const nullify = (v) => {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' || t === 'なし' || t === '不明' ? null : t
}

const outfits = JSON.parse(await readFile(path.join(DATA_DIR, 'outfits.json'), 'utf8'))
const noToKey = new Map(outfits.filter((o) => o.no != null).map((o) => [String(o.no), o.key]))
const keySet = new Set(outfits.map((o) => o.key))

const decisions = JSON.parse(await readFile(DECISIONS, 'utf8'))
const hair = JSON.parse(await readFile(HAIR, 'utf8'))
hair.auto ??= {}
hair.manual ??= {}

let applied = 0
const skipped = []
for (const [id, val] of Object.entries(decisions)) {
  // キーは outfit.key でも #番号でも受け付ける
  const key = keySet.has(id) ? id : noToKey.get(id.replace(/^#/, ''))
  if (!key) {
    skipped.push(id)
    continue
  }
  // 配列 [color, style, hat] でもオブジェクト {color,style,hat} でも受け付ける
  const [color, style, hat] = Array.isArray(val)
    ? val
    : [val.color, val.style, val.hat]
  hair.auto[key] = { color: nullify(color), style: nullify(style), hat: nullify(hat) }
  applied++
}

await writeFile(HAIR, JSON.stringify(hair, null, 2) + '\n', 'utf8')
console.log(`${applied} 件を hair.json に反映`)
if (skipped.length) console.warn(`未対応のキー（無視）: ${skipped.join(', ')}`)
