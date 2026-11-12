export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'error'

export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data?: ShareData) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError'

/** 共有シートを優先し、使えない環境ではURLのコピーへフォールバックする。 */
export async function shareUrl(
  data: ShareData & { url: string },
  nav: ShareNavigator = navigator,
): Promise<ShareResult> {
  let canUseShare = typeof nav.share === 'function'
  if (canUseShare && nav.canShare) {
    try {
      canUseShare = nav.canShare(data)
    } catch {
      canUseShare = false
    }
  }

  if (canUseShare && nav.share) {
    try {
      await nav.share(data)
      return 'shared'
    } catch (error) {
      if (isAbortError(error)) return 'cancelled'
      // 共有シート自体の失敗時も、リンクコピーなら完了できる可能性がある。
    }
  }

  try {
    if (!nav.clipboard) return 'error'
    await nav.clipboard.writeText(data.url)
    return 'copied'
  } catch {
    return 'error'
  }
}
