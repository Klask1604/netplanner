'use client'
import { useEffect } from 'react'

interface UseTerrainLayerProps {
  mapRef:           React.MutableRefObject<any>
  hillshadeVisible: boolean
  terrain3dEnabled: boolean
  topoMapEnabled:   boolean
}

export function useTerrainLayer({ mapRef, hillshadeVisible, terrain3dEnabled, topoMapEnabled }: UseTerrainLayerProps) {
  // ── Sync basemap visibility (dark ↔ topo, mutually exclusive) ────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('basemap-dark') || !map.getLayer('basemap-topo')) return
    map.setLayoutProperty('basemap-dark', 'visibility', topoMapEnabled ? 'none'    : 'visible')
    map.setLayoutProperty('basemap-topo', 'visibility', topoMapEnabled ? 'visible' : 'none')
  }, [topoMapEnabled])

  // ── Sync hillshade visibility ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('hillshade')) return
    map.setLayoutProperty('hillshade', 'visibility', hillshadeVisible ? 'visible' : 'none')
  }, [hillshadeVisible])

  // ── Sync 3D terrain ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('terrain-dem')) return

    if (terrain3dEnabled) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 })
      map.easeTo({ pitch: 45, duration: 600 })
    } else {
      map.setTerrain(null)
      map.easeTo({ pitch: 0, duration: 600 })
    }
  }, [terrain3dEnabled])
}
