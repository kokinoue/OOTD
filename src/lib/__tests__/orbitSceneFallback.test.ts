import { describe, expect, it, vi } from 'vitest'
import { createCompatibleOrbitScene } from '../orbitSceneFallback'
import type { OrbitSceneController } from '../orbitScene'

const controller = (): OrbitSceneController => ({
  setIndex: vi.fn(),
  setLayoutMode: vi.fn(),
  setTrace: vi.fn(),
  dispose: vi.fn(),
})

const options = {
  container: {
    querySelectorAll: vi.fn(() => []),
  },
} as never

describe('createCompatibleOrbitScene', () => {
  it('uses WebGL when the primary renderer starts successfully', () => {
    const webglController = controller()
    const canvasFactory = vi.fn(() => controller())

    const result = createCompatibleOrbitScene(
      options,
      () => webglController,
      canvasFactory,
      () => true,
    )

    expect(result).toBe(webglController)
    expect(canvasFactory).not.toHaveBeenCalled()
  })

  it('uses Canvas 2D when WebGL context creation fails', () => {
    const canvasController = controller()
    const canvasFactory = vi.fn(() => canvasController)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = createCompatibleOrbitScene(
      options,
      () => {
        throw new Error('Error creating WebGL context')
      },
      canvasFactory,
      () => true,
    )

    expect(result).toBe(canvasController)
    expect(canvasFactory).toHaveBeenCalledOnce()
  })

  it('skips WebGL initialization when the browser has no WebGL context', () => {
    const webglFactory = vi.fn(() => controller())
    const canvasController = controller()

    const result = createCompatibleOrbitScene(
      options,
      webglFactory,
      () => canvasController,
      () => false,
    )

    expect(result).toBe(canvasController)
    expect(webglFactory).not.toHaveBeenCalled()
  })
})
