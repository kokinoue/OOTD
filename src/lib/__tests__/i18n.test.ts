import { describe, expect, it } from 'vitest'
import { detectLocale, translate } from '../i18n'

describe('i18n', () => {
  it('prefers a saved locale over browser languages', () => {
    expect(detectLocale('en', ['ja-JP'])).toBe('en')
    expect(detectLocale('ja', ['en-US'])).toBe('ja')
  })

  it('detects Japanese browsers and otherwise defaults to English', () => {
    expect(detectLocale(null, ['en-US', 'ja-JP'])).toBe('ja')
    expect(detectLocale(null, ['en-US', 'fr-FR'])).toBe('en')
  })

  it('translates and interpolates English UI text', () => {
    expect(
      translate('en', '近い順に {shown} 件を表示しています（全 {total} 件）', {
        shown: 12,
        total: 42,
      }),
    ).toBe('Showing the 12 closest matches out of 42.')
  })

  it('keeps Japanese text and interpolates variables', () => {
    expect(translate('ja', '{count}日', { count: 3 })).toBe('3日')
  })

  it('handles dynamic labels and falls back safely', () => {
    expect(translate('en', '髪色: 金')).toBe('Hair color: Blond')
    expect(translate('en', '未登録の文言')).toBe('未登録の文言')
  })
})
