'use client'
import { useEffect, useRef } from 'react'
import { useNetStore } from '@/store/netStore'
import { Station, STATION_TYPES, CoveragePolygons, destinationPoint } from '@/lib/rf'
import { makeIconHTML } from './mapUtils'

interface UseMarkerSyncProps {
  mapRef:            React.MutableRefObject<any>
  stations:          Station[]
  selId:             number | null
  linkSrc:           number | null
  coveragePolygons:  Record<number, CoveragePolygons>
  removeStation:     (id: number) => void
  selectStation:     (id: number | null) => void
  startLink:         (id: number) => void
  completeLink:      (id: number) => void
  fetchStationElevation: (id: number) => Promise<void>
}

/** Coverage boundary ring respecting beamwidth (sector for directional, circle for omni). */
function coverageBoundaryRing(
  lat: number, lng: number, radiusKm: number, azimuth: number, beamwidth: number,
): [number, number][] {
  const beamwidthDeg      = beamwidth ?? 360
  const isOmnidirectional = beamwidthDeg >= 355
  const ringPoints: [number, number][] = []

  if (!isOmnidirectional) ringPoints.push([lng, lat])

  for (let i = 0; i <= 36; i++) {
    const bearingDeg = i * 10
    if (!isOmnidirectional) {
      let diff = ((bearingDeg - azimuth) % 360 + 360) % 360
      if (diff > 180) diff -= 360
      if (Math.abs(diff) > beamwidthDeg / 2) continue
    }
    const [pLat, pLng] = destinationPoint(lat, lng, bearingDeg, radiusKm)
    ringPoints.push([pLng, pLat])
  }

  if (!isOmnidirectional) {
    ringPoints.push([lng, lat])
  } else if (ringPoints.length > 0) {
    ringPoints.push(ringPoints[0])
  }

  return ringPoints
}

export function useMarkerSync({
  mapRef, stations, selId, linkSrc, coveragePolygons,
  removeStation, selectStation, startLink, completeLink, fetchStationElevation,
}: UseMarkerSyncProps) {
  const markerRefs = useRef<Record<number, any>>({})

  // ── Sync markers whenever stations / selection state changes ───────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      clearInterval(interval)

      import('maplibre-gl').then(({ Marker }) => {
        const currentIds = new Set(stations.map(s => s.id))

        // Remove stale markers
        Object.keys(markerRefs.current).forEach(k => {
          const id = parseInt(k)
          if (!currentIds.has(id)) {
            markerRefs.current[id]?.remove()
            delete markerRefs.current[id]
          }
        })

        stations.forEach(st => {
          const isSelected   = st.id === selId
          const isLinkSource = st.id === linkSrc

          if (!markerRefs.current[st.id]) {
            // ── Create new marker ──
            const markerElement = document.createElement('div')
            markerElement.innerHTML = makeIconHTML(st.type, isSelected, isLinkSource)

            markerElement.addEventListener('click', (e) => {
              e.stopPropagation()
              const state = useNetStore.getState()
              if (state.tool === 'delete') { removeStation(st.id); return }
              if (state.tool === 'link') {
                if (!state.linkSrc) startLink(st.id)
                else completeLink(st.id)
                return
              }
              selectStation(st.id)
            })

            const marker = new Marker({ element: markerElement, draggable: true })
              .setLngLat([st.lng, st.lat])
              .addTo(map)

            marker.on('dragend', () => {
              const newLngLat = marker.getLngLat()
              useNetStore.getState().updateStation(st.id, { lat: newLngLat.lat, lng: newLngLat.lng })
              fetchStationElevation(st.id)
            })

            markerRefs.current[st.id] = marker

          } else {
            // ── Update existing marker icon + position ──
            const marker       = markerRefs.current[st.id]
            marker.setLngLat([st.lng, st.lat])
            const markerElement = marker.getElement()
            markerElement.innerHTML = makeIconHTML(st.type, isSelected, isLinkSource)
          }
        })

        // ── Update station coverage rings (GeoJSON layer) ──────────────────
        const ringFeatures: GeoJSON.Feature[] = stations.map(st => {
          const cfg   = STATION_TYPES[st.type]
          const polys = coveragePolygons[st.id]
          const ring  = polys
            ? polys[0].map(([lat, lng]) => [lng, lat] as [number, number])
            : coverageBoundaryRing(st.lat, st.lng, st.radius, st.azimuth, st.beamwidth ?? 360)

          return {
            type:     'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: { id: st.id, color: cfg.color },
          }
        })

        const source = map.getSource('station-rings') as any
        source?.setData({ type: 'FeatureCollection', features: ringFeatures })
      })
    }, 50)

    return () => clearInterval(interval)
  }, [stations, selId, linkSrc, coveragePolygons])
}
