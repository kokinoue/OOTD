import * as THREE from 'three'
import {
  clampOrbitIndex,
  ORBIT_RADIUS,
  ORBIT_Y_STEP,
  type OrbitColorPoint,
  type OrbitEntry,
  visibleOrbitRange,
} from './orbit'
import type { Sky } from './weather'

type SpriteSize = { w: number; h: number }

type OrbitSceneOptions = {
  container: HTMLElement
  entries: OrbitEntry[]
  sprites: Record<string, SpriteSize>
  assetBase: string
  initialIndex: number
  colorLayout: OrbitColorPoint[]
  colorSwatches: Record<string, string>
  weatherKinds: Array<Sky | null>
  onIndexChange: (index: number) => void
}

export type OrbitSceneController = {
  setIndex: (index: number) => void
  setLayoutMode: (mode: 'time' | 'color') => void
  setTrace: (indices: number[], color?: string) => void
  dispose: () => void
}

const CAMERA_RADIUS = 12.6
const TEXTURE_WINDOW_RADIUS = 20
const SELECTED_SPRITE_HEIGHT = 2.5
const DEFAULT_SPRITE_HEIGHT = 1.9
const SEASON_COLORS = [0x9ad0b1, 0xf2b366, 0xc7865a, 0x8db9d6] as const
const WEATHER_OPACITY: Record<Sky, number> = {
  sunny: 0.5,
  cloudy: 0.22,
  rain: 0.46,
  snow: 0.72,
}

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
  colorLayout,
  colorSwatches,
  weatherKinds,
  onIndexChange,
}: OrbitSceneOptions): OrbitSceneController {
  if (entries.length === 0) throw new Error('Orbit requires at least one outfit')
  if (colorLayout.length !== entries.length) throw new Error('Orbit color layout is incomplete')

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

  const timePositions = new Float32Array(entries.length * 3)
  const colorPositions = new Float32Array(entries.length * 3)
  const visualPositions = new Float32Array(entries.length * 3)
  const orbitColors = new Float32Array(entries.length * 3)
  const colorModeColors = new Float32Array(entries.length * 3)
  const color = new THREE.Color()
  for (const entry of entries) {
    const offset = entry.index * 3
    timePositions[offset] = entry.position.x
    timePositions[offset + 1] = entry.position.y
    timePositions[offset + 2] = entry.position.z
    colorPositions[offset] = colorLayout[entry.index].position.x
    colorPositions[offset + 1] = colorLayout[entry.index].position.y
    colorPositions[offset + 2] = colorLayout[entry.index].position.z
    visualPositions[offset] = entry.position.x
    visualPositions[offset + 1] = entry.position.y
    visualPositions[offset + 2] = entry.position.z
    const month = Number(entry.outfit.date.slice(5, 7))
    color.setHex(SEASON_COLORS[seasonIndex(month)])
    orbitColors[offset] = color.r
    orbitColors[offset + 1] = color.g
    orbitColors[offset + 2] = color.b
    color.set(colorSwatches[colorLayout[entry.index].color ?? ''] ?? '#8f94a3')
    colorModeColors[offset] = color.r
    colorModeColors[offset + 1] = color.g
    colorModeColors[offset + 2] = color.b
  }

  const pointGeometry = new THREE.BufferGeometry()
  const pointPositionAttribute = new THREE.BufferAttribute(visualPositions, 3)
  const pointColorAttribute = new THREE.BufferAttribute(orbitColors.slice(), 3)
  pointGeometry.setAttribute('position', pointPositionAttribute)
  pointGeometry.setAttribute('color', pointColorAttribute)
  const pointMaterial = new THREE.PointsMaterial({
    size: 0.11,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
  })
  scene.add(new THREE.Points(pointGeometry, pointMaterial))

  const lineGeometry = new THREE.BufferGeometry()
  const linePositionAttribute = new THREE.BufferAttribute(visualPositions, 3)
  lineGeometry.setAttribute('position', linePositionAttribute)
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xaab3cb,
    transparent: true,
    opacity: 0.12,
  })
  scene.add(new THREE.Line(lineGeometry, lineMaterial))

  const ringGeometries: THREE.BufferGeometry[] = []
  const ringMaterials: THREE.MeshBasicMaterial[] = []
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

  const traceGeometry = new THREE.BufferGeometry()
  const traceLineMaterial = new THREE.LineBasicMaterial({
    color: 0xd8cdff,
    transparent: true,
    opacity: 0,
    depthTest: false,
  })
  const tracePointMaterial = new THREE.PointsMaterial({
    color: 0xf4f0ff,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthTest: false,
  })
  const traceLine = new THREE.Line(traceGeometry, traceLineMaterial)
  const tracePoints = new THREE.Points(traceGeometry, tracePointMaterial)
  traceLine.renderOrder = 4
  tracePoints.renderOrder = 5
  traceLine.visible = false
  tracePoints.visible = false
  scene.add(traceLine, tracePoints)

  const weatherAnchor = new THREE.Group()
  scene.add(weatherAnchor)

  const rainCount = 84
  const rainPositions = new Float32Array(rainCount * 6)
  for (let index = 0; index < rainCount; index += 1) {
    const offset = index * 6
    const x = (random(index + 701) - 0.5) * 9
    const y = (random(index + 811) - 0.35) * 8
    const z = (random(index + 907) - 0.5) * 7
    rainPositions[offset] = x
    rainPositions[offset + 1] = y
    rainPositions[offset + 2] = z
    rainPositions[offset + 3] = x - 0.04
    rainPositions[offset + 4] = y - 0.55
    rainPositions[offset + 5] = z
  }
  const rainGeometry = new THREE.BufferGeometry()
  const rainPositionAttribute = new THREE.BufferAttribute(rainPositions, 3)
  rainGeometry.setAttribute('position', rainPositionAttribute)
  const rainMaterial = new THREE.LineBasicMaterial({
    color: 0x8eb8dd,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial)
  weatherAnchor.add(rain)

  const makeWeatherPoints = (count: number, colorValue: number, size: number) => {
    const positions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3
      const angle = random(index + count * 3) * Math.PI * 2
      const radius = 0.8 + random(index + count * 7) * 4
      positions[offset] = Math.cos(angle) * radius
      positions[offset + 1] = (random(index + count * 11) - 0.3) * 7
      positions[offset + 2] = Math.sin(angle) * radius
    }
    const geometry = new THREE.BufferGeometry()
    const attribute = new THREE.BufferAttribute(positions, 3)
    geometry.setAttribute('position', attribute)
    const material = new THREE.PointsMaterial({
      color: colorValue,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    weatherAnchor.add(points)
    return { points, geometry, attribute, material, positions }
  }

  const snowLayer = makeWeatherPoints(96, 0xe8f3ff, 0.095)
  const sunLayer = makeWeatherPoints(62, 0xffd58a, 0.07)
  const cloudLayer = makeWeatherPoints(52, 0xc7ccda, 0.13)
  const weatherMaterials: Record<Sky, THREE.Material & { opacity: number }> = {
    sunny: sunLayer.material,
    cloudy: cloudLayer.material,
    rain: rainMaterial,
    snow: snowLayer.material,
  }
  const weatherMaterialEntries = Object.entries(weatherMaterials) as Array<
    [Sky, THREE.Material & { opacity: number }]
  >

  const loader = new THREE.TextureLoader()
  const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
  const activeSprites = new Map<number, THREE.Sprite>()
  const pendingSprites = new Set<number>()
  let desiredIndices = new Set<number>()
  let activeCenter = -100
  let disposed = false
  let targetIndex = clampOrbitIndex(initialIndex, entries.length)
  let currentIndex = targetIndex
  let targetMorph = 0
  let currentMorph = 0
  let traceIndices: number[] = []
  let traceIndexSet = new Set<number>()
  let traceActive = false
  let tracePositionAttribute: THREE.BufferAttribute | null = null
  let traceFocus = 0
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

  const setLayoutMode = (mode: 'time' | 'color') => {
    targetMorph = mode === 'color' ? 1 : 0
  }

  const setTrace = (indices: number[], colorValue = '#d8cdff') => {
    const nextIndices = indices.filter((index) => index >= 0 && index < entries.length)
    if (nextIndices.length === 0) {
      traceActive = false
      traceIndexSet.clear()
      return
    }

    traceActive = true
    traceIndices = nextIndices
    traceIndexSet = new Set(traceIndices)
    const positions = new Float32Array(traceIndices.length * 3)
    tracePositionAttribute = new THREE.BufferAttribute(positions, 3)
    traceGeometry.setAttribute('position', tracePositionAttribute)
    traceGeometry.setDrawRange(0, traceIndices.length)
    traceLineMaterial.color.set(colorValue)
    tracePointMaterial.color.set(colorValue)
    traceLine.visible = traceIndices.length > 1
    tracePoints.visible = true
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
    const morphSmoothing = reduceMotion ? 1 : 1 - Math.exp(-delta * 6)
    currentMorph += (targetMorph - currentMorph) * morphSmoothing
    traceFocus += ((traceActive ? 1 : 0) - traceFocus) * smoothing

    const activeColors = pointColorAttribute.array as Float32Array
    for (let index = 0; index < entries.length; index += 1) {
      const offset = index * 3
      visualPositions[offset] = THREE.MathUtils.lerp(
        timePositions[offset],
        colorPositions[offset],
        currentMorph,
      )
      visualPositions[offset + 1] = THREE.MathUtils.lerp(
        timePositions[offset + 1],
        colorPositions[offset + 1],
        currentMorph,
      )
      visualPositions[offset + 2] = THREE.MathUtils.lerp(
        timePositions[offset + 2],
        colorPositions[offset + 2],
        currentMorph,
      )
      activeColors[offset] = THREE.MathUtils.lerp(
        orbitColors[offset],
        colorModeColors[offset],
        currentMorph,
      )
      activeColors[offset + 1] = THREE.MathUtils.lerp(
        orbitColors[offset + 1],
        colorModeColors[offset + 1],
        currentMorph,
      )
      activeColors[offset + 2] = THREE.MathUtils.lerp(
        orbitColors[offset + 2],
        colorModeColors[offset + 2],
        currentMorph,
      )
    }
    pointPositionAttribute.needsUpdate = true
    linePositionAttribute.needsUpdate = true
    pointColorAttribute.needsUpdate = true
    pointMaterial.opacity = THREE.MathUtils.lerp(0.8, 0.18, traceFocus)
    lineMaterial.opacity = THREE.MathUtils.lerp(0.12, 0.025, currentMorph)
    for (const material of ringMaterials) {
      material.opacity = THREE.MathUtils.lerp(0.16, 0.04, currentMorph)
    }

    const entryIndex = Math.round(currentIndex)
    const selectedOffset = entryIndex * 3
    const selectedX = visualPositions[selectedOffset]
    const selectedY = visualPositions[selectedOffset + 1]
    const selectedZ = visualPositions[selectedOffset + 2]
    const cameraAngle = Math.atan2(selectedX, selectedZ)
    const cameraY = currentIndex * ORBIT_Y_STEP

    camera.position.set(
      Math.sin(cameraAngle) * CAMERA_RADIUS,
      cameraY + 0.22,
      Math.cos(cameraAngle) * CAMERA_RADIUS,
    )
    camera.lookAt(0, cameraY, 0)

    halo.position.set(selectedX, selectedY, selectedZ)
    halo.quaternion.copy(camera.quaternion)
    halo.scale.setScalar(1 + Math.sin(elapsedTime * 2.4) * (reduceMotion ? 0 : 0.035))

    for (const [index, sprite] of activeSprites) {
      const distance = Math.abs(index - currentIndex)
      const selected = index === entryIndex
      const { width, height } = sprite.userData as { width: number; height: number }
      const targetHeight = selected ? SELECTED_SPRITE_HEIGHT : DEFAULT_SPRITE_HEIGHT
      const scale = targetHeight / height
      const offset = index * 3
      sprite.position.set(
        visualPositions[offset],
        visualPositions[offset + 1],
        visualPositions[offset + 2],
      )
      sprite.scale.set(width * scale, targetHeight, 1)
      const distanceOpacity = Math.max(0.22, 1 - distance / (TEXTURE_WINDOW_RADIUS + 4))
      const traceOpacity =
        !traceActive || traceIndexSet.has(index) || selected ? 1 : 0.16
      sprite.material.opacity = distanceOpacity * traceOpacity
    }

    if (tracePositionAttribute) {
      const positions = tracePositionAttribute.array as Float32Array
      for (let traceIndex = 0; traceIndex < traceIndices.length; traceIndex += 1) {
        const sourceOffset = traceIndices[traceIndex] * 3
        const targetOffset = traceIndex * 3
        positions[targetOffset] = visualPositions[sourceOffset]
        positions[targetOffset + 1] = visualPositions[sourceOffset + 1]
        positions[targetOffset + 2] = visualPositions[sourceOffset + 2]
      }
      tracePositionAttribute.needsUpdate = true
      traceLineMaterial.opacity = 0.78 * traceFocus
      tracePointMaterial.opacity = 0.9 * traceFocus
      if (!traceActive && traceFocus < 0.01) {
        traceLine.visible = false
        tracePoints.visible = false
      }
    }

    weatherAnchor.position.set(selectedX, selectedY, selectedZ)
    const activeWeather = weatherKinds[entryIndex]
    const weatherSmoothing = reduceMotion ? 1 : 1 - Math.exp(-delta * 4.5)
    for (const [kind, material] of weatherMaterialEntries) {
      const targetOpacity =
        activeWeather === kind ? WEATHER_OPACITY[kind] * (reduceMotion ? 0.55 : 1) : 0
      material.opacity += (targetOpacity - material.opacity) * weatherSmoothing
    }

    if (!reduceMotion) {
      for (let index = 0; index < rainCount; index += 1) {
        const offset = index * 6
        rainPositions[offset + 1] -= delta * 5.8
        rainPositions[offset + 4] -= delta * 5.8
        if (rainPositions[offset + 4] < -2.8) {
          rainPositions[offset + 1] += 8
          rainPositions[offset + 4] += 8
        }
      }
      rainPositionAttribute.needsUpdate = true

      for (let index = 0; index < snowLayer.positions.length; index += 3) {
        snowLayer.positions[index] += Math.sin(elapsedTime * 0.8 + index) * delta * 0.055
        snowLayer.positions[index + 1] -= delta * (0.32 + random(index + 131) * 0.22)
        if (snowLayer.positions[index + 1] < -2.6) snowLayer.positions[index + 1] += 7
      }
      snowLayer.attribute.needsUpdate = true
      sunLayer.points.rotation.y += delta * 0.16
      sunLayer.points.rotation.z = Math.sin(elapsedTime * 0.18) * 0.08
      cloudLayer.points.rotation.y += delta * 0.025
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
    setLayoutMode,
    setTrace,
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
      traceGeometry.dispose()
      traceLineMaterial.dispose()
      tracePointMaterial.dispose()
      rainGeometry.dispose()
      rainMaterial.dispose()
      snowLayer.geometry.dispose()
      snowLayer.material.dispose()
      sunLayer.geometry.dispose()
      sunLayer.material.dispose()
      cloudLayer.geometry.dispose()
      cloudLayer.material.dispose()
      for (const geometry of ringGeometries) geometry.dispose()
      for (const material of ringMaterials) material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
