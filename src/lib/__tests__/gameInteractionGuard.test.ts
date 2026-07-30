import { describe, expect, it } from 'vitest'
import {
  isGameCanvasTarget,
  shouldPreventGameBrowserGesture,
} from '../gameInteractionGuard'

function target({
  inMain = true,
  interactive = false,
  canvas = false,
}: {
  inMain?: boolean
  interactive?: boolean
  canvas?: boolean
} = {}): EventTarget {
  return {
    closest: (selector: string) => {
      if (selector === 'main') return inMain ? {} : null
      if (selector === 'main canvas') return inMain && canvas ? {} : null
      return interactive ? {} : null
    },
  } as unknown as EventTarget
}

describe('game interaction guard', () => {
  it('prevents browser gestures on non-interactive game content', () => {
    expect(shouldPreventGameBrowserGesture(target())).toBe(true)
    expect(shouldPreventGameBrowserGesture(target({ canvas: true }))).toBe(true)
  })

  it('preserves buttons, links, and content outside game main', () => {
    expect(shouldPreventGameBrowserGesture(target({ interactive: true }))).toBe(false)
    expect(shouldPreventGameBrowserGesture(target({ inMain: false }))).toBe(false)
    expect(shouldPreventGameBrowserGesture(null)).toBe(false)
  })

  it('limits pointer-default prevention to game canvases', () => {
    expect(isGameCanvasTarget(target({ canvas: true }))).toBe(true)
    expect(isGameCanvasTarget(target())).toBe(false)
    expect(isGameCanvasTarget(target({ inMain: false, canvas: true }))).toBe(false)
  })
})
