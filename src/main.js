import './style.css'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import haikuData from './data/data.json'

// --- Loading manager + small rotating-cube loader UI ---
const loadingManager = new THREE.LoadingManager()
const loaderOverlayEl = typeof document !== 'undefined' ? document.getElementById('loader-overlay') : null
const loaderText = typeof document !== 'undefined' ? document.getElementById('loader-text') : null
const loaderProgressEl = typeof document !== 'undefined' ? document.getElementById('loader-progress') : null
const loaderCanvas = typeof document !== 'undefined' ? document.getElementById('loader-canvas') : null

if (loaderCanvas) {
  const loaderRenderer = new THREE.WebGLRenderer({ canvas: loaderCanvas, alpha: true, antialias: true })
  loaderRenderer.setPixelRatio(window.devicePixelRatio || 1)
  loaderRenderer.setSize(loaderCanvas.width || 160, loaderCanvas.height || 160, false)
  const loaderScene = new THREE.Scene()
  const loaderCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10)
  loaderCamera.position.set(0, 0, 3)
  // wireframe cube for loader
  const cubeGeom = new THREE.BoxGeometry(1, 1, 1)
  const cubeMat = new THREE.MeshBasicMaterial({ color: 0x8a7bff, wireframe: true })
  const cube = new THREE.Mesh(cubeGeom, cubeMat)
  loaderScene.add(cube)
  const l = new THREE.DirectionalLight(0xffffff, 0.9)
  l.position.set(2, 3, 2)
  loaderScene.add(l)
  let _loaderAnim = null
  const _animateLoader = () => {
    cube.rotation.x += 0.02
    cube.rotation.y += 0.035
    loaderRenderer.render(loaderScene, loaderCamera)
    _loaderAnim = requestAnimationFrame(_animateLoader)
  }
  _animateLoader()

  loadingManager.onLoad = () => {
    if (loaderOverlayEl) loaderOverlayEl.classList.add('hidden')
    // stop renderer loop and release GL context if possible
    if (_loaderAnim) cancelAnimationFrame(_loaderAnim)
    try { loaderRenderer.dispose(); if (loaderRenderer.forceContextLoss) loaderRenderer.forceContextLoss() } catch (e) {}
    setTimeout(() => { try { if (loaderOverlayEl && loaderOverlayEl.parentNode) loaderOverlayEl.parentNode.removeChild(loaderOverlayEl) } catch (e) {} }, 700)
  }

  loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const pct = itemsTotal > 0 ? Math.round((itemsLoaded / itemsTotal) * 100) : 0
    if (loaderProgressEl) loaderProgressEl.style.width = pct + '%'
    if (loaderText) loaderText.textContent = `Loading ${pct}%`
  }

  loadingManager.onError = (url) => {
    if (loaderText) loaderText.textContent = 'Load error'
  }
}

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="scene-container"></div>
  <div id="ui">Use arrow keys to move</div>
  <div id="music-player" aria-label="Music player">
    <div class="mp-controls">
      <button id="mp-prev" title="Previous">⏮</button>
      <button id="mp-play" title="Play">▶</button>
      <button id="mp-next" title="Next">⏭</button>
      <input id="mp-vol" type="range" min="0" max="1" step="0.01" value="0.6" aria-label="Volume" />
    </div>
    <div id="mp-tracklist" class="mp-tracklist"></div>
  </div>
`

const container = document.getElementById('scene-container')

// overlay element for haiku text
const haikuEl = document.createElement('div')
haikuEl.id = 'haiku-overlay'
haikuEl.textContent = ''
haikuEl.style.opacity = '0'
haikuEl.style.pointerEvents = 'none'
haikuEl.style.whiteSpace = 'pre-wrap'
app.appendChild(haikuEl)

const scene = new THREE.Scene()
// darker ambient fog to push mid/long-range values toward black
scene.fog = new THREE.FogExp2(0x000000, 0.006)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
// use YXZ rotation order (yaw, then pitch) so applying yaw doesn't produce
// unexpected axis-swapped rotations when pitch is non-zero (from lookAt)
camera.rotation.order = 'YXZ'
camera.position.set(0, 1.8, 6)

// Wrapping: when the camera drifts far from scene objects, wrap X/Z.
// `wrapLimit` is tuned after the city is generated; default keeps wrapping
// behavior even if generation hasn't finished yet.
let wrapLimit = 60
function wrapCoordinate(coord, limit) {
  const span = limit * 2
  let r = coord + limit
  r = ((r % span) + span) % span
  return r - limit
}

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
new HDRLoader(loadingManager)
  .load(hdrPath, (hdrTex) => {
    // HDRLoader provides an equirectangular texture
    const envMap = pmremGenerator.fromEquirectangular(hdrTex).texture
    scene.environment = envMap
    scene.background = envMap
    if (hdrTex.dispose) hdrTex.dispose()
    pmremGenerator.dispose()
  }, undefined, (err) => console.warn('HDR load failed', err))

// Load image textures and video texture
const texLoader = new THREE.TextureLoader(loadingManager)

// Dynamically import all images in assets/img so adding new images is automatic.
// Vite exposes `import.meta.glob` which returns module objects with `default` URL when eager.
const imageModules = import.meta.glob('./assets/img/*.{png,jpg,jpeg,webp}', { eager: true })
const imagePaths = Object.values(imageModules).map(m => (m && m.default) || m).filter(Boolean)

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
videoEl.src = new URL('./assets/video/0001.mp4', import.meta.url).href
videoEl.loop = true
videoEl.autoplay = true
videoEl.muted = true
videoEl.playsInline = true
videoEl.preload = 'auto'
videoEl.crossOrigin = 'anonymous'
videoTexture = new THREE.VideoTexture(videoEl)
videoTexture.encoding = THREE.sRGBEncoding
videoTexture.minFilter = THREE.LinearFilter
videoTexture.magFilter = THREE.LinearFilter
videoTexture.format = THREE.RGBAFormat
// Attempt to start playback immediately; browsers allow muted autoplay in most cases.
videoEl.play().catch(() => {})

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

// --- Firefly particle system (soft glowing points that wander) ---
const FIREFLY_COUNT = 300
const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3)
const fireflyScales = new Float32Array(FIREFLY_COUNT)
const fireflyPhases = new Float32Array(FIREFLY_COUNT)
const fireflyVelocities = []
const fireflyColor = new THREE.Color(0xfff2b0)

const FIREFLY_AREA_RADIUS = 48
for (let i = 0; i < FIREFLY_COUNT; i++) {
  const r = Math.sqrt(Math.random()) * FIREFLY_AREA_RADIUS
  const a = Math.random() * Math.PI * 2
  const x = Math.cos(a) * r
  const z = Math.sin(a) * r
  const y = 0.6 + Math.random() * 6.5
  fireflyPositions[i * 3 + 0] = x
  fireflyPositions[i * 3 + 1] = y
  fireflyPositions[i * 3 + 2] = z
  // smaller, subtler base sizes
  fireflyScales[i] = 0.9 + Math.random() * 1.6
  fireflyPhases[i] = Math.random() * Math.PI * 2
  fireflyVelocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.08))
}

const fireflyGeo = new THREE.BufferGeometry()
fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3))
fireflyGeo.setAttribute('aScale', new THREE.BufferAttribute(fireflyScales, 1))
fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(fireflyPhases, 1))

const fireflyMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0.0 },
    uColor: { value: fireflyColor }
  },
  vertexShader: `
    attribute float aScale;
    attribute float aPhase;
    varying float vPhase;
    uniform float uTime;
    void main() {
      vPhase = aPhase;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      // subtler size oscillation and reduced base multiplier
      float tw = 1.0 + 0.45 * sin(uTime * 1.6 + aPhase);
      // smaller on-screen sizes for subtle look
      gl_PointSize = aScale * tw * (120.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vPhase;
    uniform float uTime;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float dist = length(c);
      // slightly softer core and reduced radius
      float alpha = smoothstep(0.55, 0.0, dist);
      // lower flicker amplitude and slower rate for subtlety
      float flick = 0.35 + 0.25 * sin(uTime * 2.2 + vPhase);
      vec3 col = uColor * 0.92;
      gl_FragColor = vec4(col, alpha * flick * 0.6);
    }
  `,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  transparent: true,
  vertexColors: false
})

const fireflyPoints = new THREE.Points(fireflyGeo, fireflyMat)
fireflyPoints.frustumCulled = false
scene.add(fireflyPoints)

// City generation
const city = new THREE.Group()
scene.add(city)
// interactive objects that can display haiku when looked at closely
const interactiveObjects = []

function findHaikuForSrc(src) {
  if (!src) return null
  try {
    // normalize to the URL basename (e.g. "0001-DEfRsdbw.webp") and
    // compare against haiku keys by their base name (without extension)
    const basename = (typeof src === 'string') ? String(src).split('/').pop().split('?')[0] : ''
    const nameNoExt = basename.replace(/\.[^.]*$/, '')
    for (const k of Object.keys(haikuData)) {
      if (!k) continue
      const keyBase = String(k).replace(/\.[^.]*$/, '')
      if (!keyBase) continue
      // match if the asset basename includes the key base (handles hashed names)
      if (basename && nameNoExt.indexOf(keyBase) !== -1) return haikuData[k].haiku
    }
  } catch (e) {}
  return null
}
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
  const faceFilenames = []
  for (let fi = 0; fi < 6; fi++) {
    // face indices: 0:+X, 1:-X, 2:+Y(top), 3:-Y(bottom), 4:+Z, 5:-Z
    if (fi === 2 || fi === 3) {
      materials.push(new THREE.MeshBasicMaterial({ color: 0x0f0f0f }))
      continue
    }
    // Allow occasional video faces; otherwise use an image texture for
    // each vertical face. If neither is available, fall back to dark.
    if (Math.random() < 0.12 && videoTexture) {
      materials.push(new THREE.MeshBasicMaterial({ map: videoTexture, toneMapped: false, side: THREE.FrontSide }))
      continue
    }
    if (!imageTextures.length) {
      materials.push(new THREE.MeshBasicMaterial({ color: 0x0f0f0f }))
      continue
    }
    const src = imageTextures[Math.floor(Math.random() * imageTextures.length)]
    const faceW = (fi === 0 || fi === 1) ? d : w
    const faceH = h
    const tex = makeTextureForFace(src, faceW, faceH)
    materials.push(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.FrontSide }))
    try { if (src && src.image && src.image.src) faceFilenames.push(src.image.src) } catch (e) {}
  }

  const mesh = new THREE.Mesh(geom, materials)
  mesh.position.set(bx, h / 2, bz)
  mesh.castShadow = false
  mesh.receiveShadow = false
  // store a representative image URL for haiku lookup and register
  mesh.userData.haikuSrc = faceFilenames.length ? faceFilenames[0] : null
  interactiveObjects.push(mesh)
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
  const gltfLoader = new GLTFLoader(loadingManager)
  const modelFiles = [
    new URL('./assets/models/chains.glb', import.meta.url).href,
    new URL('./assets/models/ghost.glb', import.meta.url).href,
    new URL('./assets/models/hooded.glb', import.meta.url).href,
    new URL('./assets/models/lantern.glb', import.meta.url).href,
    new URL('./assets/models/maiden.glb', import.meta.url).href
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
  // holographic material factory (reuse for fallbacks)
  function makeHoloMaterial() {
    // Darker metallic variant: very dark base color with strong specular
    // reflections, low roughness and pronounced clearcoat for a crisp
    // metallic look while staying visually dark.
    return new THREE.MeshPhysicalMaterial({
      color: 0x07101a,
      metalness: 0.98,
      roughness: 0.06,
      transmission: 0.0,
      thickness: 0.0,
      ior: 1.6,
      envMapIntensity: 1.4,
      clearcoat: 0.85,
      clearcoatRoughness: 0.01,
      emissive: 0x00060a,
      emissiveIntensity: 0.01,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide
    })
  }

  modelFiles.forEach((p) => {
    gltfLoader.load(p, (g) => {
      const root = g.scene || g.scenes[0]
      root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true } })
      // create mesh wrapper function for placement
      const createFn = (rx, rz) => {
        const clone = root.clone()
        // apply an initial random scale then normalize to a reasonable size
        const randScale = 1.5 + Math.random() * 2.5
        clone.scale.setScalar(randScale)

        // apply holographic/metallic-glass material to all meshes in the clone
        clone.traverse((node) => {
          if (!node.isMesh) return
          const holoMat = makeHoloMaterial()
          if (scene.environment) holoMat.envMap = scene.environment
          holoMat.side = THREE.DoubleSide
          node.material = holoMat
          node.castShadow = true
          node.receiveShadow = true
          node.visible = true
          node.frustumCulled = false
          try { if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals() } catch (e) {}
        })

        // place at rx,0,rz first then compute bbox to lift above ground
        clone.position.set(rx, 0, rz)
        const bbox = new THREE.Box3().setFromObject(clone)
        const size = new THREE.Vector3()
        bbox.getSize(size)
        // normalize scale so largest dimension is near target (3-6 units)
        const maxDim = Math.max(size.x, size.y, size.z, 0.0001)
        const target = 3.5
        const normScale = target / maxDim
        // clamp overall resulting scale to avoid extreme sizes
        const finalScale = THREE.MathUtils.clamp(normScale * randScale, 0.5, 6.0)
        clone.scale.setScalar(finalScale)

        // recompute bbox after scaling and lift to rest on ground
        const bbox2 = new THREE.Box3().setFromObject(clone)
        const minY = bbox2.min.y
        const lift = (minY < 0) ? -minY + 0.05 : 0.05
        clone.position.y = lift

        return clone
      }
      const placed = placeObjectNoOverlap(createFn)
      if (placed) {
        // register its bbox so future placement avoids overlap
        const placedBox = new THREE.Box3().setFromObject(placed)
        placedBox.expandByScalar(0.6)
        buildingBoxes.push(placedBox)
        // attach source glb URL so models can show haiku (if available)
        try { placed.userData.haikuSrc = p } catch (e) {}
        interactiveObjects.push(placed)
      }
    }, undefined, () => {})
  })

  // scatter uniform cubes (panels) randomly like gallery pedestals/walls
  const totalPanels = 14
  const panelSize = 3.5

  for (let i = 0; i < totalPanels; i++) {
    const createPanel = (rx, rz) => {
      const geom = new THREE.BoxGeometry(panelSize, panelSize, panelSize)
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, metalness: 0.9, roughness: 0.12 })
      const materials = []
      const faceFilenames = []
      for (let fi = 0; fi < 6; fi++) materials.push(baseMat)
      if (imageTextures.length) {
        // Put images on all four vertical sides (0,1,4,5). Each side can be different.
        const faceH = panelSize
        for (const fi of [0, 1, 4, 5]) {
          // small chance to use the shared video texture for a face
          if (Math.random() < 0.12 && videoTexture) {
            materials[fi] = new THREE.MeshStandardMaterial({ map: videoTexture, metalness: 0.0, roughness: 0.35, emissive: 0xffffff, emissiveMap: videoTexture, emissiveIntensity: 0.6 })
            continue
          }
          const src = imageTextures[Math.floor(Math.random() * imageTextures.length)]
          const faceW = panelSize
          const tex = makeTextureForFace(src, faceW, faceH)
          materials[fi] = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.0, roughness: 0.35, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 })
          try { if (src && src.image && src.image.src) faceFilenames.push(src.image.src) } catch (e) {}
        }
      }
      const mesh = new THREE.Mesh(geom, materials)
      mesh.position.set(rx, panelSize/2, rz)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.userData.haikuSrc = faceFilenames.length ? faceFilenames[0] : null
      interactiveObjects.push(mesh)
      return mesh
    }
    placeObjectNoOverlap(createPanel)
  }

  // Roads removed: no road meshes are created for a cleaner scene
  // (Previously created long strip meshes along grid lines.)

  // place camera outside the city so it spawns looking in
  // compute scene extent and use it to pick a good distance
  const length = grid * spacing + spacing
  // tune wrap limit from scene extent so wrapping happens at sensible distance
  wrapLimit = Math.max(48, Math.ceil(length * 0.55))
  // attempt to spawn camera inside the city: sample random positions
  // and pick the first one that doesn't intersect any building boxes
  function findSpawnInside(maxRadius = Math.max(8, length * 0.35), tries = 300) {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2
      // bias samples toward the center for earlier success
      const bias = (i < tries * 0.5) ? 0.5 : 1.0
      const r = Math.random() * maxRadius * bias
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const pos = new THREE.Vector3(x, 1.8, z)
      const sphere = new THREE.Sphere(pos, playerRadius)
      let blocked = false
      for (const box of buildingBoxes) {
        if (sphere.intersectsBox(box)) { blocked = true; break }
      }
      if (!blocked) return pos
    }
    return null
  }

  const spawnPos = findSpawnInside()
  if (spawnPos) {
    camera.position.copy(spawnPos)
  } else {
    // fallback: place camera a little closer to the city on spawn
    camera.position.set(0, 1.8, Math.max(2, Math.ceil(length * 0.45)))
  }
  camera.lookAt(0, 1.8, 0)
  // initialize `yaw` from the camera's forward direction so controls
  // remain aligned with the facing direction after spawning
  try {
    const initForward = new THREE.Vector3()
    camera.getWorldDirection(initForward)
    initForward.y = 0
    initForward.normalize()
    // Three.js forward for rotation `y = 0` is (0,0,-1).
    // For a given forward vector `f`, the correct yaw satisfies
    // f = (-sin(yaw), 0, -cos(yaw)), so yaw = atan2(-f.x, -f.z).
    yaw = Math.atan2(-initForward.x, -initForward.z)
  } catch (e) {}

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

let _lastTime = performance.now()
function animate(t) {
  requestAnimationFrame(animate)
  const now = (typeof t === 'number') ? t : performance.now()
  const dt = Math.min(0.1, (now - _lastTime) * 0.001)
  _lastTime = now
  // advance shader time
  if (fireflyMat && fireflyMat.uniforms && typeof fireflyMat.uniforms.uTime !== 'undefined') fireflyMat.uniforms.uTime.value += dt

  // rotation with left/right or a/d
  if (keys['arrowleft'] || keys['a']) yaw += 0.03
  if (keys['arrowright'] || keys['d']) yaw -= 0.03

  // apply yaw while preserving pitch using the camera's rotation order
  // this avoids gimbal/sign issues when camera pitch was set by lookAt
  camera.rotation.set(camera.rotation.x, yaw, 0)
  // forward = (-sin(yaw), 0, -cos(yaw)) matches Three.js where yaw=0 -> forward (0,0,-1)
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
  // right = (cos(yaw), 0, -sin(yaw)) is the camera's local +X direction
  right.set(Math.cos(yaw), 0, -Math.sin(yaw))

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

  // Wrap camera position if it drifts far away from scene objects
  try {
    if (buildingBoxes && buildingBoxes.length) {
      const cam2 = new THREE.Vector2(camera.position.x, camera.position.z)
      let nearest = Infinity
      const ctmp = new THREE.Vector3()
      for (const b of buildingBoxes) {
        b.getCenter(ctmp)
        const d = cam2.distanceTo(new THREE.Vector2(ctmp.x, ctmp.z))
        if (d < nearest) nearest = d
      }
      // only wrap when the nearest object is farther than the threshold
      if (nearest > wrapLimit * 0.9) {
        camera.position.x = wrapCoordinate(camera.position.x, wrapLimit)
        camera.position.z = wrapCoordinate(camera.position.z, wrapLimit)
      }
    }
  } catch (e) {}

  // Haiku overlay detection: find the nearest interactive object within view and distance
  try {
    // camera forward is 'forward' with y zeroed earlier
    const camDir = forward.clone().normalize()
    let bestObj = null
    let bestDist = Infinity
    const tmpBox = new THREE.Box3()
    const tmpCenter = new THREE.Vector3()
    for (const obj of interactiveObjects) {
      if (!obj) continue
      tmpBox.setFromObject(obj)
      tmpBox.getCenter(tmpCenter)
      const toObj = tmpCenter.clone().sub(camera.position)
      const dist = toObj.length()
      if (dist > 6.0) continue
      const dirTo = toObj.clone().normalize()
      const dot = camDir.dot(dirTo)
      if (dot < 0.7) continue
      if (dist < bestDist) { bestDist = dist; bestObj = { obj, center: tmpCenter.clone() } }
    }

    if (bestObj && bestObj.obj && bestObj.obj.userData) {
      const src = bestObj.obj.userData.haikuSrc || ''
      const haiku = findHaikuForSrc(src)
      if (haiku) {
        // project center to screen
        const proj = bestObj.center.clone().project(camera)
        const x = (proj.x * 0.5 + 0.5) * window.innerWidth
        const y = (-proj.y * 0.5 + 0.5) * window.innerHeight
        haikuEl.textContent = haiku
        haikuEl.style.left = `${x}px`
        haikuEl.style.top = `${y - 36}px`
        haikuEl.style.opacity = '1'
      } else {
        haikuEl.style.opacity = '0'
      }
    } else {
      haikuEl.style.opacity = '0'
    }
  } catch (e) {}

  // update fireflies positions (gentle wandering + bounds)
  try {
    const posAttr = fireflyGeo.getAttribute('position')
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ix = i * 3
      // random small acceleration
      fireflyVelocities[i].x += (Math.random() - 0.5) * 0.02
      fireflyVelocities[i].y += (Math.random() - 0.5) * 0.01
      fireflyVelocities[i].z += (Math.random() - 0.5) * 0.02
      // clamp velocities
      fireflyVelocities[i].x = THREE.MathUtils.clamp(fireflyVelocities[i].x, -0.25, 0.25)
      fireflyVelocities[i].y = THREE.MathUtils.clamp(fireflyVelocities[i].y, -0.12, 0.12)
      fireflyVelocities[i].z = THREE.MathUtils.clamp(fireflyVelocities[i].z, -0.25, 0.25)
      // integrate
      posAttr.array[ix + 0] += fireflyVelocities[i].x * dt * 12.0
      posAttr.array[ix + 1] += fireflyVelocities[i].y * dt * 12.0
      posAttr.array[ix + 2] += fireflyVelocities[i].z * dt * 12.0
      // vertical bounds
      if (posAttr.array[ix + 1] < 0.4) { posAttr.array[ix + 1] = 0.4; fireflyVelocities[i].y = Math.abs(fireflyVelocities[i].y) }
      if (posAttr.array[ix + 1] > 9.0) { posAttr.array[ix + 1] = 9.0; fireflyVelocities[i].y = -Math.abs(fireflyVelocities[i].y) }
      // radial bounds: push back toward center
      const x = posAttr.array[ix + 0]
      const z = posAttr.array[ix + 2]
      if (x * x + z * z > FIREFLY_AREA_RADIUS * FIREFLY_AREA_RADIUS) {
        posAttr.array[ix + 0] *= 0.92
        posAttr.array[ix + 2] *= 0.92
        fireflyVelocities[i].x *= -0.6
        fireflyVelocities[i].z *= -0.6
      }
    }
    posAttr.needsUpdate = true
  } catch (e) {}

  renderer.render(scene, camera)
}

animate()

// --- Simple music player using files in ./assets/music ---
try {
  const musicModules = import.meta.glob('./assets/music/*.{mp3,ogg}', { eager: true })
  const trackUrls = Object.values(musicModules).map(m => (m && m.default) || m).filter(Boolean)
  const playerEl = document.getElementById('music-player')
  const playBtn = document.getElementById('mp-play')
  const prevBtn = document.getElementById('mp-prev')
  const nextBtn = document.getElementById('mp-next')
  const volEl = document.getElementById('mp-vol')
  const listEl = document.getElementById('mp-tracklist')

  if (playerEl && trackUrls.length) {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.volume = parseFloat(volEl.value || '0.6')
    let current = 0
    let playing = false

    function niceName(url) {
      try {
        const s = url.split('/').pop() || url
        return s.replace(/\.(mp3|ogg)$/i, '').replace(/[-_]/g, ' ')
      } catch (e) { return url }
    }

    function renderList() {
      listEl.innerHTML = ''
      trackUrls.forEach((u, i) => {
        const d = document.createElement('div')
        d.className = 'mp-track'
        if (i === current) d.classList.add('active')
        d.textContent = niceName(u)
        d.addEventListener('click', () => { playIndex(i) })
        listEl.appendChild(d)
      })
    }

    function updateButtons() {
      playBtn.textContent = playing ? '⏸' : '▶'
    }

    function playIndex(i) {
      if (i < 0) i = trackUrls.length - 1
      if (i >= trackUrls.length) i = 0
      current = i
      audio.src = trackUrls[current]
      audio.play().catch(() => {})
      playing = true
      updateButtons()
      renderList()
    }

    playBtn.addEventListener('click', () => {
      if (!audio.src) playIndex(current)
      else if (audio.paused) { audio.play().catch(() => {}); playing = true }
      else { audio.pause(); playing = false }
      updateButtons()
    })
    prevBtn.addEventListener('click', () => { playIndex(current - 1) })
    nextBtn.addEventListener('click', () => { playIndex(current + 1) })
    volEl.addEventListener('input', () => { audio.volume = parseFloat(volEl.value) })

    audio.addEventListener('ended', () => { playIndex(current + 1) })

    renderList()
    // try to auto-load first track so UI shows proper filename
    if (trackUrls.length) {
      audio.src = trackUrls[0]
    }
  } else if (playerEl) {
    playerEl.style.display = 'none'
  }
} catch (e) { console.warn('music player init failed', e) }
