import { NextRequest, NextResponse } from 'next/server'
import { fetchBuildingsInBbox } from '@/lib/buildings.server'

/**
 * GET /api/buildings?south=&west=&north=&east=
 *
 * Proxies the Overpass API (avoids CORS from the browser) and returns a
 * GeoJSON FeatureCollection of building polygons with a `height` property
 * (metres).  Used by the MapLibre fill-extrusion layer.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const south = parseFloat(searchParams.get('south') ?? 'NaN')
    const west  = parseFloat(searchParams.get('west')  ?? 'NaN')
    const north = parseFloat(searchParams.get('north') ?? 'NaN')
    const east  = parseFloat(searchParams.get('east')  ?? 'NaN')

    if ([south, west, north, east].some(isNaN)) {
      return NextResponse.json({ error: 'Invalid bbox parameters' }, { status: 400 })
    }

    const buildings = await fetchBuildingsInBbox(south, west, north, east)

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: buildings.map(b => ({
        type:     'Feature',
        geometry: {
          type:        'Polygon',
          coordinates: [b.ring.map(([lat, lng]) => [lng, lat])],  // GeoJSON is [lng, lat]
        },
        properties: { height: b.height },
      })),
    }

    return NextResponse.json(geojson)
  } catch (error) {
    // Return an empty collection instead of 500 — the map renders no buildings
    // gracefully and the client won't show console errors.
    console.warn('[/api/buildings] fetch failed, returning empty collection:', (error as Error).message)
    return NextResponse.json({ type: 'FeatureCollection', features: [] })
  }
}
