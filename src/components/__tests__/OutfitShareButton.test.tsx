import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../lib/i18n'
import type { Outfit } from '../../types'
import OutfitShareButton from '../OutfitShareButton'

const outfit: Outfit = {
  key: 'n0123',
  no: 123,
  title: '今日の出勤服#123',
  date: '2026-08-11',
  publishAt: '2026-08-11T19:00:00+09:00',
  like: 10,
  comment: '',
  noteUrl: '',
  images: [],
  itemIds: [],
}

describe('OutfitShareButton', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('コーデ単体の共有ボタンを表示する', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'ja' },
    })

    const html = renderToStaticMarkup(
      <I18nProvider>
        <OutfitShareButton outfit={outfit} />
      </I18nProvider>,
    )

    expect(html).toContain('title="このコーデのリンクを共有"')
    expect(html).toContain('共有')
  })
})
