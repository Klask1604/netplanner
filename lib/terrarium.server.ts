// Terrain elevation via AWS Terrain Tiles (Terrarium encoding) — server-side Node.js version.
// Uses pngjs for PNG decoding instead of the browser Canvas API.
//
// Tile URL: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// Encoding: elevation (metres AMSL) = R * 256 + G + B / 256 - 32768
// Zoom 13 ≈ 19 m/pixel at latitude 45° (Brasov) — finer than SRTM 90 m.

import { PNG } from 'pngjs'

const ZOOM = 13

function tileUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
}

// Cache decoded RGBA pixel buffers per tile key "z/x/y"
const tilePixelCache = new Map<string, Buffer>()

/**
 * Convert a lat/lng coordinate to tile XY + pixel offset within that tile.
 */
function latLngToTilePixel(lat: number, lng: number, zoom: number) {
  const tileCount = Math.pow(2, zoom)
  const tileX     = Math.floor((lng + 180) / 360 * tileCount)
  const latRad    = (lat * Math.PI) / 180
  const tileY     = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * tileCount
  )
  const fracX = (lng + 180) / 360 * tileCount - tileX
  const fracY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * tileCount - tileY
  return {
    tileX,
    tileY,
    pixelX: Math.min(Math.floor(fracX * 256), 255),
    pixelY: Math.min(Math.floor(fracY * 256), 255),
  }
}

function decodeTerrarium(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768
}

/**
 * Fetch a Terrarium PNG tile and cache its decoded RGBA pixels.
 */
async function loadTilePixels(tileX: number, tileY: number, zoom: number): Promise<Buffer> {
  const cacheKey = `${zoom}/${tileX}/${tileY}`
  if (tilePixelCache.has(cacheKey)) return tilePixelCache.get(cacheKey)!

  const response = await fetch(tileUrl(zoom, tileX, tileY))
  if (!response.ok) throw new Error(`Terrarium tile fetch failed: ${response.status}`)

  const arrayBuffer = await response.arrayBuffer()
  const pngData     = PNG.sync.read(Buffer.from(arrayBuffer))
  const pixels      = Buffer.from(pngData.data)  // RGBA, 256×256×4 bytes

  tilePixelCache.set(cacheKey, pixels)
  return pixels
}

/**
 * Get terrain elevation (metres AMSL) at a single coordinate.
 */
export async function getElevationServer(lat: number, lng: number): Promise<number> {
  const { tileX, tileY, pixelX, pixelY } = latLngToTilePixel(lat, lng, ZOOM)
  const pixels     = await loadTilePixels(tileX, tileY, ZOOM)
  const pixelIndex = (pixelY * 256 + pixelX) * 4
  return decodeTerrarium(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2])
}

/**
 * Get terrain elevations for many points in one call.
 *
 * Groups points by unique tile, fetches all unique tiles in parallel (S3 has
 * no rate limit), then reads elevations from the cached pixel data.
 * Subsequent calls for the same geographic area return instantly from cache.
 */
export async function getElevationsServer(
  points: { lat: number; lng: number }[]
): Promise<number[]> {
  const tileCoords = points.map(point => latLngToTilePixel(point.lat, point.lng, ZOOM))

  // Deduplicate tiles and fetch all in parallel
  const uniqueTiles = new Map<string, { tileX: number; tileY: number }>()
  for (const coord of tileCoords) {
    const cacheKey = `${ZOOM}/${coord.tileX}/${coord.tileY}`
    if (!uniqueTiles.has(cacheKey)) uniqueTiles.set(cacheKey, { tileX: coord.tileX, tileY: coord.tileY })
  }

  await Promise.all(
    Array.from(uniqueTiles.values()).map(({ tileX, tileY }) => loadTilePixels(tileX, tileY, ZOOM))
  )

  return tileCoords.map(({ tileX, tileY, pixelX, pixelY }) => {
    const pixels     = tilePixelCache.get(`${ZOOM}/${tileX}/${tileY}`)!
    const pixelIndex = (pixelY * 256 + pixelX) * 4
    return decodeTerrarium(pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2])
  })
}
