import * as THREE from 'three'
import {
  clampOrbitIndex,
  ORBIT_ANGLE_STEP,
  ORBIT_RADIUS,
  ORBIT_Y_STEP,
  type OrbitEntry,
  visibleOrbitRange,
} from './orbit'

type SpriteSize = { w: number; h: number }

type OrbitSceneOptions = {
  container: HTMLElement
  entries: OrbitEntry[]
  sprites: Record<string, SpriteSize>
  assetBase: string
  initialIndex: number
  onIndexChange: (index: number) => void
}

export type OrbitSceneController = {
  setIndex: (index: number) => void
  dispose: () => void
}

const CAMERA_RADIUS = 12.6
const TEXTURE_WINDOW_RADIUS = 20
const SELECTED_SPRITE_HEIGHT = 2.5
const DEFAULT_SPRITE_HEIGHT = 1.9
const SEASON_COLORS = [0x9ad0b1, 0xf2b366, 0xc7865a, 0x8db9d6] as const

const seasonIndex = (month: number) => {
  if (month >= 3 && month <= 5) return 0
  if (month >= 6 && month <= 8) return 1
  if (month >= 9 && month <= 11) return 2
  return 3
}

const random = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function createOrbitScene({
  container,
  entries,
  sprites,
  assetBase,
  initialIndex,
  onIndexChange,
}: OrbitSceneOptions): OrbitSceneController {
  if (entries.length === 0) throw new Error('Orbit requires at least one outfit')

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.className = 'orbit-webgl'
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute(
    'aria-label',
    '出勤服の3Dタイムライン。上下キー、マウスホイール、ドラッグで年代を移動できます',
  )
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x090b12, 0.025)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120)

  const orbitPositions = new Float32Array(entries.length * 3)
  const orbitColors = new Float32Array(entries.length * 3)
  const color = new THREE.Color()
  for (const entry of entries) {
    const offset = entry.index * 3
    orbitPositions[offset] = entry.position.x
    orbitPositions[offset + 1] = entry.position.y
    orbitPositions[offset + 2] = entry.position.z
    const month = Number(entry.outfit.date.slice(5, 7))
    color.setHex(SEASON_COLORS[seasonIndex(month)])
    orbitColors[offset] = color.r
    orbitColors[offset + 1] = color.g
    orbitColors[offset + 2] = color.b
  }

  const pointGeometry = new THREE.BufferGeometry()
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(orbitPositions, 3))
  pointGeometry.setAttribute('color', new THREE.BufferAttribute(orbitColors, 3))
  const pointMaterial = new THREE.PointsMaterial({
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
  })
  scene.add(new THREE.Points(pointGeometry, pointMaterial))

  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(orbitPositions.slice(), 3))
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xaab3cb,
    transparent: true,
    opacity: 0.12,
  })
  scene.add(new THREE.Line(lineGeometry, lineMaterial))

  const ringGeometries: THREE.BufferGeometry[] = []
  const ringMaterials: THREE.Material[] = []
  const seenYears = new Set<number>()
  for (const entry of entries) {
    if (seenYears.has(entry.year)) continue
    seenYears.add(entry.year)
    const geometry = new THREE.TorusGeometry(ORBIT_RADIUS, 0.018, 5, 96)
    const material = new THREE.MeshBasicMaterial({
      color: 0xdce2f1,
      transparent: true,
      opacity: 0.16,
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = Math.PI / 2
    ring.position.y = entry.position.y
    scene.add(ring)
    ringGeometries.push(geometry)
    ringMaterials.push(material)
  }

  const starCount = 560
  const starPositions = new Float32Array(starCount * 3)
  for (let index = 0; index < starCount; index += 1) {
    const offset = index * 3
    const angle = random(index + 1) * Math.PI * 2
    const radius = 14 + random(index + 41) * 22
    starPositions[offset] = Math.cos(angle) * radius
    starPositions[offset + 1] = random(index + 101) * entries.at(-1)!.position.y
    starPositions[offset + 2] = Math.sin(angle) * radius
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({
    color: 0xdde6ff,
    size: 0.055,
    transparent: true,
    opacity: 0.38,
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  scene.add(stars)

  const haloGeometry = new THREE.RingGeometry(0.78, 0.92, 48)
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const halo = new THREE.Mesh(haloGeometry, haloMaterial)
  scene.add(halo)

  const loader = new THREE.TextureLoader()
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
  const activeSprites = new Map<number, THREE.Sprite>()
  const pendingSprites = new Set<number>()
  let desiredIndices = new Set<number>()
  let activeCenter = -100
  let disposed = false
  let targetIndex = clampOrbitIndex(initialIndex, entries.length)
  let currentIndex = targetIndex
  let announcedIndex = -1
  let frame = 0
  let dragging = false
  let dragMoved = false
  let dragStartY = 0
  let dragStartIndex = targetIndex
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let previousFrameTime = performance.now()
  let elapsedTime = 0

  const spriteUrl = (entry: OrbitEntry) => `${assetBase}cutouts/${entry.outfit.key}.webp`

  const removeSprite = (index: number) => {
    const sprite = activeSprites.get(index)
    if (!sprite) return
    scene.remove(sprite)
    sprite.material.map?.dispose()
    sprite.material.dispose()
    activeSprites.delete(index)
  }

  const refreshTextureWindow = (center: number) => {
    if (Math.abs(center - activeCenter) < 3 && activeSprites.size > 0) return
    activeCenter = center
    desiredIndices = new Set(visibleOrbitRange(center, entries.length, TEXTURE_WINDOW_RADIUS))

    for (const index of activeSprites.keys()) {
      if (!desiredIndices.has(index)) removeSprite(index)
    }

    for (const index of desiredIndices) {
      if (activeSprites.has(index) || pendingSprites.has(index)) continue
      const entry = entries[index]
      const size = sprites[entry.outfit.key]
      if (!size) continue
      pendingSprites.add(index)
      loader.load(
        spriteUrl(entry),
        (texture) => {
          pendingSprites.delete(index)
          if (disposed || !desiredIndices.has(index)) {
            texture.dispose()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          texture.anisotropy = maxAnisotropy
          const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.04,
            depthWrite: false,
          })
          const sprite = new THREE.Sprite(material)
          const height = DEFAULT_SPRITE_HEIGHT
          const width = height * (size.w / size.h)
          sprite.position.set(entry.position.x, entry.position.y, entry.position.z)
          sprite.scale.set(width, height, 1)
          sprite.userData = { index, width, height }
          activeSprites.set(index, sprite)
          scene.add(sprite)
        },
        undefined,
        () => pendingSprites.delete(index),
      )
    }
  }

  const setPointer = (event: PointerEvent) => {
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
  }

  const hitIndex = (event: PointerEvent) => {
    setPointer(event)
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects([...activeSprites.values()], false)
    return hits.length > 0 ? (hits[0].object.userData.index as number) : null
  }

  const setIndex = (index: number) => {
    targetIndex = clampOrbitIndex(index, entries.length)
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    setIndex(targetIndex - event.deltaY * 0.028)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    dragging = true
    dragMoved = false
    dragStartY = event.clientY
    dragStartIndex = targetIndex
    renderer.domElement.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (dragging) {
      const delta = event.clientY - dragStartY
      if (Math.abs(delta) > 4) dragMoved = true
      setIndex(dragStartIndex + delta * 0.075)
      renderer.domElement.style.cursor = 'grabbing'
      return
    }
    renderer.domElement.style.cursor = hitIndex(event) == null ? 'grab' : 'pointer'
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    renderer.domElement.releasePointerCapture(event.pointerId)
    renderer.domElement.style.cursor = 'grab'
    if (!dragMoved) {
      const index = hitIndex(event)
      if (index != null) setIndex(index)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    let next: number | null = null
    if (event.key === 'ArrowDown') next = Math.round(targetIndex) - 1
    if (event.key === 'ArrowUp') next = Math.round(targetIndex) + 1
    if (event.key === 'PageDown') next = Math.round(targetIndex) - 12
    if (event.key === 'PageUp') next = Math.round(targetIndex) + 12
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = entries.length - 1
    if (next == null) return
    event.preventDefault()
    setIndex(next)
  }

  const resize = () => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)
  renderer.domElement.addEventListener('keydown', onKeyDown)

  const animate = (frameTime: number) => {
    const delta = Math.min((frameTime - previousFrameTime) / 1000, 0.05)
    previousFrameTime = frameTime
    elapsedTime += delta
    const smoothing = reduceMotion ? 1 : 1 - Math.exp(-delta * 7)
    currentIndex += (targetIndex - currentIndex) * smoothing
    const entryIndex = Math.round(currentIndex)
    const entry = entries[entryIndex]
    const cameraAngle = currentIndex * ORBIT_ANGLE_STEP
    const cameraY = currentIndex * ORBIT_Y_STEP

    camera.position.set(
      Math.sin(cameraAngle) * CAMERA_RADIUS,
      cameraY + 0.22,
      Math.cos(cameraAngle) * CAMERA_RADIUS,
    )
    camera.lookAt(0, cameraY, 0)

    halo.position.set(entry.position.x, entry.position.y, entry.position.z)
    halo.quaternion.copy(camera.quaternion)
    halo.scale.setScalar(1 + Math.sin(elapsedTime * 2.4) * (reduceMotion ? 0 : 0.035))

    for (const [index, sprite] of activeSprites) {
      const distance = Math.abs(index - currentIndex)
      const selected = index === entryIndex
      const { width, height } = sprite.userData as { width: number; height: number }
      const targetHeight = selected ? SELECTED_SPRITE_HEIGHT : DEFAULT_SPRITE_HEIGHT
      const scale = targetHeight / height
      sprite.scale.set(width * scale, targetHeight, 1)
      sprite.material.opacity = Math.max(0.22, 1 - distance / (TEXTURE_WINDOW_RADIUS + 4))
    }

    if (!reduceMotion) stars.rotation.y += delta * 0.006
    if (Math.abs(targetIndex - currentIndex) < TEXTURE_WINDOW_RADIUS + 6) {
      refreshTextureWindow(entryIndex)
    }
    if (announcedIndex !== entryIndex) {
      announcedIndex = entryIndex
      onIndexChange(entryIndex)
    }

    renderer.render(scene, camera)
    frame = window.requestAnimationFrame(animate)
  }
  refreshTextureWindow(Math.round(currentIndex))
  animate(previousFrameTime)

  return {
    setIndex,
    dispose: () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('keydown', onKeyDown)
      for (const index of [...activeSprites.keys()]) removeSprite(index)
      pointGeometry.dispose()
      pointMaterial.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      starGeometry.dispose()
      starMaterial.dispose()
      haloGeometry.dispose()
      haloMaterial.dispose()
      for (const geometry of ringGeometries) geometry.dispose()
      for (const material of ringMaterials) material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
