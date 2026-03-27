'use client'
import { useEffect, useRef } from 'react'
import { useNetStore } from '@/store/netStore'
import { Station, Link, LinkStats, linkBudget } from '@/lib/rf'

interface UseLinkSyncProps {
  mapRef:            React.MutableRefObject<any>
  links:             Link[]
  stations:          Station[]
  terrainLinkStats:  Record<number, LinkStats>
}

export function useLinkSync({ mapRef, links, stations, terrainLinkStats }: UseLinkSyncProps) {
  const popupRef    = useRef<any>(null)
  const listenersSet = useRef(false)

  // ── Set up hover / click listeners once, after map is ready ────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      clearInterval(interval)

      if (listenersSet.current) return
      listenersSet.current = true

      import('maplibre-gl').then(({ Popup }) => {
        popupRef.current = new Popup({
          closeButton:  false,
          closeOnClick: false,
          className:    'ml-popup',
        })

        map.on('mouseenter', 'links', (e: any) => {
          map.getCanvas().style.cursor = 'pointer'
          const f = e.features?.[0]
          if (!f) return
          popupRef.current
            .setHTML(f.properties.tooltip)
            .setLngLat(e.lngLat)
            .addTo(map)
        })

        map.on('mousemove', 'links', (e: any) => {
          popupRef.current?.setLngLat(e.lngLat)
        })

        map.on('mouseleave', 'links', () => {
          map.getCanvas().style.cursor = ''
          popupRef.current?.remove()
        })

        map.on('click', 'links', (e: any) => {
          const f = e.features?.[0]
          if (f) {
            useNetStore.getState().removeLink(Number(f.properties.linkId))
          }
        })
      })
    }, 50)

    return () => clearInterval(interval)
  }, [])

  // ── Update GeoJSON source whenever links / stations change ─────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      clearInterval(interval)

      const features: GeoJSON.Feature[] = links.flatMap(link => {
        const s1 = stations.find(s => s.id === link.station1Id)
        const s2 = stations.find(s => s.id === link.station2Id)
        if (!s1 || !s2) return []

        // Prefer terrain-aware stats if computed, fall back to FSPL-only
        const stats  = terrainLinkStats[link.id] ?? linkBudget(s1, s2)
        const hasTerrain = !!terrainLinkStats[link.id]

        // Color: green=ok, orange=obstructed but margin ok, red=link down
        let color = stats.ok ? '#00ff88' : '#ff3860'
        if (stats.ok && stats.losObstructed) color = '#ffaa00'

        const terrainLine = hasTerrain
          ? `Terrain loss: ${stats.diffractionLoss.toFixed(1)} dB` +
            (stats.losObstructed ? ' ⚠ LOS blocked' : ' ✓ LOS clear')
          : ''

        const combinedAreaKm2 = Math.PI * (s1.radius ** 2 + s2.radius ** 2)

        return [{
          type:     'Feature',
          geometry: {
            type:        'LineString',
            coordinates: [[s1.lng, s1.lat], [s2.lng, s2.lat]],
          },
          properties: {
            linkId: link.id,
            color,
            tooltip:
              `<b>${s1.name} ↔ ${s2.name}</b><br>` +
              `Distanta: ${stats.distance.toFixed(2)} km<br>` +
              `FSPL: ${stats.fspl.toFixed(1)} dB<br>` +
              (terrainLine ? `${terrainLine}<br>` : '') +
              `Rx: ${stats.rxPower.toFixed(1)} dBm · Margin: ${stats.margin.toFixed(1)} dB ${stats.ok ? '✓' : '✗'}<br>` +
              (stats.ok
                ? `<b>Arie retea combinata: ${combinedAreaKm2.toFixed(1)} km²</b>`
                : `<span style="color:#ff3860">Link inactiv — margin insuficient</span>`),
          },
        }]
      })

      const source = map.getSource('links') as any
      source?.setData({ type: 'FeatureCollection', features })
    }, 50)

    return () => clearInterval(interval)
  }, [links, stations, terrainLinkStats])
}
