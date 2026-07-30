import { useEffect, useRef } from 'react'

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, [contenteditable="true"], [data-game-browser-gesture]'

type ClosestTarget = {
  closest: (selector: string) => Element | null
}

const asClosestTarget = (target: EventTarget | null): ClosestTarget | null => {
  if (!target || typeof (target as Partial<ClosestTarget>).closest !== 'function') return null
  return target as unknown as ClosestTarget
}

/** ゲーム画面内の非操作要素だけ、選択・長押しメニュー・ドラッグを抑止する。 */
export function shouldPreventGameBrowserGesture(target: EventTarget | null): boolean {
  const element = asClosestTarget(target)
  if (!element?.closest('main')) return false
  return !element.closest(INTERACTIVE_SELECTOR)
}

/** スクロール等の既定ポインター動作を止める対象はCanvasに限定する。 */
export function isGameCanvasTarget(target: EventTarget | null): boolean {
  return asClosestTarget(target)?.closest('main canvas') != null
}

/**
 * 個別ゲームを包むAppルートへ、モバイルブラウザのゲームに不要な既定動作を
 * 一括で抑止する。ボタン・リンク等は除外するため通常操作を維持する。
 */
export function useGameInteractionGuard(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    if (!root) return

    const preventNonInteractiveGesture = (event: Event) => {
      if (shouldPreventGameBrowserGesture(event.target)) event.preventDefault()
    }
    const preventCanvasPointerDefault = (event: PointerEvent) => {
      if (isGameCanvasTarget(event.target)) event.preventDefault()
    }

    root.addEventListener('pointerdown', preventCanvasPointerDefault, {
      capture: true,
      passive: false,
    })
    root.addEventListener('contextmenu', preventNonInteractiveGesture)
    root.addEventListener('selectstart', preventNonInteractiveGesture)
    root.addEventListener('dragstart', preventNonInteractiveGesture)
    return () => {
      root.removeEventListener('pointerdown', preventCanvasPointerDefault, true)
      root.removeEventListener('contextmenu', preventNonInteractiveGesture)
      root.removeEventListener('selectstart', preventNonInteractiveGesture)
      root.removeEventListener('dragstart', preventNonInteractiveGesture)
    }
  }, [enabled])

  return rootRef
}
