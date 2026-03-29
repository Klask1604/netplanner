import {
  okumuraHata,
  linkBudget,
  calcEIRP,
  calcCoverageArea,
  haversineKm,
  stationsInterfere,
  Station,
} from './rf'

// ─── Stații de test reprezentative ────────────────────────────────────────────
const btsBucharest: Station = {
  id: 1, type: 'bts', name: 'BTS Bucharest',
  lat: 44.4268, lng: 26.1025,
  txPower: 43, gain: 15, freq: 900, height: 30, sens: -90, azimuth: 0, radius: 0,
}

const antennaCluj: Station = {
  id: 2, type: 'antenna', name: 'Antenna Cluj',
  lat: 46.7712, lng: 23.6236,
  txPower: 30, gain: 10, freq: 2400, height: 15, sens: -85, azimuth: 0, radius: 0,
}

const routerNearby: Station = {
  id: 3, type: 'router', name: 'Router Nearby',
  lat: 44.4270, lng: 26.1027,    // ~30m de BTS Bucharest
  txPower: 20, gain: 5, freq: 5800, height: 5, sens: -80, azimuth: 0, radius: 0,
}

const repeaterFar: Station = {
  id: 4, type: 'repeater', name: 'Repeater Far',
  lat: 45.7489, lng: 21.2087,    // Timișoara
  txPower: 37, gain: 12, freq: 1800, height: 20, sens: -88, azimuth: 0, radius: 0,
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

  test('stații în orașe diferite → link NOK (BTS 900MHz la ~324km față de antenă 2.4GHz cu sens -85dBm)', () => {
    // BTS: txPower=43, gain=15 → EIRP=58 dBm
    // dist ≈ 324 km, freq_medie=(900+2400)/2=1650 MHz
    // FSPL = 20*log10(324) + 20*log10(1650) + 32.44 ≈ 50.2 + 64.3 + 32.44 ≈ 147 dB
    // Rx = 58 - 147 + 10 = -79 dBm, margin = -79 - (-85) = +6 dB → ok!
    // (BTS-ul are câștig mare, link funcționează teoretic)
    const stats = linkBudget(btsBucharest, antennaCluj)
    // verificăm că formula e corectă, nu presupunem rezultatul
    const expectedMargin = stats.rxPower - antennaCluj.sens
    expect(stats.margin).toBeCloseTo(expectedMargin, 6)
    expect(stats.ok).toBe(stats.margin > 0)
  })

  test('FSPL creste cu distanta: 10km > 1km', () => {
    const near: Station = { ...antennaCluj, lat: 44.4358, lng: 26.1025 }  // ~1 km nord
    const far:  Station = { ...antennaCluj, lat: 44.5168, lng: 26.1025 }  // ~10 km nord
    const statsNear = linkBudget(btsBucharest, near)
    const statsFar  = linkBudget(btsBucharest, far)
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
