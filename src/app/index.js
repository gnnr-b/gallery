import * as THREE from 'three'
import haikuData from '../data/data.json'
import { loadingManager, getImagePaths, loadTextures, makeTextureForFace, createVideoTexture, loadEnvironment } from './assets.js'
import { createFireflySystem } from './particles.js'
import { setupControls } from './controls.js'
import { startTouchControls } from './touchControls.js'
import { initModels } from './models.js'

export function startApp() {
  // --- Loading manager + small rotating-cube loader UI ---
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
      if (_loaderAnim) cancelAnimationFrame(_loaderAnim)
      try {
        // disposing the renderer is sufficient; avoid calling forceContextLoss()
        // because calling it when the context is already lost can trigger
        // GL errors in some browsers/extensions.
        loaderRenderer.dispose()
      } catch (e) {}
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
  scene.fog = new THREE.FogExp2(0x000000, 0.006)

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.rotation.order = 'YXZ'
  camera.position.set(0, 1.8, 6)

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
  renderer.physicallyCorrectLights = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.35
  container.appendChild(renderer.domElement)

  // load HDR environment (pmrem) in background
  loadEnvironment(renderer, scene).catch(() => {})

  const imagePaths = getImagePaths()
  let imageTextures = []
  const texturesReady = loadTextures(imagePaths).then((txs) => { imageTextures = txs.filter(Boolean) })

  // helper to create canvas-backed textures for faces is in ./assets.js

  const { videoEl, videoTexture } = createVideoTexture()

  const hemi = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.18)
  scene.add(hemi)
  const ambient = new THREE.AmbientLight(0x101010, 0.08)
  scene.add(ambient)
  const dir = new THREE.DirectionalLight(0xffffff, 0.4)
  dir.position.set(5, 10, 7.5)
  dir.castShadow = true
  scene.add(dir)
  const keyLight = new THREE.PointLight(0xfff7e6, 0.2, 40)
  keyLight.position.set(0, 8, 8)
  scene.add(keyLight)
  const fill = new THREE.PointLight(0x88aaff, 0.04, 60)
  fill.position.set(0, 4, -8)
  scene.add(fill)

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x000000, wireframe: false })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000, 200, 200), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0
  scene.add(ground)

  const fireflies = createFireflySystem(scene)

  const city = new THREE.Group()
  scene.add(city)
  const interactiveObjects = []

  function findHaikuForSrc(src) {
    if (!src) return null
    try {
      const basename = (typeof src === 'string') ? String(src).split('/').pop().split('?')[0] : ''
      const nameNoExt = basename.replace(/\.[^.]*$/, '')
      for (const k of Object.keys(haikuData)) {
        if (!k) continue
        const keyBase = String(k).replace(/\.[^.]*$/, '')
        if (!keyBase) continue
        if (basename && nameNoExt.indexOf(keyBase) !== -1) return haikuData[k].haiku
      }
    } catch (e) {}
    return null
  }

  const buildingBoxes = []
  const playerRadius = 0.45

  const palette = [0x8fbf8f, 0xa0c4ff, 0xffc89a, 0xffe082, 0xb39ddb, 0x90a4ae]

  function makeBuilding(i, j, x, z, roadEvery, spacing) {
    const size = 3.5
    const w = size
    const d = size
    const h = size

    const localI = i % roadEvery
    const localJ = j % roadEvery

    let shiftX = 0
    let shiftZ = 0
    if (localI === 1) shiftX = - (spacing / 2 - w / 2)
    else if (localI === roadEvery - 1) shiftX = (spacing / 2 - w / 2)
    if (localJ === 1) shiftZ = - (spacing / 2 - d / 2)
    else if (localJ === roadEvery - 1) shiftZ = (spacing / 2 - d / 2)

    if (shiftX !== 0 && shiftZ !== 0) {
      if (Math.random() < 0.5) shiftZ = 0
      else shiftX = 0
    }

    const bx = x + shiftX
    const bz = z + shiftZ

    const geom = new THREE.BoxGeometry(w, h, d)

    const materials = []
    const faceFilenames = []
    for (let fi = 0; fi < 6; fi++) {
      if (fi === 2 || fi === 3) {
        materials.push(new THREE.MeshBasicMaterial({ color: 0x0f0f0f }))
        continue
      }
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
    mesh.userData.haikuSrc = faceFilenames.length ? faceFilenames[0] : null
    interactiveObjects.push(mesh)
    return mesh
  }

  texturesReady.then(async () => {
    try {
    const grid = 12
    const spacing = 8
    const roadEvery = 4
    const roadWidth = spacing * 0.9

    // model loading and placement moved to ./models.js (initModels)

    // Panels and ambient models are initialized inside `initModels()` in ./models.js
    // (keeps model/panel placement logic isolated and avoids duplicate definitions)

    const length = grid * spacing + spacing
    wrapLimit = Math.max(48, Math.ceil(length * 0.55))
    function findSpawnInside(maxRadius = Math.max(8, length * 0.35), tries = 300) {
      for (let i = 0; i < tries; i++) {
        const a = Math.random() * Math.PI * 2
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

    // initialize models and placement
    const { spawnPos, wrapLimit: newWrap } = await initModels({ scene, imageTextures, videoTexture, loadingManager, interactiveObjects, buildingBoxes, city })
    if (newWrap) wrapLimit = newWrap
    if (spawnPos) {
      if (camera && camera.position && typeof camera.position.copy === 'function') camera.position.copy(spawnPos)
    }
    else camera.position.set(0, 1.8, Math.max(2, Math.ceil((12 * 8 + 8) * 0.45)))
    camera.lookAt(0, 1.8, 0)
    try {
      const initForward = new THREE.Vector3()
      camera.getWorldDirection(initForward)
      initForward.y = 0
      initForward.normalize()
      // yaw local variable will be initialized in controls module; keep consistent
    } catch (e) {}

    animate()
    } catch (err) {}
  })

  const controls = setupControls(camera, buildingBoxes)

  // start touch gesture controls on touch-capable devices
  let _stopTouchControls = null
  try {
    if (typeof window !== 'undefined' && 'ontouchstart' in window) {
      _stopTouchControls = startTouchControls(container, {
        onLook: (dx, dy) => { if (controls && typeof controls.applyLookDelta === 'function') controls.applyLookDelta(dx, dy) },
        onMove: (axes) => { if (controls && typeof controls.setMoveAxes === 'function') controls.setMoveAxes(axes.x, axes.z) }
      })
    }
  } catch (e) { console.warn('touch controls init failed', e) }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', resize)

  container.addEventListener('click', () => {
    container.focus()
    if (videoEl && videoEl.paused) {
      videoEl.play().catch(() => {})
    }
  })
  container.tabIndex = 0

  // controls module handles input and movement

  let _lastTime = performance.now()
  function animate(t) {
    requestAnimationFrame(animate)
    const now = (typeof t === 'number') ? t : performance.now()
    const dt = Math.min(0.1, (now - _lastTime) * 0.001)
    _lastTime = now
    // update controls (keyboard movement & yaw)
    const { yaw, forward, right } = controls.update()

    // update fireflies
    fireflies.update(dt)

    if (camera.position.y < 1.5) camera.position.y = 1.5

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
        if (nearest > wrapLimit * 0.9) {
          camera.position.x = wrapCoordinate(camera.position.x, wrapLimit)
          camera.position.z = wrapCoordinate(camera.position.z, wrapLimit)
        }
      }
    } catch (e) {}

    try {
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

    renderer.render(scene, camera)
  }

  animate()

  try {
    const musicModules = import.meta.glob('../assets/music/*.{mp3,ogg}', { eager: true })
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
      if (trackUrls.length) {
        audio.src = trackUrls[0]
      }
    } else if (playerEl) {
      playerEl.style.display = 'none'
    }
  } catch (e) { console.warn('music player init failed', e) }
}
