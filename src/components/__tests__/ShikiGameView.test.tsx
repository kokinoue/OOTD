import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import overridesJson from '../../data/overrides.json'
import splitsJson from '../../data/splits.json'
import { I18nProvider } from '../../lib/i18n'
import { buildData } from '../../lib/useData'
import type { Overrides, SplitsFile } from '../../types'
import ShikiGameView from '../ShikiGameView'

const data = buildData(
  { renames: {}, categories: {}, merges: {}, hidden: [], colors: {}, ...(overridesJson as Partial<Overrides>) },
  splitsJson as SplitsFile,
)

const stubBrowser = (locale: string, saved: Record<string, string> = {}) => {
  const storage = { getItem: (k: string) => saved[k] ?? (k === 'ootd-locale' ? locale : null), setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('window', { location: { hash: '#/shiki' }, localStorage: storage })
  vi.stubGlobal('localStorage', storage)
}

const render = () =>
  renderToStaticMarkup(
    <I18nProvider>
      <ShikiGameView data={data} onBack={() => undefined} />
    </I18nProvider>,
  )

describe('ShikiGameView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('タイトルで、今日のお題と遊べる年を選べて、ゲーム自体を共有できる', () => {
    stubBrowser('ja')
    const html = render()
    expect(html).toContain('今日のお題')
    expect(html).toContain('2024年の名場面')
    expect(html).toContain('おまかせ')
    expect(html).toContain('title="このゲームのリンクを共有"')
    expect(html).not.toContain('つづきから')
  })

  it('自己ベストがある年は、点数とランクを出す', () => {
    stubBrowser('ja', { 'shiki.best.v1': JSON.stringify({ 2024: 3100 }) })
    expect(render()).toContain('自己ベスト 3,100 点（ランクS）')
  })

  it('英語でも文言が欠けない', () => {
    stubBrowser('en')
    const html = render()
    expect(html).toContain('FOUR SEASONS COMMUTE')
    expect(html).toContain('Daily challenge')
    expect(html).not.toMatch(/[ぁ-ん]/)
  })
})
