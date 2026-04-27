import {
  okumuraHata,
  linkBudget,
  calcEIRP,
  calcCoverageArea,
  haversineKm,
  stationsInterfere,
  terrainCoveragePolygon,
  COVERAGE_BEARINGS,
  COVERAGE_SAMPLES,
  Station,
} from './rf'

// ─── Stații de test reprezentative ────────────────────────────────────────────
const btsBucharest: Station = {
  id: 1, type: 'bts', name: 'BTS Bucharest',
  lat: 44.4268, lng: 26.1025,
  txPower: 43, gain: 15, freq: 900, height: 30, sens: -90, azimuth: 0, beamwidth: 360, radius: 0, elevation: 0,
}

const antennaCluj: Station = {
  id: 2, type: 'antenna', name: 'Antenna Cluj',
  lat: 46.7712, lng: 23.6236,
  txPower: 30, gain: 10, freq: 2400, height: 15, sens: -85, azimuth: 0, beamwidth: 65, radius: 0, elevation: 0,
}

const routerNearby: Station = {
  id: 3, type: 'router', name: 'Router Nearby',
  lat: 44.4270, lng: 26.1027,    // ~30m de BTS Bucharest
  txPower: 20, gain: 5, freq: 5800, height: 5, sens: -80, azimuth: 0, beamwidth: 360, radius: 0, elevation: 0,
}

const repeaterFar: Station = {
  id: 4, type: 'repeater', name: 'Repeater Far',
  lat: 45.7489, lng: 21.2087,    // Timișoara
  txPower: 37, gain: 12, freq: 1800, height: 20, sens: -88, azimuth: 0, beamwidth: 360, radius: 0, elevation: 0,
}

// ─── calcEIRP ─────────────────────────────────────────────────────────────────

describe('calcEIRP', () => {
  test('BTS: 43 dBm TX + 15 dBi gain = 58 dBm EIRP', () => {
    expect(calcEIRP(btsBucharest)).toBe(58)
  })

  test('Router: 20 dBm TX + 5 dBi gain = 25 dBm EIRP', () => {
    expect(calcEIRP(routerNearby)).toBe(25)
  })

  test('EIRP este suma simpla txPower + gain', () => {
    const s = { ...btsBucharest, txPower: 10, gain: 3 }
    expect(calcEIRP(s)).toBe(13)
  })
})

// ─── calcCoverageArea ─────────────────────────────────────────────────────────

describe('calcCoverageArea', () => {
  test('radius 1 km → π km²', () => {
    expect(calcCoverageArea(1)).toBeCloseTo(Math.PI, 10)
  })

  test('radius 0 → 0 km²', () => {
    expect(calcCoverageArea(0)).toBe(0)
  })

  test('radius 5 km → 25π ≈ 78.54 km²', () => {
    expect(calcCoverageArea(5)).toBeCloseTo(78.5398, 2)
  })
})

// ─── haversineKm ──────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  test('distanță zero pentru același punct', () => {
    expect(haversineKm(44.4268, 26.1025, 44.4268, 26.1025)).toBe(0)
  })

  test('Bucharest → Cluj ≈ 324 km (toleranță ±5 km)', () => {
    const dist = haversineKm(44.4268, 26.1025, 46.7712, 23.6236)
    expect(dist).toBeGreaterThan(310)
    expect(dist).toBeLessThan(340)
  })

  test('Bucharest → Timișoara ≈ 411 km (toleranță ±15 km)', () => {
    const dist = haversineKm(44.4268, 26.1025, 45.7489, 21.2087)
    expect(dist).toBeGreaterThan(395)
    expect(dist).toBeLessThan(430)
  })

  test('este simetric: dist(A,B) === dist(B,A)', () => {
    const d1 = haversineKm(44.4268, 26.1025, 46.7712, 23.6236)
    const d2 = haversineKm(46.7712, 23.6236, 44.4268, 26.1025)
    expect(d1).toBeCloseTo(d2, 6)
  })
})

// ─── okumuraHata ──────────────────────────────────────────────────────────────

describe('okumuraHata', () => {
  test('BTS 900 MHz returnează un radius pozitiv', () => {
    const r = okumuraHata(btsBucharest)
    expect(r).toBeGreaterThan(0)
  })

  test('BTS 900 MHz: radius realist între 1 și 40 km', () => {
    const r = okumuraHata(btsBucharest)
    expect(r).toBeGreaterThan(1)
    expect(r).toBeLessThanOrEqual(40)
  })

  test('putere mai mare → acoperire mai mare', () => {
    const rLow  = okumuraHata({ ...btsBucharest, txPower: 30 })
    const rHigh = okumuraHata({ ...btsBucharest, txPower: 43 })
    expect(rHigh).toBeGreaterThan(rLow)
  })

  test('frecvență mai mare → acoperire mai mică (atenuare mai mare)', () => {
    const r900  = okumuraHata({ ...btsBucharest, freq: 900  })
    const r1800 = okumuraHata({ ...btsBucharest, freq: 1800 })
    expect(r900).toBeGreaterThan(r1800)
  })

  test('înălțime mai mare → acoperire mai mare', () => {
    const rLow  = okumuraHata({ ...btsBucharest, height: 10 })
    const rHigh = okumuraHata({ ...btsBucharest, height: 50 })
    expect(rHigh).toBeGreaterThan(rLow)
  })

  test('rezultatul este clamped la [0.05, 40] km', () => {
    // parametri extremi care ar da un radius absurd
    const rMin = okumuraHata({ txPower: -99, gain: 0, freq: 900, height: 5, sens: 0 })
    const rMax = okumuraHata({ txPower: 99, gain: 99, freq: 150, height: 500, sens: -200 })
    expect(rMin).toBeCloseTo(0.05, 5)
    expect(rMax).toBeCloseTo(40, 5)
  })

  test('verificare calcul manual pentru BTS default', () => {
    // freq=900, baseHeight=30, mobileHeight=1.5, EIRP=58, maxPL=148
    // mhf = (1.1*log10(900)-0.7)*1.5 - (1.56*log10(900)-0.8)
    // slope = 44.9 - 6.55*log10(30) ≈ 35.22
    // K = 69.55 + 26.16*log10(900) - 13.82*log10(30) - mhf
    // logD = (148 - K) / slope
    // radius = 10^logD  (rezultat real ≈ 4.1 km)
    const freq = 900, hb = 30, hm = 1.5
    const eirp = 43 + 15  // 58
    const maxPL = eirp - (-90)  // 148
    const mhf = (1.1 * Math.log10(freq) - 0.7) * hm - (1.56 * Math.log10(freq) - 0.8)
    const slope = 44.9 - 6.55 * Math.log10(hb)
    const K = 69.55 + 26.16 * Math.log10(freq) - 13.82 * Math.log10(hb) - mhf
    const logD = (maxPL - K) / slope
    const expected = Math.pow(10, logD)

    const r = okumuraHata(btsBucharest)
    expect(r).toBeCloseTo(expected, 6)
  })
})

// ─── linkBudget ───────────────────────────────────────────────────────────────

describe('linkBudget', () => {
  test('stații identice (distanță 0) → margin 99, ok true', () => {
    const stats = linkBudget(btsBucharest, btsBucharest)
    expect(stats.distance).toBe(0)
    expect(stats.margin).toBe(99)
    expect(stats.ok).toBe(true)
  })

  test('stații foarte apropiate → distanță mică, FSPL mică, link ok', () => {
    const stats = linkBudget(btsBucharest, routerNearby)
    expect(stats.distance).toBeLessThan(0.1)   // sub 100 m
    expect(stats.ok).toBe(true)
  })

  test('stații în orașe diferite → margin/rx respectă contractul când beam-ul e aliniat', () => {
    // BTS: txPower=43, gain=15 → EIRP=58 dBm, freq=900 MHz (transmitter freq)
    // dist ≈ 324 km, FSPL = 20*log10(324) + 20*log10(900) + 32.44 ≈ 50.2 + 59.1 + 32.44 ≈ 141.7 dB
    // Rx = 58 - 141.7 + 10 = -73.7 dBm, margin = -73.7 - (-85) = +11.3 dB → ok!
    const alignedAntenna = { ...antennaCluj, beamwidth: 360, azimuth: 0 }
    const stats = linkBudget(btsBucharest, alignedAntenna)
    // contractual check: margin === rxPower - sens, ok === margin > 0
    const expectedMargin = stats.rxPower - alignedAntenna.sens
    expect(stats.margin).toBeCloseTo(expectedMargin, 6)
    expect(stats.ok).toBe(stats.margin > 0)
    // frequency mismatch flag: 900 MHz vs 2400 MHz → incompatibil
    expect(stats.frequencyMismatch).toBe(true)
  })

  test('FSPL creste cu distanta: 10km > 1km', () => {
    const near: Station = { ...antennaCluj, lat: 44.4358, lng: 26.1025, beamwidth: 360 }  // ~1 km nord
    const far:  Station = { ...antennaCluj, lat: 44.5168, lng: 26.1025, beamwidth: 360 }  // ~10 km nord
    const statsNear = linkBudget(btsBucharest, near)
    const statsFar  = linkBudget(btsBucharest, far)
    expect(statsNear.beamMisaligned).toBe(false)
    expect(statsFar.beamMisaligned).toBe(false)
    expect(statsFar.fspl).toBeGreaterThan(statsNear.fspl)
  })

  test('formula FSPL: 20*log10(d) + 20*log10(f) + 32.44', () => {
    // Plasăm stația 2 exact la 1 grad lat diferență nord (~111.32 km)
    const s2: Station = { ...btsBucharest, id: 2, lat: btsBucharest.lat + 1, lng: btsBucharest.lng }
    const stats = linkBudget(btsBucharest, s2)
    const expectedFspl = 20 * Math.log10(stats.distance) + 20 * Math.log10(900) + 32.44
    expect(stats.fspl).toBeCloseTo(expectedFspl, 3)
  })

  test('rxPower = txPower + gainTX - FSPL + gainRX', () => {
    const s2: Station = { ...btsBucharest, id: 2, lat: btsBucharest.lat + 0.1, lng: btsBucharest.lng }
    const stats = linkBudget(btsBucharest, s2)
    const expected = btsBucharest.txPower + btsBucharest.gain - stats.fspl + s2.gain
    expect(stats.rxPower).toBeCloseTo(expected, 6)
  })

  test('margin = rxPower - sensibilitate receptor', () => {
    const s2: Station = { ...btsBucharest, id: 2, lat: btsBucharest.lat + 0.1, lng: btsBucharest.lng }
    const stats = linkBudget(btsBucharest, s2)
    expect(stats.margin).toBeCloseTo(stats.rxPower - s2.sens, 6)
  })

  test('ok = true când margin > 0', () => {
    const statsNear = linkBudget(btsBucharest, routerNearby)
    expect(statsNear.ok).toBe(statsNear.margin > 0)
  })

  test('frequencyMismatch = false pentru stații pe aceeași frecvență', () => {
    const s2: Station = { ...btsBucharest, id: 2, lat: btsBucharest.lat + 0.1, lng: btsBucharest.lng }
    const stats = linkBudget(btsBucharest, s2)
    expect(stats.frequencyMismatch).toBe(false)
  })

  test('frequencyMismatch = true pentru stații pe benzi foarte diferite (900 vs 5800)', () => {
    const stats = linkBudget(btsBucharest, routerNearby) // 900 MHz vs 5800 MHz
    expect(stats.frequencyMismatch).toBe(true)
  })

  test('FSPL foloseste frecventa transmitatorului (station1.freq), nu media', () => {
    const s1: Station = { ...btsBucharest, id: 1, freq: 900 }
    const s2: Station = { ...btsBucharest, id: 2, lat: btsBucharest.lat + 0.5, lng: btsBucharest.lng, freq: 5800 }
    const stats = linkBudget(s1, s2)
    // FSPL trebuie calculat cu 900 MHz (freq s1), nu cu (900+5800)/2=3350 MHz
    const expectedFspl = 20 * Math.log10(stats.distance) + 20 * Math.log10(900) + 32.44
    expect(stats.fspl).toBeCloseTo(expectedFspl, 3)
  })

  test('link cu repeater: margin calculat cu sensibilitatea receptorului (repeater)', () => {
    // BTS (source) → Repeater (receiver): margin = rxPower - repeater.sens
    const bts: Station = { ...btsBucharest, id: 10, txPower: 43, gain: 15, sens: -90 }
    const rep: Station = { ...repeaterFar, id: 11, lat: 44.43, lng: 26.11, sens: -88 } // apropiat
    const stats = linkBudget(bts, rep)
    // margin trebuie sa fie rxPower - rep.sens, NU rxPower - bts.sens
    expect(stats.margin).toBeCloseTo(stats.rxPower - rep.sens, 5)
  })
})

// ─── stationsInterfere ────────────────────────────────────────────────────────

describe('stationsInterfere', () => {
  const bts1: Station = { ...btsBucharest, id: 1, radius: 5 }
  const bts2Near: Station = { ...btsBucharest, id: 2, lat: 44.430, lng: 26.110, radius: 5 }
  const bts3Far: Station  = { ...btsBucharest, id: 3, lat: 44.500, lng: 26.200, radius: 5 }

  test('tipuri diferite nu interferează niciodată', () => {
    const router: Station = { ...routerNearby, radius: 99 }
    expect(stationsInterfere(bts1, router)).toBe(false)
  })

  test('BTS-uri la ~500m distanță cu radius 5km interferează', () => {
    expect(stationsInterfere(bts1, bts2Near)).toBe(true)
  })

  test('BTS-uri la ~10km distanță cu radius 5km nu interferează', () => {
    expect(stationsInterfere(bts1, bts3Far)).toBe(false)
  })

  test('este simetric: interfere(A,B) === interfere(B,A)', () => {
    expect(stationsInterfere(bts1, bts2Near)).toBe(stationsInterfere(bts2Near, bts1))
    expect(stationsInterfere(bts1, bts3Far)).toBe(stationsInterfere(bts3Far, bts1))
  })
})

// ─── terrainCoveragePolygon diagnostics ───────────────────────────────────────

describe('terrainCoveragePolygon', () => {
  test('returneaza diagnostics + bearings pentru grid complet', () => {
    const station: Station = {
      ...btsBucharest,
      radius: 3,
      elevation: 520,
      beamwidth: 360,
    }
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES
    const terrainElevations = Array.from({ length: totalSamples }, () => 520)
    const buildingHeights = Array.from({ length: totalSamples }, () => 0)

    const result = terrainCoveragePolygon(station, terrainElevations, buildingHeights)

    expect(result.diagnostics.samplesUsed).toBe(totalSamples)
    expect(result.diagnostics.totalBearings).toBe(COVERAGE_BEARINGS)
    expect(result.bearings).toHaveLength(COVERAGE_BEARINGS)
    expect(result.bearings[0]).toEqual(
      expect.objectContaining({
        bearingDeg: 0,
        obstructedAtKm: null,
        edgeBuildingHeight: 0,
      }),
    )
  })

  test('antena directionala azimut=0 produce polygon continuu (fara salt 32°→328°)', () => {
    // Bug anterior: bearings 0…32 erau push-ate primele, 328…359 ultimele →
    // poligon auto-intersectat vizibil ca dungi subțiri.
    const station: Station = {
      ...antennaCluj,
      azimuth: 0,
      beamwidth: 65,
      radius: 2,
      elevation: 400,
    }
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES
    const terrainElevations = Array.from({ length: totalSamples }, () => 400)
    const buildingHeights   = Array.from({ length: totalSamples }, () => 0)

    const result = terrainCoveragePolygon(station, terrainElevations, buildingHeights)

    // Bearings trebuie să fie în ordine unghiulară continuă: 328…359, 0…32
    const degs = result.bearings.map(b => b.bearingDeg)
    // Primul bearing trebuie să fie la stânga sectorului (≈328°), nu la 0°
    expect(degs[0]).toBeGreaterThan(180)
    // Ultimul bearing trebuie să fie la dreapta sectorului (≈32°)
    expect(degs[degs.length - 1]).toBeLessThan(90)
    // Nu trebuie să existe un salt de >180° între doi bearings consecutivi
    for (let i = 1; i < degs.length; i++) {
      const delta = Math.abs(degs[i] - degs[i - 1])
      const wrappedDelta = Math.min(delta, 360 - delta)
      expect(wrappedDelta).toBeLessThan(10)
    }
  })

  test('pentru statie directionala include doar bearings din sector', () => {
    const station: Station = {
      ...antennaCluj,
      azimuth: 90,
      beamwidth: 60,
      radius: 2,
      elevation: 400,
    }
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES
    const terrainElevations = Array.from({ length: totalSamples }, () => 400)
    const buildingHeights = Array.from({ length: totalSamples }, () => 0)

    const result = terrainCoveragePolygon(station, terrainElevations, buildingHeights)

    expect(result.bearings.length).toBeGreaterThan(50)
    expect(result.bearings.length).toBeLessThan(70)
    expect(result.diagnostics.totalBearings).toBe(result.bearings.length)
  })
})
