import { describe, expect, it, vi } from 'vitest'
import { saveImageFile, shareUrl, type ShareNavigator } from '../share'

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

describe('saveImageFile', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'tower-25.jpg', { type: 'image/jpeg' })

  it('共有シートにファイルを渡せる端末では共有シートを開く', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const download = vi.fn()

    await expect(
      saveImageFile(file, { title: '25体' }, { share, canShare: () => true }, download),
    ).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ files: [file], title: '25体' })
    expect(download).not.toHaveBeenCalled()
  })

  it('ファイルを共有できない環境ではダウンロードする', async () => {
    const share = vi.fn()
    const download = vi.fn()

    await expect(saveImageFile(file, {}, { share, canShare: () => false }, download)).resolves.toBe('downloaded')
    await expect(saveImageFile(file, {}, {}, download)).resolves.toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledTimes(2)
    expect(download).toHaveBeenCalledWith(file)
  })

  it('useShareSheet=false なら共有シートが使えてもダウンロードする', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const download = vi.fn()

    await expect(
      saveImageFile(file, { useShareSheet: false }, { share, canShare: () => true }, download),
    ).resolves.toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
  })

  it('共有シートを閉じただけならダウンロードに切り替えない', async () => {
    const aborted = new Error('cancelled')
    aborted.name = 'AbortError'
    const download = vi.fn()

    await expect(
      saveImageFile(file, {}, { share: vi.fn().mockRejectedValue(aborted), canShare: () => true }, download),
    ).resolves.toBe('cancelled')
    expect(download).not.toHaveBeenCalled()
  })

  it('共有シートが失敗したらダウンロードで代替する', async () => {
    const download = vi.fn()

    await expect(
      saveImageFile(file, {}, { share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), canShare: () => true }, download),
    ).resolves.toBe('downloaded')
    expect(download).toHaveBeenCalledWith(file)
  })
})
