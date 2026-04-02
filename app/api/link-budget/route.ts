import { NextRequest, NextResponse } from 'next/server'
import { Station, linkSamplePoints, terrainLinkBudget } from '@/lib/rf'
import { getElevationsServer } from '@/lib/terrarium.server'

export async function POST(request: NextRequest) {
  try {
    const { station1, station2 }: { station1: Station; station2: Station } = await request.json()

    // Sample terrain elevations along the path between the two stations
    const pathSamplePoints  = linkSamplePoints(station1, station2)
    const terrainElevations = await getElevationsServer(pathSamplePoints)

    // Compute terrain-aware link budget with knife-edge diffraction
    const linkStats = terrainLinkBudget(station1, station2, terrainElevations)

    return NextResponse.json({ stats: linkStats })
  } catch (error) {
    console.error('[/api/link-budget] error:', error)
    return NextResponse.json({ error: 'Link budget computation failed' }, { status: 500 })
  }
}
