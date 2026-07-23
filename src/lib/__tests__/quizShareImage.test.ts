import { describe, expect, it } from 'vitest'
import { getStoryVerticalLayout } from '../quizShareImage'

describe('getStoryVerticalLayout', () => {
  it('keeps the score card clear of the footer', () => {
    const layout = getStoryVerticalLayout(488)

    expect(layout.footerTop - layout.barsCardBottom).toBeGreaterThanOrEqual(40)
    expect(layout.spriteHeight).toBeGreaterThan(0)
    expect(layout.spriteHeight).toBeLessThanOrEqual(720)
  })

  it('shrinks the sprite when the result copy wraps', () => {
    const regular = getStoryVerticalLayout(488)
    const wrapped = getStoryVerticalLayout(584)

    expect(wrapped.spriteHeight).toBe(regular.spriteHeight - 96)
    expect(wrapped.barsCardBottom).toBe(regular.barsCardBottom)
  })
})
