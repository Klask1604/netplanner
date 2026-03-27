'use client'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect } from 'react'
import { useNetStore } from '@/store/netStore'
import { useMapInit } from './useMapInit'
import { useMarkerSync } from './useMarkerSync'
import { useLinkSync } from './useLinkSync'
import { useHeatmapLayer } from './useHeatmapLayer'
import { useTerrainLayer } from './useTerrainLayer'
import { useBuildingLayer } from './useBuildingLayer'
import LinkModeHint from './LinkModeHint'
import HeatmapLegend from './HeatmapLegend'
import TopoLegend from './TopoLegend'
import styles from './MapView.module.css'

export default function MapView() {
  const {
    stations, links, selId, tool, linkSrc, heatmapVisible, coveragePolygons, terrainLinkStats,
    hillshadeVisible, terrain3dEnabled, topoMapEnabled, buildingsVisible,
    addStation, removeStation, selectStation, startLink, completeLink, fetchStationElevation,
  } = useNetStore()

  const { mapRef } = useMapInit({ addStation, selectStation })

  useMarkerSync({
    mapRef, stations, selId, linkSrc, coveragePolygons,
    removeStation, selectStation, startLink, completeLink, fetchStationElevation,
  })
  useLinkSync({ mapRef, links, stations, terrainLinkStats })
  useHeatmapLayer({ mapRef, stations, links, visible: heatmapVisible, coveragePolygons, terrainLinkStats })
  useTerrainLayer({ mapRef, hillshadeVisible, terrain3dEnabled, topoMapEnabled })
  useBuildingLayer({ mapRef, buildingsVisible })

  // Update canvas cursor when placing-tool is active
  useEffect(() => {
    const canvas = document.querySelector('#map canvas') as HTMLElement | null
    if (!canvas) return
    const isPlacing = ['bts', 'antenna', 'router', 'repeater'].includes(tool)
    canvas.style.cursor = isPlacing ? 'crosshair' : ''
  }, [tool])

  return (
    <div className={styles.wrapper}>
      <div id="map" className={styles.map} />
      {tool === 'link' && <LinkModeHint hasSource={!!linkSrc} />}
      {heatmapVisible && <HeatmapLegend />}
      {topoMapEnabled && <TopoLegend />}
    </div>
  )
}
