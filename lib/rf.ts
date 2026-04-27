export interface Station {
  id: number;
  type: StationType;
  name: string;
  lat: number;
  lng: number;
  txPower: number; // dBm
  gain: number; // dBi
  freq: number; // MHz
  height: number; // m AGL (antenna mast height above local ground)
  sens: number; // dBm receiver sensitivity
  azimuth: number; // azimuth degrees (0 = North, clockwise)
  beamwidth: number; // horizontal beamwidth in degrees (360 = omnidirectional)
  radius: number; // coverage radius km (computed, flat-terrain)
  elevation: number; // m AMSL (terrain elevation at station location, auto-fetched)
}

// One polygon per dB-margin threshold.
export type CoveragePolygons = [
  [number, number][],
  [number, number][],
  [number, number][],
  [number, number][],
  [number, number][],
];

export interface Link {
  id: number;
  station1Id: number; // station id
  station2Id: number; // station id
}

export interface LinkStats {
  distance: number; // km
  fspl: number; // dB (free-space path loss)
  rxPower: number; // dBm
  margin: number; // dB above sensitivity
  ok: boolean;
  diffractionLoss: number; // dB additional loss from terrain (0 when not computed)
  losObstructed: boolean; // true if terrain physically crosses the LOS line
  beamMisaligned: boolean; // true if either station's directional beam doesn't cover the other
  frequencyMismatch: boolean; // true if stations operate on incompatible frequency bands (>10% relative diff)
}

export type StationType = "bts" | "antenna" | "router" | "repeater";
export type ToolType =
  | "select"
  | "bts"
  | "antenna"
  | "router"
  | "repeater"
  | "link"
  | "delete";

export interface StationConfig {
  name: string;
  color: string;
  def: Omit<Station, "id" | "type" | "name" | "lat" | "lng" | "radius">;
}

export const STATION_TYPES: Record<StationType, StationConfig> = {
  bts: {
    name: "BTS / eNodeB",
    color: "#00d4ff",
    def: {
      txPower: 10,
      gain: 5,
      freq: 900,
      height: 5,
      sens: -88,
      azimuth: 0,
      beamwidth: 360,
      elevation: 0,
    },
  },
  antenna: {
    name: "Antenă Radio",
    color: "#ff8c00",
    def: {
      txPower: 30,
      gain: 10,
      freq: 2400,
      height: 15,
      sens: -85,
      azimuth: 0,
      beamwidth: 65,
      elevation: 0,
    },
  },
  router: {
    name: "Router / Switch",
    color: "#00ff88",
    def: {
      txPower: 20,
      gain: 5,
      freq: 5800,
      height: 5,
      sens: -80,
      azimuth: 0,
      beamwidth: 360,
      elevation: 0,
    },
  },
  repeater: {
    name: "Repeater",
    color: "#cc00ff",
    def: {
      txPower: 37,
      gain: 12,
      freq: 1800,
      height: 20,
      sens: -88,
      azimuth: 0,
      beamwidth: 360,
      elevation: 0,
    },
  },
};

/**
 * Free-space path loss coverage radius for short-range devices (WiFi APs, routers).
 * FSPL formula: PL = 20·log10(d) + 20·log10(f) + 32.44  (d in km, f in MHz)
 * Result is capped at 0.5 km — realistic maximum for indoor/campus equipment.
 */
export function freeSpaceRadius(
  station: Pick<Station, "txPower" | "gain" | "freq" | "sens">,
): number {
  const eirp = station.txPower + station.gain;
  const maxPathLoss = eirp - station.sens;
  const freqMHz = Math.max(station.freq, 1);
  const logDistance = (maxPathLoss - 20 * Math.log10(freqMHz) - 32.44) / 20;
  return Math.min(Math.max(Math.pow(10, logDistance), 0.01), 0.5);
}

/**
 * Okumura-Hata model (urban, small/medium city)
 * Returns coverage radius in km
 */
export function okumuraHataSlope(height: number): number {
  return 44.9 - 6.55 * Math.log10(Math.max(height, 5));
}

export function okumuraHata(
  station: Pick<Station, "txPower" | "gain" | "freq" | "height" | "sens">,
): number {
  const freq = Math.max(station.freq, 150); // MHz
  const baseHeight = Math.max(station.height, 5); // base station height m
  const mobileHeight = 1.5; // mobile height m
  const eirp = station.txPower + station.gain;
  const maxPathLoss = eirp - station.sens;

  const mobileHeightFactor =
    (1.1 * Math.log10(freq) - 0.7) * mobileHeight -
    (1.56 * Math.log10(freq) - 0.8);
  const slope = okumuraHataSlope(baseHeight);
  const intercept =
    69.55 +
    26.16 * Math.log10(freq) -
    13.82 * Math.log10(baseHeight) -
    mobileHeightFactor;
  const logDistance = (maxPathLoss - intercept) / slope;

  return Math.min(Math.max(Math.pow(10, logDistance), 0.05), 40);
}

/**
 * Okumura-Hata dB margin received at a specific distance from a station.
 * Positive = within coverage, negative = beyond coverage edge.
 * Used to assess how well a repeater can receive the source broadcast signal.
 */
export function okumuraHataMarginAtDistance(
  station: Pick<Station, "txPower" | "gain" | "freq" | "height" | "sens">,
  distKm: number,
): number {
  const freq = Math.max(station.freq, 150);
  const baseHeight = Math.max(station.height, 5);
  const mobileHeight = 1.5;
  const eirp = station.txPower + station.gain;
  const mobileHeightFactor =
    (1.1 * Math.log10(freq) - 0.7) * mobileHeight -
    (1.56 * Math.log10(freq) - 0.8);
  const slope = okumuraHataSlope(baseHeight);
  const intercept =
    69.55 +
    26.16 * Math.log10(freq) -
    13.82 * Math.log10(baseHeight) -
    mobileHeightFactor;
  const pathLoss = intercept + slope * Math.log10(Math.max(distKm, 0.01));
  return eirp - pathLoss - station.sens; // = maxPathLoss - pathLoss
}

/** Free-space path loss between two stations (no terrain). */
export function linkBudget(station1: Station, station2: Station): LinkStats {
  const distance = haversineKm(station1.lat, station1.lng, station2.lat, station2.lng);

  if (distance < 0.001) {
    return {
      distance: 0,
      fspl: 0,
      rxPower: station1.txPower + station1.gain + station2.gain,
      margin: 99,
      ok: true,
      diffractionLoss: 0,
      losObstructed: false,
      beamMisaligned: false,
      frequencyMismatch: false,
    };
  }

  // Beam alignment check: each directional antenna must face the other station.
  const bearing1to2 = bearingBetween(
    station1.lat,
    station1.lng,
    station2.lat,
    station2.lng,
  );
  const bearing2to1 = (bearing1to2 + 180) % 360;
  const beamMisaligned =
    !isInBeam(bearing1to2, station1.azimuth, station1.beamwidth ?? 360) ||
    !isInBeam(bearing2to1, station2.azimuth, station2.beamwidth ?? 360);

  if (beamMisaligned) {
    return {
      distance,
      fspl: 0,
      rxPower: -999,
      margin: -999,
      ok: false,
      diffractionLoss: 0,
      losObstructed: false,
      beamMisaligned: true,
      frequencyMismatch: false,
    };
  }

  // Links involving a repeater use the Okumura-Hata broadcast model — the repeater
  // must be within the source's actual coverage area to receive the signal.
  // BTS↔BTS or BTS↔Antenna backhaul links use FSPL (dedicated point-to-point).
  const involvesRepeater =
    station1.type === "repeater" || station2.type === "repeater";
  if (involvesRepeater) {
    const source = station1.type === "repeater" ? station2 : station1;
    const receiver = station1.type === "repeater" ? station1 : station2;
    // okumuraHataMarginAtDistance returns: sourceEIRP - L(dist) - source.sens
    // Reverse-extract actual Okumura-Hata path loss L, then recompute margin at receiver.
    const sourceEIRP = source.txPower + source.gain;
    const sourceMarginAtDist = okumuraHataMarginAtDistance(source, distance);
    const pathLoss = sourceEIRP - source.sens - sourceMarginAtDist;
    const rxPower = sourceEIRP - pathLoss + receiver.gain;
    const margin = rxPower - receiver.sens;
    return {
      distance,
      fspl: pathLoss,
      rxPower,
      margin,
      ok: margin > 0,
      diffractionLoss: 0,
      losObstructed: false,
      beamMisaligned: false,
      frequencyMismatch: false,
    };
  }

  // FSPL uses the transmitter (station1) frequency — the signal wavelength is
  // determined by the transmitter. Flag incompatible bands (>10% relative diff).
  const frequencyMismatch =
    Math.abs(station1.freq - station2.freq) / Math.min(station1.freq, station2.freq) > 0.1;
  const freqMHz = station1.freq;
  const fspl = 20 * Math.log10(distance) + 20 * Math.log10(freqMHz) + 32.44;
  const rxPower = station1.txPower + station1.gain - fspl + station2.gain;
  const margin = rxPower - station2.sens;
  return {
    distance,
    fspl,
    rxPower,
    margin,
    ok: margin > 0,
    diffractionLoss: 0,
    losObstructed: false,
    beamMisaligned: false,
    frequencyMismatch,
  };
}

/**
 * Knife-edge diffraction loss (ITU-R P.526) for a given Fresnel-Kirchhoff
 * parameter ν.  Returns additional path loss in dB (0 when terrain is clear).
 */
export function knifeEdgeLoss(nu: number): number {
  if (nu < -0.7) return 0;
  if (nu <= 2.4) return Math.max(0, 6.02 + 9.11 * nu + 1.27 * nu * nu);
  return 12.953 + 20 * Math.log10(nu);
}

/**
 * Generate N evenly-spaced sample points along the path between two stations
 * (excluding the endpoints themselves).
 * N = max(20, 4 samples/km) so short links still get decent coverage.
 */
export function linkSamplePoints(
  s1: Station,
  s2: Station,
): { lat: number; lng: number }[] {
  const distKm = haversineKm(s1.lat, s1.lng, s2.lat, s2.lng);
  const sampleCount = Math.max(20, Math.ceil(distKm * 4));
  const points: { lat: number; lng: number }[] = [];
  for (let i = 1; i <= sampleCount; i++) {
    const pathFraction = i / (sampleCount + 1);
    points.push({
      lat: s1.lat + pathFraction * (s2.lat - s1.lat),
      lng: s1.lng + pathFraction * (s2.lng - s1.lng),
    });
  }
  return points;
}

/**
 * Terrain-aware link budget with optional building obstruction.
 *
 * Applies single knife-edge diffraction at the worst obstruction found along
 * the path profile (ITU-R P.526 method). Buildings are treated as additional
 * height on top of terrain at each sample point.
 *
 * @param pathElevations      Terrain AMSL (m) at each point from linkSamplePoints.
 * @param pathBuildingHeights Building height above terrain (m) at the same points.
 *                            Omit or pass [] to disable building LOS checks.
 */
export function terrainLinkBudget(
  station1: Station,
  station2: Station,
  pathElevations: number[],
  pathBuildingHeights: number[] = [],
): LinkStats {
  const base = linkBudget(station1, station2);
  // Short-circuit: co-located stations, no terrain data, or beam not pointed at target
  if (
    base.distance < 0.001 ||
    pathElevations.length === 0 ||
    base.beamMisaligned
  )
    return base;

  const elevationSampleCount = pathElevations.length;
  const txAntennaMsl = station1.elevation + station1.height; // antenna tip AMSL (m)
  const rxAntennaMsl = station2.elevation + station2.height;
  const distKm = base.distance;
  const freqMHz = station1.freq; // Fresnel radius uses transmitter wavelength
  const lambdaKm = 300 / freqMHz; // wavelength in km

  let worstFresnelNumber = -Infinity;
  let obstructed = false;

  for (let i = 0; i < elevationSampleCount; i++) {
    const pathFraction = (i + 1) / (elevationSampleCount + 1);
    const distFromTx = pathFraction * distKm;
    const distFromRx = (1 - pathFraction) * distKm;
    const losElevation =
      txAntennaMsl + pathFraction * (rxAntennaMsl - txAntennaMsl); // LOS height at this point (m AMSL)
    const buildingH = pathBuildingHeights[i] ?? 0;
    const obstacleMsl = pathElevations[i] + buildingH; // terrain + building top
    const clearanceM = obstacleMsl - losElevation; // >0 means obstacle above LOS

    const fresnelNumber =
      (clearanceM / 1000) *
      Math.sqrt(
        (2 * (distFromTx + distFromRx)) / (lambdaKm * distFromTx * distFromRx),
      );
    if (fresnelNumber > worstFresnelNumber) {
      worstFresnelNumber = fresnelNumber;
      if (clearanceM > 0) obstructed = true;
    }
  }

  const diffractionLoss = knifeEdgeLoss(worstFresnelNumber);
  const totalLoss = base.fspl + diffractionLoss;
  const rxPower = station1.txPower + station1.gain - totalLoss + station2.gain;
  const margin = rxPower - station2.sens;

  return {
    distance: base.distance,
    fspl: base.fspl,
    rxPower,
    margin,
    ok: margin > 0,
    diffractionLoss: Math.round(diffractionLoss * 10) / 10,
    losObstructed: obstructed,
    beamMisaligned: false,
    frequencyMismatch: base.frequencyMismatch,
  };
}

export function calcEIRP(station: Station): number {
  return station.txPower + station.gain;
}

export function calcCoverageArea(radius: number): number {
  return Math.PI * radius * radius;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadius = 6371;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLng = ((lng2 - lng1) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(deltaLng / 2) ** 2;
  return (
    earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function stationsInterfere(
  stationA: Station,
  stationB: Station,
): boolean {
  if (stationA.type !== stationB.type) return false;
  // Stations on incompatible frequency bands cannot cause co-channel interference.
  // Same threshold as frequencyMismatch: >10% relative difference = different band.
  const freqRatio =
    Math.abs(stationA.freq - stationB.freq) /
    Math.min(stationA.freq, stationB.freq);
  if (freqRatio > 0.1) return false;
  const distance = haversineKm(
    stationA.lat,
    stationA.lng,
    stationB.lat,
    stationB.lng,
  );
  return distance < stationA.radius + stationB.radius;
}

/**
 * Returns the [lat, lng] point that is distKm away from [lat, lng] in the
 * given bearing (degrees, 0=north, clockwise).
 */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distKm: number,
): [number, number] {
  const R = 6371;
  const d = distKm / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

/** Compass bearing (0–360°) from point A to point B. */
export function bearingBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Returns true when `targetBearing` falls inside the antenna beam centred on
 * `azimuth` with half-angle `beamwidth/2`.  Omni antennas (beamwidth ≥ 355°)
 * always return true.
 */
export function isInBeam(
  targetBearing: number,
  azimuth: number,
  beamwidth: number,
): boolean {
  if ((beamwidth ?? 360) >= 355) return true;
  let diff = (((targetBearing - azimuth) % 360) + 360) % 360;
  if (diff > 180) diff -= 360;
  return Math.abs(diff) <= beamwidth / 2;
}

const MARGIN_STOPS = [0, 5, 10, 20, 30] as const; // dB margin thresholds
// Maximum-resolution coverage grid: 360 bearings × 80 samples = 28 800 samples.
// Combined with line-of-sight bisection at the obstruction edge this gives
// ~1 m radial precision near the antenna and ~12 m at 1 km radius.
export const COVERAGE_BEARINGS = 360; // directions (every 1°)
export const COVERAGE_SAMPLES = 80; // samples per direction

/**
 * Returns true when bearingDeg falls within the antenna sector defined by
 * azimuth ± beamwidth/2.  Handles 360°-wraparound correctly.
 */
function bearingInSector(
  bearingDeg: number,
  azimuth: number,
  beamwidth: number,
): boolean {
  if (beamwidth >= 355) return true; // omnidirectional
  let diff = (((bearingDeg - azimuth) % 360) + 360) % 360;
  if (diff > 180) diff -= 360;
  return Math.abs(diff) <= beamwidth / 2;
}

/**
 * Build N sample points along a given bearing from the station up to maxKm.
 */
function samplePoints(
  lat: number,
  lng: number,
  bearingDeg: number,
  maxKm: number,
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 1; i <= COVERAGE_SAMPLES; i++) {
    points.push(
      destinationPoint(lat, lng, bearingDeg, (i / COVERAGE_SAMPLES) * maxKm),
    );
  }
  return points;
}

/**
 * Line-of-sight + obstruction analysis for one bearing.
 *
 * Inputs (all paralel arrays of length COVERAGE_SAMPLES, ordered nearest-to-farthest):
 *  - `terrainSamples[i]` — terrain MSL elevation at sample i (m)
 *  - `buildingHeights[i]` — building height ABOVE terrain at sample i (m, 0 if outside any footprint)
 *
 * Obstacle MSL = `terrainSamples[i] + buildingHeights[i]`.
 * LOS at fraction f along the ray = `antennaMSL + f · (rxMSL − antennaMSL)`.
 * A sample is blocked iff `obstacleMSL > losElevation`.
 *
 * When an obstruction is found at sample `i`, an adaptive bisection runs between
 * the previous-clear sample (or station origin if i=0) and sample `i`, performing
 * 6 iterations of linear interpolation on terrain & building height. This places
 * the obstruction edge with ≈1–2 m precision without any extra terrain fetches.
 */
function analyseBearing(
  groundElevationAtStation: number,
  antennaHeightAgl: number,
  terrainSamples: number[],
  buildingHeights: number[],
  flatRadiusKm: number,
): { obstructedAtKm: number | null; effectiveHeight: number } {
  const sampleCount = terrainSamples.length;
  const antennaMsl = groundElevationAtStation + antennaHeightAgl;

  if (sampleCount === 0) {
    return {
      obstructedAtKm: null,
      effectiveHeight: Math.max(antennaHeightAgl, 5),
    };
  }

  const receiverMsl = terrainSamples[sampleCount - 1] + 1.5;

  // Virtual "previous clear" point at the station origin.
  let prevF = 0;
  let prevTerrain = groundElevationAtStation;
  let prevBuilding = 0;

  for (let i = 0; i < sampleCount; i++) {
    const f = (i + 1) / sampleCount;
    const losMsl = antennaMsl + f * (receiverMsl - antennaMsl);
    const terrain = terrainSamples[i];
    const building = buildingHeights[i] ?? 0;
    const obstacleMsl = terrain + building;

    if (obstacleMsl > losMsl) {
      let lowF = prevF;
      let lowTerrain = prevTerrain;
      let lowBuilding = prevBuilding;
      let highF = f;
      let highTerrain = terrain;
      let highBuilding = building;

      for (let iter = 0; iter < 6; iter++) {
        const midF = (lowF + highF) / 2;
        const span = highF - lowF || 1;
        const blend = (midF - lowF) / span;
        const midTerrain = lowTerrain + blend * (highTerrain - lowTerrain);
        const midBuilding = lowBuilding + blend * (highBuilding - lowBuilding);
        const midObstacle = midTerrain + midBuilding;
        const midLos = antennaMsl + midF * (receiverMsl - antennaMsl);
        if (midObstacle > midLos) {
          highF = midF;
          highTerrain = midTerrain;
          highBuilding = midBuilding;
        } else {
          lowF = midF;
          lowTerrain = midTerrain;
          lowBuilding = midBuilding;
        }
      }

      const obstructedAtKm = Math.max(lowF * flatRadiusKm, 0.001);
      return { obstructedAtKm, effectiveHeight: 5 };
    }

    prevF = f;
    prevTerrain = terrain;
    prevBuilding = building;
  }

  const effectiveHeight = antennaMsl - terrainSamples[0];
  return {
    obstructedAtKm: null,
    effectiveHeight: Math.max(effectiveHeight, 5),
  };
}

/**
 * Circular median filter — replaces each radius with the median of a 2·k+1
 * window around it (wrap-around). Robust to single-bearing spikes/dropouts
 * (gaps from buildings, noisy elevation pixels) without rounding off real
 * concave shapes the way mean smoothing does.
 */
function medianCircular(values: number[], windowSize = 2): number[] {
  if (values.length === 0 || windowSize <= 0) return values;
  const result: number[] = new Array(values.length).fill(0);
  const buf: number[] = new Array(2 * windowSize + 1);
  for (let i = 0; i < values.length; i++) {
    for (let k = -windowSize; k <= windowSize; k++) {
      const idx = (i + k + values.length) % values.length;
      buf[k + windowSize] = values[idx];
    }
    buf.sort((a, b) => a - b);
    result[i] = buf[windowSize];
  }
  return result;
}

/** Linear (non-wrap) median filter for sectorial / non-omni patterns. */
function medianLinear(values: number[], windowSize = 2): number[] {
  if (values.length === 0 || windowSize <= 0) return values;
  const result: number[] = new Array(values.length).fill(0);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    buf.length = 0;
    for (let k = -windowSize; k <= windowSize; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= values.length) continue;
      buf.push(values[idx]);
    }
    buf.sort((a, b) => a - b);
    result[i] = buf[Math.floor(buf.length / 2)];
  }
  return result;
}

function clampCircularDelta(
  values: number[],
  maxDeltaKm: number,
  passes = 2,
): number[] {
  if (values.length < 3 || maxDeltaKm <= 0) return values;
  let result = [...values];
  for (let pass = 0; pass < passes; pass++) {
    const next = [...result];
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const curr = result[i];
      const delta = curr - prev;
      if (delta > maxDeltaKm) next[i] = prev + maxDeltaKm;
      else if (delta < -maxDeltaKm) next[i] = prev - maxDeltaKm;
    }
    result = next;
  }
  return result;
}

function clampLinearDelta(
  values: number[],
  maxDeltaKm: number,
  passes = 2,
): number[] {
  if (values.length < 3 || maxDeltaKm <= 0) return values;
  let result = [...values];
  for (let pass = 0; pass < passes; pass++) {
    const forward = [...result];
    for (let i = 1; i < result.length; i++) {
      const prev = forward[i - 1];
      const curr = forward[i];
      const delta = curr - prev;
      if (delta > maxDeltaKm) forward[i] = prev + maxDeltaKm;
      else if (delta < -maxDeltaKm) forward[i] = prev - maxDeltaKm;
    }

    const backward = [...forward];
    for (let i = backward.length - 2; i >= 0; i--) {
      const next = backward[i + 1];
      const curr = backward[i];
      const delta = curr - next;
      if (delta > maxDeltaKm) backward[i] = next + maxDeltaKm;
      else if (delta < -maxDeltaKm) backward[i] = next - maxDeltaKm;
    }
    result = backward;
  }
  return result;
}

function removeRadiusOutliers(
  values: number[],
  maxMultiplier = 2.2,
  minJumpKm = 0.06,
  circular = true,
): number[] {
  if (values.length < 3) return values;
  const filtered = [...values];
  for (let i = 0; i < values.length; i++) {
    const leftIndex = circular
      ? (i - 1 + values.length) % values.length
      : Math.max(0, i - 1);
    const rightIndex = circular
      ? (i + 1) % values.length
      : Math.min(values.length - 1, i + 1);
    const neighborAvg = (values[leftIndex] + values[rightIndex]) / 2;
    const curr = values[i];
    if (
      curr > neighborAvg * maxMultiplier &&
      curr - neighborAvg > minJumpKm
    ) {
      filtered[i] = neighborAvg;
    }
  }
  return filtered;
}

export interface CoverageRawDiagnostics {
  /** Total terrain samples used (== COVERAGE_BEARINGS · COVERAGE_SAMPLES). */
  samplesUsed: number;
  /** Number of bearings inside the antenna sector that hit a real obstruction. */
  obstructedBearings: number;
  /** Total bearings inside the antenna sector (denominator for ratios). */
  totalBearings: number;
  /** Mean obstruction distance across obstructed bearings (km), null when none. */
  meanObstructionKm: number | null;
}

/**
 * Per-bearing diagnostic data emitted alongside the coverage polygons.
 * Used by the client diagnostic ray overlay to render a 360-line "x-ray" view
 * proving the LOS computation matches the rendered polygon.
 */
export interface BearingDiagnostic {
  bearingDeg: number;
  /** Distance along bearing where line-of-sight was blocked (km), null = clear. */
  obstructedAtKm: number | null;
  /** Raw 0 dB radius used for this bearing BEFORE polygon smoothing (km). */
  effectiveRadiusKm: number;
  /** Tip of the ray (visible coverage edge along this bearing). */
  edgeLat: number;
  edgeLng: number;
  /** Building height (m) at the obstructing sample (0 when clear or terrain-only). */
  edgeBuildingHeight: number;
  /** Terrain MSL (m) at the obstructing sample (or farthest sample when clear). */
  edgeTerrainElevation: number;
}

export interface TerrainCoverageResult {
  polygons: CoveragePolygons;
  diagnostics: CoverageRawDiagnostics;
  bearings: BearingDiagnostic[];
}

/**
 * Compute terrain + building-aware coverage polygons for a station.
 *
 * @param station            Station with `elevation` populated (ground MSL at
 *                           station, optionally already adjusted for rooftop
 *                           placement upstream).
 * @param terrainElevations  Row-major flat array of TERRAIN MSL (m) for each
 *                           sample point: `[bearing * SAMPLES + sample]`.
 * @param buildingHeights    Parallel array of building height ABOVE terrain (m)
 *                           at the same sample points (0 outside any footprint).
 *                           Pass an all-zero array to disable building LOS.
 */
export function terrainCoveragePolygon(
  station: Station,
  terrainElevations: number[],
  buildingHeights: number[],
): TerrainCoverageResult {
  const flatRadiusKm = station.radius;
  const beamwidthDeg = station.beamwidth ?? 360;
  const isOmnidirectional = beamwidthDeg >= 355;
  const antennaHeightAgl = station.height;
  const groundElevation = station.elevation;

  const polygons = MARGIN_STOPS.map(
    () => [] as [number, number][],
  ) as unknown as CoveragePolygons;

  // Pre-compute LOS analysis once per bearing (independent of margin band).
  const bearingDegs: number[] = [];
  const bearingIndices: number[] = [];
  const obstructedAtKmList: (number | null)[] = [];
  const effectiveHeightList: number[] = [];

  // For directional antennas, start iteration from the LEFT edge of the sector
  // so bearings are pushed in angular order (left-edge → right-edge).
  // Without this, a sector straddling 0°/360° (e.g. azimuth=0, bw=65°) would
  // push bearings 0…32 first and 328…359 last, creating a self-intersecting
  // polygon (split into thin disconnected slivers).
  // Omni antennas always start from index 0 — order is irrelevant for circles.
  const iterStart = isOmnidirectional
    ? 0
    : Math.round((((station.azimuth - beamwidthDeg / 2) % 360) + 360) % 360);

  for (
    let i = 0;
    i < COVERAGE_BEARINGS;
    i++
  ) {
    const bearingIndex = (iterStart + i) % COVERAGE_BEARINGS;
    const bearingDeg = bearingIndex * (360 / COVERAGE_BEARINGS);
    if (!bearingInSector(bearingDeg, station.azimuth, beamwidthDeg)) continue;

    const sliceStart = bearingIndex * COVERAGE_SAMPLES;
    const sliceEnd = sliceStart + COVERAGE_SAMPLES;
    const terrainSamples = terrainElevations.slice(sliceStart, sliceEnd);
    const heightSamples = buildingHeights.slice(sliceStart, sliceEnd);

    const { obstructedAtKm, effectiveHeight } = analyseBearing(
      groundElevation,
      antennaHeightAgl,
      terrainSamples,
      heightSamples,
      flatRadiusKm,
    );

    bearingDegs.push(bearingDeg);
    bearingIndices.push(bearingIndex);
    obstructedAtKmList.push(obstructedAtKm);
    effectiveHeightList.push(effectiveHeight);
  }

  // Per-bearing raw 0 dB radius (used for diagnostic rays — pre-smoothing).
  const rawEffectiveRadiusKm: number[] = new Array(bearingDegs.length);
  for (let i = 0; i < bearingDegs.length; i++) {
    const obstructedAtKm = obstructedAtKmList[i];
    const effectiveHeight = effectiveHeightList[i];
    rawEffectiveRadiusKm[i] =
      obstructedAtKm !== null
        ? obstructedAtKm
        : Math.min(
            okumuraHata({ ...station, height: effectiveHeight }),
            flatRadiusKm,
          );
  }

  // Per-bearing smoothing thresholds tuned for the 1°/360-bearing grid.
  const maxNeighborJumpKm = Math.max(flatRadiusKm * 0.04, 0.02);
  const outlierJumpKm = Math.max(flatRadiusKm * 0.12, 0.03);

  for (let marginIndex = 0; marginIndex < MARGIN_STOPS.length; marginIndex++) {
    const ring: [number, number][] = [];

    if (!isOmnidirectional) {
      ring.push([station.lat, station.lng]);
    }

    const perBearingRadius: number[] = [];

    for (let i = 0; i < bearingDegs.length; i++) {
      const obstructedAtKm = obstructedAtKmList[i];
      const effectiveHeight = effectiveHeightList[i];

      const effectiveRadiusKm =
        obstructedAtKm !== null
          ? obstructedAtKm
          : Math.min(
              okumuraHata({ ...station, height: effectiveHeight }),
              flatRadiusKm,
            );
      const marginDb = MARGIN_STOPS[marginIndex];
      const coverageRadiusKm =
        marginDb === 0
          ? effectiveRadiusKm
          : effectiveRadiusKm *
            Math.pow(10, -marginDb / okumuraHataSlope(effectiveHeight));

      perBearingRadius.push(coverageRadiusKm);
    }

    // Median filter is the primary spike remover (robust to single-bearing
    // dropouts caused by buildings on a 1° resolution grid).
    const outlierCleaned = removeRadiusOutliers(
      perBearingRadius,
      2.0,
      outlierJumpKm,
      isOmnidirectional,
    );
    const medianFiltered = isOmnidirectional
      ? medianCircular(outlierCleaned, 2)
      : medianLinear(outlierCleaned, 2);
    const stabilizedRadius = isOmnidirectional
      ? clampCircularDelta(medianFiltered, maxNeighborJumpKm, 3)
      : clampLinearDelta(medianFiltered, maxNeighborJumpKm, 3);

    for (let i = 0; i < stabilizedRadius.length; i++) {
      ring.push(
        destinationPoint(
          station.lat,
          station.lng,
          bearingDegs[i],
          stabilizedRadius[i],
        ),
      );
    }

    if (!isOmnidirectional) {
      ring.push([station.lat, station.lng]);
    }

    polygons[marginIndex] = ring;
  }

  let obstructedBearings = 0;
  let obstructionSumKm = 0;
  for (const d of obstructedAtKmList) {
    if (d !== null) {
      obstructedBearings++;
      obstructionSumKm += d;
    }
  }

  const diagnostics: CoverageRawDiagnostics = {
    samplesUsed: COVERAGE_BEARINGS * COVERAGE_SAMPLES,
    obstructedBearings,
    totalBearings: bearingDegs.length,
    meanObstructionKm:
      obstructedBearings > 0
        ? obstructionSumKm / obstructedBearings
        : null,
  };

  // Build per-bearing diagnostic objects (used by the client ray overlay).
  const bearings: BearingDiagnostic[] = new Array(bearingDegs.length);
  for (let i = 0; i < bearingDegs.length; i++) {
    const bearingDeg = bearingDegs[i];
    const bearingIndex = bearingIndices[i];
    const obstructedAtKm = obstructedAtKmList[i];
    const effectiveRadiusKm = rawEffectiveRadiusKm[i];

    // Identify the sample at (or just past) the obstruction edge so we can
    // surface the building height + terrain elevation that caused the block.
    const sliceStart = bearingIndex * COVERAGE_SAMPLES;
    const farSampleIdx = COVERAGE_SAMPLES - 1;
    let edgeSampleIdx: number;
    if (obstructedAtKm !== null && flatRadiusKm > 0) {
      const fraction = obstructedAtKm / flatRadiusKm;
      edgeSampleIdx = Math.min(
        farSampleIdx,
        Math.max(0, Math.floor(fraction * COVERAGE_SAMPLES)),
      );
    } else {
      edgeSampleIdx = farSampleIdx;
    }
    const sampleAbsIdx = sliceStart + edgeSampleIdx;

    const [edgeLat, edgeLng] = destinationPoint(
      station.lat,
      station.lng,
      bearingDeg,
      effectiveRadiusKm,
    );

    bearings[i] = {
      bearingDeg,
      obstructedAtKm,
      effectiveRadiusKm,
      edgeLat,
      edgeLng,
      edgeBuildingHeight:
        obstructedAtKm !== null ? buildingHeights[sampleAbsIdx] ?? 0 : 0,
      edgeTerrainElevation: terrainElevations[sampleAbsIdx] ?? 0,
    };
  }

  return { polygons, diagnostics, bearings };
}

/**
 * Returns the flat array of sample points needed for terrainCoveragePolygon.
 * Call fetchElevations() on this list, then pass the result to terrainCoveragePolygon.
 */
export function coverageSamplePoints(
  station: Station,
): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  for (let bearingIndex = 0; bearingIndex < COVERAGE_BEARINGS; bearingIndex++) {
    const bearingDeg = bearingIndex * (360 / COVERAGE_BEARINGS);
    for (const [lat, lng] of samplePoints(
      station.lat,
      station.lng,
      bearingDeg,
      station.radius,
    )) {
      points.push({ lat, lng });
    }
  }
  return points;
}
