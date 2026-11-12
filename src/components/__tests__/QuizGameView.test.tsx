import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../lib/i18n'
import type { Data } from '../../lib/useData'
import QuizGameView from '../QuizGameView'

describe('QuizGameView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('診断開始画面からゲーム自体を共有できる', () => {
    vi.stubGlobal('window', {
      location: { hash: '#/quiz' },
      localStorage: { getItem: () => 'ja' },
    })

    const html = renderToStaticMarkup(
      <I18nProvider>
        <QuizGameView data={{} as Data} onBack={() => undefined} />
      </I18nProvider>,
    )

    expect(html).toContain('title="このゲームのリンクを共有"')
  })
})
