'use client'
import { useEffect, useRef } from 'react'
import { BearingDiagnostic, Station } from '@/lib/rf'

interface UseDiagnosticRaysLayerProps {
  mapRef:         React.MutableRefObject<any>
  selId:          number | null
  diagnosticMode: boolean
  stations:       Station[]
  coverageRays:   Record<number, BearingDiagnostic[]>
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const LINE_LAYER_ID  = 'diagnostic-rays-line'
const EDGE_LAYER_ID  = 'diagnostic-rays-edge'
const SOURCE_ID      = 'diagnostic-rays'

/**
 * Builds a FeatureCollection with one LineString per bearing (antenna -> edge)
 * plus one Point per blocked bearing marking the obstruction edge.
 * Properties carry status/distance/buildingHeight so MapLibre can color the
 * lines and the popup can display per-bearing context on hover.
 */
function buildFeatures(
  station: Station,
  bearings: BearingDiagnostic[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const b of bearings) {
    const status =
      b.buildingPenetrationLossDb >= 10
        ? 'high-loss'
        : b.buildingPenetrationLossDb >= 4
          ? 'medium-loss'
          : 'low-loss'

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [station.lng, station.lat],
          [b.edgeLng, b.edgeLat],
        ],
      },
      properties: {
        status,
        bearingDeg:           Math.round(b.bearingDeg),
        effectiveRadiusKm:    b.effectiveRadiusKm,
        obstructedAtKm:       b.obstructedAtKm ?? -1,
        edgeBuildingHeight:   b.edgeBuildingHeight,
        edgeTerrainElevation: b.edgeTerrainElevation,
        buildingPenetrationLossDb: b.buildingPenetrationLossDb,
        buildingSamples: b.buildingSamples,
      },
    })

    if (b.obstructedAtKm !== null) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [b.edgeLng, b.edgeLat] },
        properties: {
          status,
          bearingDeg:           Math.round(b.bearingDeg),
          obstructedAtKm:       b.obstructedAtKm,
          edgeBuildingHeight:   b.edgeBuildingHeight,
          edgeTerrainElevation: b.edgeTerrainElevation,
          buildingPenetrationLossDb: b.buildingPenetrationLossDb,
          buildingSamples: b.buildingSamples,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function useDiagnosticRaysLayer({
  mapRef, selId, diagnosticMode, stations, coverageRays,
}: UseDiagnosticRaysLayerProps) {
  const popupRef = useRef<any>(null)

  // ── Source data sync ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const src = map.getSource(SOURCE_ID) as any
      if (!src) return

      if (!diagnosticMode || selId === null) {
        src.setData(EMPTY_FC)
        return
      }

      const station = stations.find(s => s.id === selId)
      const bearings = coverageRays[selId]
      if (!station || !bearings || bearings.length === 0) {
        src.setData(EMPTY_FC)
        return
      }

      src.setData(buildFeatures(station, bearings))
    }

    if (map.isStyleLoaded?.()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [mapRef, selId, diagnosticMode, stations, coverageRays])

  // ── Hover popup with per-bearing diagnostics ────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!diagnosticMode) return

    let popup: any = null
    let cleanupRunning = false

    const setup = async () => {
      const { Popup } = await import('maplibre-gl')
      if (cleanupRunning) return

      popup = new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
        className: 'diagnostic-ray-popup',
      })
      popupRef.current = popup

      const handleMove = (e: any) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'crosshair'
        const p = f.properties ?? {}
        const lossDb = Number(p.buildingPenetrationLossDb ?? 0)
        const status =
          p.status === 'high-loss'
            ? 'HIGH LOSS'
            : p.status === 'medium-loss'
              ? 'MEDIUM LOSS'
              : 'LOW LOSS'
        const obstructedAtKm = Number(p.obstructedAtKm ?? -1)
        const obstructedLine =
          obstructedAtKm > 0
            ? `Obstructie teren la <b>${(obstructedAtKm * 1000).toFixed(1)} m</b>`
            : `Distanta efectiva <b>${(Number(p.effectiveRadiusKm ?? 0) * 1000).toFixed(1)} m</b>`
        const buildingLine = `Pierdere cladiri: <b>${lossDb.toFixed(1)} dB</b> (${Number(p.buildingSamples ?? 0)} sample-uri)`
        const edgeBuildingLine =
          Number(p.edgeBuildingHeight ?? 0) > 0
            ? `Cladire la edge: <b>${Number(p.edgeBuildingHeight ?? 0).toFixed(0)} m</b>`
            : ''
        const terrainLine = `Teren la edge: <b>${Number(p.edgeTerrainElevation ?? 0).toFixed(0)} m AMSL</b>`

        const html = `
          <div class="ray-popup">
            <div class="ray-popup-row"><span>Bearing</span><b>${p.bearingDeg}&deg;</b></div>
            <div class="ray-popup-row"><span>Status</span><b class="${p.status}">${status}</b></div>
            <div class="ray-popup-row">${obstructedLine}</div>
            <div class="ray-popup-row">${buildingLine}</div>
            ${edgeBuildingLine ? `<div class="ray-popup-row">${edgeBuildingLine}</div>` : ''}
            <div class="ray-popup-row">${terrainLine}</div>
          </div>
        `
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map)
      }

      const handleLeave = () => {
        map.getCanvas().style.cursor = ''
        popup?.remove()
      }

      map.on('mousemove', LINE_LAYER_ID, handleMove)
      map.on('mouseleave', LINE_LAYER_ID, handleLeave)
      map.on('mousemove', EDGE_LAYER_ID, handleMove)
      map.on('mouseleave', EDGE_LAYER_ID, handleLeave)

      // Stash handlers so we can remove them on cleanup.
      ;(popup as any)._handlers = { handleMove, handleLeave }
    }

    setup()

    return () => {
      cleanupRunning = true
      const m = mapRef.current
      if (m && popup) {
        const h = (popup as any)._handlers
        if (h) {
          m.off('mousemove', LINE_LAYER_ID, h.handleMove)
          m.off('mouseleave', LINE_LAYER_ID, h.handleLeave)
          m.off('mousemove', EDGE_LAYER_ID, h.handleMove)
          m.off('mouseleave', EDGE_LAYER_ID, h.handleLeave)
        }
        m.getCanvas && (m.getCanvas().style.cursor = '')
      }
      popup?.remove()
      popupRef.current = null
    }
  }, [mapRef, diagnosticMode])
}
