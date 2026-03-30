'use client'
import { useEffect, useRef } from 'react'
import turfUnion     from '@turf/union'
import turfIntersect from '@turf/intersect'
import { polygon as turfPolygon, featureCollection } from '@turf/helpers'
import { Station, Link, CoveragePolygons, okumuraHataSlope, okumuraHata, okumuraHataMarginAtDistance, destinationPoint, LinkStats, linkBudget } from '@/lib/rf'

interface UseHeatmapLayerProps {
  mapRef:           React.MutableRefObject<any>
  stations:         Station[]
  links:            Link[]
  visible:          boolean
  coveragePolygons: Record<number, CoveragePolygons>
  terrainLinkStats: Record<number, LinkStats>
}

// dB margin thresholds — must match MARGIN_STOPS in lib/rf.ts
const STOPS = [
  { color: '#ff3860', opacity: 0.18 }, // 0 dB  — Edge
  { color: '#ff8c00', opacity: 0.25 }, // +5 dB  — weak
  { color: '#ffdd00', opacity: 0.32 }, // +10 dB — medium
  { color: '#00d4ff', opacity: 0.48 }, // +20 dB — good
  { color: '#00ff88', opacity: 0.68 }, // +30 dB — excellent
] as const

const MARGIN_STEPS = [0, 5, 10, 20, 30]

/**
 * Flat-terrain fallback ring for a station.
 * For omnidirectional antennas: full circle.
 * For directional antennas: sector polygon (center → arc → center).
 */
function coverageRing(
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

/**
 * Merges an array of turf Polygon features into a single union geometry.
 * Returns null when the array is empty or all unions fail.
 */
function unionAll(
  polygons: ReturnType<typeof turfPolygon>[],
): ReturnType<typeof turfPolygon> | null {
  if (polygons.length === 0) return null
  let accumulated = polygons[0]
  for (let i = 1; i < polygons.length; i++) {
    const merged = turfUnion(featureCollection([accumulated, polygons[i]]))
    if (merged) accumulated = merged as ReturnType<typeof turfPolygon>
  }
  return accumulated
}

/**
 * Computes the geographic union of two closed [lng, lat] rings.
 * Returns Polygon or MultiPolygon — both supported natively by MapLibre fill/line.
 */
function computeCoverageUnion(
  ring1: [number, number][],
  ring2: [number, number][],
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  try {
    const result = turfUnion(featureCollection([turfPolygon([ring1]), turfPolygon([ring2])]))
    return result?.geometry ?? null
  } catch {
    return null
  }
}

export function useHeatmapLayer({
  mapRef, stations, links, visible, coveragePolygons, terrainLinkStats,
}: UseHeatmapLayerProps) {
  const heatmapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const relayDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Heatmap coverage (only when heatmap is enabled) ──────────────────────
  function updateHeatmapSource() {
    const map = mapRef.current
    if (!map) return

    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

    if (!visible) {
      ;(map.getSource('coverage') as any)?.setData(empty)
      return
    }

    // Repeaters only emit coverage when they have an active link to a BTS or antenna.
    // A repeater without a feed source has no signal to re-transmit.
    const activeRepeaterIds = new Set(
      stations
        .filter(s => s.type === 'repeater')
        .filter(repeater =>
          links.some(link => {
            if (link.station1Id !== repeater.id && link.station2Id !== repeater.id) return false
            const sourceStationId = link.station1Id === repeater.id ? link.station2Id : link.station1Id
            const sourceStation   = stations.find(s => s.id === sourceStationId)
            // Must be linked to a non-repeater station (BTS, antenna, or router)
            if (!sourceStation || sourceStation.type === 'repeater') return false
            const linkStats = terrainLinkStats[link.id] ?? linkBudget(repeater, sourceStation)
            return linkStats.ok
          })
        )
        .map(s => s.id)
    )

    // For active repeaters: compute coverage scale based on received signal quality.
    // A repeater receiving weak signal (low margin) re-transmits with reduced effective power.
    // REPEATER_NOISE_FIGURE: amplifier noise that degrades retransmission quality (dB).
    const REPEATER_NOISE_FIGURE = 5

    const repeaterCoverageScale: Map<number, number> = new Map()
    for (const station of stations) {
      if (station.type !== 'repeater' || !activeRepeaterIds.has(station.id)) continue

      let bestMarginReceived = -Infinity
      for (const link of links) {
        if (link.station1Id !== station.id && link.station2Id !== station.id) continue
        const sourceId      = link.station1Id === station.id ? link.station2Id : link.station1Id
        const sourceStation = stations.find(s => s.id === sourceId)
        if (!sourceStation || sourceStation.type === 'repeater') continue

        // Prefer terrain-aware stats; fall back to flat-earth Okumura-Hata margin
        const stats = terrainLinkStats[link.id]
        const marginReceived = stats?.ok
          ? stats.margin
          : (() => {
              const dX = (station.lat - sourceStation.lat) * 111.32
              const dY = (station.lng - sourceStation.lng) * 111.32 * Math.cos(station.lat * Math.PI / 180)
              return okumuraHataMarginAtDistance(sourceStation, Math.sqrt(dX * dX + dY * dY))
            })()

        if (marginReceived > bestMarginReceived) bestMarginReceived = marginReceived
      }

      if (bestMarginReceived > 0) {
        // Effective TX power is reduced when received margin is below noise figure threshold.
        // effectiveTxPower = txPower + min(0, margin_received - NF)
        const effectiveTxPower = station.txPower + Math.min(0, bestMarginReceived - REPEATER_NOISE_FIGURE)
        const effectiveRadius  = okumuraHata({ ...station, txPower: effectiveTxPower })
        repeaterCoverageScale.set(station.id, Math.min(1, effectiveRadius / Math.max(station.radius, 0.01)))
      }
    }

    // Step 1: collect each station's ring polygon at every margin level
    const ringsByLevel: ReturnType<typeof turfPolygon>[][] = STOPS.map(() => [])

    for (const station of stations) {
      // Skip repeaters that have no active feed link — they have no coverage
      if (station.type === 'repeater' && !activeRepeaterIds.has(station.id)) continue

      // Scale factor < 1 for repeaters in weak signal zones
      const coverageScale    = station.type === 'repeater' ? (repeaterCoverageScale.get(station.id) ?? 1) : 1

      const terrainPolygons  = coveragePolygons[station.id]
      const pathLossSlope    = okumuraHataSlope(station.height)
      const radiusFractionFn = (marginDb: number) =>
        marginDb === 0 ? 1.0 : Math.pow(10, -marginDb / pathLossSlope)

      for (let marginIndex = 0; marginIndex < STOPS.length; marginIndex++) {
        const rawRing: [number, number][] = terrainPolygons
          ? terrainPolygons[marginIndex].map(([lat, lng]) => [lng, lat] as [number, number])
          : coverageRing(
              station.lat, station.lng,
              station.radius * radiusFractionFn(MARGIN_STEPS[marginIndex]),
              station.azimuth, station.beamwidth ?? 360,
            )

        // Shrink the ring around the station center when signal quality degrades
        const ring: [number, number][] = coverageScale < 1
          ? rawRing.map(([lng, lat]) => [
              station.lng + (lng - station.lng) * coverageScale,
              station.lat + (lat - station.lat) * coverageScale,
            ])
          : rawRing

        const first = ring[0], last = ring[ring.length - 1]
        const closedRing = first && last && (first[0] !== last[0] || first[1] !== last[1])
          ? [...ring, first]
          : ring

        if (closedRing.length < 4) continue

        try {
          ringsByLevel[marginIndex].push(turfPolygon([closedRing]))
        } catch {
          // skip degenerate polygon
        }
      }
    }

    // Step 2: per margin level, union all stations → "at least X dB" area.
    // Drawing from worst (0) to best (4) so better levels render on top,
    // showing the best available signal quality for every map pixel.
    const coverageFeatures: GeoJSON.Feature[] = []

    for (let marginIndex = 0; marginIndex < STOPS.length; marginIndex++) {
      const levelPolygons = ringsByLevel[marginIndex]
      if (levelPolygons.length === 0) continue

      const levelUnion = unionAll(levelPolygons)
      if (!levelUnion?.geometry) continue

      coverageFeatures.push({
        type:     'Feature',
        geometry: levelUnion.geometry,
        properties: {
          ring:    marginIndex,
          color:   STOPS[marginIndex].color,
          opacity: STOPS[marginIndex].opacity,
        },
      })
    }

    // Step 3: diversity gain — areas covered by 2+ stations at the same level
    // receive a +1 level boost (≈ +3 dB diversity gain from dual coverage).
    for (let marginIndex = 0; marginIndex < STOPS.length - 1; marginIndex++) {
      const levelPolygons = ringsByLevel[marginIndex]
      if (levelPolygons.length < 2) continue

      const boostedLevel = marginIndex + 1  // one quality tier higher

      for (let i = 0; i < levelPolygons.length - 1; i++) {
        for (let j = i + 1; j < levelPolygons.length; j++) {
          try {
            const overlap = turfIntersect(
              featureCollection([levelPolygons[i], levelPolygons[j]]),
            )
            if (!overlap?.geometry) continue

            coverageFeatures.push({
              type:     'Feature',
              geometry: overlap.geometry,
              properties: {
                ring:    boostedLevel,
                color:   STOPS[boostedLevel].color,
                opacity: STOPS[boostedLevel].opacity,
              },
            })
          } catch {
            // skip if intersection computation fails
          }
        }
      }
    }

    ;(map.getSource('coverage') as any)?.setData({
      type: 'FeatureCollection',
      features: coverageFeatures,
    })
  }

  // ── Linked coverage union (always visible, independent of heatmap) ────────
  function updateRelaySource() {
    const map = mapRef.current
    if (!map) return

    const unionFeatures: GeoJSON.Feature[] = []

    for (const link of links) {
      const fromStation = stations.find(s => s.id === link.station1Id)
      const toStation   = stations.find(s => s.id === link.station2Id)
      if (!fromStation || !toStation) continue

      const stats: LinkStats = terrainLinkStats[link.id] ?? linkBudget(fromStation, toStation)
      if (!stats.ok) continue

      const fromPolygons = coveragePolygons[fromStation.id]
      const toPolygons   = coveragePolygons[toStation.id]

      const fromOuterRing: [number, number][] = fromPolygons
        ? fromPolygons[0].map(([lat, lng]) => [lng, lat] as [number, number])
        : coverageRing(fromStation.lat, fromStation.lng, fromStation.radius, fromStation.azimuth, fromStation.beamwidth ?? 360)

      const toOuterRing: [number, number][] = toPolygons
        ? toPolygons[0].map(([lat, lng]) => [lng, lat] as [number, number])
        : coverageRing(toStation.lat, toStation.lng, toStation.radius, toStation.azimuth, toStation.beamwidth ?? 360)

      const unionGeometry = computeCoverageUnion(fromOuterRing, toOuterRing)
      if (!unionGeometry) continue

      const opacity = stats.losObstructed ? 0.12 : 0.28

      const combinedAreaKm2 = Math.PI * (fromStation.radius ** 2 + toStation.radius ** 2)

      unionFeatures.push({
        type:     'Feature',
        geometry: unionGeometry,
        properties: { color: '#00d4ff', opacity, combinedAreaKm2 },
      })
    }

    ;(map.getSource('relay') as any)?.setData({
      type: 'FeatureCollection',
      features: unionFeatures,
    })
  }

  // ── Debounced heatmap update ──────────────────────────────────────────────
  useEffect(() => {
    if (heatmapDebounceRef.current) clearTimeout(heatmapDebounceRef.current)
    heatmapDebounceRef.current = setTimeout(() => {
      const interval = setInterval(() => {
        if (!mapRef.current) return
        clearInterval(interval)
        updateHeatmapSource()
      }, 50)
    }, 150)
  }, [stations, visible, coveragePolygons])

  // ── Debounced relay update (independent of heatmap visibility) ───────────
  useEffect(() => {
    if (relayDebounceRef.current) clearTimeout(relayDebounceRef.current)
    relayDebounceRef.current = setTimeout(() => {
      const interval = setInterval(() => {
        if (!mapRef.current) return
        clearInterval(interval)
        updateRelaySource()
      }, 50)
    }, 150)
  }, [links, stations, coveragePolygons, terrainLinkStats])
}
