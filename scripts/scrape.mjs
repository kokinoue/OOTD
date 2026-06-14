// note.com マガジン「出勤服」を取得して src/data/*.json を生成する
// usage: node scripts/scrape.mjs [--force]
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, '.cache', 'notes')
const DATA_DIR = path.join(ROOT, 'src', 'data')
const MAGAZINE_KEY = 'm1e7ba6acb234'
const UA = { 'User-Agent': 'Mozilla/5.0 (personal outfit archive; owner of the magazine)' }
const SLEEP_MS = 150
const FORCE = process.argv.includes('--force')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: UA })
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (i + 1))
        continue
      }
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      if (i === retries - 1) throw e
      await sleep(1000 * (i + 1))
    }
  }
}

// --- 1. マガジン全ページから記事キー一覧を取得 ---
async function listMagazineNotes() {
  const notes = []
  for (let page = 1; ; page++) {
    const j = await fetchJson(
      `https://note.com/api/v1/layout/magazine/${MAGAZINE_KEY}/section?page=${page}`,
    )
    const section = j?.data?.section
    if (!section) throw new Error(`unexpected response at page ${page}`)
    for (const c of section.contents ?? []) {
      notes.push({ key: c.key, name: c.name, publish_at: c.publish_at, like_count: c.like_count })
    }
    process.stdout.write(`\rlisting: page ${page} (${notes.length} notes)`)
    if (section.is_last_page) break
    await sleep(SLEEP_MS)
  }
  console.log()
  return notes
}

// --- 2. 各記事の本文を取得（キャッシュあり） ---
async function fetchNote(key) {
  const cacheFile = path.join(CACHE_DIR, `${key}.json`)
  if (!FORCE) {
    try {
      await access(cacheFile)
      return JSON.parse(await readFile(cacheFile, 'utf8'))
    } catch {}
  }
  const j = await fetchJson(`https://note.com/api/v3/notes/${key}`)
  const d = j?.data ?? {}
  const slim = {
    key,
    name: d.name,
    body: d.body,
    publish_at: d.publish_at,
    like_count: d.like_count,
    note_url: d.note_url ?? `https://note.com/kokinoue/n/${key}`,
  }
  await writeFile(cacheFile, JSON.stringify(slim), 'utf8')
  await sleep(SLEEP_MS)
  return slim
}

// --- 3. 本文HTMLのパース（noteの生成HTMLなので正規表現で十分） ---
const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')

const stripTags = (s) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim()

function parseBody(body) {
  const images = []
  const comments = []
  if (!body) return { images, comments }

  for (const m of body.matchAll(/<figure[^>]*>([\s\S]*?)<\/figure>/g)) {
    const inner = m[1]
    const img = inner.match(/<img[^>]*src="([^"]+)"/)
    if (!img) continue // YouTube等の埋め込みfigureはスキップ
    const tag = inner.match(/<img[^>]*>/)?.[0] ?? ''
    const width = Number(tag.match(/width="(\d+)"/)?.[1]) || null
    const height = Number(tag.match(/height="(\d+)"/)?.[1]) || null
    const cap = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)
    images.push({
      url: img[1].split('?')[0],
      width,
      height,
      caption: cap ? stripTags(cap[1]) : '',
    })
  }
  const withoutFigures = body.replace(/<figure[\s\S]*?<\/figure>/g, '')
  for (const m of withoutFigures.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = stripTags(m[1])
    if (text) comments.push(text)
  }
  return { images, comments }
}

// --- 4. キャプション → アイテム配列 ---
// 形式: "shirt: ensou, pants: 80's, shoes: J.M.WESTON"
// 表記ゆれ・タイポはここで正規化する（jacket1/jacket2 → jacket 等）
const CATEGORY_ALIASES = {
  shirts: 'shirt',
  't-shirts': 't-shirt',
  swest: 'sweat',
  scart: 'scarf',
  'set up': 'setup',
  'jump suit': 'jumpsuit',
  glove: 'gloves',
}

function normCategory(raw) {
  let c = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  c = c.replace(/\s*\d+$/, '')
  return CATEGORY_ALIASES[c] ?? c
}

// カンマ抜け（"cap: IDEA jacket: Yohji..."）やピリオド区切り（"...Chalayan. bag: Call"）、
// カテゴリ重複（"shoes: shoes: PUMA..."）を、既知カテゴリ語の直前で区切り直して救済する
const KNOWN_CATEGORY_WORDS = [
  'all in one', 'down vest', 'knit tie', 'knit cap', 'jump suit', 'set up',
  't-shirts', 't-shirt', 'tanktop', 'cardigan', 'jumpsuit', 'blouson', 'glasses',
  'beanie', 'biaude', 'gloves', 'glove', 'hoodie', 'jacket', 'shirts', 'shirt',
  'shoes', 'boots', 'scarf', 'scart', 'snood', 'stole', 'inner', 'smock', 'setup',
  'shorts', 'sweat', 'swest', 'pants', 'vest', 'coat', 'knit', 'suit', 'tops',
  'bag', 'cap', 'hat', 'tie',
].sort((a, b) => b.length - a.length)
const CATEGORY_SPLIT_RE = new RegExp(
  `\\.?\\s+(${KNOWN_CATEGORY_WORDS.join('|')})\\s*([:：])`,
  'gi',
)
const MULTIWORD_CATEGORIES = new Set(KNOWN_CATEGORY_WORDS.filter((w) => w.includes(' ')))

function repairCaption(caption) {
  return caption.replace(CATEGORY_SPLIT_RE, (match, cat, colon, offset, str) => {
    // 直前の語と合わせて複合カテゴリ（knit cap / down vest 等）になるなら区切らない
    const before = str
      .slice(0, offset)
      .match(/([\p{L}\p{N}-]+)\s*$/u)?.[1]
      ?.toLowerCase()
    if (before && MULTIWORD_CATEGORIES.has(`${before} ${cat.toLowerCase()}`)) return match
    return `, ${cat}${colon}`
  })
}

function parseCaption(caption) {
  if (!caption) return []
  if (/^https?:\/\//.test(caption.trim())) return [] // キャプション全体が参考リンク
  return repairCaption(caption)
    .split(/[,、]/)
    .map((part) => {
      const t = part.trim()
      if (!t) return null
      if (/^https?:\/\//.test(t)) return null // 参考リンクはアイテムではない
      const m = t.match(/^([^:：;；]+)[:：;；](.*)$/)
      if (!m) return null // カテゴリのない断片（コメント・絵文字等）はアイテムにしない
      // "jacket:2: 60's" のような二重コロンの名残を除去
      const label = m[2].trim().replace(/^\d+[:：]\s*/, '')
      return { category: normCategory(m[1]), label }
    })
    .filter(Boolean)
    .filter((it) => it.label)
}

// ID用の強正規化: 大文字小文字・記号・スペース・ダイアクリティカル（Ä→a）・
// アポストロフィ類・×/x・"1950's"→"50's" のゆれを吸収する
function normalizeLabel(label) {
  let s = label
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/(?<=[A-Za-z])\p{M}+/gu, '') // ラテン文字のダイアクリティカルのみ除去（仮名の濁点は保持）
    .normalize('NFC')
    .toLowerCase()
    .replace(/[ʼʻ]/g, '')
    .replace(/[×✕✖]/g, 'x')
    .replace(/[^\p{L}\p{N}]/gu, '')
  s = s.replace(/(^|\D)19([2-9]0)s/g, '$1$2s')
  // 末尾のシーズン表記（22aw / 19ss / 21prefall 等）はアイテム同一性に含めない。
  // 元の表記はコーデ詳細のキャプションに残る
  const noSeason = s.replace(/(?:19|20)?\d{2}(?:ss|aw|fw|prefall)$/, '')
  if (noSeason.length >= 3) s = noSeason
  return LABEL_ALIASES[s] ?? s
}

// 明確なタイポ・表記ゆれの名寄せ（正規化後の文字列で対応付け）
const LABEL_ALIASES = {
  jmwestom: 'jmweston', // J.M.WESTOM → J.M.WESTON
  leyuccss: 'leyuccas', // Le Yuccs's → Le Yucca's
  '0frparis': 'ofrparis', // 0fr. Paris → Ofr.Paris
  propisition: 'proposition', // propisition → proposition
  adidasxnoah: 'noahxadidas', // adidas × noah → Noah x Adidas
  '50slevis506xx': 'levis506xx', // 506XXは50'sのモデル名なので年代表記は冗長
  '50slevis501xx': 'levis501xx', // 同上
}

const itemId = (category, label) => `${category}|${normalizeLabel(label)}`

// --- main ---
await mkdir(CACHE_DIR, { recursive: true })
await mkdir(DATA_DIR, { recursive: true })

const list = await listMagazineNotes()
console.log(`total notes: ${list.length}`)

const outfits = []
const itemMap = new Map() // id -> { id, category, label, count, firstDate, lastDate, labelVotes }
let done = 0
let captionless = 0

for (const meta of list) {
  const note = await fetchNote(meta.key)
  const { images, comments } = parseBody(note.body)
  const date = (note.publish_at ?? meta.publish_at ?? '').slice(0, 10)
  const noMatch = (note.name ?? '').match(/#(\d+)/)
  const ids = new Set()

  const imageEntries = images.map((img) => {
    const items = parseCaption(img.caption)
    const itemIds = items.map((it) => {
      const id = itemId(it.category, it.label)
      ids.add(id)
      const cur = itemMap.get(id)
      if (cur) {
        cur.count += 1
        if (date < cur.firstDate) cur.firstDate = date
        if (date > cur.lastDate) cur.lastDate = date
        cur.labelVotes[it.label] = (cur.labelVotes[it.label] ?? 0) + 1
      } else {
        itemMap.set(id, {
          id,
          category: it.category,
          label: it.label,
          count: 1,
          firstDate: date,
          lastDate: date,
          labelVotes: { [it.label]: 1 },
        })
      }
      return id
    })
    return { url: img.url, width: img.width, height: img.height, caption: img.caption, itemIds }
  })

  if (imageEntries.every((e) => e.itemIds.length === 0)) captionless++

  outfits.push({
    key: note.key,
    no: noMatch ? Number(noMatch[1]) : null,
    title: note.name ?? '',
    date,
    publishAt: note.publish_at ?? meta.publish_at,
    like: note.like_count ?? meta.like_count ?? 0,
    comment: comments.join('\n'),
    noteUrl: note.note_url,
    images: imageEntries,
    itemIds: [...ids],
  })
  done++
  if (done % 20 === 0) process.stdout.write(`\rfetching: ${done}/${list.length}`)
}
console.log(`\rfetched: ${done}/${list.length} (no-caption posts: ${captionless})`)

outfits.sort((a, b) => (a.publishAt < b.publishAt ? 1 : -1))

// 表示ラベルは最頻出の表記を採用
const items = [...itemMap.values()]
  .map(({ labelVotes, ...it }) => ({
    ...it,
    label: Object.entries(labelVotes).sort((a, b) => b[1] - a[1])[0][0],
  }))
  .sort((a, b) => b.count - a.count)

await writeFile(path.join(DATA_DIR, 'outfits.json'), JSON.stringify(outfits), 'utf8')
await writeFile(path.join(DATA_DIR, 'items.json'), JSON.stringify(items), 'utf8')
await writeFile(
  path.join(DATA_DIR, 'meta.json'),
  JSON.stringify({
    scrapedAt: new Date().toISOString(),
    outfitCount: outfits.length,
    itemCount: items.length,
    magazineUrl: `https://note.com/kokinoue/m/${MAGAZINE_KEY}`,
  }),
  'utf8',
)

const categories = {}
for (const it of items) categories[it.category] = (categories[it.category] ?? 0) + 1
console.log('outfits:', outfits.length, '/ items:', items.length)
console.log('categories:', JSON.stringify(categories))

// --- 5. 個体分割データ（splits.json）の整合性チェック ---
// scrapeはsplits.jsonに書き込まない。ここでは参照が生きているかの検証だけ行う
try {
  const splits = JSON.parse(await readFile(path.join(DATA_DIR, 'splits.json'), 'utf8'))
  const outfitKeys = new Set(outfits.map((o) => o.key))
  const itemIds = new Set(items.map((it) => it.id))
  let assigned = 0
  let orphanKeys = 0
  let orphanItems = 0
  for (const [baseId, def] of Object.entries(splits.items ?? {})) {
    if (!itemIds.has(baseId)) {
      orphanItems++
      console.warn(`WARN splits: アイテムID "${baseId}" が現データに存在しない`)
    }
    for (const sub of def.subs) {
      for (const key of sub.outfits) {
        if (outfitKeys.has(key)) assigned++
        else {
          orphanKeys++
          console.warn(`WARN splits: ${baseId}/${sub.label} の ${key} が記事一覧にない`)
        }
      }
    }
  }
  console.log(
    `splits check: 割当${assigned}件は全て有効${orphanKeys + orphanItems > 0 ? `（孤立: 記事${orphanKeys} / アイテム${orphanItems}）` : ''}`,
  )
} catch {
  console.log('splits check: splits.json なし（スキップ）')
}
