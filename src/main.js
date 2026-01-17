import './style.css'
import * as THREE from 'three'

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="scene-container"></div>
  <div id="ui">Use arrow keys or WASD to move — click to focus</div>
`

const container = document.getElementById('scene-container')

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x888888, 0.0025)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 1.8, 6)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputEncoding = THREE.sRGBEncoding
container.appendChild(renderer.domElement)

// Load image textures and video texture
const texLoader = new THREE.TextureLoader()
const imagePaths = [
  new URL('./assets/0001.png', import.meta.url).href,
  new URL('./assets/0003.png', import.meta.url).href,
  new URL('./assets/0004.png', import.meta.url).href,
  new URL('./assets/0005.png', import.meta.url).href,
  new URL('./assets/0006.png', import.meta.url).href,
  new URL('./assets/0007.png', import.meta.url).href,
  new URL('./assets/0008.png', import.meta.url).href,
  new URL('./assets/0009.png', import.meta.url).href,
  new URL('./assets/0010.png', import.meta.url).href,
  new URL('./assets/0011.png', import.meta.url).href
]
let imageTextures = []

// Load textures and only proceed once they're available to avoid marking
// textures for update before image data exists.
const loadTexture = (p) => new Promise((res) => {
  texLoader.load(p, (t) => {
    t.encoding = THREE.sRGBEncoding
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    res(t)
  }, undefined, () => res(null))
})

const texturesReady = Promise.all(imagePaths.map(loadTexture)).then((txs) => {
  imageTextures = txs.filter(Boolean)
})

function makeTextureForFace(srcTex, faceW, faceH) {
  // Create a canvas texture that draws the image scaled to 'contain'
  // so the full image is always visible (letterboxed) on the face.
  const canvas = document.createElement('canvas')
  // pick a reasonable resolution where the longer side is 1024
  const faceAspect = faceW / faceH || 1
  let cw, ch
  if (faceAspect >= 1) { cw = 1024; ch = Math.max(64, Math.round(1024 / faceAspect)) }
  else { ch = 1024; cw = Math.max(64, Math.round(1024 * faceAspect)) }
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')

  const tex = new THREE.CanvasTexture(canvas)
  tex.encoding = THREE.sRGBEncoding
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping

  function drawImageToCanvas(img) {
    if (!img || !img.width || !img.height) return
    // clear
    ctx.clearRect(0, 0, cw, ch)
    // fill with transparent or black background if desired; keep transparent
    // compute scale to fit (contain)
    const scale = Math.min(cw / img.width, ch / img.height)
    const iw = Math.round(img.width * scale)
    const ih = Math.round(img.height * scale)
    const ix = Math.round((cw - iw) / 2)
    const iy = Math.round((ch - ih) / 2)
    ctx.drawImage(img, ix, iy, iw, ih)
    tex.needsUpdate = true
  }

  const img = srcTex.image
  if (img && img.complete && img.naturalWidth) drawImageToCanvas(img)
  else if (img) img.addEventListener('load', () => drawImageToCanvas(img))
  return tex
}

// create video element and texture (muted so browsers allow autoplay when clicked)
let videoTexture = null
const videoEl = document.createElement('video')
videoEl.src = new URL('./assets/0002.mp4', import.meta.url).href
videoEl.loop = true
videoEl.muted = true
videoEl.playsInline = true
videoEl.preload = 'auto'
videoEl.crossOrigin = 'anonymous'
videoTexture = new THREE.VideoTexture(videoEl)
videoTexture.encoding = THREE.sRGBEncoding
videoTexture.minFilter = THREE.LinearFilter
videoTexture.magFilter = THREE.LinearFilter
videoTexture.format = THREE.RGBAFormat

// Lights
const hemi = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.8)
scene.add(hemi)
const dir = new THREE.DirectionalLight(0xffffff, 0.8)
dir.position.set(5, 10, 7.5)
dir.castShadow = true
scene.add(dir)

// Ground (wireframe)
const groundMat = new THREE.MeshStandardMaterial({ color: 0x223322, wireframe: true })
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000, 200, 200), groundMat)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
scene.add(ground)

// City generation
const city = new THREE.Group()
scene.add(city)

// For collision checks
const buildingBoxes = []
const playerRadius = 0.45

const palette = [0x8fbf8f, 0xa0c4ff, 0xffc89a, 0xffe082, 0xb39ddb, 0x90a4ae]

function makeBuilding(i, j, x, z, roadEvery, spacing) {
  // simple single-cube building aligned to nearest road edge
  const isWide = Math.random() < 0.25
  // make cubes thicker so they read as volumetric shapes
  const w = isWide ? (2 + Math.random() * 2) : (1.4 + Math.random() * 1.6)
  const d = isWide ? (2 + Math.random() * 2) : (1.4 + Math.random() * 1.6)
  const h = 3 + Math.random() * 6

  // determine adjacency to road lines (cells next to road are i%roadEvery===1 or ===roadEvery-1)
  const localI = i % roadEvery
  const localJ = j % roadEvery

  let shiftX = 0
  let shiftZ = 0
  if (localI === 1) shiftX = - (spacing / 2 - w / 2)
  else if (localI === roadEvery - 1) shiftX = (spacing / 2 - w / 2)
  if (localJ === 1) shiftZ = - (spacing / 2 - d / 2)
  else if (localJ === roadEvery - 1) shiftZ = (spacing / 2 - d / 2)

  // if adjacent on both axes, pick the dominant one randomly to keep it simple
  if (shiftX !== 0 && shiftZ !== 0) {
    if (Math.random() < 0.5) shiftZ = 0
    else shiftX = 0
  }

  const bx = x + shiftX
  const bz = z + shiftZ

  const geom = new THREE.BoxGeometry(w, h, d)

  // assign a distinct base color per cube (debugging)
  const baseColor = palette[Math.floor(Math.random() * palette.length)]
  const materials = []
  for (let m = 0; m < 6; m++) materials.push(new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.06, roughness: 0.9 }))

  // determine outward face to place image/video
  let faceIndex = 0
  if (shiftX > 0) faceIndex = 0
  else if (shiftX < 0) faceIndex = 1
  else if (shiftZ > 0) faceIndex = 4
  else if (shiftZ < 0) faceIndex = 5
  else {
    // if not adjacent to road, pick a random side
    const dirs = [0, 1, 4, 5]
    faceIndex = dirs[Math.floor(Math.random() * dirs.length)]
  }

  // choose texture (favor images) and apply to face
    if (Math.random() < 0.12) {
    const vt = new THREE.VideoTexture(videoEl)
    vt.encoding = THREE.sRGBEncoding
    vt.minFilter = THREE.LinearFilter
    vt.magFilter = THREE.LinearFilter
    vt.format = THREE.RGBAFormat
    materials[faceIndex] = new THREE.MeshBasicMaterial({ map: vt, toneMapped: false, transparent: false, depthTest: true, depthWrite: true, side: THREE.FrontSide })
  } else {
    const src = imageTextures[Math.floor(Math.random() * imageTextures.length)]
    const faceW = (faceIndex === 0 || faceIndex === 1) ? d : w
    const faceH = h
    const tex = makeTextureForFace(src, faceW, faceH)
    materials[faceIndex] = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: false, depthTest: true, depthWrite: true, side: THREE.FrontSide })
  }

  const mesh = new THREE.Mesh(geom, materials)
  mesh.position.set(bx, h / 2, bz)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

// Defer city generation until textures are loaded to ensure overlays
// have valid image data when created.
texturesReady.then(() => {
  // make the city smaller by reducing grid and spacing
  const grid = 12
  const spacing = 5
  // Roads every N grid lines
  const roadEvery = 4
  const roadWidth = spacing * 0.9

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const isRoadX = (i % roadEvery === 0)
      const isRoadZ = (j % roadEvery === 0)
      if (isRoadX || isRoadZ) continue // leave space for roads

      // base grid position with small jitter
      const x = (i - grid / 2) * spacing + (Math.random() - 0.5) * 0.6
      const z = (j - grid / 2) * spacing + (Math.random() - 0.5) * 0.6

      // create a single cube building aligned to the nearest road edge
      const b = makeBuilding(i, j, x, z, roadEvery, spacing)
      city.add(b)
      // compute and store bounding box expanded slightly for collision
      const box = new THREE.Box3().setFromObject(b)
      box.expandByScalar(0.15)
      buildingBoxes.push(box)
    }
  }

  // Create road meshes (long strips) where grid lines land
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 1, metalness: 0 })
  const length = grid * spacing + spacing
  for (let i = 0; i < grid; i++) {
    if (i % roadEvery !== 0) continue
    const x = (i - grid / 2) * spacing
    const geom = new THREE.BoxGeometry(roadWidth, 0.04, length)
    const road = new THREE.Mesh(geom, roadMat)
    road.position.set(x, 0.02, 0)
    scene.add(road)
  }
  for (let j = 0; j < grid; j++) {
    if (j % roadEvery !== 0) continue
    const z = (j - grid / 2) * spacing
    const geom = new THREE.BoxGeometry(length, 0.04, roadWidth)
    const road = new THREE.Mesh(geom, roadMat)
    road.position.set(0, 0.02, z)
    scene.add(road)
  }

  // place camera outside the city so it spawns looking in
  // use the scene extent (`length`) to pick a good distance
  camera.position.set(0, 1.8, Math.max(12, Math.ceil(length * 1.3)))
  camera.lookAt(0, 1.8, 0)

  animate()
})

// Simple navigation (yaw + move)
const keys = {}
const speed = 0.35
let yaw = 0

function onKeyDown(e) { keys[e.key.toLowerCase()] = true }
function onKeyUp(e) { keys[e.key.toLowerCase()] = false }
window.addEventListener('keydown', onKeyDown)
window.addEventListener('keyup', onKeyUp)

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', resize)

// Click to focus (helps with key events on some browsers) and start muted video playback
container.addEventListener('click', () => {
  container.focus()
  if (videoEl && videoEl.paused) {
    videoEl.play().catch(() => {})
  }
})
container.tabIndex = 0

const forward = new THREE.Vector3()
const right = new THREE.Vector3()

function tryMove(delta) {
  const proposed = camera.position.clone().add(delta)
  const sphere = new THREE.Sphere(proposed, playerRadius)

  let blocked = false
  for (const box of buildingBoxes) {
    if (sphere.intersectsBox(box)) { blocked = true; break }
  }
  if (!blocked) { camera.position.copy(proposed); return }

  // sliding: try X-only then Z-only
  const proposedX = camera.position.clone().add(new THREE.Vector3(delta.x, 0, 0))
  const sphereX = new THREE.Sphere(proposedX, playerRadius)
  let blockedX = buildingBoxes.some(box => sphereX.intersectsBox(box))
  if (!blockedX) { camera.position.copy(proposedX); return }

  const proposedZ = camera.position.clone().add(new THREE.Vector3(0, 0, delta.z))
  const sphereZ = new THREE.Sphere(proposedZ, playerRadius)
  let blockedZ = buildingBoxes.some(box => sphereZ.intersectsBox(box))
  if (!blockedZ) { camera.position.copy(proposedZ); return }
}

function animate() {
  requestAnimationFrame(animate)

  // rotation with left/right or a/d
  if (keys['arrowleft'] || keys['a']) yaw += 0.03
  if (keys['arrowright'] || keys['d']) yaw -= 0.03

  // compute direction vectors
  camera.rotation.y = yaw
  camera.getWorldDirection(forward)
  forward.y = 0
  forward.normalize()
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

  // movement with collision
  const moveDelta = new THREE.Vector3()
  if (keys['arrowup'] || keys['w']) moveDelta.add(forward)
  if (keys['arrowdown'] || keys['s']) moveDelta.addScaledVector(forward, -1)
  if (keys['q']) moveDelta.addScaledVector(right, -1)
  if (keys['e']) moveDelta.add(right)
  if (moveDelta.lengthSq() > 0) {
    moveDelta.normalize().multiplyScalar(speed)
    tryMove(moveDelta)
  }

  // clamp camera height
  if (camera.position.y < 1.5) camera.position.y = 1.5

  renderer.render(scene, camera)
}

animate()
