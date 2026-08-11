import { describe, expect, it, vi } from 'vitest'
import { shareUrl, type ShareNavigator } from '../share'

const data = { title: 'Outfit', url: 'https://example.com/#/fits?outfit=n1' }

describe('shareUrl', () => {
  it('端末の共有シートが使える場合はURLを共有する', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nav: ShareNavigator = { share, canShare: () => true, clipboard: { writeText } }

    await expect(shareUrl(data, nav)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith(data)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('共有シートがない場合はリンクをコピーする', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(shareUrl(data, { clipboard: { writeText } })).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('共有シートを閉じただけならエラーにしない', async () => {
    const aborted = new Error('cancelled')
    aborted.name = 'AbortError'
    const nav: ShareNavigator = {
      share: vi.fn().mockRejectedValue(aborted),
      canShare: () => true,
    }

    await expect(shareUrl(data, nav)).resolves.toBe('cancelled')
  })
})
