// 四季通勤の3Dジオラマ。通勤路の小さな街を、季節・時刻・天気に合わせて描き分ける。
//
// ・空の色、陽の高さと向き、影、窓あかり、街灯は「季節 × 時刻 × 空模様」から毎フレーム計算する
// ・雨・雪・桜吹雪・落ち葉はパーティクル、木と花壇は年内の位置（何月何日か）で色と量が変わる
// ・主人公はコーデのくり抜き画像。街を歩く通行人も、別の日のくり抜き（＝別の日のkoki）
// ・環境は目標値へなめらかに寄せるので、朝→午後→夕方→翌朝が時間の流れとして見える
//
// ゲームのルールは持たない。ShikiGameView が setEnv / setHero / walkTo を呼んで演出する。

import * as THREE from 'three'
import type { ShikiSeason } from './shiki'
import type { Sky } from './weather'

export type SceneEnv = {
  season: ShikiSeason
  /** 年内の位置（1月1日=0、12月31日≒1）。桜と紅葉の時期を決める */
  yearPos: number
  /** 時刻（時）。前回より小さい値を渡すと、夜を越えて翌日のその時刻まで進む */
  hour: number
  sky: Sky
  /** 雨・雪の強さ 0〜1 */
  precip: number
  /** 気温（℃）。息の白さに使う */
  temp: number
}

export type SpriteSpec = { url: string; aspect: number }

export type ShikiSceneController = {
  setEnv: (env: SceneEnv, immediate?: boolean) => void
  /** 主人公のコーデ。null で姿を消す */
  setHero: (sprite: SpriteSpec | null) => void
  /** 夜の答え合わせで隣に立つ「本物のkoki」 */
  setCompanion: (sprite: SpriteSpec | null) => void
  /** 通行人（別の日のくり抜き） */
  setCrowd: (sprites: SpriteSpec[]) => void
  /** 通勤路の位置 0（家）〜1（駅）へ歩く。ms=0 で瞬間移動 */
  walkTo: (progress: number, ms: number) => Promise<void>
  dispose: () => void
}

// ---- 配色 -------------------------------------------------------------------
const C = (hex: number) => new THREE.Color(hex)
const SKY = {
  nightTop: C(0x070b22),
  nightHorizon: C(0x1b2550),
  dayTop: C(0x3c82d8),
  dayHorizon: C(0xa9d2f7),
  goldTop: C(0x5a6cb6),
  goldHorizon: C(0xffb07a),
  overTop: C(0x8490a0),
  overHorizon: C(0xc6ccd2),
  rainTop: C(0x5c6772),
  rainHorizon: C(0x929ca6),
}
const SUN_WHITE = C(0xfff3de)
const SUN_GOLD = C(0xffc98a)
const NIGHT_AMBIENT = C(0x6474ad)
const WINDOW_OFF = C(0x53616f)
const WINDOW_ON = C(0xffd98a)

const SEASON_SUN: Record<ShikiSeason, { rise: number; set: number; elev: number }> = {
  spring: { rise: 5.8, set: 18.2, elev: 55 },
  summer: { rise: 4.6, set: 19.0, elev: 74 },
  autumn: { rise: 5.9, set: 17.2, elev: 47 },
  winter: { rise: 6.7, set: 16.8, elev: 31 },
}

// 木の葉: 年内の位置 → 色と茂り具合（冬は枝だけ、3月末〜4月頭は桜）
const FOLIAGE_KEYS: { at: number; color: number; full: number }[] = [
  { at: 0.0, color: 0x8a7460, full: 0.12 },
  { at: 0.19, color: 0x8a7460, full: 0.15 },
  { at: 0.235, color: 0xf7bfd2, full: 1.0 },
  { at: 0.275, color: 0xf9c9d8, full: 1.05 },
  { at: 0.32, color: 0x9ccf6a, full: 0.95 },
  { at: 0.45, color: 0x58a04a, full: 1.05 },
  { at: 0.68, color: 0x4f9446, full: 1.05 },
  { at: 0.8, color: 0xc9b24a, full: 1.0 },
  { at: 0.88, color: 0xd9743a, full: 0.95 },
  { at: 0.94, color: 0xb5613a, full: 0.5 },
  { at: 1.0, color: 0x8a7460, full: 0.12 },
]
const GRASS: Record<ShikiSeason, number> = {
  spring: 0x9bcb68,
  summer: 0x6aab52,
  autumn: 0xb6a85e,
  winter: 0xbfbc9c,
}
const FLOWERS: Record<ShikiSeason, number[]> = {
  spring: [0xf06a7a, 0xffd34d, 0xffffff, 0xf7a8c4],
  summer: [0x6f8ff0, 0xa98bf0, 0xffd23f, 0xffffff],
  autumn: [0xf2a3c6, 0xffffff, 0xe86a8f, 0xf6c244],
  winter: [0xe8ece8, 0xe8ece8, 0xd34b4b, 0xe8ece8],
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (lo: number, hi: number, v: number) => {
  const t = clamp01((v - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// 通勤路（手前の歩道）。主人公はこの線の上を左（家）から右（駅）へ歩く
const WALK_Z = 4.1
const WALK_X0 = -9.6
const WALK_X1 = 9.4
const STREET_W = 27

function foliageAt(pos: number) {
  const p = ((pos % 1) + 1) % 1
  let i = 0
  while (i < FOLIAGE_KEYS.length - 2 && FOLIAGE_KEYS[i + 1].at < p) i++
  const a = FOLIAGE_KEYS[i]
  const b = FOLIAGE_KEYS[i + 1]
  const t = clamp01((p - a.at) / Math.max(1e-6, b.at - a.at))
  return { color: C(a.color).lerp(C(b.color), t), full: lerp(a.full, b.full, t) }
}

function textTexture(text: string, bg: string, fg: string, w = 256, h = 64) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = fg
  ctx.font = `700 ${Math.round(h * 0.56)}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function softDot(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createShikiScene(container: HTMLElement): ShikiSceneController {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.className = 'shiki-webgl'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const fog = new THREE.FogExp2(0xcfe6fb, 0.008)
  scene.fog = fog
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400)

  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(obj: T): T => {
    disposables.push(obj)
    return obj
  }
  const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
    track(new THREE.MeshLambertMaterial({ color, ...extra }))
  const box = (w: number, h: number, d: number) => track(new THREE.BoxGeometry(w, h, d))
  const mesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    shadow: 'cast' | 'receive' | 'both' | 'none' = 'both',
  ) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = shadow === 'cast' || shadow === 'both'
    m.receiveShadow = shadow === 'receive' || shadow === 'both'
    scene.add(m)
    return m
  }

  // ---- 空 -------------------------------------------------------------------
  const skyUniforms = {
    top: { value: C(0x3c82d8) },
    horizon: { value: C(0xcfe6fb) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: C(0xfff3de) },
    sunGlow: { value: 1 },
  }
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(horizon, top, smoothstep(-0.04, 0.3, h));
          float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(d, 220.0) * 2.2 + pow(d, 14.0) * 0.28) * sunGlow;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  )
  const skyDome = new THREE.Mesh(track(new THREE.SphereGeometry(180, 24, 16)), skyMat)
  skyDome.renderOrder = -10
  scene.add(skyDome)

  const starGeo = track(new THREE.BufferGeometry())
  {
    const pts: number[] = []
    for (let i = 0; i < 260; i++) {
      const a = rand(i) * Math.PI * 2
      const e = 0.12 + rand(i + 500) * 1.3
      pts.push(Math.cos(a) * Math.cos(e) * 170, Math.sin(e) * 170, Math.sin(a) * Math.cos(e) * 170)
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }
  const starMat = track(
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
  )
  scene.add(new THREE.Points(starGeo, starMat))

  // ---- 光 -------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xcfe6fb, 0x8a7f70, 1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff3de, 2.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1536, 1536)
  sun.shadow.camera.left = -19
  sun.shadow.camera.right = 19
  sun.shadow.camera.top = 16
  sun.shadow.camera.bottom = -16
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 90
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.04
  scene.add(sun)
  scene.add(sun.target)

  // ---- 地面 -----------------------------------------------------------------
  const grassMat = lambert(GRASS.spring)
  const roadMat = lambert(0x5b6068)
  const walkMat = lambert(0xd8d3c6)
  const paintMat = lambert(0xf1efe6)
  mesh(box(STREET_W + 2, 1.4, 16.4), lambert(0x7b6a57), 0, -0.71, 0, 'receive')
  mesh(box(STREET_W + 2, 0.06, 16.4), grassMat, 0, 0.0, 0, 'receive')
  mesh(box(STREET_W + 2, 0.08, 4.8), roadMat, 0, 0.03, 0.2, 'receive')
  mesh(box(STREET_W + 2, 0.16, 2.9), walkMat, 0, 0.07, 4.05, 'receive')
  mesh(box(STREET_W + 2, 0.16, 1.9), walkMat, 0, 0.07, -3.15, 'receive')
  for (let i = -6; i <= 6; i++) {
    if (Math.abs(i) <= 1) continue
    mesh(box(1.1, 0.02, 0.12), paintMat, i * 2.1, 0.08, 0.2, 'receive')
  }
  for (let i = -3; i <= 3; i++) mesh(box(0.42, 0.02, 4.1), paintMat, i * 0.74, 0.08, 0.2, 'receive')
  // 歩道の目地
  const jointMat = lambert(0xc3bdaf)
  for (let i = -13; i <= 13; i++) mesh(box(0.04, 0.01, 2.9), jointMat, i * 1.05, 0.155, 4.05, 'none')

  // 水たまり（雨で現れる）
  const puddleMat = track(new THREE.MeshBasicMaterial({ color: 0x9fb3c6, transparent: true, opacity: 0, depthWrite: false }))
  const puddleGeo = track(new THREE.CircleGeometry(1, 20))
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(puddleGeo, puddleMat)
    p.rotation.x = -Math.PI / 2
    p.position.set(-11 + rand(i + 3) * 22, i % 2 ? 0.075 : 0.156, i % 2 ? -1.2 + rand(i + 9) * 2.8 : 3.3 + rand(i + 9) * 1.6)
    p.scale.set(0.5 + rand(i + 20) * 0.7, 0.3 + rand(i + 30) * 0.35, 1)
    scene.add(p)
  }
  // 積雪（雪の日に地面を白くする薄い板）
  const snowMat = track(new THREE.MeshLambertMaterial({ color: 0xf4f8fb, transparent: true, opacity: 0, depthWrite: false }))
  const snowCover = mesh(box(STREET_W + 2, 0.02, 16.4), snowMat, 0, 0.17, 0, 'none')
  snowCover.renderOrder = 2

  // ---- 建物 -----------------------------------------------------------------
  const windowSlots: { x: number; y: number; z: number; t: number }[] = []
  const roofMats: THREE.MeshLambertMaterial[] = []
  const roofBase: THREE.Color[] = []
  const roofMat = (color: number) => {
    const m = lambert(color)
    roofMats.push(m)
    roofBase.push(C(color))
    return m
  }
  const pyramid = track(new THREE.ConeGeometry(1, 1, 4, 1))
  let seedCounter = 1
  const building = (
    x: number,
    w: number,
    h: number,
    color: number,
    opts: { roof?: 'flat' | 'gable'; roofColor?: number; awning?: number; depth?: number } = {},
  ) => {
    const d = opts.depth ?? 3.2
    const z = -4.3 - d / 2
    mesh(box(w, h, d), lambert(color), x, h / 2 + 0.05, z)
    if (opts.roof === 'gable') {
      const roof = mesh(pyramid, roofMat(opts.roofColor ?? 0xb5654a), x, h + 0.05 + 0.75, z)
      roof.scale.set(w * 0.78, 1.5, d * 0.78)
      roof.rotation.y = Math.PI / 4
    } else {
      mesh(box(w + 0.2, 0.22, d + 0.2), roofMat(opts.roofColor ?? 0x70757e), x, h + 0.16, z)
      mesh(box(0.7, 0.5, 0.7), lambert(0x8d939b), x - w * 0.22, h + 0.5, z)
    }
    const front = -4.3 + 0.03
    const cols = Math.max(1, Math.floor((w - 0.7) / 1.0))
    const rows = Math.max(0, Math.floor((h - 2.2) / 1.35))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        windowSlots.push({
          x: x - ((cols - 1) * 1.0) / 2 + c * 1.0,
          y: 2.7 + r * 1.35,
          z: front,
          t: 0.25 + rand(seedCounter++) * 0.75,
        })
      }
    }
    // 1階: ドアとひさし
    mesh(box(0.75, 1.5, 0.06), lambert(0x4b3f37), x + w * 0.2, 0.85, front, 'none')
    if (opts.awning != null) {
      const a = mesh(box(w * 0.86, 0.08, 0.95), lambert(opts.awning), x, 1.95, front + 0.42, 'cast')
      a.rotation.x = 0.32
      windowSlots.push({ x: x - w * 0.16, y: 1.0, z: front, t: 0.2 })
    }
  }
  building(-11.2, 3.6, 5.6, 0xe8d9bf, { awning: 0x4f8f8b })
  building(-7.2, 3.0, 3.0, 0xf3ead7, { roof: 'gable', roofColor: 0xb5654a })
  building(-3.2, 4.2, 8.6, 0x9fb0c2)
  building(1.2, 3.4, 3.6, 0xe9b7a2, { awning: 0xd9583b })
  building(5.2, 3.8, 6.8, 0xbcd8c8)
  building(9.2, 3.0, 3.2, 0xf1e2c4, { roof: 'gable', roofColor: 0x6c7480 })
  building(12.4, 2.6, 5.0, 0xc9a58c)

  const windowGeo = box(0.56, 0.72, 0.05)
  const windowMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
  const windows = new THREE.InstancedMesh(windowGeo, windowMat, windowSlots.length)
  {
    const m = new THREE.Matrix4()
    windowSlots.forEach((w, i) => {
      m.makeTranslation(w.x, w.y, w.z)
      windows.setMatrixAt(i, m)
      windows.setColorAt(i, WINDOW_OFF)
    })
  }
  scene.add(windows)

  // コインランドリーの看板（このゲームの主役は洗濯なので）と駅の標識
  const signTex = track(textTexture('コインランドリー', '#f7f3e8', '#2f6f6b', 512, 64))
  const signMat = track(new THREE.MeshBasicMaterial({ map: signTex }))
  mesh(track(new THREE.PlaneGeometry(3.0, 0.4)), signMat, -11.2, 2.45, -4.25, 'none')
  const stationTex = track(textTexture('駅', '#2b62c4', '#ffffff', 96, 96))
  const stationMat = track(new THREE.MeshBasicMaterial({ map: stationTex }))
  mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 8)), lambert(0x8a8f96), 11.4, 1.6, 5.1)
  mesh(track(new THREE.PlaneGeometry(0.9, 0.9)), stationMat, 11.4, 2.75, 5.16, 'none')
  mesh(box(2.6, 0.12, 1.8), lambert(0x7c8794), 12.0, 3.1, 4.3)
  mesh(box(0.12, 3.0, 0.12), lambert(0x7c8794), 13.1, 1.6, 3.6)
  mesh(box(0.12, 3.0, 0.12), lambert(0x7c8794), 13.1, 1.6, 5.0)

  // 自販機・ポスト・ベンチ
  mesh(box(0.8, 1.6, 0.6), lambert(0xf2f2ee), 3.6, 0.95, -3.6)
  const vendGlow = track(new THREE.MeshBasicMaterial({ color: 0x9fd8ff }))
  mesh(box(0.62, 0.7, 0.04), vendGlow, 3.6, 1.25, -3.28, 'none')
  mesh(box(0.42, 0.9, 0.42), lambert(0xd8442f), 9.3, 0.6, 5.2)
  mesh(box(1.5, 0.1, 0.5), lambert(0x8a6a4a), -5.6, 0.55, 5.0)
  mesh(box(0.1, 0.4, 0.4), lambert(0x5d5f63), -6.2, 0.33, 5.0)
  mesh(box(0.1, 0.4, 0.4), lambert(0x5d5f63), -5.0, 0.33, 5.0)

  // 電柱と電線
  const poleMat = lambert(0x8b8b86)
  const poleXs = [-9.2, -0.6, 7.6]
  for (const x of poleXs) {
    mesh(track(new THREE.CylinderGeometry(0.09, 0.12, 6.2, 8)), poleMat, x, 3.2, -2.4)
    mesh(box(1.5, 0.09, 0.09), poleMat, x, 5.7, -2.4)
  }
  const wireMat = track(new THREE.LineBasicMaterial({ color: 0x3b3f46 }))
  for (let i = 0; i < poleXs.length - 1; i++) {
    for (const dz of [-0.55, 0.55]) {
      const pts: THREE.Vector3[] = []
      for (let s = 0; s <= 12; s++) {
        const t = s / 12
        pts.push(new THREE.Vector3(lerp(poleXs[i], poleXs[i + 1], t), 5.72 - Math.sin(t * Math.PI) * 0.45, -2.4 + dz))
      }
      scene.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), wireMat))
    }
  }

  // 街灯
  const bulbMat = track(new THREE.MeshBasicMaterial({ color: 0x777777 }))
  const lamps: THREE.PointLight[] = []
  for (const x of [-4.6, 5.4]) {
    mesh(track(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 8)), lambert(0x4a4f57), x, 1.9, 2.75)
    mesh(box(0.7, 0.06, 0.06), lambert(0x4a4f57), x, 3.7, 3.05)
    mesh(track(new THREE.SphereGeometry(0.16, 10, 8)), bulbMat, x, 3.6, 3.35, 'none')
    const light = new THREE.PointLight(0xffd9a0, 0, 11, 1.6)
    light.position.set(x, 3.4, 3.5)
    scene.add(light)
    lamps.push(light)
  }

  // ---- 木と花壇 --------------------------------------------------------------
  const foliageMat = track(new THREE.MeshLambertMaterial({ color: 0x58a04a, flatShading: true }))
  const trunkMat = lambert(0x6b4f3a)
  const foliageGeo = track(new THREE.IcosahedronGeometry(1, 1))
  const trunkGeo = track(new THREE.CylinderGeometry(0.1, 0.17, 1.9, 6))
  const twigGeo = track(new THREE.CylinderGeometry(0.03, 0.06, 1.2, 5))
  const crowns: { group: THREE.Group; phase: number }[] = []
  const tree = (x: number, z: number, scale: number) => {
    mesh(trunkGeo, trunkMat, x, 1.0 * scale + 0.1, z).scale.setScalar(scale)
    for (let i = 0; i < 4; i++) {
      const twig = mesh(twigGeo, trunkMat, x + Math.cos(i * 1.7) * 0.28 * scale, 2.2 * scale, z + Math.sin(i * 1.7) * 0.28 * scale, 'cast')
      twig.rotation.set(Math.sin(i * 1.7) * 0.6, 0, -Math.cos(i * 1.7) * 0.6)
      twig.scale.setScalar(scale)
    }
    const group = new THREE.Group()
    group.position.set(x, 2.55 * scale, z)
    const blobs: [number, number, number, number][] = [
      [0, 0.1, 0, 1.0],
      [0.62, -0.15, 0.2, 0.68],
      [-0.58, -0.1, -0.15, 0.72],
      [0.1, 0.55, -0.1, 0.62],
    ]
    for (const [bx, by, bz, s] of blobs) {
      const blob = new THREE.Mesh(foliageGeo, foliageMat)
      blob.position.set(bx * scale, by * scale, bz * scale)
      blob.scale.setScalar(s * scale)
      blob.castShadow = true
      group.add(blob)
    }
    scene.add(group)
    crowns.push({ group, phase: rand(x * 3.1 + z) * 6.28 })
  }
  tree(-10.4, 2.75, 1.05)
  tree(-1.9, 2.75, 1.2)
  tree(2.6, 2.75, 1.0)
  tree(10.2, 2.75, 1.15)
  tree(-12.6, 6.6, 0.9)
  tree(8.2, 6.9, 0.85)

  const bushMat = lambert(0x5f9a4c, { flatShading: true })
  for (let i = 0; i < 7; i++) {
    const b = mesh(foliageGeo, bushMat, -11.5 + i * 3.7 + rand(i + 60) * 1.2, 0.3, 6.5 + rand(i + 70) * 0.9)
    b.scale.set(0.8 + rand(i + 80) * 0.5, 0.42, 0.6)
  }
  const flowerGeo = track(new THREE.IcosahedronGeometry(0.1, 0))
  const flowerMat = track(new THREE.MeshLambertMaterial({ color: 0xffffff }))
  const FLOWER_N = 90
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_N)
  {
    const m = new THREE.Matrix4()
    for (let i = 0; i < FLOWER_N; i++) {
      m.makeTranslation(-13 + rand(i + 100) * 26, 0.2 + rand(i + 200) * 0.12, 5.9 + rand(i + 300) * 1.9)
      flowers.setMatrixAt(i, m)
      flowers.setColorAt(i, C(0xffffff))
    }
  }
  scene.add(flowers)
  let flowerSeason: ShikiSeason | null = null
  const paintFlowers = (season: ShikiSeason) => {
    if (flowerSeason === season) return
    flowerSeason = season
    const palette = FLOWERS[season]
    for (let i = 0; i < FLOWER_N; i++) flowers.setColorAt(i, C(palette[Math.floor(rand(i + 400) * palette.length)]))
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true
  }

  // ---- 雲 -------------------------------------------------------------------
  // 雲は下から見上げるので、光源で陰らせず色を直接決める（陰らせると雨の日に真っ黒な塊になる）
  const cloudMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, fog: false }))
  const clouds: { group: THREE.Group; speed: number; rank: number }[] = []
  for (let i = 0; i < 9; i++) {
    const group = new THREE.Group()
    const n = 3 + Math.floor(rand(i + 700) * 3)
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(foliageGeo, cloudMat)
      puff.position.set((k - n / 2) * 1.5, rand(i * 9 + k) * 0.6, rand(i * 7 + k) * 0.8)
      puff.scale.set(1.5 + rand(i * 5 + k) * 0.9, 0.85 + rand(i * 3 + k) * 0.4, 1.1)
      group.add(puff)
    }
    group.position.set(-30 + rand(i + 710) * 60, 9 + rand(i + 720) * 7, -20 - rand(i + 730) * 16)
    group.scale.setScalar(1 + rand(i + 740) * 0.8)
    scene.add(group)
    clouds.push({ group, speed: 0.25 + rand(i + 750) * 0.35, rank: i / 9 })
  }
  // 夏の入道雲
  const thunderhead = new THREE.Group()
  for (let k = 0; k < 9; k++) {
    const puff = new THREE.Mesh(foliageGeo, cloudMat)
    puff.position.set((rand(k + 800) - 0.5) * 7, k * 1.25, (rand(k + 810) - 0.5) * 2)
    puff.scale.setScalar(3.4 - k * 0.22 + rand(k + 820))
    thunderhead.add(puff)
  }
  thunderhead.position.set(15, 3, -38)
  scene.add(thunderhead)

  // ---- 雨・雪・花びら ---------------------------------------------------------
  const RAIN_N = 800
  const rainPos = new Float32Array(RAIN_N * 6)
  const rainSeed = new Float32Array(RAIN_N * 3)
  for (let i = 0; i < RAIN_N; i++) {
    rainSeed[i * 3] = -17 + rand(i + 1000) * 34
    rainSeed[i * 3 + 1] = rand(i + 2000) * 18
    rainSeed[i * 3 + 2] = -9 + rand(i + 3000) * 19
  }
  const rainGeo = track(new THREE.BufferGeometry())
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rainMat = track(new THREE.LineBasicMaterial({ color: 0xdfeaf5, transparent: true, opacity: 0, depthWrite: false }))
  const rain = new THREE.LineSegments(rainGeo, rainMat)
  rain.frustumCulled = false
  scene.add(rain)

  const FLAKE_N = 520
  const flakePos = new Float32Array(FLAKE_N * 3)
  const flakeGeo = track(new THREE.BufferGeometry())
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3))
  const dotTex = track(softDot('rgba(255,255,255,1)', 'rgba(255,255,255,0)'))
  const flakeMat = track(
    new THREE.PointsMaterial({ map: dotTex, color: 0xffffff, size: 0.2, transparent: true, opacity: 0, depthWrite: false }),
  )
  const flakes = new THREE.Points(flakeGeo, flakeMat)
  flakes.frustumCulled = false
  scene.add(flakes)

  const PETAL_N = 170
  const petalPos = new Float32Array(PETAL_N * 3)
  const petalCol = new Float32Array(PETAL_N * 3)
  const petalGeo = track(new THREE.BufferGeometry())
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3))
  petalGeo.setAttribute('color', new THREE.BufferAttribute(petalCol, 3))
  const petalMat = track(
    new THREE.PointsMaterial({ size: 0.17, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }),
  )
  const petals = new THREE.Points(petalGeo, petalMat)
  petals.frustumCulled = false
  scene.add(petals)
  let petalKind: 'sakura' | 'leaf' | null = null
  const paintPetals = (kind: 'sakura' | 'leaf') => {
    if (petalKind === kind) return
    petalKind = kind
    const palette = kind === 'sakura' ? [0xffd6e4, 0xf9b9cf, 0xffffff] : [0xe07a3a, 0xc94f2f, 0xe3b23c, 0x9a5a2e]
    for (let i = 0; i < PETAL_N; i++) {
      const c = C(palette[Math.floor(rand(i + 5000) * palette.length)])
      petalCol.set([c.r, c.g, c.b], i * 3)
    }
    petalGeo.attributes.color.needsUpdate = true
  }

  // ---- 人（くり抜き） ---------------------------------------------------------
  const loader = new THREE.TextureLoader()
  const personGeo = track(new THREE.PlaneGeometry(1, 1))
  personGeo.translate(0, 0.5, 0)
  const shadowTex = track(softDot('rgba(0,0,0,0.42)', 'rgba(0,0,0,0)'))
  type Person = {
    plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    shadow: THREE.Mesh
    url: string | null
    height: number
    fade: number
    target: number
  }
  const makePerson = (height: number): Person => {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.08, opacity: 0, side: THREE.DoubleSide })
    const plane = new THREE.Mesh(personGeo, mat)
    plane.visible = false
    plane.renderOrder = 5
    scene.add(plane)
    const shadow = new THREE.Mesh(
      puddleGeo,
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = 3
    scene.add(shadow)
    return { plane, shadow, url: null, height, fade: 0, target: 0 }
  }
  const setPersonSprite = (p: Person, sprite: SpriteSpec | null) => {
    if (!sprite) {
      p.target = 0
      p.url = null
      return
    }
    if (p.url === sprite.url) {
      p.target = 1
      return
    }
    p.url = sprite.url
    const url = sprite.url
    loader.load(url, (tex) => {
      if (disposed || p.url !== url) {
        tex.dispose()
        return
      }
      tex.colorSpace = THREE.SRGBColorSpace
      p.plane.material.map?.dispose()
      p.plane.material.map = tex
      p.plane.material.needsUpdate = true
      p.plane.scale.set(p.height * sprite.aspect, p.height, 1)
      p.plane.visible = true
      p.target = 1
    })
  }
  const disposePerson = (p: Person) => {
    p.plane.material.map?.dispose()
    p.plane.material.dispose()
    ;(p.shadow.material as THREE.Material).dispose()
  }
  const hero = makePerson(2.5)
  const companion = makePerson(2.5)
  const crowd = Array.from({ length: 4 }, (_, i) => ({
    person: makePerson(2.2),
    x: -12 + i * 7 + rand(i + 900) * 3,
    dir: i % 2 ? 1 : -1,
    speed: 0.7 + rand(i + 910) * 0.5,
    phase: rand(i + 920) * 6,
  }))

  // 白い息
  const breathTex = track(softDot('rgba(255,255,255,0.75)', 'rgba(255,255,255,0)'))
  const breaths = Array.from({ length: 3 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: breathTex, transparent: true, opacity: 0, depthWrite: false }))
    s.renderOrder = 6
    scene.add(s)
    return { sprite: s, age: 9 }
  })

  // ---- 車 -------------------------------------------------------------------
  const headMat = track(new THREE.MeshBasicMaterial({ color: 0x555555 }))
  const tyreMat = lambert(0x24262a)
  const tyreGeo = track(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 10))
  const makeCar = (color: number, len: number, tall: number) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(box(len, tall * 0.55, 1.25), lambert(color))
    body.position.y = 0.3 + tall * 0.275
    const cabin = new THREE.Mesh(box(len * 0.6, tall * 0.45, 1.15), lambert(0xdfe8ee))
    cabin.position.set(-len * 0.05, 0.3 + tall * 0.55 + tall * 0.225, 0)
    g.add(body, cabin)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const t = new THREE.Mesh(tyreGeo, tyreMat)
        t.rotation.x = Math.PI / 2
        t.position.set(sx * len * 0.32, 0.28, sz * 0.58)
        g.add(t)
      }
      const lightBox = new THREE.Mesh(box(0.06, 0.16, 0.9), headMat)
      lightBox.position.set(sx * (len / 2 + 0.01), 0.3 + tall * 0.3, 0)
      g.add(lightBox)
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    g.visible = false
    scene.add(g)
    return g
  }
  const cars = [
    { group: makeCar(0xf2c230, 2.6, 1.0), z: 1.25, dir: 1, x: 99, wait: 3 },
    { group: makeCar(0x5a8fd6, 4.6, 1.7), z: -0.85, dir: -1, x: 99, wait: 9 },
    { group: makeCar(0xe8e4dc, 2.3, 1.15), z: 1.25, dir: 1, x: 99, wait: 16 },
  ]

  // ---- 状態 -----------------------------------------------------------------
  const sunCfg = { ...SEASON_SUN.spring }
  const cur = { hour: 7.8, cloud: 0.2, precip: 0, snow: 0, wet: 0, snowGround: 0, yearPos: 0.25, temp: 15 }
  const tgt = { ...cur }
  let tgtSeason: ShikiSeason = 'spring'
  let initialized = false
  let disposed = false
  let heroX = WALK_X0
  let heroBob = 0
  let walk: { from: number; to: number; start: number; ms: number; resolve: () => void } | null = null
  let flash = 0
  let nextFlash = 6
  const grassTarget = C(GRASS.spring)

  const cloudOf = (sky: Sky) => (sky === 'sunny' ? 0.15 : sky === 'cloudy' ? 0.82 : 1)

  const tmpA = new THREE.Color()
  const tmpB = new THREE.Color()
  const sunDir = new THREE.Vector3()
  let lastDark = -1

  let width = 1
  let height = 1
  let viewWidth = STREET_W
  const resize = () => {
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    // 横長なら街全体、縦長なら主人公のまわりだけを映す
    viewWidth = lerp(13, STREET_W, clamp01((camera.aspect - 0.7) / (1.9 - 0.7)))
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  let last = performance.now()
  let raf = 0
  let time = 0

  const frame = () => {
    raf = requestAnimationFrame(frame)
    const nowMs = performance.now()
    // 描画が遅い端末でも時間の進みは実時間に合わせる（上限を小さくすると、低fpsで全体がスローになる）
    const dt = Math.min(1, (nowMs - last) / 1000)
    last = nowMs
    time += dt

    // 目標へなめらかに寄せる
    const k = 1 - Math.exp(-dt * 2.2)
    const kSlow = 1 - Math.exp(-dt * 0.9)
    const hourGap = tgt.hour - cur.hour
    cur.hour += Math.sign(hourGap) * Math.min(Math.abs(hourGap), dt * Math.max(3.2, Math.abs(hourGap) * 1.6))
    cur.cloud = lerp(cur.cloud, tgt.cloud, k)
    cur.precip = lerp(cur.precip, tgt.precip, k)
    cur.snow = lerp(cur.snow, tgt.snow, k)
    cur.temp = lerp(cur.temp, tgt.temp, k)
    cur.wet = lerp(cur.wet, tgt.precip > 0.05 && tgt.snow < 0.5 ? 1 : 0, kSlow)
    cur.snowGround = lerp(cur.snowGround, tgt.snow > 0.5 ? Math.min(1, tgt.precip + 0.3) : 0, kSlow)
    // 年内の位置は近い向きへ回す（冬→春は12月→1月→3月と進む）
    let yearGap = tgt.yearPos - cur.yearPos
    if (yearGap > 0.5) yearGap -= 1
    if (yearGap < -0.5) yearGap += 1
    cur.yearPos = (((cur.yearPos + yearGap * kSlow) % 1) + 1) % 1
    const target = SEASON_SUN[tgtSeason]
    sunCfg.rise = lerp(sunCfg.rise, target.rise, kSlow)
    sunCfg.set = lerp(sunCfg.set, target.set, kSlow)
    sunCfg.elev = lerp(sunCfg.elev, target.elev, kSlow)

    // ---- 太陽の位置 ----
    const h = ((cur.hour % 24) + 24) % 24
    const dayT = (h - sunCfg.rise) / (sunCfg.set - sunCfg.rise)
    let elev: number
    if (dayT >= 0 && dayT <= 1) elev = sunCfg.elev * Math.sin(Math.PI * dayT)
    else {
      const away = dayT < 0 ? sunCfg.rise - h : h - sunCfg.set
      elev = -Math.min(24, Math.min(away, 24 - (sunCfg.set - sunCfg.rise) - away) * 14)
    }
    const er = (elev * Math.PI) / 180
    const tt = clamp01(dayT)
    sunDir.set(-Math.cos(Math.PI * tt) * Math.cos(er) * 0.9, Math.sin(er), 0.5 * Math.cos(er) + 0.15).normalize()
    const dayness = smooth(-7, 9, elev)
    const golden = (1 - smooth(5, 30, elev)) * smooth(-9, 2, elev)
    const dark = clamp01(1 - dayness * lerp(1, 0.62, cur.cloud * cur.precip))

    // ---- 空と光 ----
    tmpA.copy(SKY.nightTop).lerp(SKY.dayTop, dayness).lerp(SKY.goldTop, golden * 0.7)
    tmpB.copy(SKY.overTop).multiplyScalar(lerp(0.12, 1, dayness))
    tmpA.lerp(tmpB, cur.cloud * 0.92)
    tmpB.copy(SKY.rainTop).multiplyScalar(lerp(0.12, 1, dayness))
    tmpA.lerp(tmpB, cur.precip * 0.8)
    skyUniforms.top.value.copy(tmpA)

    tmpA.copy(SKY.nightHorizon).lerp(SKY.dayHorizon, dayness).lerp(SKY.goldHorizon, golden * (1 - cur.cloud * 0.75))
    tmpB.copy(SKY.overHorizon).multiplyScalar(lerp(0.16, 1, dayness))
    tmpA.lerp(tmpB, cur.cloud * 0.85)
    tmpB.copy(SKY.rainHorizon).multiplyScalar(lerp(0.16, 1, dayness))
    tmpA.lerp(tmpB, cur.precip * 0.8)
    skyUniforms.horizon.value.copy(tmpA)
    fog.color.copy(tmpA)
    fog.density = lerp(0.006, 0.016, cur.cloud) + cur.precip * 0.012

    const sunColor = tmpB.copy(SUN_WHITE).lerp(SUN_GOLD, golden)
    skyUniforms.sunColor.value.copy(sunColor)
    skyUniforms.sunDir.value.copy(sunDir)
    skyUniforms.sunGlow.value = (1 - cur.cloud * 0.95) * smooth(-4, 3, elev)
    starMat.opacity = (1 - dayness) * (1 - cur.cloud) * 0.9

    // 雷（大雨のときだけ、たまに空が光る）
    if (cur.precip > 0.85 && cur.snow < 0.5 && !reduceMotion) {
      nextFlash -= dt
      if (nextFlash <= 0) {
        flash = 1
        nextFlash = 7 + rand(time) * 9
      }
    }
    flash = Math.max(0, flash - dt * 4)

    sun.color.copy(sunColor)
    sun.intensity = dayness * lerp(2.9, 0.35, cur.cloud) * lerp(1, 0.6, cur.precip)
    sun.position.copy(sunDir).multiplyScalar(40)
    sun.target.position.set(0, 0, 0)
    hemi.color.copy(tmpA).lerp(NIGHT_AMBIENT, 1 - dayness)
    hemi.intensity = lerp(0.5, 1.15, dayness) * lerp(1, 0.9, cur.cloud) + flash * 1.6

    // 人は光源の影響を受けない板なので、明るさを手で合わせる
    const personLight = lerp(0.42, 1, dayness) * lerp(1, 0.86, cur.cloud) + flash * 0.3
    tmpA.setRGB(personLight, personLight, personLight).lerp(sunColor, golden * 0.25)
    if (dark > 0.5) tmpA.lerp(SUN_GOLD, (dark - 0.5) * 0.3)

    // ---- 窓あかり・街灯 ----
    if (Math.abs(dark - lastDark) > 0.015) {
      lastDark = dark
      windowSlots.forEach((w, i) => {
        const lit = smooth(w.t * 0.75, w.t * 0.75 + 0.12, dark)
        windows.setColorAt(i, tmpB.copy(WINDOW_OFF).lerp(WINDOW_ON, lit))
      })
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true
      const lampOn = smooth(0.35, 0.6, dark)
      bulbMat.color.setRGB(lerp(0.45, 1, lampOn), lerp(0.45, 0.88, lampOn), lerp(0.45, 0.62, lampOn))
      for (const l of lamps) l.intensity = lampOn * 14
      headMat.color.setRGB(lerp(0.33, 1, lampOn), lerp(0.33, 0.95, lampOn), lerp(0.33, 0.75, lampOn))
      vendGlow.color.setRGB(lerp(0.55, 0.75, lampOn), lerp(0.75, 0.95, lampOn), 1)
    }

    // ---- 地面の濡れ・雪 ----
    roadMat.color.setHex(0x5b6068).lerp(tmpB.setHex(0x363b42), cur.wet * 0.8)
    walkMat.color.setHex(0xd8d3c6).lerp(tmpB.setHex(0x9d998f), cur.wet * 0.7)
    puddleMat.opacity = cur.wet * 0.5
    snowMat.opacity = cur.snowGround * 0.92
    roofMats.forEach((m, i) => m.color.copy(roofBase[i]).lerp(tmpB.setHex(0xf4f8fb), cur.snowGround * 0.9))
    grassTarget.setHex(GRASS[tgtSeason])
    grassMat.color.lerp(grassTarget, kSlow)

    // ---- 木・花 ----
    const fol = foliageAt(cur.yearPos)
    foliageMat.color.copy(fol.color).lerp(tmpB.setHex(0xf4f8fb), cur.snowGround * 0.6)
    const sway = reduceMotion ? 0 : 0.03 + cur.precip * 0.05
    for (const c of crowns) {
      c.group.scale.setScalar(Math.max(0.02, fol.full))
      c.group.rotation.z = Math.sin(time * 0.9 + c.phase) * sway
      c.group.rotation.x = Math.cos(time * 0.7 + c.phase) * sway * 0.6
    }
    paintFlowers(tgtSeason)
    flowers.visible = fol.full > 0.3

    // ---- 雲 ----
    cloudMat.color
      .setRGB(1, 1, 1)
      .lerp(tmpB.setHex(0xb4bcc5), cur.cloud * 0.8)
      .lerp(tmpB.setHex(0x8f99a4), cur.precip * 0.7)
      .lerp(SUN_GOLD, golden * (1 - cur.cloud) * 0.55)
      .lerp(tmpB.setHex(0x2c3558), (1 - dayness) * 0.9)
    for (const c of clouds) {
      c.group.visible = c.rank < 0.25 + cur.cloud
      c.group.position.x += c.speed * dt * (reduceMotion ? 0 : 1)
      if (c.group.position.x > 34) c.group.position.x = -34
    }
    const summer = smooth(0.42, 0.5, cur.yearPos) * (1 - smooth(0.66, 0.72, cur.yearPos))
    thunderhead.visible = summer > 0.2 && cur.cloud < 0.6
    thunderhead.scale.setScalar(0.6 + summer * 0.5)

    // ---- 雨 ----
    const rainAmt = cur.precip * (1 - cur.snow)
    rainMat.opacity = rainAmt * 0.55
    rain.visible = rainAmt > 0.02
    if (rain.visible) {
      const fall = (time * 26) % 18
      const count = Math.floor(RAIN_N * clamp01(0.25 + rainAmt))
      for (let i = 0; i < RAIN_N; i++) {
        const o = i * 6
        if (i >= count) {
          rainPos[o + 1] = rainPos[o + 4] = -50
          continue
        }
        const y = 18 - ((rainSeed[i * 3 + 1] + fall) % 18)
        const x = rainSeed[i * 3] - (18 - y) * 0.12
        const z = rainSeed[i * 3 + 2]
        rainPos[o] = x
        rainPos[o + 1] = y
        rainPos[o + 2] = z
        rainPos[o + 3] = x + 0.07
        rainPos[o + 4] = y + 0.6
        rainPos[o + 5] = z
      }
      rainGeo.attributes.position.needsUpdate = true
    }

    // ---- 雪 ----
    const snowAmt = cur.precip * cur.snow
    flakeMat.opacity = Math.min(1, snowAmt * 1.4)
    flakes.visible = snowAmt > 0.02
    if (flakes.visible) {
      for (let i = 0; i < FLAKE_N; i++) {
        const y = 16 - ((rand(i + 6000) * 16 + time * (1.1 + rand(i + 6100) * 0.9)) % 16)
        flakePos[i * 3] = -16 + rand(i + 6200) * 32 + Math.sin(time * 0.8 + i) * 0.5
        flakePos[i * 3 + 1] = y
        flakePos[i * 3 + 2] = -8 + rand(i + 6300) * 17
      }
      flakeGeo.attributes.position.needsUpdate = true
    }

    // ---- 桜吹雪・落ち葉 ----
    const sakura = smooth(0.215, 0.24, cur.yearPos) * (1 - smooth(0.285, 0.31, cur.yearPos))
    const leaves = smooth(0.82, 0.87, cur.yearPos) * (1 - smooth(0.94, 0.97, cur.yearPos))
    const drift = Math.max(sakura, leaves * 0.75) * (1 - cur.precip * 0.7)
    petalMat.opacity = drift
    petals.visible = drift > 0.03
    if (petals.visible) {
      paintPetals(sakura >= leaves ? 'sakura' : 'leaf')
      for (let i = 0; i < PETAL_N; i++) {
        const life = (rand(i + 7000) * 9 + time * (0.5 + rand(i + 7100) * 0.4)) % 9
        petalPos[i * 3] = -16 + rand(i + 7200) * 30 + life * 0.9 + Math.sin(time * 1.3 + i) * 0.35
        petalPos[i * 3 + 1] = 6.5 - life * 0.75 + Math.sin(time * 2 + i * 1.7) * 0.2
        petalPos[i * 3 + 2] = -3 + rand(i + 7300) * 10 + Math.cos(time + i) * 0.3
      }
      petalGeo.attributes.position.needsUpdate = true
    }

    // ---- 主人公 ----
    if (walk) {
      const t = walk.ms <= 0 ? 1 : clamp01((performance.now() - walk.start) / walk.ms)
      const e = t * t * (3 - 2 * t)
      heroX = lerp(walk.from, walk.to, e)
      heroBob += dt * 9
      if (t >= 1) {
        const done = walk.resolve
        walk = null
        done()
      }
    }
    const walking = walk != null
    const placePerson = (p: Person, x: number, z: number, bob: number, lean: number) => {
      p.fade = lerp(p.fade, p.target, 1 - Math.exp(-dt * 7))
      if (p.fade < 0.01 && p.target === 0) {
        p.plane.visible = false
        ;(p.shadow.material as THREE.MeshBasicMaterial).opacity = 0
        return
      }
      p.plane.material.opacity = p.fade
      p.plane.material.color.copy(tmpA)
      p.plane.position.set(x, 0.15 + bob, z)
      p.plane.rotation.z = lean
      p.shadow.position.set(x, 0.165, z + 0.02)
      p.shadow.scale.set(p.height * 0.34, p.height * 0.14, 1)
      ;(p.shadow.material as THREE.MeshBasicMaterial).opacity = p.fade * lerp(0.35, 0.9, dayness * (1 - cur.cloud * 0.6))
    }
    const stepBob = walking && !reduceMotion ? Math.abs(Math.sin(heroBob)) * 0.09 : Math.sin(time * 1.6) * 0.012
    placePerson(hero, heroX, WALK_Z, stepBob, walking ? Math.sin(heroBob) * 0.035 : 0)
    placePerson(companion, heroX + 1.55, WALK_Z + 0.25, Math.sin(time * 1.4 + 1) * 0.012, 0)
    for (const c of crowd) {
      if (!reduceMotion) c.x += c.dir * c.speed * dt
      if (c.x > 15) c.x = -15
      if (c.x < -15) c.x = 15
      placePerson(c.person, c.x, -3.1, Math.abs(Math.sin(time * 5 * c.speed + c.phase)) * 0.06, 0)
      c.person.plane.material.color.multiplyScalar(0.86)
    }

    // 白い息（寒い朝だけ）
    const cold = hero.fade > 0.5 && cur.temp < 7 ? clamp01((7 - cur.temp) / 6) : 0
    breaths.forEach((b, i) => {
      b.age += dt
      if (b.age > 2.4 && cold > 0 && Math.floor(time * 1.25) % 3 === i) b.age = 0
      const t = b.age / 1.6
      const mat = b.sprite.material
      mat.opacity = t < 1 ? Math.sin(t * Math.PI) * 0.5 * cold : 0
      b.sprite.position.set(heroX + 0.28 + t * 0.35, 0.15 + hero.height * 0.86 + t * 0.3, WALK_Z + 0.1)
      b.sprite.scale.setScalar(0.25 + t * 0.5)
    })

    // ---- 車 ----
    for (const car of cars) {
      if (reduceMotion) break
      if (!car.group.visible) {
        car.wait -= dt
        if (car.wait <= 0) {
          car.group.visible = true
          car.x = -18 * car.dir
          car.group.rotation.y = car.dir > 0 ? 0 : Math.PI
        }
        continue
      }
      car.x += car.dir * 7.5 * dt
      car.group.position.set(car.x, 0.03, car.z)
      if (Math.abs(car.x) > 19) {
        car.group.visible = false
        car.wait = 7 + rand(time + car.z) * 12
      }
    }

    // ---- カメラ ----
    const span = (STREET_W - viewWidth) / 2
    const cx = Math.min(span, Math.max(-span, heroX * 0.92))
    const dist = viewWidth / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect)
    const swayX = reduceMotion ? 0 : Math.sin(time * 0.17) * 0.5
    const swayY = reduceMotion ? 0 : Math.sin(time * 0.13 + 1) * 0.18
    const tilt = 0.21
    camera.position.set(cx + swayX, 3.3 + dist * Math.sin(tilt) + swayY, dist * Math.cos(tilt) + 1.5)
    camera.lookAt(cx, 3.3, 0)
    skyDome.position.copy(camera.position)

    renderer.render(scene, camera)
  }

  const onVisibility = () => {
    cancelAnimationFrame(raf)
    if (!document.hidden && !disposed) {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  raf = requestAnimationFrame(frame)

  return {
    setEnv: (env, immediate) => {
      tgtSeason = env.season
      tgt.yearPos = env.yearPos
      tgt.cloud = cloudOf(env.sky)
      tgt.precip = env.precip
      tgt.snow = env.sky === 'snow' ? 1 : 0
      tgt.temp = env.temp
      // 時刻は必ず前へ進める（夕方→翌朝は夜を越える）
      let hour = env.hour
      while (hour < cur.hour - 0.01) hour += 24
      tgt.hour = hour
      if (immediate || !initialized) {
        initialized = true
        Object.assign(cur, tgt, { hour: env.hour, wet: env.precip > 0.05 && env.sky !== 'snow' ? 1 : 0, snowGround: 0 })
        tgt.hour = env.hour
        Object.assign(sunCfg, SEASON_SUN[env.season])
        grassMat.color.setHex(GRASS[env.season])
      } else if (cur.hour > 48) {
        // 日をまたぎ続けても数値が膨らまないよう、同じ時刻のまま巻き戻す
        const days = Math.floor(cur.hour / 24) * 24
        cur.hour -= days
        tgt.hour -= days
      }
    },
    setHero: (sprite) => setPersonSprite(hero, sprite),
    setCompanion: (sprite) => setPersonSprite(companion, sprite),
    setCrowd: (sprites) => crowd.forEach((c, i) => setPersonSprite(c.person, sprites[i] ?? null)),
    walkTo: (progress, ms) =>
      new Promise<void>((resolve) => {
        walk?.resolve()
        const to = lerp(WALK_X0, WALK_X1, clamp01(progress))
        if (ms <= 0 || reduceMotion) {
          heroX = to
          walk = null
          resolve()
          return
        }
        walk = { from: heroX, to, start: performance.now(), ms, resolve }
      }),
    dispose: () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      walk?.resolve()
      walk = null
      disposePerson(hero)
      disposePerson(companion)
      for (const c of crowd) disposePerson(c.person)
      for (const b of breaths) b.sprite.material.dispose()
      for (const d of disposables) d.dispose()
      windows.dispose()
      flowers.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
