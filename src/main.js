import './style.css'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="scene-container"></div>
  <div id="ui">Use arrow keys or WASD to move — click to focus</div>
`

const container = document.getElementById('scene-container')

const scene = new THREE.Scene()
// darker ambient fog to push mid/long-range values toward black
scene.fog = new THREE.FogExp2(0x000000, 0.006)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 1.8, 6)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputEncoding = THREE.sRGBEncoding
// enable physically correct light calculations and nicer tonemapping
renderer.physicallyCorrectLights = true
renderer.toneMapping = THREE.ACESFilmicToneMapping
// lower exposure for a darker overall look
renderer.toneMappingExposure = 0.35
container.appendChild(renderer.domElement)

// load HDR environment and apply as scene.environment (for metallic reflections)
const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()
const hdrPath = new URL('./assets/background.hdr', import.meta.url).href
new HDRLoader()
  .load(hdrPath, (hdrTex) => {
    // HDRLoader provides an equirectangular texture
    const envMap = pmremGenerator.fromEquirectangular(hdrTex).texture
    scene.environment = envMap
    scene.background = envMap
    if (hdrTex.dispose) hdrTex.dispose()
    pmremGenerator.dispose()
  }, undefined, (err) => console.warn('HDR load failed', err))

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

// Lights (further reduced intensities for an even darker scene)
const hemi = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.18)
scene.add(hemi)
// small ambient to lift shadowed areas
const ambient = new THREE.AmbientLight(0x101010, 0.08)
scene.add(ambient)
// directional light for specular highlights (toned down)
const dir = new THREE.DirectionalLight(0xffffff, 0.4)
dir.position.set(5, 10, 7.5)
dir.castShadow = true
scene.add(dir)
// add a warm key point light to create shiny highlights on cube faces
const keyLight = new THREE.PointLight(0xfff7e6, 0.2, 40)
keyLight.position.set(0, 8, 8)
scene.add(keyLight)
// a cool fill light behind the camera to lift shadows subtly
const fill = new THREE.PointLight(0x88aaff, 0.04, 60)
fill.position.set(0, 4, -8)
scene.add(fill)

// Ground — darkest base color (no wireframe)
const groundMat = new THREE.MeshStandardMaterial({ color: 0x000000, wireframe: false })
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
  // use a uniform cube size for all buildings
  const size = 3.5
  const w = size
  const d = size
  const h = size

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

  // Create simple cube materials: images on four sides (+X, -X, +Z, -Z), dark top/bottom
  const materials = []
  for (let fi = 0; fi < 6; fi++) {
    // face indices: 0:+X, 1:-X, 2:+Y(top), 3:-Y(bottom), 4:+Z, 5:-Z
    if (fi === 2 || fi === 3) {
      materials.push(new THREE.MeshBasicMaterial({ color: 0x0f0f0f }))
      continue
    }

    // choose an image (favor images) for each side face
    if (Math.random() < 0.12) {
      const vt = new THREE.VideoTexture(videoEl)
      vt.encoding = THREE.sRGBEncoding
      vt.minFilter = THREE.LinearFilter
      vt.magFilter = THREE.LinearFilter
      vt.format = THREE.RGBAFormat
      materials.push(new THREE.MeshBasicMaterial({ map: vt, toneMapped: false, side: THREE.FrontSide }))
    } else {
      const src = imageTextures[Math.floor(Math.random() * imageTextures.length)]
      const faceW = (fi === 0 || fi === 1) ? d : w
      const faceH = h
      const tex = makeTextureForFace(src, faceW, faceH)
      materials.push(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.FrontSide }))
    }
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
  // increase spacing to spread out objects more
  const spacing = 8
  // Roads every N grid lines
  const roadEvery = 4
  const roadWidth = spacing * 0.9

  // --- Gallery layout ---
  // Load .glb models and place them in randomized, non-overlapping spots
  const gltfLoader = new GLTFLoader()
  const modelFiles = [
    new URL('./assets/ganesha.glb', import.meta.url).href,
    new URL('./assets/broken_head.glb', import.meta.url).href
  ]

  function randomPos(radius = 24) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * radius
    return [Math.cos(a) * r, Math.sin(a) * r]
  }

  function placeObjectNoOverlap(createMeshFn) {
    for (let tries = 0; tries < 50; tries++) {
      const [rx, rz] = randomPos(24)
      const mesh = createMeshFn(rx, rz)
      const box = new THREE.Box3().setFromObject(mesh)
      box.expandByScalar(0.6)
      // check overlap
      const overlap = buildingBoxes.some(b => b.intersectsBox(box))
      if (!overlap) { city.add(mesh); buildingBoxes.push(box); return mesh }
    }
    return null
  }

  // place models larger and in their own spaces
  modelFiles.forEach((p) => {
    gltfLoader.load(p, (g) => {
      const root = g.scene || g.scenes[0]
      root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true } })
      // create mesh wrapper function for placement
      const createFn = (rx, rz) => {
        const clone = root.clone()
        const scale = 2.5 + Math.random() * 2.0 // much bigger
        clone.scale.setScalar(scale)

        // apply holographic/metallic-glass material to all meshes in the clone
        clone.traverse((node) => {
          if (!node.isMesh) return
          // use MeshPhysicalMaterial for transmission/refraction + metalness
          const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccff,
            metalness: 0.8,
            roughness: 0.12,
            transmission: 0.75,
            thickness: 0.8,
            ior: 1.45,
            envMapIntensity: 1.5,
            clearcoat: 0.25,
            clearcoatRoughness: 0.05,
            emissive: 0x66ddff,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide
          })
          // if we already have a scene environment, attach it
          if (scene.environment) holoMat.envMap = scene.environment
          node.material = holoMat
          node.castShadow = true
          node.receiveShadow = true
        })

        // place at rx,0,rz first then compute bbox to lift above ground
        clone.position.set(rx, 0, rz)
        const bbox = new THREE.Box3().setFromObject(clone)
        const minY = bbox.min.y
        const lift = (minY < 0) ? -minY + 0.05 : 0.05
        clone.position.y = lift
        return clone
      }
      const placed = placeObjectNoOverlap(createFn)
      if (!placed) {
        // fallback: add at fixed spot, elevated to sit on ground
        root.scale.setScalar(3.0)
        // apply holographic material to fallback root as well
        root.traverse((node) => {
          if (!node.isMesh) return
          const holoMat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccff,
            metalness: 0.8,
            roughness: 0.12,
            transmission: 0.75,
            thickness: 0.8,
            ior: 1.45,
            envMapIntensity: 1.5,
            clearcoat: 0.25,
            clearcoatRoughness: 0.05,
            emissive: 0x66ddff,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide
          })
          if (scene.environment) holoMat.envMap = scene.environment
          node.material = holoMat
          node.castShadow = true
          node.receiveShadow = true
        })
        root.position.set(0, 0, -6)
        const bbox = new THREE.Box3().setFromObject(root)
        const minY = bbox.min.y
        const lift = (minY < 0) ? -minY + 0.05 : 0.05
        root.position.y = lift
        scene.add(root)
      }
    }, undefined, (err) => console.warn('model load failed', p, err))
  })

  // scatter uniform cubes (panels) randomly like gallery pedestals/walls
  const totalPanels = 14
  const panelSize = 3.5

  for (let i = 0; i < totalPanels; i++) {
    const createPanel = (rx, rz) => {
      const geom = new THREE.BoxGeometry(panelSize, panelSize, panelSize)
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, metalness: 0.9, roughness: 0.12 })
      const materials = []
      for (let fi = 0; fi < 6; fi++) materials.push(baseMat)
      if (imageTextures.length) {
        const src = imageTextures[Math.floor(Math.random() * imageTextures.length)]
        const faceW = panelSize
        const faceH = panelSize
        const tex = makeTextureForFace(src, faceW, faceH)
        // put image on a random side
        const sideIdx = [0,1,4,5][Math.floor(Math.random()*4)]
        materials[sideIdx] = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.0, roughness: 0.35, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 })
      }
      const mesh = new THREE.Mesh(geom, materials)
      mesh.position.set(rx, panelSize/2, rz)
      mesh.castShadow = false
      mesh.receiveShadow = false
      return mesh
    }
    placeObjectNoOverlap(createPanel)
  }

  // Roads removed: no road meshes are created for a cleaner scene
  // (Previously created long strip meshes along grid lines.)

  // place camera outside the city so it spawns looking in
  // compute scene extent and use it to pick a good distance
  const length = grid * spacing + spacing
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
