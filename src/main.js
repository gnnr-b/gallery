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

function makeBuilding(x, z) {
  const isWide = Math.random() < 0.18
  const w = isWide ? (2 + Math.random() * 3) : (1 + Math.random() * 1.6)
  const d = isWide ? (2 + Math.random() * 3) : (1 + Math.random() * 1.6)
  const h = 2 + Math.random() * 24
  const geom = new THREE.BoxGeometry(w, h, d)
  const color = palette[Math.floor(Math.random() * palette.length)]
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.7 })
  mat.wireframe = true
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(x, h / 2, z)
  mesh.userData.wide = isWide
  return mesh
}

const grid = 18
const spacing = 4
// Roads every N grid lines
const roadEvery = 4
const roadWidth = spacing * 0.9

for (let i = 0; i < grid; i++) {
  for (let j = 0; j < grid; j++) {
    const isRoadX = (i % roadEvery === 0)
    const isRoadZ = (j % roadEvery === 0)
    if (isRoadX || isRoadZ) continue // leave space for roads

    const x = (i - grid / 2) * spacing + (Math.random() - 0.5) * 0.6
    const z = (j - grid / 2) * spacing + (Math.random() - 0.5) * 0.6
    const b = makeBuilding(x, z)
    city.add(b)
    // compute and store bounding box expanded slightly for collision
    const box = new THREE.Box3().setFromObject(b)
    box.expandByScalar(0.25)
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

// also add road boxes to block walking on tall road edges (optional)
// (keep roads walkable by default; commented out)

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

// Click to focus (helps with key events on some browsers)
container.addEventListener('click', () => container.focus())
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
