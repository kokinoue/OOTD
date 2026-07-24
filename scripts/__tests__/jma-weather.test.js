import { describe, expect, it } from 'vitest'
import { classifyJmaWeather, parseJmaDailyWeather } from '../lib/jma-weather.mjs'

describe('classifyJmaWeather', () => {
  it('昼概況の先頭にある主天気を4分類する', () => {
    expect(classifyJmaWeather('晴一時曇')).toBe('sunny')
    expect(classifyJmaWeather('薄曇一時晴')).toBe('cloudy')
    expect(classifyJmaWeather('雨後時々霧雨一時曇')).toBe('rain')
    expect(classifyJmaWeather('雪後曇')).toBe('snow')
  })

  it('空欄は判定しない', () => {
    expect(classifyJmaWeather('')).toBeNull()
    expect(classifyJmaWeather('--')).toBeNull()
  })
})

describe('parseJmaDailyWeather', () => {
  it('日別表から昼（06:00–18:00）の天気概況だけを取り出す', () => {
    const cells = (values) =>
      values.map((value) => `<td class="data_0_0">${value}</td>`).join('')
    const filler = Array.from({ length: 18 }, () => '--')
    const html = `
      <table id="tablefix1">
        <tr class="mtx"><th>日</th></tr>
        <tr class="mtx">${cells(['21', ...filler, '曇時々雨', '雨'])}</tr>
        <tr class="mtx">${cells([
          '<a href="hourly_s1.php?day=22">22</a>',
          ...filler,
          '晴一時曇',
          '晴',
        ])}</tr>
      </table>
    `

    expect(parseJmaDailyWeather(html, 2026, 7)).toEqual({
      '2026-07-21': { summary: '曇時々雨', sky: 'cloudy' },
      '2026-07-22': { summary: '晴一時曇', sky: 'sunny' },
    })
  })
})
