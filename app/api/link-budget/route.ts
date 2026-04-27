import { NextRequest, NextResponse } from 'next/server'
import { Station, linkSamplePoints, terrainLinkBudget } from '@/lib/rf'
import { getElevationsServer } from '@/lib/terrarium.server'
import { fetchBuildingsInBbox, computeBuildingHeightsAlongPath } from '@/lib/buildings.server'

export async function POST(request: NextRequest) {
  try {
    const { station1, station2 }: { station1: Station; station2: Station } = await request.json()

    const pathSamplePoints  = linkSamplePoints(station1, station2)
    const terrainElevations = await getElevationsServer(pathSamplePoints)

    // Fetch buildings along the link path. Buffer of ~200m (0.002°) catches
    // buildings that straddle the bounding box edge.
    const BUFFER_DEG = 0.002
    const south = Math.min(station1.lat, station2.lat) - BUFFER_DEG
    const north = Math.max(station1.lat, station2.lat) + BUFFER_DEG
    const west  = Math.min(station1.lng, station2.lng) - BUFFER_DEG
    const east  = Math.max(station1.lng, station2.lng) + BUFFER_DEG

    const buildings = await fetchBuildingsInBbox(south, west, north, east)
    const pathBuildingHeights = buildings.length > 0
      ? computeBuildingHeightsAlongPath(station1.lat, station1.lng, pathSamplePoints, buildings)
      : []

    if (buildings.length > 0) {
      const blockedSamples = pathBuildingHeights.filter(h => h > 0).length
      console.log(`[/api/link-budget] ${buildings.length} buildings along path → ${blockedSamples}/${pathSamplePoints.length} samples inside footprints`)
    }

    const linkStats = terrainLinkBudget(station1, station2, terrainElevations, pathBuildingHeights)

    return NextResponse.json({ stats: linkStats })
  } catch (error) {
    console.error('[/api/link-budget] error:', error)
    return NextResponse.json({ error: 'Link budget computation failed' }, { status: 500 })
  }
}
