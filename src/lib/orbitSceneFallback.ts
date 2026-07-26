import { createOrbitCanvasScene } from './orbitCanvasScene'
import {
  createOrbitScene,
  type OrbitSceneController,
  type OrbitSceneOptions,
} from './orbitScene'

type SceneFactory = (options: OrbitSceneOptions) => OrbitSceneController

const browserSupportsWebgl = () => {
  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
}

export function createCompatibleOrbitScene(
  options: OrbitSceneOptions,
  createWebgl: SceneFactory = createOrbitScene,
  createCanvas: SceneFactory = createOrbitCanvasScene,
  canUseWebgl: () => boolean = browserSupportsWebgl,
): OrbitSceneController {
  if (!canUseWebgl()) return createCanvas(options)

  try {
    return createWebgl(options)
  } catch (error) {
    console.warn('WebGLを開始できないためCanvas 2Dで軌道を表示します:', error)
    options.container.querySelectorAll('.orbit-webgl').forEach((element) => element.remove())
    return createCanvas(options)
  }
}
