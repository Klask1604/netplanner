'use client'
import { useEffect, useRef } from 'react'
import { useNetStore } from '@/store/netStore'
import { StationType } from '@/lib/rf'
import { BRASOV } from './mapUtils'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const CARTO_DARK_TILES = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
]

const OPENTOPO_TILES = ['https://tile.opentopomap.org/{z}/{x}/{y}.png']

const TERRARIUM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']

interface UseMapInitProps {
  addStation:    (lat: number, lng: number, type: StationType) => void
  selectStation: (id: number | null) => void
}

export function useMapInit({ addStation, selectStation }: UseMapInitProps) {
  const mapRef     = useRef<any>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    import('maplibre-gl').then(({ Map: MLMap }) => {
      if (mapRef.current) return

      const map = new MLMap({
        container: 'map',
        center:    [BRASOV[1], BRASOV[0]],   // MapLibre uses [lng, lat]
        zoom:      13,
        style: {
          version: 8,
          sources: {},
          layers:  [],
        },
      })

      map.on('load', () => {
        // ── Basemap: dark (default) ──────────────────────────────────────────
        map.addSource('basemap-dark', {
          type:        'raster',
          tiles:       CARTO_DARK_TILES,
          tileSize:    256,
          attribution: '©<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ©<a href="https://carto.com/attributions">CARTO</a>',
        })
        map.addLayer({
          id:     'basemap-dark',
          type:   'raster',
          source: 'basemap-dark',
          layout: { visibility: 'visible' },
        })

        // ── Basemap: topographic (OpenTopoMap) ──────────────────────────────
        map.addSource('basemap-topo', {
          type:        'raster',
          tiles:       OPENTOPO_TILES,
          tileSize:    256,
          maxzoom:     17,
          attribution: '©<a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
        })
        map.addLayer({
          id:     'basemap-topo',
          type:   'raster',
          source: 'basemap-topo',
          layout: { visibility: 'none' },
        })

        // ── Terrain DEM source + hillshade layer (visibility toggled externally) ──
        map.addSource('terrain-dem', {
          type:     'raster-dem',
          tiles:    TERRARIUM_TILES,
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom:  14,
        })
        map.addLayer({
          id:     'hillshade',
          type:   'hillshade',
          source: 'terrain-dem',
          layout: { visibility: 'none' },
          paint: {
            'hillshade-exaggeration':           0.6,
            'hillshade-shadow-color':           '#000000',
            'hillshade-highlight-color':        '#ffffff',
            'hillshade-accent-color':           '#444444',
            'hillshade-illumination-direction': 335,
          },
        })

        // ── GeoJSON sources ──────────────────────────────────────────────────
        map.addSource('station-rings', { type: 'geojson', data: EMPTY_FC })
        map.addSource('links',         { type: 'geojson', data: EMPTY_FC })
        map.addSource('coverage',      { type: 'geojson', data: EMPTY_FC })
        map.addSource('relay',         { type: 'geojson', data: EMPTY_FC })
        map.addSource('buildings',     { type: 'geojson', data: EMPTY_FC })

        // ── 3D buildings from OSM (fill-extrusion, toggled externally) ─────────
        map.addLayer({
          id:     'buildings-3d',
          type:   'fill-extrusion',
          source: 'buildings',
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color':   '#1e2035',
            'fill-extrusion-height':  ['coalesce', ['get', 'height'], 8],
            'fill-extrusion-base':    0,
            'fill-extrusion-opacity': 0.80,
          },
        })

        // ── Coverage fill (heatmap signal quality) ───────────────────────────
        map.addLayer({
          id:     'coverage-fill',
          type:   'fill',
          source: 'coverage',
          paint: {
            'fill-color':   ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
          },
        })

        // ── Linked coverage bounding box fill ────────────────────────────────
        map.addLayer({
          id:     'relay-fill',
          type:   'fill',
          source: 'relay',
          paint: {
            'fill-color':   ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
          },
        })

        // ── Linked coverage union border ─────────────────────────────────────
        map.addLayer({
          id:     'relay-border',
          type:   'line',
          source: 'relay',
          paint: {
            'line-color':   '#00d4ff',
            'line-width':   2.5,
            'line-opacity': 0.85,
          },
        })

        // ── Coverage outer dashed boundary ───────────────────────────────────
        map.addLayer({
          id:     'coverage-border',
          type:   'line',
          source: 'coverage',
          filter: ['==', ['get', 'ring'], 0],
          paint: {
            'line-color':     '#ff3860',
            'line-width':     1.5,
            'line-opacity':   0.35,
            'line-dasharray': [3, 5],
          },
        })

        // ── Station coverage rings (per station type, always visible) ────────
        map.addLayer({
          id:     'station-rings',
          type:   'line',
          source: 'station-rings',
          paint: {
            'line-color':     ['get', 'color'],
            'line-width':     1.5,
            'line-opacity':   0.6,
            'line-dasharray': [5, 4],
          },
        })

        // ── Links ────────────────────────────────────────────────────────────
        map.addLayer({
          id:     'links',
          type:   'line',
          source: 'links',
          paint: {
            'line-color':     ['get', 'color'],
            'line-width':     1.5,
            'line-opacity':   0.85,
            'line-dasharray': [6, 4],
          },
        })

        // ── Click to place station / deselect ────────────────────────────────
        map.on('click', (e: any) => {
          const activeTool = useNetStore.getState().tool
          if (['bts', 'antenna', 'router', 'repeater'].includes(activeTool)) {
            addStation(e.lngLat.lat, e.lngLat.lng, activeTool as StationType)
          } else if (activeTool === 'select') {
            selectStation(null)
          }
        })

        // Signal to all hooks that the map + sources are ready
        mapRef.current = map
      })
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current    = null
        mountedRef.current = false
      }
    }
  }, [])

  return { mapRef }
}
