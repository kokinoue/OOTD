import {
  clampOrbitIndex,
  orbitFraming,
  visibleOrbitRange,
  type OrbitEntry,
  type OrbitFraming,
} from './orbit'
import type {
  OrbitSceneController,
  OrbitSceneOptions,
} from './orbitScene'
import { translate } from './i18n'

type Point = { x: number; y: number; z: number }
type ProjectedPoint = Point & { scale: number }
type HitBox = { index: number; x: number; y: number; w: number; h: number }

const IMAGE_WINDOW_RADIUS = 18
const DRAW_WINDOW_RADIUS = 42
const SEASON_COLORS = ['#9ad0b1', '#f2b366', '#c7865a', '#8db9d6'] as const

const seasonColor = (entry: OrbitEntry) => {
  const month = Number(entry.outfit.date.slice(5, 7))
  if (month >= 3 && month <= 5) return SEASON_COLORS[0]
  if (month >= 6 && month <= 8) return SEASON_COLORS[1]
  if (month >= 9 && month <= 11) return SEASON_COLORS[2]
  return SEASON_COLORS[3]
}

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

export function createOrbitCanvasScene({
  container,
  entries,
  sprites,
  assetBase,
  initialIndex,
  colorLayout,
  colorSwatches,
  locale = 'ja',
  onIndexChange,
}: OrbitSceneOptions): OrbitSceneController {
  if (entries.length === 0) throw new Error('Orbit requires at least one outfit')

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')

  canvas.className = 'orbit-webgl orbit-canvas-2d'
  canvas.tabIndex = 0
  canvas.setAttribute(
    'aria-label',
    translate(locale, '出勤服の軌道。上下キー、マウスホイール、ドラッグで年代を移動できます'),
  )
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  container.appendChild(canvas)

  const images = new Map<number, HTMLImageElement>()
  let hitBoxes: HitBox[] = []
  let targetIndex = clampOrbitIndex(initialIndex, entries.length)
  let currentIndex = targetIndex
  let targetMorph = 0
  let currentMorph = 0
  let traceIndices: number[] = []
  let traceColor = '#d8cdff'
  let announcedIndex = -1
  let frame = 0
  let dragging = false
  let dragMoved = false
  let dragStartY = 0
  let dragStartIndex = targetIndex
  let previousFrameTime = performance.now()
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const positionAt = (index: number): Point => {
    const time = entries[index].position
    const color = colorLayout[index]?.position ?? time
    return {
      x: mix(time.x, color.x, currentMorph),
      y: mix(time.y, color.y, currentMorph),
      z: mix(time.z, color.z, currentMorph),
    }
  }

  const project = (
    position: Point,
    center: Point,
    width: number,
    height: number,
    framing: OrbitFraming,
  ): ProjectedPoint | null => {
    const cameraAngle = Math.atan2(center.x, center.z)
    const cameraX = Math.sin(cameraAngle) * framing.cameraRadius
    const cameraZ = Math.cos(cameraAngle) * framing.cameraRadius
    const relativeX = position.x - cameraX
    const relativeZ = position.z - cameraZ
    const rightX = Math.cos(cameraAngle)
    const rightZ = -Math.sin(cameraAngle)
    const forwardX = -Math.sin(cameraAngle)
    const forwardZ = -Math.cos(cameraAngle)
    const cameraDepth = relativeX * forwardX + relativeZ * forwardZ
    if (cameraDepth <= 0.2) return null
    const focalLength = Math.min(width, height) * 0.82
    const scale = focalLength / cameraDepth
    // 縦長では被写体を上寄りにして、下の詳細カードと重ならないようにする
    const verticalCenter = 0.46 - 0.025 * framing.portrait
    return {
      x: width * 0.5 + (relativeX * rightX + relativeZ * rightZ) * scale,
      y: height * verticalCenter - (position.y - center.y) * scale,
      z: cameraDepth,
      scale,
    }
  }

  const loadImages = (center: number) => {
    const desired = new Set(visibleOrbitRange(center, entries.length, IMAGE_WINDOW_RADIUS))
    for (const index of images.keys()) {
      if (!desired.has(index)) images.delete(index)
    }
    for (const index of desired) {
      if (images.has(index) || !sprites[entries[index].outfit.key]) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = `${assetBase}cutouts/${entries[index].outfit.key}.webp`
      images.set(index, image)
    }
  }

  const drawStars = (width: number, height: number, time: number) => {
    context.fillStyle = 'rgba(221, 230, 255, 0.36)'
    for (let index = 0; index < 96; index += 1) {
      const x = ((index * 83.17 + time * 0.0015) % (width + 40)) - 20
      const y = (index * 47.63) % height
      const radius = index % 9 === 0 ? 1.2 : 0.65
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }

  const draw = (frameTime: number) => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.round(width * ratio)
    const pixelHeight = Math.round(height * ratio)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    drawStars(width, height, reduceMotion ? 0 : frameTime)

    const framing = orbitFraming(width, height)
    const selectedIndex = Math.round(currentIndex)
    const center = positionAt(selectedIndex)
    const visible = visibleOrbitRange(currentIndex, entries.length, DRAW_WINDOW_RADIUS)
    const projected = visible
      .map((index) => {
        const point = project(positionAt(index), center, width, height, framing)
        return point ? { index, point } : null
      })
      .filter((value): value is { index: number; point: ProjectedPoint } => value != null)

    context.lineWidth = 1
    context.strokeStyle = `rgba(185, 195, 220, ${mix(0.18, 0.07, currentMorph)})`
    context.beginPath()
    projected.forEach(({ point }, index) => {
      if (index === 0) context.moveTo(point.x, point.y)
      else context.lineTo(point.x, point.y)
    })
    context.stroke()

    for (const { index, point } of projected) {
      const colorName = colorLayout[index]?.color ?? ''
      context.fillStyle =
        currentMorph > 0.5
          ? colorSwatches[colorName] ?? '#8f94a3'
          : seasonColor(entries[index])
      context.globalAlpha = Math.max(0.22, 1 - Math.abs(index - currentIndex) / 48)
      context.beginPath()
      context.arc(point.x, point.y, index === selectedIndex ? 4.2 : 2.1, 0, Math.PI * 2)
      context.fill()
    }
    context.globalAlpha = 1

    const tracePoints = traceIndices
      .map((index) => {
        const point = project(positionAt(index), center, width, height, framing)
        return point ? { index, point } : null
      })
      .filter((value): value is { index: number; point: ProjectedPoint } => value != null)
    if (tracePoints.length > 0) {
      context.strokeStyle = traceColor
      context.fillStyle = traceColor
      context.lineWidth = 2
      context.globalAlpha = 0.82
      context.beginPath()
      tracePoints.forEach(({ point }, index) => {
        if (index === 0) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      })
      context.stroke()
      for (const { point } of tracePoints) {
        context.beginPath()
        context.arc(point.x, point.y, 3, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
    }

    hitBoxes = []
    const drawableImages = projected
      .filter(({ index }) => images.get(index)?.complete)
      .sort((a, b) => b.point.z - a.point.z)
    for (const { index, point } of drawableImages) {
      const image = images.get(index)!
      const size = sprites[entries[index].outfit.key]
      if (!size || image.naturalWidth === 0) continue
      const distance = Math.abs(index - currentIndex)
      const selected = index === selectedIndex
      const heightRatio = selected ? 0.29 - 0.05 * framing.portrait : 0.19
      const targetHeight = Math.min(height * heightRatio, selected ? 250 : 170)
      const perspective = Math.max(0.64, Math.min(1.2, point.scale / 88))
      const imageHeight = targetHeight * perspective
      const imageWidth = imageHeight * (size.w / size.h)
      const x = point.x - imageWidth / 2
      const y = point.y - imageHeight / 2
      context.globalAlpha =
        Math.max(0.18, 1 - distance / 24) * (selected ? 1 : framing.ambientOpacity)
      context.drawImage(image, x, y, imageWidth, imageHeight)
      if (distance < 8) hitBoxes.push({ index, x, y, w: imageWidth, h: imageHeight })
    }
    context.globalAlpha = 1

    const selectedPoint = project(center, center, width, height, framing)
    if (selectedPoint) {
      const pulse = reduceMotion ? 0 : Math.sin(frameTime * 0.0024) * 3
      context.strokeStyle = `rgba(255, 255, 255, ${framing.haloOpacity.toFixed(2)})`
      context.lineWidth = 1.5
      context.beginPath()
      context.arc(selectedPoint.x, selectedPoint.y, 34 + pulse, 0, Math.PI * 2)
      context.stroke()
    }
  }

  const setIndex = (index: number) => {
    targetIndex = clampOrbitIndex(index, entries.length)
  }

  const setLayoutMode = (mode: 'time' | 'color') => {
    targetMorph = mode === 'color' ? 1 : 0
  }

  const setTrace = (indices: number[], color = '#d8cdff') => {
    traceIndices = indices.filter((index) => index >= 0 && index < entries.length)
    traceColor = color
  }

  const hitIndex = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    return (
      [...hitBoxes]
        .reverse()
        .find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h)
        ?.index ?? null
    )
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
    canvas.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      canvas.style.cursor = hitIndex(event) == null ? 'grab' : 'pointer'
      return
    }
    const delta = event.clientY - dragStartY
    if (Math.abs(delta) > 4) dragMoved = true
    setIndex(dragStartIndex + delta * 0.075)
    canvas.style.cursor = 'grabbing'
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    canvas.releasePointerCapture(event.pointerId)
    canvas.style.cursor = 'grab'
    if (!dragMoved) {
      const index = hitIndex(event)
      if (index != null) setIndex(index)
    }
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowDown: -1,
      ArrowUp: 1,
      PageDown: -12,
      PageUp: 12,
    }
    let next = steps[event.key] == null ? null : Math.round(targetIndex) + steps[event.key]
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = entries.length - 1
    if (next == null) return
    event.preventDefault()
    setIndex(next)
  }

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('keydown', onKeyDown)

  const animate = (frameTime: number) => {
    const delta = Math.min((frameTime - previousFrameTime) / 1000, 0.05)
    previousFrameTime = frameTime
    const smoothing = reduceMotion ? 1 : 1 - Math.exp(-delta * 7)
    currentIndex += (targetIndex - currentIndex) * smoothing
    currentMorph += (targetMorph - currentMorph) * smoothing
    const selectedIndex = Math.round(currentIndex)
    loadImages(selectedIndex)
    if (announcedIndex !== selectedIndex) {
      announcedIndex = selectedIndex
      onIndexChange(selectedIndex)
    }
    draw(frameTime)
    frame = window.requestAnimationFrame(animate)
  }
  animate(previousFrameTime)

  return {
    setIndex,
    setLayoutMode,
    setTrace,
    dispose: () => {
      window.cancelAnimationFrame(frame)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('keydown', onKeyDown)
      images.clear()
      canvas.remove()
    },
  }
}
