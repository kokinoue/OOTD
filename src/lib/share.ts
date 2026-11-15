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

export type SaveFileResult = 'shared' | 'downloaded' | 'cancelled'

export type FileShareNavigator = {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data?: ShareData) => boolean
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 生成した画像ファイルを端末に渡す。
 * 共有シートが使えればそちらへ（iOS は「画像を保存」で写真アプリに入る。ダウンロードだと
 * 「ファイル」に入ってしまう）、使えなければダウンロードする。
 * useShareSheet=false で常にダウンロードにできる（PC では共有シートより素直なため）。
 */
export async function saveImageFile(
  file: File,
  opts: { title?: string; useShareSheet?: boolean } = {},
  nav: FileShareNavigator = navigator,
  download: (file: File) => void = downloadFile,
): Promise<SaveFileResult> {
  const { title, useShareSheet = true } = opts
  let canUseShare = false
  if (useShareSheet && typeof nav.share === 'function' && nav.canShare) {
    try {
      canUseShare = nav.canShare({ files: [file] })
    } catch {
      canUseShare = false
    }
  }
  if (canUseShare && nav.share) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (error) {
      if (isAbortError(error)) return 'cancelled'
      // それ以外（iOS のユーザー操作判定切れ等）はダウンロードへフォールバック
    }
  }
  download(file)
  return 'downloaded'
}
