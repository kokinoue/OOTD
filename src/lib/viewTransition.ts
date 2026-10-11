import { flushSync } from 'react-dom'

// 一覧のサムネとモーダルの写真を View Transitions でつなぎ、同じ写真が拡大・縮小するように見せる。
// 非対応ブラウザ・モーション控えめ設定では、ただ状態を更新するだけ（今までと同じ見た目）。
// モーダル側の写真は styles.css で常に view-transition-name: outfit-hero を持つ。
// 同名の要素が2つあると遷移が中断されるため、サムネ側の名前は遷移の瞬間だけ付け外しする。
const HERO = 'outfit-hero'
const MODAL_HERO = '.modal-hero'

type ViewTransition = { finished: Promise<void>; ready: Promise<void> }
type DocumentWithVT = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => ViewTransition
}

const canAnimate = () =>
  typeof (document as DocumentWithVT).startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isOnScreen = (el: Element | null): el is HTMLElement => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight
}

// 新しい状態のスナップショットは callback 完了時に撮られる。写真の読み込みを少しだけ待ち、
// 空の枠に向かって拡大してしまうのを防ぐ（待ちすぎると操作が重く感じるので上限を設ける）。
const waitForImage = (img: HTMLImageElement | null) =>
  !img || img.complete
    ? Promise.resolve()
    : Promise.race([
        img.decode().catch(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
      ])

// タブが非表示のときなどは遷移がスキップされ ready が reject される（更新自体は行われる）。
// 未処理の reject としてコンソールを汚さないよう受け止めておく。
const settle = (vt: ViewTransition, cleanup: () => void) => {
  vt.ready.catch(() => undefined)
  vt.finished.catch(() => undefined).finally(cleanup)
}

/** サムネ(from)からモーダルを開く */
export function openWithHero(from: HTMLElement | null, update: () => void) {
  if (!isOnScreen(from) || !canAnimate()) {
    update()
    return
  }
  from.style.viewTransitionName = HERO
  const vt = (document as DocumentWithVT).startViewTransition!(async () => {
    from.style.viewTransitionName = ''
    flushSync(update)
    await waitForImage(document.querySelector<HTMLImageElement>(MODAL_HERO))
  })
  settle(vt, () => {
    from.style.viewTransitionName = ''
  })
}

/** モーダルを閉じ、一覧のサムネ(to)へ写真を戻す */
export function closeWithHero(to: HTMLElement | null, update: () => void) {
  if (!isOnScreen(to) || !isOnScreen(document.querySelector(MODAL_HERO)) || !canAnimate()) {
    update()
    return
  }
  const vt = (document as DocumentWithVT).startViewTransition!(() => {
    flushSync(update)
    to.style.viewTransitionName = HERO
  })
  settle(vt, () => {
    to.style.viewTransitionName = ''
  })
}

/** 一覧上のコーデのサムネ画像（カード・カレンダーのマス共通で data-outfit-key を目印にする） */
export const findOutfitThumb = (key: string) =>
  document.querySelector<HTMLElement>(`[data-outfit-key="${CSS.escape(key)}"] img`)
