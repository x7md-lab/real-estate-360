import { useRef, useEffect, useState, lazy, Suspense } from 'react'
import * as THREE from 'three'

// Lazy-load dev panel — entire module tree-shaken in production
const DevPanel = import.meta.env.DEV
  ? lazy(() => import('./DevPanel'))
  : () => null

function createArrowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, 128, 128)
  ctx.beginPath()
  ctx.moveTo(64, 10)
  ctx.lineTo(120, 72)
  ctx.lineTo(90, 72)
  ctx.lineTo(90, 118)
  ctx.lineTo(38, 118)
  ctx.lineTo(38, 72)
  ctx.lineTo(8, 72)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createClickablePolygonMesh(points) {
  if (!Array.isArray(points) || points.length < 3) return null
  const verts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z).normalize().multiplyScalar(494))
  const center = new THREE.Vector3()
  verts.forEach((v) => center.add(v))
  center.divideScalar(verts.length)
  const positions = []
  for (let i = 0; i < verts.length; i++) {
    const next = verts[(i + 1) % verts.length]
    positions.push(center.x, center.y, center.z)
    positions.push(verts[i].x, verts[i].y, verts[i].z)
    positions.push(next.x, next.y, next.z)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const material = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  return new THREE.Mesh(geometry, material)
}

export default function PanoramaViewer({
  imageUrl, initialView, polygons = [], onPolygonClick, onAddPolygon, onUpdatePolygon, onDeletePolygon, scenes = [],
}) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const hasLoadedOnce = useRef(false)
  const [transitioning, setTransitioning] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [hotspotHovered, setHotspotHovered] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)

  const stateRef = useRef({
    camera: null, scene: null, renderer: null, sphere: null,
    raycaster: new THREE.Raycaster(),
    isUserInteracting: false, hasDragged: false, ctrlHeld: false, devMode: false,
    onPointerDownPointerX: 0, onPointerDownPointerY: 0,
    lon: 0, onPointerDownLon: 0, lat: 0, onPointerDownLat: 0,
    targetLon: 0, targetLat: 0,
    velocityLon: 0, velocityLat: 0,
    lastMoveX: 0, lastMoveY: 0, lastMoveTime: 0,
    hotspotGroup: null, hotspotTexture: null,
    hotspotHoveredIndex: -1,
    animationId: null,
  })

  // ─── Three.js init ───
  useEffect(() => {
    const container = containerRef.current
    const s = stateRef.current

    const getSize = () => ({
      w: container.clientWidth || window.innerWidth,
      h: container.clientHeight || window.innerHeight,
    })

    s.scene = new THREE.Scene()
    const { w, h } = getSize()
    s.camera = new THREE.PerspectiveCamera(75, w / h, 1, 1100)

    const geometry = new THREE.SphereGeometry(500, 60, 40)
    geometry.scale(-1, 1, 1)
    s.sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000 }))
    s.scene.add(s.sphere)

    // ─── Watermark overlay (tiled inside renderer) ───
    s.wmScene = new THREE.Scene()
    s.wmCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const wmLoader = new THREE.TextureLoader()
    const base = import.meta.env.BASE_URL
    const wmTexture = wmLoader.load(`${base}watermark.svg`)
    wmTexture.wrapS = THREE.RepeatWrapping
    wmTexture.wrapT = THREE.RepeatWrapping
    wmTexture.colorSpace = THREE.SRGBColorSpace
    // Tile count — adjusted on resize
    const tileSize = 180 // px per tile
    const updateWmRepeat = (rw, rh) => {
      wmTexture.repeat.set(rw / tileSize, rh / tileSize)
    }
    updateWmRepeat(w, h)
    s._updateWmRepeat = updateWmRepeat

    const wmMat = new THREE.MeshBasicMaterial({
      map: wmTexture,
      transparent: true,
      opacity: 0.2,
      depthTest: false,
      depthWrite: false,
    })
    const wmQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), wmMat)
    s.wmScene.add(wmQuad)

    s.renderer = new THREE.WebGLRenderer({ antialias: true })
    s.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    s.renderer.setSize(w, h)
    s.renderer.autoClear = false
    container.appendChild(s.renderer.domElement)
    s.hotspotTexture = createArrowTexture()

    const onKeyDown = (e) => { if (e.key === 'Control') { s.ctrlHeld = true; setCtrlHeld(true) } }
    const onKeyUp = (e) => { if (e.key === 'Control') { s.ctrlHeld = false; setCtrlHeld(false) } }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const onPointerDown = (e) => {
      if (e.isPrimary === false) return
      if (s.ctrlHeld && s.devMode) return
      s.isUserInteracting = true
      s.hasDragged = false
      s.onPointerDownPointerX = e.clientX
      s.onPointerDownPointerY = e.clientY
      s.onPointerDownLon = s.lon
      s.onPointerDownLat = s.lat
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
    }
    const onPointerMove = (e) => {
      if (e.isPrimary === false) return
      if (Math.abs(e.clientX - s.onPointerDownPointerX) > 3 || Math.abs(e.clientY - s.onPointerDownPointerY) > 3) s.hasDragged = true

      const now = performance.now()
      const dt = Math.max(now - s.lastMoveTime, 1)
      const newLon = (s.onPointerDownPointerX - e.clientX) * 0.15 + s.onPointerDownLon
      const newLat = (e.clientY - s.onPointerDownPointerY) * 0.15 + s.onPointerDownLat

      s.velocityLon = (newLon - s.targetLon) / dt * 16
      s.velocityLat = (newLat - s.targetLat) / dt * 16
      s.targetLon = newLon
      s.targetLat = newLat
      s.lastMoveTime = now
    }
    const onPointerUp = () => {
      s.isUserInteracting = false
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    }
    const onWheel = (e) => {
      s.camera.fov = THREE.MathUtils.clamp(s.camera.fov + e.deltaY * 0.05, 10, 75)
      s.camera.updateProjectionMatrix()
    }
    const onResize = () => {
      const { w: rw, h: rh } = getSize()
      s.camera.aspect = rw / rh
      s.camera.updateProjectionMatrix()
      s.renderer.setSize(rw, rh)
      s._updateWmRepeat(rw, rh)
    }

    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(container)

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('wheel', onWheel)
    window.addEventListener('resize', onResize)

    const animate = () => {
      s.animationId = requestAnimationFrame(animate)

      if (s.isUserInteracting) {
        s.lon += (s.targetLon - s.lon) * 0.6
        s.lat += (s.targetLat - s.lat) * 0.6
      } else {
        s.targetLon += s.velocityLon
        s.targetLat += s.velocityLat
        s.velocityLon *= 0.95
        s.velocityLat *= 0.95
        if (Math.abs(s.velocityLon) < 0.001) s.velocityLon = 0
        if (Math.abs(s.velocityLat) < 0.001) s.velocityLat = 0
        s.lon += (s.targetLon - s.lon) * 0.25
        s.lat += (s.targetLat - s.lat) * 0.25
      }

      s.lat = Math.max(-85, Math.min(85, s.lat))
      s.targetLat = Math.max(-85, Math.min(85, s.targetLat))

      const phi = THREE.MathUtils.degToRad(90 - s.lat)
      const theta = THREE.MathUtils.degToRad(s.lon)
      s.camera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta),
      )
      if (s.hotspotGroup?.children.length) {
        const now = performance.now() * 0.002
        s.hotspotGroup.children.forEach((sprite) => {
          if (!sprite.isSprite) return
          const basePosition = sprite.userData.basePosition
          const normal = sprite.userData.normal
          if (!basePosition || !normal) return
          const phase = sprite.userData.phase ?? 0
          const isHovered = s.hotspotHoveredIndex === sprite.userData.polygonIndex
          const floatOffset = Math.sin(now * 2 + phase) * 3.6
          const pulse = 1 + Math.sin(now * 3 + phase) * 0.12
          const hoverBoost = isHovered ? 1.25 : 1
          const finalScale = (sprite.userData.baseScale ?? 34) * pulse * hoverBoost
          sprite.position.copy(basePosition)
          sprite.position.addScaledVector(normal, floatOffset)
          sprite.scale.set(finalScale, finalScale, 1)
          sprite.material.opacity = isHovered ? 1 : 0.88
        })
      }
      s.renderer.clear()
      s.renderer.render(s.scene, s.camera)
      s.renderer.render(s.wmScene, s.wmCamera)
    }
    animate()

    return () => {
      cancelAnimationFrame(s.animationId)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      resizeObserver.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      s.renderer.dispose()
      if (s.hotspotTexture) s.hotspotTexture.dispose()
      container.removeChild(s.renderer.domElement)
    }
  }, [])

  useEffect(() => { stateRef.current.devMode = devMode }, [devMode])

  useEffect(() => {
    const s = stateRef.current
    if (!s.scene || !s.hotspotTexture) return
    if (s.hotspotGroup) {
      s.hotspotGroup.children.forEach((child) => child.material.dispose())
      s.scene.remove(s.hotspotGroup)
    }
    s.hotspotHoveredIndex = -1
    queueMicrotask(() => setHotspotHovered(false))
    const group = new THREE.Group()
    polygons.forEach((polygon, index) => {
      if (polygon?.points?.length >= 3) {
        const polygonMesh = createClickablePolygonMesh(polygon.points)
        if (!polygonMesh) return
        polygonMesh.userData.polygonIndex = index
        group.add(polygonMesh)
        return
      }
      if (!polygon?.position) return
      const { x, y, z } = polygon.position
      const point = new THREE.Vector3(x, y, z)
      if (point.lengthSq() === 0) return
      point.normalize().multiplyScalar(492)
      const normal = point.clone().normalize()
      const material = new THREE.SpriteMaterial({
        map: s.hotspotTexture,
        color: 0xffffff,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.position.copy(point)
      sprite.scale.set(34, 34, 1)
      sprite.userData.polygonIndex = index
      sprite.userData.basePosition = point.clone()
      sprite.userData.normal = normal
      sprite.userData.baseScale = 34
      sprite.userData.phase = index * 1.3
      group.add(sprite)
    })
    s.hotspotGroup = group
    group.visible = false
    s.scene.add(group)
    return () => {
      if (!s.hotspotGroup) return
      s.hotspotGroup.children.forEach((child) => child.material.dispose())
      s.scene.remove(s.hotspotGroup)
      s.hotspotGroup = null
      s.hotspotHoveredIndex = -1
      queueMicrotask(() => setHotspotHovered(false))
    }
  }, [polygons, imageUrl])

  useEffect(() => {
    const container = containerRef.current
    const s = stateRef.current

    const hitTestHotspot = (e) => {
      if (s.devMode) return -1
      if (!s.hotspotGroup || !s.hotspotGroup.children.length) return -1
      const rect = container.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      s.raycaster.setFromCamera(mouse, s.camera)
      const hits = s.raycaster.intersectObjects(s.hotspotGroup.children, true)
      if (!hits.length) return -1
      return hits[0].object.userData.polygonIndex
    }

    const handlePointerMove = (e) => {
      const hoveredIndex = hitTestHotspot(e)
      if (hoveredIndex === s.hotspotHoveredIndex) return
      s.hotspotHoveredIndex = hoveredIndex
      setHotspotHovered(hoveredIndex !== -1)
    }

    const handlePointerLeave = () => {
      if (s.hotspotHoveredIndex === -1) return
      s.hotspotHoveredIndex = -1
      setHotspotHovered(false)
    }

    const handleClick = (e) => {
      if (e.ctrlKey || s.hasDragged) return
      if (s.devMode) return
      const index = hitTestHotspot(e)
      if (typeof index !== 'number') return
      if (index === -1) return
      const polygon = polygons[index]
      if (polygon) onPolygonClick?.(polygon)
    }

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerleave', handlePointerLeave)
    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerLeave)
      container.removeEventListener('click', handleClick)
    }
  }, [polygons, onPolygonClick])

  // ─── Show/hide hotspots based on scene readiness ───
  useEffect(() => {
    const s = stateRef.current
    if (s.hotspotGroup) s.hotspotGroup.visible = sceneReady
  }, [sceneReady, polygons, imageUrl])

  // ─── Jump camera on scene change if initialView provided ───
  useEffect(() => {
    if (!initialView) return
    const s = stateRef.current
    s.lon = s.targetLon = initialView.lon ?? 0
    s.lat = s.targetLat = initialView.lat ?? 0
    s.velocityLon = 0
    s.velocityLat = 0
  }, [imageUrl, initialView])

  // ─── Load texture ───
  useEffect(() => {
    const s = stateRef.current
    if (!s.sphere) return

    const isFirst = !hasLoadedOnce.current
    setSceneReady(false)
    setLoadProgress(0)
    queueMicrotask(() => {
      if (isFirst) setLoading(true)
      else setTransitioning(true)
    })

    const xhr = new XMLHttpRequest()
    xhr.open('GET', imageUrl, true)
    xhr.responseType = 'blob'
    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        setLoadProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status !== 200) {
        console.error('Failed to load:', imageUrl)
        setLoading(false)
        setTransitioning(false)
        return
      }
      const blobUrl = URL.createObjectURL(xhr.response)
      const img = new Image()
      img.onload = () => {
        const texture = new THREE.Texture(img)
        texture.needsUpdate = true
        texture.colorSpace = THREE.SRGBColorSpace
        if (s.sphere.material.map) s.sphere.material.map.dispose()
        s.sphere.material.map = texture
        s.sphere.material.color.set(0xffffff)
        s.sphere.material.needsUpdate = true
        URL.revokeObjectURL(blobUrl)
        hasLoadedOnce.current = true
        setLoadProgress(100)
        setLoading(false)
        setTransitioning(false)
        // Small delay so camera position settles before showing hotspots
        setTimeout(() => setSceneReady(true), 120)
      }
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl)
        console.error('Failed to decode:', imageUrl)
        setLoading(false)
        setTransitioning(false)
      }
      img.src = blobUrl
    }
    xhr.onerror = () => {
      console.error('Failed to load:', imageUrl)
      setLoading(false)
      setTransitioning(false)
    }
    xhr.send()

    return () => xhr.abort()
  }, [imageUrl])

  const getCursor = () => {
    if (devMode && ctrlHeld) return 'crosshair'
    if (!devMode && hotspotHovered) return 'pointer'
    return 'grab'
  }

  return (
    <>
      {loading && (
        <div className="loader">
          <div className="loader-content">
            <div className="loader-text">جاري التحميل...</div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${loadProgress}%` }} />
            </div>
            <div className="loader-percent">{loadProgress}%</div>
          </div>
        </div>
      )}

      {transitioning && (
        <div className="transition-bar">
          <div className="transition-bar-fill" style={{ width: `${loadProgress}%` }} />
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: getCursor() }} />

      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <DevPanel
            devMode={devMode}
            setDevMode={setDevMode}
            imageUrl={imageUrl}
            scenes={scenes}
            polygons={polygons}
            onAddPolygon={onAddPolygon}
            onUpdatePolygon={onUpdatePolygon}
            onDeletePolygon={onDeletePolygon}
            threeState={stateRef}
            containerRef={containerRef}
          />
        </Suspense>
      )}
    </>
  )
}
