import { describe, expect, it } from 'vitest'
import { parseThemePref, resolveTheme } from '../theme'

describe('theme', () => {
  it('treats anything but an explicit light/dark as auto', () => {
    expect(parseThemePref('light')).toBe('light')
    expect(parseThemePref('dark')).toBe('dark')
    expect(parseThemePref(null)).toBe('auto')
    expect(parseThemePref('night')).toBe('auto')
  })

  it('follows the system setting only in auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
