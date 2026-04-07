import { useState, useEffect, useRef } from 'react'
import * as THREE from 'three'

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

function buildPolygonMesh(points, color = 0x00ccff, opacity = 0.35, showDots = true) {
  const group = new THREE.Group()

  if (points.length >= 3) {
    const verts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z).normalize().multiplyScalar(494))
    const center = new THREE.Vector3()
    verts.forEach((v) => center.add(v))
    center.divideScalar(verts.length)

    const geo = new THREE.BufferGeometry()
    const positions = []
    for (let i = 0; i < verts.length; i++) {
      const next = verts[(i + 1) % verts.length]
      positions.push(center.x, center.y, center.z)
      positions.push(verts[i].x, verts[i].y, verts[i].z)
      positions.push(next.x, next.y, next.z)
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.computeVertexNormals()

    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false,
    })
    group.add(new THREE.Mesh(geo, mat))
  }

  if (points.length >= 2) {
    const lineVerts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z).normalize().multiplyScalar(494.5))
    lineVerts.push(lineVerts[0].clone())
    const lineGeo = new THREE.BufferGeometry().setFromPoints(lineVerts)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false })
    group.add(new THREE.Line(lineGeo, lineMat))
  }

  if (showDots) {
    points.forEach((p, i) => {
      const dotGeo = new THREE.SphereGeometry(3, 8, 8)
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
      const dot = new THREE.Mesh(dotGeo, dotMat)
      dot.userData.vertexIndex = i
      const pos = new THREE.Vector3(p.x, p.y, p.z).normalize().multiplyScalar(494)
      dot.position.copy(pos)
      group.add(dot)
    })
  }

  return group
}

export default function DevPanel({
  devMode, setDevMode, imageUrl, scenes,
  polygons, onAddPolygon, onUpdatePolygon, onDeletePolygon,
  threeState, containerRef,
}) {
  const [drawingPoints, setDrawingPoints] = useState([])
  const [selectedTarget, setSelectedTarget] = useState('')
  const [editingIdx, setEditingIdx] = useState(null)
  const [editPoints, setEditPoints] = useState([])
  const [editTarget, setEditTarget] = useState('')

  const drawingMeshRef = useRef(null)
  const editMeshRef = useRef(null)
  const polygonMeshesRef = useRef([])

  const isEditing = editingIdx !== null

  // ─── Ctrl+click handler for placing vertices ───
  useEffect(() => {
    if (!devMode) return
    const container = containerRef.current
    const s = threeState.current

    const handleClick = (e) => {
      const ctrlClick = e.ctrlKey
      if (!ctrlClick) return

      const mouse = new THREE.Vector2(
        (e.clientX / container.clientWidth) * 2 - 1,
        -(e.clientY / container.clientHeight) * 2 + 1
      )
      s.raycaster.setFromCamera(mouse, s.camera)
      const hits = s.raycaster.intersectObject(s.sphere)
      if (hits.length > 0) {
        const p = hits[0].point
        const point = {
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          z: Math.round(p.z * 100) / 100,
        }
        if (editingIdx !== null) {
          setEditPoints((prev) => [...prev, point])
        } else {
          setDrawingPoints((prev) => [...prev, point])
        }
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [devMode, editingIdx, containerRef, threeState])

  // ─── Drawing preview mesh ───
  useEffect(() => {
    const s = threeState.current
    if (!s.scene) return
    if (drawingMeshRef.current) { s.scene.remove(drawingMeshRef.current); drawingMeshRef.current = null }
    if (drawingPoints.length > 0) {
      const mesh = buildPolygonMesh(drawingPoints, 0xffcc00, 0.3)
      s.scene.add(mesh)
      drawingMeshRef.current = mesh
    }
  }, [drawingPoints, threeState])

  // ─── Edit preview mesh ───
  useEffect(() => {
    const s = threeState.current
    if (!s.scene) return
    if (editMeshRef.current) { s.scene.remove(editMeshRef.current); editMeshRef.current = null }
    if (editPoints.length > 0) {
      const mesh = buildPolygonMesh(editPoints, 0xff8800, 0.4, true)
      s.scene.add(mesh)
      editMeshRef.current = mesh
    }
  }, [editPoints, threeState])

  // ─── Saved polygons mesh ───
  useEffect(() => {
    const s = threeState.current
    if (!s.scene) return
    polygonMeshesRef.current.forEach((g) => s.scene.remove(g))
    polygonMeshesRef.current = []

    polygons.forEach((poly, i) => {
      if (i === editingIdx) return
      const mesh = buildPolygonMesh(poly.points, 0x00ccff, 0.3, false)
      s.scene.add(mesh)
      polygonMeshesRef.current.push(mesh)
    })
  }, [polygons, editingIdx, threeState])

  // ─── Actions ───
  const handleSavePolygon = () => {
    if (drawingPoints.length < 3 || !selectedTarget) return
    const polygon = {
      points: [...drawingPoints],
      targetImage: selectedTarget,
      position: getPolygonPosition(drawingPoints),
    }
    onAddPolygon?.(polygon)
    console.log('Polygon saved:', JSON.stringify(polygon, null, 2))
    setDrawingPoints([])
    setSelectedTarget('')
  }

  const startEditing = (idx) => {
    const poly = polygons[idx]
    setEditingIdx(idx)
    setEditPoints([...poly.points])
    setEditTarget(poly.targetImage)
    setDrawingPoints([])
    setSelectedTarget('')
  }

  const handleSaveEdit = () => {
    if (editPoints.length < 3) return
    const updatedPolygon = {
      points: [...editPoints],
      targetImage: editTarget,
      position: getPolygonPosition(editPoints),
    }
    onUpdatePolygon?.(editingIdx, updatedPolygon)
    console.log('Polygon updated:', JSON.stringify(updatedPolygon, null, 2))
    cancelEdit()
  }

  const cancelEdit = () => {
    setEditingIdx(null)
    setEditPoints([])
    setEditTarget('')
  }

  const handleDeletePolygon = (idx) => {
    onDeletePolygon?.(idx)
    if (editingIdx === idx) cancelEdit()
  }

  const removeEditVertex = (vertIdx) => {
    setEditPoints((prev) => prev.filter((_, i) => i !== vertIdx))
  }

  return (
    <>
      {/* Dev mode toggle */}
      <button
        onClick={() => {
          setDevMode((d) => !d)
          setDrawingPoints([])
          setSelectedTarget('')
          cancelEdit()
        }}
        style={{
          position: 'absolute', top: 20, left: 20, zIndex: 200, padding: '8px 16px',
          background: devMode ? '#ff4444' : 'rgba(255,255,255,0.15)',
          color: 'white',
          border: devMode ? '2px solid #ff6666' : '1px solid rgba(255,255,255,0.3)',
          borderRadius: 8, cursor: 'pointer', backdropFilter: 'blur(10px)', fontSize: 14,
        }}
      >
        {devMode ? 'Dev Mode ON' : 'Dev Mode'}
      </button>

      {/* Dev panel */}
      {devMode && (
        <div style={{
          position: 'absolute', top: 70, left: 20, zIndex: 200,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', color: 'white',
          padding: 20, borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)',
          width: 320, fontSize: 14, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
        }}>

          {isEditing ? (
            <>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#ff8800' }}>Editing Polygon #{editingIdx + 1}</h3>
              <p style={{ opacity: 0.6, marginBottom: 12, fontSize: 13 }}>
                Hold <kbd style={kbdStyle}>Ctrl</kbd> + click to add new vertices. Click <strong>X</strong> to remove a vertex.
              </p>

              <div style={{
                background: 'rgba(255,136,0,0.15)', border: '1px solid rgba(255,136,0,0.4)',
                padding: 12, borderRadius: 8, marginBottom: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong>Vertices: {editPoints.length}</strong>
                  {editPoints.length >= 3 && <span style={{ color: '#00cc88' }}>Valid</span>}
                  {editPoints.length < 3 && <span style={{ color: '#ff4444' }}>Need 3+</span>}
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {editPoints.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: 11, fontFamily: 'monospace', padding: '3px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}>
                      <span style={{ opacity: 0.7 }}>{i + 1}. ({p.x}, {p.y}, {p.z})</span>
                      <button
                        onClick={() => removeEditVertex(i)}
                        style={{
                          background: 'rgba(255,68,68,0.4)', color: 'white', border: 'none',
                          borderRadius: 3, cursor: 'pointer', fontSize: 10, padding: '1px 6px',
                        }}
                      >X</button>
                    </div>
                  ))}
                </div>
              </div>

              <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Link to scene:</label>
              <select value={editTarget} onChange={(e) => setEditTarget(e.target.value)} style={selectStyle}>
                <option value="">-- Select target --</option>
                {scenes.filter((s) => s.image !== imageUrl).map((s) => (
                  <option key={s.id} value={s.image}>{s.name}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleSaveEdit}
                  disabled={editPoints.length < 3 || !editTarget}
                  style={{
                    ...actionBtnStyle, flex: 1,
                    background: (editPoints.length >= 3 && editTarget) ? '#00cc88' : '#555',
                    cursor: (editPoints.length >= 3 && editTarget) ? 'pointer' : 'not-allowed',
                  }}
                >Save</button>
                <button onClick={cancelEdit} style={{ ...actionBtnStyle, background: 'rgba(255,255,255,0.15)' }}>Cancel</button>
                <button onClick={() => handleDeletePolygon(editingIdx)} style={{ ...actionBtnStyle, background: 'rgba(255,68,68,0.5)' }}>Delete</button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Polygon Editor</h3>
              <p style={{ opacity: 0.6, marginBottom: 12, fontSize: 13 }}>
                Hold <kbd style={kbdStyle}>Ctrl</kbd> + click to place vertices. Min 3 points.
              </p>

              <div style={{
                background: drawingPoints.length > 0 ? 'rgba(255,204,0,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${drawingPoints.length > 0 ? 'rgba(255,204,0,0.4)' : 'rgba(255,255,255,0.1)'}`,
                padding: 12, borderRadius: 8, marginBottom: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong>Vertices: {drawingPoints.length}</strong>
                  {drawingPoints.length >= 3 && <span style={{ color: '#00cc88' }}>Ready</span>}
                </div>

                {drawingPoints.length > 0 && (
                  <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8 }}>
                    {drawingPoints.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.7, padding: '2px 0' }}>
                        {i + 1}. ({p.x}, {p.y}, {p.z})
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  {drawingPoints.length > 0 && (
                    <button onClick={() => setDrawingPoints((p) => p.slice(0, -1))} style={smallBtnStyle}>Undo</button>
                  )}
                  {drawingPoints.length > 0 && (
                    <button onClick={() => { setDrawingPoints([]); setSelectedTarget('') }} style={{ ...smallBtnStyle, background: 'rgba(255,68,68,0.3)' }}>Clear</button>
                  )}
                </div>
              </div>

              {drawingPoints.length >= 3 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Link to scene:</label>
                  <select value={selectedTarget} onChange={(e) => setSelectedTarget(e.target.value)} style={selectStyle}>
                    <option value="">-- Select target --</option>
                    {scenes.filter((s) => s.image !== imageUrl).map((s) => (
                      <option key={s.id} value={s.image}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleSavePolygon}
                    disabled={!selectedTarget}
                    style={{
                      width: '100%', padding: '10px 12px',
                      background: selectedTarget ? '#00cc88' : '#555',
                      color: 'white', border: 'none', borderRadius: 6,
                      cursor: selectedTarget ? 'pointer' : 'not-allowed',
                      fontSize: 14, fontWeight: 'bold',
                    }}
                  >Save Polygon</button>
                </div>
              )}
            </>
          )}

          {/* ════ DEFAULT VIEW PICKER ════ */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 12, marginTop: 12 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, opacity: 0.7 }}>Default View (initial camera)</h4>
            <p style={{ opacity: 0.5, fontSize: 11, marginBottom: 8 }}>
              Current camera lon/lat. Copy and paste into your scene config as <code style={{ background: '#333', padding: '1px 4px', borderRadius: 3 }}>initialView</code>.
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.08)', padding: 10, borderRadius: 6,
              fontFamily: 'monospace', fontSize: 12, marginBottom: 8,
            }}>
              <div>lon: <strong>{Math.round(threeState.current.lon * 100) / 100}</strong></div>
              <div>lat: <strong>{Math.round(threeState.current.lat * 100) / 100}</strong></div>
            </div>
            <button
              onClick={() => {
                const s = threeState.current
                const val = JSON.stringify({
                  lon: Math.round(s.lon * 100) / 100,
                  lat: Math.round(s.lat * 100) / 100,
                })
                navigator.clipboard.writeText(val)
                console.log('Default view for this scene:', val)
              }}
              style={{
                ...smallBtnStyle, width: '100%', padding: '6px 10px',
                background: 'rgba(0,204,136,0.25)', textAlign: 'center',
              }}
            >Copy to clipboard</button>
          </div>

          {polygons.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 12, marginTop: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, opacity: 0.7 }}>
                Saved polygons ({polygons.length})
              </h4>
              {polygons.map((poly, i) => (
                <div key={i} style={{
                  background: editingIdx === i ? 'rgba(255,136,0,0.2)' : 'rgba(0,204,255,0.12)',
                  border: editingIdx === i ? '1px solid rgba(255,136,0,0.5)' : '1px solid transparent',
                  padding: '8px 10px', borderRadius: 6, marginBottom: 4, fontSize: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{poly.points.length} vertices</span>
                    <span style={{ opacity: 0.6 }}>
                      {scenes.find((s) => s.image === poly.targetImage)?.name || '?'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      onClick={() => startEditing(i)}
                      disabled={isEditing}
                      style={{
                        ...smallBtnStyle,
                        background: isEditing ? '#333' : 'rgba(255,136,0,0.3)',
                        cursor: isEditing ? 'not-allowed' : 'pointer',
                      }}
                    >Edit</button>
                    <button
                      onClick={() => handleDeletePolygon(i)}
                      disabled={isEditing && editingIdx !== i}
                      style={{
                        ...smallBtnStyle,
                        background: 'rgba(255,68,68,0.3)',
                        cursor: (isEditing && editingIdx !== i) ? 'not-allowed' : 'pointer',
                      }}
                    >Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

const kbdStyle = { background: '#444', padding: '2px 6px', borderRadius: 4 }
const smallBtnStyle = {
  padding: '4px 10px', background: 'rgba(255,255,255,0.15)', color: 'white',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const actionBtnStyle = {
  padding: '8px 12px', color: 'white', border: 'none',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
}
const selectStyle = {
  width: '100%', padding: 8, borderRadius: 6, border: 'none',
  background: '#333', color: 'white', marginBottom: 10, fontSize: 14,
}
