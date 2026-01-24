import * as THREE from 'three'

export const loadingManager = new THREE.LoadingManager()
export const texLoader = new THREE.TextureLoader(loadingManager)

export function getImagePaths() {
  const imageModules = import.meta.glob('../assets/img/*.{png,jpg,jpeg,webp}', { eager: true })
  return Object.values(imageModules).map(m => (m && m.default) || m).filter(Boolean)
}

export function loadTextures(paths) {
  return Promise.all(paths.map(p => new Promise((res) => {
    texLoader.load(p, (t) => {
      t.encoding = THREE.sRGBEncoding
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      res(t)
    }, undefined, () => res(null))
  }))).then(txs => txs.filter(Boolean))
}

export function makeTextureForFace(srcTex, faceW, faceH) {
  const canvas = document.createElement('canvas')
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
    ctx.clearRect(0, 0, cw, ch)
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

export function createVideoTexture() {
  const videoEl = document.createElement('video')
  videoEl.src = new URL('../assets/video/0001.mp4', import.meta.url).href
  videoEl.loop = true
  videoEl.autoplay = true
  videoEl.muted = true
  videoEl.playsInline = true
  videoEl.preload = 'auto'
  videoEl.crossOrigin = 'anonymous'
  const videoTexture = new THREE.VideoTexture(videoEl)
  videoTexture.encoding = THREE.sRGBEncoding
  videoTexture.minFilter = THREE.LinearFilter
  videoTexture.magFilter = THREE.LinearFilter
  videoTexture.format = THREE.RGBAFormat
  videoEl.play().catch(() => {})
  return { videoEl, videoTexture }
}

export function loadEnvironment(renderer, scene) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  pmremGenerator.compileEquirectangularShader()

  // create an equirectangular-like gradient on a canvas and use it as background
  const w = 2048, h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // sunset gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0.0, '#0b1020') // deep sky at top
  grad.addColorStop(0.4, '#3b1f4a') // purple
  grad.addColorStop(0.7, '#ff6a00') // orange
  grad.addColorStop(0.95, '#ffd36b') // warm horizon
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // sun (radial glow)
  const sunX = w * 0.5
  const sunY = h * 0.78
  const sunR = Math.min(w, h) * 0.08
  const sunGrad = ctx.createRadialGradient(sunX, sunY, sunR * 0.15, sunX, sunY, sunR)
  sunGrad.addColorStop(0, 'rgba(255,230,150,1)')
  sunGrad.addColorStop(0.5, 'rgba(255,140,40,0.95)')
  sunGrad.addColorStop(1, 'rgba(255,140,40,0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = sunGrad
  ctx.beginPath()
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // simple soft cloud clusters
  function drawCloud(cx, cy, widthC, heightC, alpha) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    for (let i = -2; i <= 2; i++) {
      const rx = cx + i * (widthC * 0.22)
      const ry = cy + Math.sin(i * 0.8) * (heightC * 0.12)
      ctx.beginPath()
      ctx.ellipse(rx, ry, widthC * 0.26, heightC * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  drawCloud(w * 0.72, h * 0.6, w * 0.28, h * 0.08, 0.14)
  drawCloud(w * 0.28, h * 0.55, w * 0.34, h * 0.1, 0.16)

  const canvasTex = new THREE.CanvasTexture(canvas)
  canvasTex.encoding = THREE.sRGBEncoding
  canvasTex.mapping = THREE.EquirectangularReflectionMapping
  canvasTex.needsUpdate = true

  // generate a PMREM environment from the canvas texture so PBR materials keep lighting
  let envMap = null
  try {
    envMap = pmremGenerator.fromEquirectangular(canvasTex).texture
    scene.environment = envMap
    scene.background = canvasTex
  } catch (err) {
    // fallback: use the canvas texture as background without PMREM env
    try {
      scene.background = canvasTex
      scene.environment = null
    } catch (e) {}
  }

  // ensure renderer clear color matches primary hue so change is visible
  try {
    renderer.setClearColor(new THREE.Color('#12486b'))
  } catch (e) {}

  // increase global brightness via renderer tone mapping exposure
  try {
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.8
  } catch (e) {}

  pmremGenerator.dispose()
  return Promise.resolve(envMap)
}
