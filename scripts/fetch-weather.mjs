// 東京の日次気温＋天気を Open-Meteo から取得して src/data/weather.json を生成する
// usage: node scripts/fetch-weather.mjs
// 出力: { "2022-03-01": { max, min, mean, code }, ... }
// code = WMO weather_code（晴/曇/雨/雪の判定に使う。気温・天気フィルタの共通基盤）
//
// archive API は確定値（数日のラグあり）。直近はラグで欠けるので forecast API の
// past_days で補完する。気温(衣替え)機能の共通データ基盤。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'src', 'data')
// 東京（note社・撮影地周辺）
const LAT = 35.68
const LON = 139.76

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

// コーデの最古日を取得範囲の起点にする
const outfits = JSON.parse(await readFile(path.join(DATA_DIR, 'outfits.json'), 'utf8'))
const dates = outfits.map((o) => o.date).sort()
const start = dates[0]
const todayIso = new Date().toISOString().slice(0, 10)

const daily = {}
const put = (d, max, min, mean, code) => {
  if (max == null && min == null) return
  daily[d] = {
    max: max ?? null,
    min: min ?? null,
    mean: mean ?? (max != null && min != null ? Math.round(((max + min) / 2) * 10) / 10 : null),
    code: code ?? null,
  }
}

// 1) archive: start 〜 今日
{
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
    `&start_date=${start}&end_date=${todayIso}` +
    `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,weather_code&timezone=Asia%2FTokyo`
  const j = await fetchJson(url)
  const t = j.daily.time
  for (let i = 0; i < t.length; i++) {
    put(
      t[i],
      j.daily.temperature_2m_max[i],
      j.daily.temperature_2m_min[i],
      j.daily.temperature_2m_mean[i],
      j.daily.weather_code?.[i],
    )
  }
  console.log(`archive: ${t.length}日分`)
}

// 2) forecast の past_days で直近を補完（archiveのラグ埋め）
{
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code&past_days=30&forecast_days=1&timezone=Asia%2FTokyo`
  const j = await fetchJson(url)
  const t = j.daily.time
  let filled = 0
  for (let i = 0; i < t.length; i++) {
    if (!daily[t[i]] && j.daily.temperature_2m_max[i] != null) {
      put(
        t[i],
        j.daily.temperature_2m_max[i],
        j.daily.temperature_2m_min[i],
        undefined,
        j.daily.weather_code?.[i],
      )
      filled++
    }
  }
  console.log(`forecast past_days: ${filled}日分を補完`)
}

await mkdir(DATA_DIR, { recursive: true })
await writeFile(path.join(DATA_DIR, 'weather.json'), JSON.stringify(daily), 'utf8')

// コーデ日でカバーできなかった日を報告
const missing = dates.filter((d) => !daily[d])
const allDays = Object.keys(daily).length
console.log(`weather.json: ${allDays}日分`)
console.log(`コーデ${dates.length}件中、気温なし: ${missing.length}件`, missing.slice(0, 5))
