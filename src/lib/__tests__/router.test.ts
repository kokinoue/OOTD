import { describe, expect, it } from 'vitest'
import { defaultFilters, defaultItemsFilters } from '../../App'
import { decodeHash, encodeHash } from '../router'

describe('outfit route', () => {
  it('開いているコーデを共有可能な hash に含める', () => {
    expect(
      encodeHash({
        view: 'fits',
        filters: defaultFilters,
        itemsFilters: defaultItemsFilters,
        outfitKey: 'n0123#look',
      }),
    ).toBe('/fits?outfit=n0123%23look')
  })

  it('共有 hash から開くコーデを復元する', () => {
    expect(decodeHash('#/fits?outfit=n0123%23look').outfitKey).toBe('n0123#look')
  })

  it('コーデ指定は FITS 以外の画面へ持ち越さない', () => {
    expect(decodeHash('#/items?outfit=n0123').outfitKey).toBeNull()
  })
})
