'use client'
import { useEffect, useRef } from 'react'

interface UseBuildingLayerProps {
  mapRef:           React.MutableRefObject<any>
  buildingsVisible: boolean
}

/**
 * Manages the 3D building fill-extrusion layer.
 *
 * Fetch strategy:
 *  - On toggle ON: fetch immediately
 *  - On moveend: debounce 1.5 s so rapid panning/zooming collapses into one request
 *  - Only one in-flight request at a time: any pending fetch is cancelled when a
 *    new moveend fires (AbortController)
 *  - Only fires at zoom ≥ 13 to keep bboxes small enough for Overpass
 */
export function useBuildingLayer({ mapRef, buildingsVisible }: UseBuildingLayerProps) {
  const visibleRef      = useRef(buildingsVisible)
  const listenersSet    = useRef(false)
  const debounceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortController = useRef<AbortController | null>(null)

  // Sync visibility + trigger initial fetch when toggle changes
  useEffect(() => {
    visibleRef.current = buildingsVisible

    const map = mapRef.current
    if (!map) return

    if (map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', buildingsVisible ? 'visible' : 'none')
    }

    if (buildingsVisible) {
      scheduleFetch(map, 0, abortController, debounceTimer)
    }
  }, [buildingsVisible])

  // Attach moveend listener once the map is ready (poll until ready)
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current
      if (!map) return
      clearInterval(interval)

      if (listenersSet.current) return
      listenersSet.current = true

      map.on('moveend', () => {
        if (!visibleRef.current) return
        scheduleFetch(map, 1500, abortController, debounceTimer)
      })
    }, 100)

    return () => clearInterval(interval)
  }, [])
}

/** Debounced fetch trigger: cancels any pending timer and starts a new one. */
function scheduleFetch(
  map:            any,
  delayMs:        number,
  abortRef:       React.MutableRefObject<AbortController | null>,
  timerRef:       React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (timerRef.current) clearTimeout(timerRef.current)

  timerRef.current = setTimeout(() => {
    // Cancel any previous in-flight HTTP request
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    fetchAndUpdateBuildings(map, abortRef.current.signal)
  }, delayMs)
}

async function fetchAndUpdateBuildings(map: any, signal: AbortSignal) {
  const zoom = map.getZoom()
  if (zoom < 13) return

  const bounds = map.getBounds()
  const south  = bounds.getSouth()
  const west   = bounds.getWest()
  const north  = bounds.getNorth()
  const east   = bounds.getEast()

  try {
    const res = await fetch(
      `/api/buildings?south=${south}&west=${west}&north=${north}&east=${east}`,
      { signal },
    )
    if (!res.ok) return

    const geojson = await res.json()
    const source  = map.getSource('buildings') as any
    source?.setData(geojson)
  } catch {
    // AbortError (cancelled by newer fetch) or network error — both non-critical
  }
}
