import { useState, useCallback, useEffect } from 'react'
import PanoramaViewer from './components/PanoramaViewer'
import './App.css'

const base = import.meta.env.BASE_URL
const RADIUS = 494
const BUILDING_VIEWS = {
  panorama: { lon: -54.45, lat: -43.95 },
  dji0546: { lon: -84.75, lat: -51.3 },
  dji0547: { lon: 104.25, lat: -65.85 },
  dji0548: { lon: -156.15, lat: -44.7 },
}

function lonLatToPosition(lon, lat) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = lon * (Math.PI / 180)
  return {
    x: Math.round((RADIUS * Math.sin(phi) * Math.cos(theta)) * 100) / 100,
    y: Math.round((RADIUS * Math.cos(phi)) * 100) / 100,
    z: Math.round((RADIUS * Math.sin(phi) * Math.sin(theta)) * 100) / 100,
  }
}

const initialPolygons = [
  {
    sceneImage: `${base}panorama.avif`,
    action: 'poster',
    poster: {
      title: 'الموقع الاستراتيجي',
      subtitle: 'انقر خارج النافذة للإغلاق',
      imageUrl: `${base}poster.jpeg`,
    },
    points: [
      { x: -55.34, y: -176.2, z: -463.94 },
      { x: 12.89, y: -291.39, z: -405.51 },
      { x: 87.47, y: -351.79, z: -343.77 },
      { x: 181.66, y: -386.93, z: -258.52 },
      { x: 157.58, y: -421.08, z: -218.08 },
      { x: 212.58, y: -420.9, z: -164.92 },
      { x: 230.08, y: -396.16, z: -199.05 },
      { x: 214.23, y: -420.93, z: -162.81 },
      { x: 266.98, y: -408.61, z: -106.35 },
      { x: 280.24, y: -389.69, z: -137.83 },
      { x: 314.24, y: -344.7, z: -178.97 },
      { x: -56.32, y: -173.83, z: -464.67 },
    ],
  },
  { sceneImage: `${base}panorama.avif`, targetImage: `${base}DJI_0546.avif`, position: lonLatToPosition(-37, -8), points: [] },
  { sceneImage: `${base}panorama.avif`, targetImage: `${base}DJI_0547.avif`, position: lonLatToPosition(-10, -5), points: [] },
  { sceneImage: `${base}panorama.avif`, targetImage: `${base}DJI_0548.avif`, position: lonLatToPosition(18, -6), points: [] },
  { sceneImage: `${base}DJI_0546.avif`, targetImage: `${base}panorama.avif`, position: lonLatToPosition(140, -4), points: [] },
  { sceneImage: `${base}DJI_0546.avif`, targetImage: `${base}DJI_0547.avif`, position: lonLatToPosition(6, -6), points: [] },
  { sceneImage: `${base}DJI_0547.avif`, targetImage: `${base}DJI_0546.avif`, position: lonLatToPosition(-170, -6), points: [] },
  { sceneImage: `${base}DJI_0547.avif`, targetImage: `${base}DJI_0548.avif`, position: lonLatToPosition(12, -7), points: [] },
  { sceneImage: `${base}DJI_0548.avif`, targetImage: `${base}DJI_0547.avif`, position: lonLatToPosition(-160, -7), points: [] },
  { sceneImage: `${base}DJI_0548.avif`, targetImage: `${base}panorama.avif`, position: lonLatToPosition(-30, -5), points: [] },
]

function getPolygonPosition(points = []) {
  if (!points.length) return null
  const sum = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
    z: acc.z + point.z,
  }), { x: 0, y: 0, z: 0 })
  const count = points.length
  return {
    x: Math.round((sum.x / count) * 100) / 100,
    y: Math.round((sum.y / count) * 100) / 100,
    z: Math.round((sum.z / count) * 100) / 100,
  }
}

function normalizePolygon(polygon) {
  const points = Array.isArray(polygon?.points) ? polygon.points : []
  return {
    ...polygon,
    points,
    position: polygon?.position ?? getPolygonPosition(points),
  }
}

function buildPolygonMap(polygons) {
  return polygons.reduce((acc, polygon) => {
    if (!polygon?.sceneImage) return acc
    const list = acc[polygon.sceneImage] || []
    return {
      ...acc,
      [polygon.sceneImage]: [...list, normalizePolygon(polygon)],
    }
  }, {})
}

function positionToView(position) {
  if (!position) return null
  const x = position.x ?? 0
  const y = position.y ?? 0
  const z = position.z ?? 0
  const length = Math.hypot(x, y, z) || 1
  const nx = x / length
  const ny = y / length
  const nz = z / length
  const phi = Math.acos(Math.max(-1, Math.min(1, ny)))
  const theta = Math.atan2(nz, nx)
  return {
    lon: Math.round((theta * 180 / Math.PI) * 100) / 100,
    lat: Math.round((90 - phi * 180 / Math.PI) * 100) / 100,
  }
}

const scenes = [
  // initialView: { lon, lat } — use Dev Mode to pick, then paste here
  { id: 1, name: 'المنظر 1', image: `${base}panorama.avif`, initialView: BUILDING_VIEWS.panorama },
  { id: 2, name: 'المنظر 2', image: `${base}DJI_0546.avif`, initialView: BUILDING_VIEWS.dji0546 },
  { id: 3, name: 'المنظر 3', image: `${base}DJI_0547.avif`, initialView: BUILDING_VIEWS.dji0547 },
  { id: 4, name: 'المنظر 4', image: `${base}DJI_0548.avif`, initialView: BUILDING_VIEWS.dji0548 },
]

function App() {
  const [activeScene, setActiveScene] = useState(scenes[0])
  const [polygonMap, setPolygonMap] = useState(() => buildPolygonMap(initialPolygons))
  const [activePoster, setActivePoster] = useState(null)

  const currentPolygons = polygonMap[activeScene.image] || []

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActivePoster(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleAddPolygon = useCallback((polygon) => {
    setPolygonMap((prev) => ({
      ...prev,
      [activeScene.image]: [...(prev[activeScene.image] || []), normalizePolygon(polygon)],
    }))
  }, [activeScene.image])

  const handleUpdatePolygon = useCallback((index, updated) => {
    setPolygonMap((prev) => {
      const list = [...(prev[activeScene.image] || [])]
      list[index] = normalizePolygon(updated)
      return { ...prev, [activeScene.image]: list }
    })
  }, [activeScene.image])

  const handleDeletePolygon = useCallback((index) => {
    setPolygonMap((prev) => {
      const list = [...(prev[activeScene.image] || [])]
      list.splice(index, 1)
      return { ...prev, [activeScene.image]: list }
    })
  }, [activeScene.image])

  const handlePolygonClick = useCallback((polygon) => {
    if (polygon.action === 'poster' || polygon.poster) {
      setActivePoster(polygon.poster || { title: 'Poster', subtitle: '', imageUrl: '' })
      return
    }
    const target = scenes.find((s) => s.image === polygon.targetImage)
    if (!target) return
    const reverseLink = (polygonMap[target.image] || []).find((item) => (
      item.targetImage === activeScene.image && item.position && (!item.points || item.points.length === 0)
    ))
    const syncedView = positionToView(reverseLink?.position) || target.initialView
    setActiveScene({ ...target, initialView: syncedView })
  }, [activeScene.image, polygonMap])

  return (
    <div className="app">
      <PanoramaViewer
        imageUrl={activeScene.image}
        initialView={activeScene.initialView}
        polygons={currentPolygons}
        onPolygonClick={handlePolygonClick}
        onAddPolygon={handleAddPolygon}
        onUpdatePolygon={handleUpdatePolygon}
        onDeletePolygon={handleDeletePolygon}
        scenes={scenes}
      />

      <div className="info-panel">
        <h1>جوهرة المسفلة</h1>
        <p>جولة افتراضية 360°</p>
      </div>

      {import.meta.env.DEV && (
        <div className="ui-overlay">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              className={`view-btn ${activeScene.id === scene.id ? 'active' : ''}`}
              onClick={() => {
                setActiveScene(scene)
                setActivePoster(null)
              }}
            >
              {scene.name}
            </button>
          ))}
        </div>
      )}

      {activePoster && (
        <div className="poster-overlay" onClick={() => setActivePoster(null)}>
          <div className="poster-modal" onClick={(event) => event.stopPropagation()}>
            <button className="poster-close" onClick={() => setActivePoster(null)}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
            {activePoster.imageUrl ? (
              <img src={activePoster.imageUrl} alt={activePoster.title || 'Poster'} className="poster-image" />
            ) : (
              <div className="poster-placeholder">
                <h2>{activePoster.title || 'Poster'}</h2>
                {activePoster.subtitle ? <p>{activePoster.subtitle}</p> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
