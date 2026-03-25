export interface Station {
  id: number
  type: StationType
  name: string
  lat: number
  lng: number
  txPower: number   // dBm
  gain: number      // dBi
  freq: number      // MHz
  height: number    // m AGL (antenna mast height above local ground)
  sens: number      // dBm receiver sensitivity
  azimuth: number   // azimuth degrees (0 = North, clockwise)
  beamwidth: number // horizontal beamwidth in degrees (360 = omnidirectional)
  radius: number    // coverage radius km (computed, flat-terrain)
  elevation: number // m AMSL (terrain elevation at station location, auto-fetched)
}

// One polygon per dB-margin threshold, each polygon is 36 [lat,lng] vertices.
export type CoveragePolygons = [[number, number][], [number, number][], [number, number][], [number, number][], [number, number][]]

export interface Link {
  id: number
  station1Id: number  // station id
  station2Id: number  // station id
}

export interface LinkStats {
  distance:        number   // km
  fspl:            number   // dB (free-space path loss)
  rxPower:         number   // dBm
  margin:          number   // dB above sensitivity
  ok:              boolean
  diffractionLoss: number   // dB additional loss from terrain (0 when not computed)
  losObstructed:   boolean  // true if terrain physically crosses the LOS line
  beamMisaligned:  boolean  // true if either station's directional beam doesn't cover the other
}

export type StationType = 'bts' | 'antenna' | 'router' | 'repeater'
export type ToolType = 'select' | 'bts' | 'antenna' | 'router' | 'repeater' | 'link' | 'delete'

export interface StationConfig {
  name: string
  color: string
  def: Omit<Station, 'id' | 'type' | 'name' | 'lat' | 'lng' | 'radius'>
}

export const STATION_TYPES: Record<StationType, StationConfig> = {
  bts: {
    name: 'BTS / eNodeB',
    color: '#00d4ff',
    def: { txPower: 43, gain: 15, freq: 900, height: 30, sens: -90, azimuth: 0, beamwidth: 360, elevation: 0 },
  },
  antenna: {
    name: 'Antenă Radio',
    color: '#ff8c00',
    def: { txPower: 30, gain: 10, freq: 2400, height: 15, sens: -85, azimuth: 0, beamwidth: 65, elevation: 0 },
  },
  router: {
    name: 'Router / Switch',
    color: '#00ff88',
    def: { txPower: 20, gain: 5, freq: 5800, height: 5, sens: -80, azimuth: 0, beamwidth: 360, elevation: 0 },
  },
  repeater: {
    name: 'Repeater',
    color: '#cc00ff',
    def: { txPower: 37, gain: 12, freq: 1800, height: 20, sens: -88, azimuth: 0, beamwidth: 360, elevation: 0 },
  },
}

/**
 * Free-space path loss coverage radius for short-range devices (WiFi APs, routers).
 * FSPL formula: PL = 20·log10(d) + 20·log10(f) + 32.44  (d in km, f in MHz)
 * Result is capped at 0.5 km — realistic maximum for indoor/campus equipment.
 */
export function freeSpaceRadius(
  station: Pick<Station, 'txPower' | 'gain' | 'freq' | 'sens'>,
): number {
  const eirp         = station.txPower + station.gain
  const maxPathLoss  = eirp - station.sens
  const freqMHz      = Math.max(station.freq, 1)
  const logDistance  = (maxPathLoss - 20 * Math.log10(freqMHz) - 32.44) / 20
  return Math.min(Math.max(Math.pow(10, logDistance), 0.01), 0.5)
}

/**
 * Okumura-Hata model (urban, small/medium city)
 * Returns coverage radius in km
 */
export function okumuraHataSlope(height: number): number {
  return 44.9 - 6.55 * Math.log10(Math.max(height, 5))
}

export function okumuraHata(station: Pick<Station, 'txPower' | 'gain' | 'freq' | 'height' | 'sens'>): number {
  const freq        = Math.max(station.freq, 150)    // MHz
  const baseHeight  = Math.max(station.height, 5)    // base station height m
  const mobileHeight = 1.5                           // mobile height m
  const eirp        = station.txPower + station.gain
  const maxPathLoss = eirp - station.sens

  const mobileHeightFactor = (1.1 * Math.log10(freq) - 0.7) * mobileHeight - (1.56 * Math.log10(freq) - 0.8)
  const slope              = okumuraHataSlope(baseHeight)
  const intercept          = 69.55 + 26.16 * Math.log10(freq) - 13.82 * Math.log10(baseHeight) - mobileHeightFactor
  const logDistance        = (maxPathLoss - intercept) / slope

  return Math.min(Math.max(Math.pow(10, logDistance), 0.05), 40)
}

/**
 * Okumura-Hata dB margin received at a specific distance from a station.
 * Positive = within coverage, negative = beyond coverage edge.
 * Used to assess how well a repeater can receive the source broadcast signal.
 */
export function okumuraHataMarginAtDistance(
  station: Pick<Station, 'txPower' | 'gain' | 'freq' | 'height' | 'sens'>,
  distKm: number,
): number {
  const freq             = Math.max(station.freq, 150)
  const baseHeight       = Math.max(station.height, 5)
  const mobileHeight     = 1.5
  const eirp             = station.txPower + station.gain
  const mobileHeightFactor = (1.1 * Math.log10(freq) - 0.7) * mobileHeight - (1.56 * Math.log10(freq) - 0.8)
  const slope            = okumuraHataSlope(baseHeight)
  const intercept        = 69.55 + 26.16 * Math.log10(freq) - 13.82 * Math.log10(baseHeight) - mobileHeightFactor
  const pathLoss         = intercept + slope * Math.log10(Math.max(distKm, 0.01))
  return eirp - pathLoss - station.sens  // = maxPathLoss - pathLoss
}

/** Free-space path loss between two stations (no terrain). */
export function linkBudget(station1: Station, station2: Station): LinkStats {
  const deltaX   = (station1.lat - station2.lat) * 111.32
  const deltaY   = (station1.lng - station2.lng) * 111.32 * Math.cos((station1.lat * Math.PI) / 180)
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

  if (distance < 0.001) {
    return {
      distance: 0, fspl: 0,
      rxPower: station1.txPower + station1.gain + station2.gain,
      margin: 99, ok: true, diffractionLoss: 0, losObstructed: false, beamMisaligned: false,
    }
  }

  // Beam alignment check: each directional antenna must face the other station.
  const bearing1to2    = bearingBetween(station1.lat, station1.lng, station2.lat, station2.lng)
  const bearing2to1    = (bearing1to2 + 180) % 360
  const beamMisaligned =
    !isInBeam(bearing1to2, station1.azimuth, station1.beamwidth ?? 360) ||
    !isInBeam(bearing2to1, station2.azimuth, station2.beamwidth ?? 360)

  if (beamMisaligned) {
    return {
      distance, fspl: 0, rxPower: -999,
      margin: -999, ok: false, diffractionLoss: 0, losObstructed: false, beamMisaligned: true,
    }
  }

  // Links involving a repeater use the Okumura-Hata broadcast model — the repeater
  // must be within the source's actual coverage area to receive the signal.
  // BTS↔BTS or BTS↔Antenna backhaul links use FSPL (dedicated point-to-point).
  const involvesRepeater = station1.type === 'repeater' || station2.type === 'repeater'
  if (involvesRepeater) {
    const source   = station1.type === 'repeater' ? station2 : station1
    const receiver = station1.type === 'repeater' ? station1 : station2
    const margin   = okumuraHataMarginAtDistance(source, distance)
    const pathLoss = (source.txPower + source.gain) - station2.sens - margin
    const rxPower  = source.txPower + source.gain - pathLoss + receiver.gain
    return {
      distance, fspl: pathLoss, rxPower,
      margin, ok: margin > 0, diffractionLoss: 0, losObstructed: false, beamMisaligned: false,
    }
  }

  const avgFreq = (station1.freq + station2.freq) / 2
  const fspl    = 20 * Math.log10(distance) + 20 * Math.log10(avgFreq) + 32.44
  const rxPower = station1.txPower + station1.gain - fspl + station2.gain
  const margin  = rxPower - station2.sens
  return { distance, fspl, rxPower, margin, ok: margin > 0, diffractionLoss: 0, losObstructed: false, beamMisaligned: false }
}

/**
 * Knife-edge diffraction loss (ITU-R P.526) for a given Fresnel-Kirchhoff
 * parameter ν.  Returns additional path loss in dB (0 when terrain is clear).
 */
export function knifeEdgeLoss(nu: number): number {
  if (nu < -0.7) return 0
  if (nu <=  2.4) return Math.max(0, 6.02 + 9.11 * nu + 1.27 * nu * nu)
  return 12.953 + 20 * Math.log10(nu)
}

/**
 * Generate N evenly-spaced sample points along the path between two stations
 * (excluding the endpoints themselves).
 * N = max(20, 4 samples/km) so short links still get decent coverage.
 */
export function linkSamplePoints(
  s1: Station, s2: Station
): { lat: number; lng: number }[] {
  const distKm      = haversineKm(s1.lat, s1.lng, s2.lat, s2.lng)
  const sampleCount = Math.max(20, Math.ceil(distKm * 4))
  const points: { lat: number; lng: number }[] = []
  for (let i = 1; i <= sampleCount; i++) {
    const pathFraction = i / (sampleCount + 1)
    points.push({
      lat: s1.lat + pathFraction * (s2.lat - s1.lat),
      lng: s1.lng + pathFraction * (s2.lng - s1.lng),
    })
  }
  return points
}

/**
 * Terrain-aware link budget.
 *
 * Applies single knife-edge diffraction at the worst terrain obstruction
 * found along the path profile (ITU-R P.526 method).
 *
 * @param pathElevations  Terrain AMSL (m) at each point returned by linkSamplePoints.
 */
export function terrainLinkBudget(
  station1: Station,
  station2: Station,
  pathElevations: number[],
): LinkStats {
  const base = linkBudget(station1, station2)
  // Short-circuit: co-located stations, no terrain data, or beam not pointed at target
  if (base.distance < 0.001 || pathElevations.length === 0 || base.beamMisaligned) return base

  const elevationSampleCount = pathElevations.length
  const txAntennaMsl         = station1.elevation + station1.height   // antenna tip AMSL (m)
  const rxAntennaMsl         = station2.elevation + station2.height
  const distKm               = base.distance
  const freqMHz              = (station1.freq + station2.freq) / 2
  const lambdaKm             = 300 / freqMHz                          // wavelength in km

  let worstFresnelNumber = -Infinity
  let obstructed         = false

  for (let i = 0; i < elevationSampleCount; i++) {
    const pathFraction   = (i + 1) / (elevationSampleCount + 1)
    const distFromTx     = pathFraction * distKm
    const distFromRx     = (1 - pathFraction) * distKm
    const losElevation   = txAntennaMsl + pathFraction * (rxAntennaMsl - txAntennaMsl)  // LOS height at this point (m AMSL)
    const clearanceM     = pathElevations[i] - losElevation                             // >0 means terrain above LOS

    const fresnelNumber = (clearanceM / 1000) * Math.sqrt(2 * (distFromTx + distFromRx) / (lambdaKm * distFromTx * distFromRx))
    if (fresnelNumber > worstFresnelNumber) {
      worstFresnelNumber = fresnelNumber
      if (clearanceM > 0) obstructed = true
    }
  }

  const diffractionLoss = knifeEdgeLoss(worstFresnelNumber)
  const totalLoss       = base.fspl + diffractionLoss
  const rxPower         = station1.txPower + station1.gain - totalLoss + station2.gain
  const margin          = rxPower - station2.sens

  return {
    distance:        base.distance,
    fspl:            base.fspl,
    rxPower,
    margin,
    ok:              margin > 0,
    diffractionLoss: Math.round(diffractionLoss * 10) / 10,
    losObstructed:   obstructed,
    beamMisaligned:  false,
  }
}

export function calcEIRP(station: Station): number {
  return station.txPower + station.gain
}

export function calcCoverageArea(radius: number): number {
  return Math.PI * radius * radius
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius  = 6371
  const deltaLat     = (lat2 - lat1) * Math.PI / 180
  const deltaLng     = (lng2 - lng1) * Math.PI / 180
  const haversine    = Math.sin(deltaLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(deltaLng/2)**2
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1-haversine))
}

export function stationsInterfere(stationA: Station, stationB: Station): boolean {
  if (stationA.type !== stationB.type) return false
  const distance = haversineKm(stationA.lat, stationA.lng, stationB.lat, stationB.lng)
  return distance < stationA.radius + stationB.radius
}

/**
 * Returns the [lat, lng] point that is distKm away from [lat, lng] in the
 * given bearing (degrees, 0=north, clockwise).
 */
export function destinationPoint(
  lat: number, lng: number, bearingDeg: number, distKm: number
): [number, number] {
  const R   = 6371
  const d   = distKm / R
  const b   = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lng1 = (lng * Math.PI) / 180

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b)
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  )
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI]
}

/** Compass bearing (0–360°) from point A to point B. */
export function bearingBetween(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const dLng  = toRad(lng2 - lng1)
  const phi1  = toRad(lat1)
  const phi2  = toRad(lat2)
  const y     = Math.sin(dLng) * Math.cos(phi2)
  const x     = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Returns true when `targetBearing` falls inside the antenna beam centred on
 * `azimuth` with half-angle `beamwidth/2`.  Omni antennas (beamwidth ≥ 355°)
 * always return true.
 */
export function isInBeam(targetBearing: number, azimuth: number, beamwidth: number): boolean {
  if ((beamwidth ?? 360) >= 355) return true
  let diff = ((targetBearing - azimuth) % 360 + 360) % 360
  if (diff > 180) diff -= 360
  return Math.abs(diff) <= beamwidth / 2
}

const MARGIN_STOPS = [0, 5, 10, 20, 30] as const  // dB margin thresholds
const BEARINGS     = 36                             // directions (every 10°)
const SAMPLES      = 5                              // samples per direction (36×5=180 pts → 2 batches/station)

/**
 * Returns true when bearingDeg falls within the antenna sector defined by
 * azimuth ± beamwidth/2.  Handles 360°-wraparound correctly.
 */
function bearingInSector(bearingDeg: number, azimuth: number, beamwidth: number): boolean {
  if (beamwidth >= 355) return true          // omnidirectional
  let diff = ((bearingDeg - azimuth) % 360 + 360) % 360
  if (diff > 180) diff -= 360
  return Math.abs(diff) <= beamwidth / 2
}

/**
 * Build N sample points along a given bearing from the station up to maxKm.
 */
function samplePoints(
  lat: number, lng: number, bearingDeg: number, maxKm: number
): [number, number][] {
  const points: [number, number][] = []
  for (let i = 1; i <= SAMPLES; i++) {
    points.push(destinationPoint(lat, lng, bearingDeg, (i / SAMPLES) * maxKm))
  }
  return points
}

/**
 * Given terrain elevation samples along a single bearing (from nearest to
 * farthest, SAMPLES points), compute:
 *  - whether there is a line-of-sight obstruction and at what fraction
 *  - the effective antenna height at the boundary
 *
 * antennaMSL = station.elevation + station.height
 * Receiver is assumed at 1.5 m AGL.
 */
function analyseBearing(
  antennaMslElevation: number,
  samples: number[],           // terrain AMSL, index 0 = nearest, SAMPLES-1 = farthest
  flatRadiusKm: number
): { obstructedAtKm: number | null; effectiveHeight: number } {
  const receiverElevation = samples[SAMPLES - 1] + 1.5

  for (let i = 0; i < SAMPLES; i++) {
    const pathFraction = (i + 1) / SAMPLES   // fraction along bearing (0..1]
    const distKm       = pathFraction * flatRadiusKm
    const losElevation = antennaMslElevation + pathFraction * (receiverElevation - antennaMslElevation)
    if (samples[i] > losElevation) {
      return { obstructedAtKm: distKm, effectiveHeight: 5 }
    }
  }

  const effectiveHeight = antennaMslElevation - (samples[SAMPLES - 1] + 1.5)
  return { obstructedAtKm: null, effectiveHeight: Math.max(effectiveHeight, 5) }
}

/**
 * Compute terrain-aware coverage polygons for a station.
 *
 * @param station   The station (must have elevation populated)
 * @param terrainElevations  Flat array of terrain elevations in row-major order:
 *   row = bearing index (0..35), col = sample index (0..11)
 *   i.e. terrainElevations[bearing * SAMPLES + sample]
 * @returns CoveragePolygons — 5 polygons, one per MARGIN_STOPS threshold,
 *   each is an array of 36 [lat,lng] vertices.
 */
export function terrainCoveragePolygon(
  station: Station,
  terrainElevations: number[]
): CoveragePolygons {
  const antennaMslElevation = station.elevation + station.height
  const flatRadiusKm        = station.radius
  const beamwidthDeg        = station.beamwidth ?? 360
  const isOmnidirectional   = beamwidthDeg >= 355

  const polygons = MARGIN_STOPS.map(() => [] as [number, number][]) as unknown as CoveragePolygons

  for (let marginIndex = 0; marginIndex < MARGIN_STOPS.length; marginIndex++) {
    const ring: [number, number][] = []

    if (!isOmnidirectional) {
      ring.push([station.lat, station.lng])  // sector polygon starts at center
    }

    for (let bearingIndex = 0; bearingIndex < BEARINGS; bearingIndex++) {
      const bearingDeg = bearingIndex * 10
      if (!bearingInSector(bearingDeg, station.azimuth, beamwidthDeg)) continue

      const samples = terrainElevations.slice(bearingIndex * SAMPLES, bearingIndex * SAMPLES + SAMPLES)
      const { obstructedAtKm, effectiveHeight } = analyseBearing(antennaMslElevation, samples, flatRadiusKm)

      const effectiveRadiusKm = obstructedAtKm !== null
        ? obstructedAtKm
        : okumuraHata({ ...station, height: effectiveHeight })

      const marginDb       = MARGIN_STOPS[marginIndex]
      const coverageRadiusKm = marginDb === 0
        ? effectiveRadiusKm
        : effectiveRadiusKm * Math.pow(10, -marginDb / okumuraHataSlope(effectiveHeight))

      ring.push(destinationPoint(station.lat, station.lng, bearingDeg, coverageRadiusKm))
    }

    if (!isOmnidirectional) {
      ring.push([station.lat, station.lng])  // close sector back to center
    }

    polygons[marginIndex] = ring
  }

  return polygons
}

/**
 * Returns the flat array of sample points needed for terrainCoveragePolygon.
 * Call fetchElevations() on this list, then pass the result to terrainCoveragePolygon.
 */
export function coverageSamplePoints(station: Station): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = []
  for (let bearingIndex = 0; bearingIndex < BEARINGS; bearingIndex++) {
    const bearingDeg = bearingIndex * 10
    for (const [lat, lng] of samplePoints(station.lat, station.lng, bearingDeg, station.radius)) {
      points.push({ lat, lng })
    }
  }
  return points
}
