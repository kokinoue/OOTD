// 各コーデ写真を画像認識AI（Anthropic）に渡し、髪色・髪型・帽子を推定して
// src/data/hair.json の auto に書き込む。手動修正（manual）はそのまま保持する。
//
// usage:
//   ANTHROPIC_API_KEY=sk-... node scripts/classify-hair.mjs [options]
// options:
//   --force         既に推定済みのコーデも再分類する（デフォルトは未分類のみ）
//   --limit N        最大 N 件だけ処理する（試運転用）
//   --concurrency N  並列数（デフォルト 4）
//   --model NAME     使うモデル（デフォルト claude-haiku-4-5 / env HAIR_MODEL でも可）
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const OUTFITS = path.join(DATA_DIR, 'outfits.json')
const HAIR = path.join(DATA_DIR, 'hair.json')

const API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = argValue('--model') ?? process.env.HAIR_MODEL ?? 'claude-haiku-4-5'
const FORCE = process.argv.includes('--force')
const LIMIT = Number(argValue('--limit')) || Infinity
const CONCURRENCY = Number(argValue('--concurrency')) || 4

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 推定値の語彙（フィルタのチップ数を安定させるため列挙で縛る）。
// 帽子で隠れて分からない場合は「不明」、帽子なしは「なし」を返させ、保存時に null へ畳む。
const COLORS = ['黒', '茶', '明るめ', '白髪まじり', '不明']
const STYLES = ['ベリーショート', 'ショート', 'ミディアム', '長め', 'パーマ', '刈り上げ', '結び', 'その他', '不明']
const HATS = ['なし', 'キャップ', 'ニット帽', 'ハット', 'その他']

const TOOL = {
  name: 'record_hair',
  description: '写真に写っている人物の髪まわり（髪色・髪型・帽子）を分類して記録する',
  input_schema: {
    type: 'object',
    properties: {
      color: { type: 'string', enum: COLORS, description: '髪の色。帽子で髪がほぼ隠れて判別できないときは「不明」' },
      style: { type: 'string', enum: STYLES, description: '髪型。帽子でほぼ隠れて判別できないときは「不明」' },
      hat: { type: 'string', enum: HATS, description: '被っている帽子の種類。被っていなければ「なし」' },
    },
    required: ['color', 'style', 'hat'],
  },
}

const SYSTEM =
  '同一人物（成人男性）が毎営業日に撮る定点コーデ写真のアーカイブを分類しています。' +
  '写真の人物の髪まわりを観察し、record_hair ツールで髪色・髪型・帽子を1つずつ選んでください。' +
  '時系列で見たとき表記がぶれないよう、与えられた選択肢の中から最も近いものを選びます。' +
  '帽子で髪がほとんど隠れている場合は、その軸を「不明」にしてください。'

const nullify = (v) => (v === '不明' || v === 'なし' || v === '' ? null : v)

async function classify(imageUrl) {
  const body = {
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_hair' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: `${imageUrl}?width=512` } },
          { type: 'text', text: 'この写真の人物の髪まわりを分類してください。' },
        ],
      },
    ],
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    const json = await res.json()
    const block = json.content?.find((b) => b.type === 'tool_use')
    if (!block) throw new Error(`no tool_use in response: ${JSON.stringify(json.content)}`)
    const { color, style, hat } = block.input
    return { color: nullify(color), style: nullify(style), hat: nullify(hat) }
  }
  throw new Error('retries exhausted')
}

async function main() {
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY が未設定です。例: ANTHROPIC_API_KEY=sk-... pnpm hair')
    process.exit(1)
  }

  const outfits = JSON.parse(await readFile(OUTFITS, 'utf8'))
  const hair = JSON.parse(await readFile(HAIR, 'utf8'))
  hair.auto ??= {}
  hair.manual ??= {}

  const targets = outfits
    .filter((o) => o.images?.[0]?.url)
    .filter((o) => FORCE || !(o.key in hair.auto))
    .slice(0, LIMIT)

  console.log(
    `対象 ${targets.length} 件 / 全 ${outfits.length} 件（モデル: ${MODEL}, 並列: ${CONCURRENCY}）`,
  )
  if (targets.length === 0) {
    console.log('処理対象がありません（--force で全件やり直し）')
    return
  }

  let done = 0
  let failed = 0
  let dirty = 0

  // 一定件数ごと、または最後にまとめて書き出す。
  // 並列ワーカーが同時に呼んでもファイルが壊れないよう直列化する
  let saving = Promise.resolve()
  const save = () => {
    saving = saving.then(async () => {
      dirty = 0
      await writeFile(HAIR, JSON.stringify(hair, null, 2) + '\n', 'utf8')
    })
    return saving
  }

  // 並列ワーカープール
  let cursor = 0
  const worker = async () => {
    while (cursor < targets.length) {
      const o = targets[cursor++]
      try {
        hair.auto[o.key] = await classify(o.images[0].url)
        dirty++
      } catch (e) {
        failed++
        console.error(`\n  ✗ ${o.key} (${o.date}): ${e.message}`)
      }
      done++
      process.stdout.write(`\r分類中: ${done}/${targets.length}（失敗 ${failed}）`)
      if (dirty >= 20) await save()
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await save()
  console.log(`\n完了: ${done - failed} 件を hair.json に保存（失敗 ${failed}）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
