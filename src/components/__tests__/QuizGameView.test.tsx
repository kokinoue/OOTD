import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Data } from '../../lib/useData'
import QuizGameView from '../QuizGameView'

describe('QuizGameView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('診断開始画面からゲーム自体を共有できる', () => {
    vi.stubGlobal('window', { location: { hash: '#/quiz' } })

    const html = renderToStaticMarkup(
      <QuizGameView data={{} as Data} onBack={() => undefined} />,
    )

    expect(html).toContain('title="このゲームのリンクを共有"')
  })
})
