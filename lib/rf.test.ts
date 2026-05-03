import {
  okumuraHata,
  linkBudget,
  terrainLinkBudget,
  calcEIRP,
  calcCoverageArea,
  haversineKm,
  stationsInterfere,
  terrainCoveragePolygon,
  COVERAGE_BEARINGS,
  COVERAGE_SAMPLES,
  Station,
} from "./rf";

// stații de test (fixtures reutilizabile)
const btsBucharest: Station = {
  id: 1,
  type: "bts",
  name: "BTS Bucharest",
  lat: 44.4268,
  lng: 26.1025,
  txPower: 43,
  gain: 15,
  freq: 900,
  height: 30,
  sens: -90,
  azimuth: 0,
  beamwidth: 360,
  radius: 0,
  elevation: 0,
};

const antennaCluj: Station = {
  id: 2,
  type: "antenna",
  name: "Antenna Cluj",
  lat: 46.7712,
  lng: 23.6236,
  txPower: 30,
  gain: 10,
  freq: 2400,
  height: 15,
  sens: -85,
  azimuth: 0,
  beamwidth: 65,
  radius: 0,
  elevation: 0,
};

const routerNearby: Station = {
  id: 3,
  type: "router",
  name: "Router Nearby",
  lat: 44.427,
  lng: 26.1027, // la ~30 m de BTS București
  txPower: 20,
  gain: 5,
  freq: 5800,
  height: 5,
  sens: -80,
  azimuth: 0,
  beamwidth: 360,
  radius: 0,
  elevation: 0,
};

const repeaterFar: Station = {
  id: 4,
  type: "repeater",
  name: "Repeater Far",
  lat: 45.7489,
  lng: 21.2087, // Timișoara (coordonate)
  txPower: 37,
  gain: 12,
  freq: 1800,
  height: 20,
  sens: -88,
  azimuth: 0,
  beamwidth: 360,
  radius: 0,
  elevation: 0,
};

// calcEIRP: sumă txPower + gain (dBm), adică putere efectiv iradiată

describe("calcEIRP", () => {
  test("BTS: 43 dBm TX + 15 dBi gain = 58 dBm EIRP", () => {
    expect(calcEIRP(btsBucharest)).toBe(58);
  });

  test("Router: 20 dBm TX + 5 dBi gain = 25 dBm EIRP", () => {
    expect(calcEIRP(routerNearby)).toBe(25);
  });

  test("EIRP este suma simpla txPower + gain", () => {
    const s = { ...btsBucharest, txPower: 10, gain: 3 };
    expect(calcEIRP(s)).toBe(13);
  });
});

// calcCoverageArea: suprafață disc (km2)

describe("calcCoverageArea", () => {
  test("radius 1 km -> pi km2", () => {
    expect(calcCoverageArea(1)).toBeCloseTo(Math.PI, 10);
  });

  test("radius 0 -> 0 km2", () => {
    expect(calcCoverageArea(0)).toBe(0);
  });

  test("radius 5 km -> 25*pi ~ 78.54 km2", () => {
    expect(calcCoverageArea(5)).toBeCloseTo(78.5398, 2);
  });
});

// haversineKm: distanță geografică

describe("haversineKm", () => {
  test("zero distance same point", () => {
    expect(haversineKm(44.4268, 26.1025, 44.4268, 26.1025)).toBe(0);
  });

  test("Bucharest to Cluj ~324 km (tolerance +/-5 km)", () => {
    const dist = haversineKm(44.4268, 26.1025, 46.7712, 23.6236);
    expect(dist).toBeGreaterThan(310);
    expect(dist).toBeLessThan(340);
  });

  test("Bucharest to Timisoara ~411 km (tolerance +/-15 km)", () => {
    const dist = haversineKm(44.4268, 26.1025, 45.7489, 21.2087);
    expect(dist).toBeGreaterThan(395);
    expect(dist).toBeLessThan(430);
  });

  test("este simetric: dist(A,B) === dist(B,A)", () => {
    const d1 = haversineKm(44.4268, 26.1025, 46.7712, 23.6236);
    const d2 = haversineKm(46.7712, 23.6236, 44.4268, 26.1025);
    expect(d1).toBeCloseTo(d2, 6);
  });
});

// okumuraHata: rază acoperire model urban

describe("okumuraHata", () => {
  test("BTS 900 MHz returns positive radius", () => {
    const r = okumuraHata(btsBucharest);
    expect(r).toBeGreaterThan(0);
  });

  test("BTS implicit 900 MHz: rază urbană realistă (~4 km, nu doar sub plafonul 40 km)", () => {
    const r = okumuraHata(btsBucharest);
    // Cu parametrii default, Okumura-Hata dă ~3,5–5 km; prinde regresii mari, fără a lega testul de zecimale exacte
    expect(r).toBeGreaterThan(3);
    expect(r).toBeLessThan(5.5);
    expect(r).toBeLessThanOrEqual(40); // plafon din implementare (clamp)
  });

  test("higher power -> larger coverage radius", () => {
    const rLow = okumuraHata({ ...btsBucharest, txPower: 30 });
    const rHigh = okumuraHata({ ...btsBucharest, txPower: 43 });
    expect(rHigh).toBeGreaterThan(rLow);
  });

  test("higher frequency -> smaller coverage (more attenuation)", () => {
    const r900 = okumuraHata({ ...btsBucharest, freq: 900 });
    const r1800 = okumuraHata({ ...btsBucharest, freq: 1800 });
    expect(r900).toBeGreaterThan(r1800);
  });

  test("higher antenna -> larger coverage", () => {
    const rLow = okumuraHata({ ...btsBucharest, height: 10 });
    const rHigh = okumuraHata({ ...btsBucharest, height: 50 });
    expect(rHigh).toBeGreaterThan(rLow);
  });

  test("result clamped to [0.05, 40] km", () => {
    // parametri extreme care altfel ar da raze absurde; verifică marginile fixe ale clamp-ului
    const rMin = okumuraHata({
      txPower: -99,
      gain: 0,
      freq: 900,
      height: 5,
      sens: 0,
    });
    const rMax = okumuraHata({
      txPower: 99,
      gain: 99,
      freq: 150,
      height: 500,
      sens: -200,
    });
    expect(rMin).toBeCloseTo(0.05, 5);
    expect(rMax).toBeCloseTo(40, 5);
  });

  test("manual formula check for default BTS", () => {
    // freq=900, înălțime bază=30, mobil=1.5, EIRP=58, pierdere max=148
    // mhf = (1.1*log10(900)-0.7)*1.5 - (1.56*log10(900)-0.8)
    // pantă = 44.9 - 6.55*log10(30) ~ 35.22
    // K = 69.55 + 26.16*log10(900) - 13.82*log10(30) - mhf
    // logD = (148 - K) / pantă
    // rază = 10^logD (rezultat așteptat ~4,1 km)
    const freq = 900,
      hb = 30,
      hm = 1.5;
    const eirp = 43 + 15; // 58 dBm
    const maxPL = eirp - -90; // 148 dB pierdere maximă utilă
    const mhf =
      (1.1 * Math.log10(freq) - 0.7) * hm - (1.56 * Math.log10(freq) - 0.8);
    const slope = 44.9 - 6.55 * Math.log10(hb);
    const K = 69.55 + 26.16 * Math.log10(freq) - 13.82 * Math.log10(hb) - mhf;
    const logD = (maxPL - K) / slope;
    const expected = Math.pow(10, logD);

    const r = okumuraHata(btsBucharest);
    expect(r).toBeCloseTo(expected, 6);
  });
});

// linkBudget: bilanț legătură (FSPL / repeater)

describe("linkBudget", () => {
  test("identical stations (distance 0) -> margin 99, ok true", () => {
    const stats = linkBudget(btsBucharest, btsBucharest);
    expect(stats.distance).toBe(0);
    expect(stats.margin).toBe(99);
    expect(stats.ok).toBe(true);
  });

  test("very close stations -> small distance, low FSPL, link ok", () => {
    const stats = linkBudget(btsBucharest, routerNearby);
    expect(stats.distance).toBeLessThan(0.1); // sub 100 m distanță
    expect(stats.ok).toBe(true);
  });

  test("different cities -> margin/rx match contract when beams aligned", () => {
    // BTS: txPower=43, gain=15 dau EIRP=58 dBm, freq=900 MHz (emitator)
    // distanță ~324 km, FSPL ~141,7 dB, Rx ~ -73,7 dBm, marjă ~ +11,3 dB
    const alignedAntenna = { ...antennaCluj, beamwidth: 360, azimuth: 0 };
    const stats = linkBudget(btsBucharest, alignedAntenna);
    // contract: marjă = putere Rx - sensibilitate; ok dacă marjă > 0
    const expectedMargin = stats.rxPower - alignedAntenna.sens;
    expect(stats.margin).toBeCloseTo(expectedMargin, 6);
    expect(stats.ok).toBe(stats.margin > 0);
    // benzi incompatibile: 900 MHz vs 2400 MHz
    expect(stats.frequencyMismatch).toBe(true);
  });

  test("FSPL increases with distance: 10km > 1km", () => {
    const near: Station = {
      ...antennaCluj,
      lat: 44.4358,
      lng: 26.1025,
      beamwidth: 360,
    }; // la ~1 km nord de BTS
    const far: Station = {
      ...antennaCluj,
      lat: 44.5168,
      lng: 26.1025,
      beamwidth: 360,
    }; // la ~10 km nord de BTS
    const statsNear = linkBudget(btsBucharest, near);
    const statsFar = linkBudget(btsBucharest, far);
    expect(statsNear.beamMisaligned).toBe(false);
    expect(statsFar.beamMisaligned).toBe(false);
    expect(statsFar.fspl).toBeGreaterThan(statsNear.fspl);
  });

  test("formula FSPL: 20*log10(d) + 20*log10(f) + 32.44", () => {
    // stația 2: exact 1° latitudine la nord (~111,32 km)
    const s2: Station = {
      ...btsBucharest,
      id: 2,
      lat: btsBucharest.lat + 1,
      lng: btsBucharest.lng,
    };
    const stats = linkBudget(btsBucharest, s2);
    const expectedFspl =
      20 * Math.log10(stats.distance) + 20 * Math.log10(900) + 32.44;
    expect(stats.fspl).toBeCloseTo(expectedFspl, 3);
  });

  test("rxPower = txPower + gainTX - FSPL + gainRX", () => {
    const s2: Station = {
      ...btsBucharest,
      id: 2,
      lat: btsBucharest.lat + 0.1,
      lng: btsBucharest.lng,
    };
    const stats = linkBudget(btsBucharest, s2);
    const expected =
      btsBucharest.txPower + btsBucharest.gain - stats.fspl + s2.gain;
    expect(stats.rxPower).toBeCloseTo(expected, 6);
  });

  test("margin = rxPower - receiver sensitivity", () => {
    const s2: Station = {
      ...btsBucharest,
      id: 2,
      lat: btsBucharest.lat + 0.1,
      lng: btsBucharest.lng,
    };
    const stats = linkBudget(btsBucharest, s2);
    expect(stats.margin).toBeCloseTo(stats.rxPower - s2.sens, 6);
  });

  test("ok true when margin > 0", () => {
    const statsNear = linkBudget(btsBucharest, routerNearby);
    expect(statsNear.ok).toBe(statsNear.margin > 0);
  });

  test("frequencyMismatch false same band", () => {
    const s2: Station = {
      ...btsBucharest,
      id: 2,
      lat: btsBucharest.lat + 0.1,
      lng: btsBucharest.lng,
    };
    const stats = linkBudget(btsBucharest, s2);
    expect(stats.frequencyMismatch).toBe(false);
  });

  test("frequencyMismatch true for 900 vs 5800 MHz", () => {
    const stats = linkBudget(btsBucharest, routerNearby); // 900 MHz față de 5800 MHz
    expect(stats.frequencyMismatch).toBe(true);
  });

  test("FSPL uses transmitter freq (station1.freq), not average", () => {
    const s1: Station = { ...btsBucharest, id: 1, freq: 900 };
    const s2: Station = {
      ...btsBucharest,
      id: 2,
      lat: btsBucharest.lat + 0.5,
      lng: btsBucharest.lng,
      freq: 5800,
    };
    const stats = linkBudget(s1, s2);
    // FSPL trebuie calculat cu 900 MHz (s1), nu cu media (900+5800)/2 = 3350 MHz
    const expectedFspl =
      20 * Math.log10(stats.distance) + 20 * Math.log10(900) + 32.44;
    expect(stats.fspl).toBeCloseTo(expectedFspl, 3);
  });

  test("repeater link: margin uses receiver (repeater) sensitivity", () => {
    // BTS (sursă) spre repeater (receptor): marjă = rxPower minus sensibilitatea repeater-ului
    const bts: Station = {
      ...btsBucharest,
      id: 10,
      txPower: 43,
      gain: 15,
      sens: -90,
    };
    const rep: Station = {
      ...repeaterFar,
      id: 11,
      lat: 44.43,
      lng: 26.11,
      sens: -88,
    }; // poziții apropiate pe hartă
    const stats = linkBudget(bts, rep);
    // marjă: folosește sensibilitatea repeater-ului, nu cea a BTS-ului sursă
    expect(stats.margin).toBeCloseTo(stats.rxPower - rep.sens, 5);
  });
});

// stationsInterfere: interferență co-canal

describe("stationsInterfere", () => {
  const bts1: Station = { ...btsBucharest, id: 1, radius: 5 };
  const bts2Near: Station = {
    ...btsBucharest,
    id: 2,
    lat: 44.43,
    lng: 26.11,
    radius: 5,
  };
  const bts3Far: Station = {
    ...btsBucharest,
    id: 3,
    lat: 44.5,
    lng: 26.2,
    radius: 5,
  };

  test("different station types never interfere", () => {
    const router: Station = { ...routerNearby, radius: 99 };
    expect(stationsInterfere(bts1, router)).toBe(false);
  });

  test("two BTS ~500m apart 5km radius interfere", () => {
    expect(stationsInterfere(bts1, bts2Near)).toBe(true);
  });

  test("two BTS ~10km apart 5km radius do not interfere", () => {
    expect(stationsInterfere(bts1, bts3Far)).toBe(false);
  });

  test("este simetric: interfere(A,B) === interfere(B,A)", () => {
    expect(stationsInterfere(bts1, bts2Near)).toBe(
      stationsInterfere(bts2Near, bts1),
    );
    expect(stationsInterfere(bts1, bts3Far)).toBe(
      stationsInterfere(bts3Far, bts1),
    );
  });
});

// terrainCoveragePolygon: poligon acoperire cu relief

describe("terrainCoveragePolygon", () => {
  test("returns diagnostics and bearings for full grid", () => {
    const station: Station = {
      ...btsBucharest,
      radius: 3,
      elevation: 520,
      beamwidth: 360,
    };
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES;
    const terrainElevations = Array.from({ length: totalSamples }, () => 520);
    const buildingHeights = Array.from({ length: totalSamples }, () => 0);

    const result = terrainCoveragePolygon(
      station,
      terrainElevations,
      buildingHeights,
    );

    expect(result.diagnostics.samplesUsed).toBe(totalSamples);
    expect(result.diagnostics.totalBearings).toBe(COVERAGE_BEARINGS);
    expect(result.bearings).toHaveLength(COVERAGE_BEARINGS);
    expect(result.bearings[0]).toEqual(
      expect.objectContaining({
        bearingDeg: 0,
        obstructedAtKm: null,
        edgeBuildingHeight: 0,
      }),
    );
  });

  test("directional antenna azimuth 0: continuous polygon (no 32 deg to 328 deg jump)", () => {
    // Bug vechi: azimuturile 0..32 erau adăugate primele, 328..359 ultimele;
    // poligon auto-intersecat (dungi subțiri pe hartă).
    const station: Station = {
      ...antennaCluj,
      azimuth: 0,
      beamwidth: 65,
      radius: 2,
      elevation: 400,
    };
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES;
    const terrainElevations = Array.from({ length: totalSamples }, () => 400);
    const buildingHeights = Array.from({ length: totalSamples }, () => 0);

    const result = terrainCoveragePolygon(
      station,
      terrainElevations,
      buildingHeights,
    );

    // Ordine unghiulară continuă: 328..359, apoi 0..32
    const degs = result.bearings.map((b) => b.bearingDeg);
    // primul azimut: la stânga sectorului (~328°), nu 0°
    expect(degs[0]).toBeGreaterThan(180);
    // ultimul azimut: la dreapta sectorului (~32°)
    expect(degs[degs.length - 1]).toBeLessThan(90);
    // fără salt > 180° între două azimuturi consecutive
    for (let i = 1; i < degs.length; i++) {
      const delta = Math.abs(degs[i] - degs[i - 1]);
      const wrappedDelta = Math.min(delta, 360 - delta);
      expect(wrappedDelta).toBeLessThan(10);
    }
  });

  test("directional station: bearings only inside sector", () => {
    const station: Station = {
      ...antennaCluj,
      azimuth: 90,
      beamwidth: 60,
      radius: 2,
      elevation: 400,
    };
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES;
    const terrainElevations = Array.from({ length: totalSamples }, () => 400);
    const buildingHeights = Array.from({ length: totalSamples }, () => 0);

    const result = terrainCoveragePolygon(
      station,
      terrainElevations,
      buildingHeights,
    );

    expect(result.bearings.length).toBeGreaterThan(50);
    expect(result.bearings.length).toBeLessThan(70);
    expect(result.diagnostics.totalBearings).toBe(result.bearings.length);
  });

  test("buildings: soft attenuation dB, not hard LOS block", () => {
    const station: Station = {
      ...btsBucharest,
      radius: 3,
      elevation: 500,
      beamwidth: 360,
    };
    const totalSamples = COVERAGE_BEARINGS * COVERAGE_SAMPLES;
    const terrainElevations = Array.from({ length: totalSamples }, () => 500);
    const noBuildings = Array.from({ length: totalSamples }, () => 0);
    const denseBuildings = Array.from({ length: totalSamples }, () => 18);

    const clear = terrainCoveragePolygon(
      station,
      terrainElevations,
      noBuildings,
    );
    const attenuated = terrainCoveragePolygon(
      station,
      terrainElevations,
      denseBuildings,
    );

    expect(attenuated.bearings[0].obstructedAtKm).toBeNull();
    expect(attenuated.bearings[0].buildingPenetrationLossDb).toBeGreaterThan(0);
    expect(attenuated.bearings[0].effectiveRadiusKm).toBeLessThan(
      clear.bearings[0].effectiveRadiusKm,
    );
    expect(attenuated.diagnostics.meanBuildingLossDb).toBeGreaterThan(0);
    expect(attenuated.diagnostics.buildingHitSamples).toBeGreaterThan(0);
  });
});

// terrainLinkBudget: bilanț cu eșantionare relief

describe("terrainLinkBudget", () => {
  test("adds building loss without forcing losObstructed", () => {
    const tx: Station = {
      ...btsBucharest,
      id: 11,
      elevation: 120,
      height: 20,
      beamwidth: 360,
    };
    const rx: Station = {
      ...antennaCluj,
      id: 12,
      lat: tx.lat + 0.02,
      lng: tx.lng,
      elevation: 120,
      beamwidth: 360,
    };

    const sampleCount = 24;
    const terrain = Array.from({ length: sampleCount }, () => 120);
    const noBuildings = Array.from({ length: sampleCount }, () => 0);
    const withBuildings = Array.from({ length: sampleCount }, () => 15);

    const clear = terrainLinkBudget(tx, rx, terrain, noBuildings);
    const attenuated = terrainLinkBudget(tx, rx, terrain, withBuildings);

    expect(attenuated.losObstructed).toBe(false);
    expect(attenuated.buildingPenetrationLoss).toBeGreaterThan(0);
    expect(attenuated.margin).toBeLessThan(clear.margin);
  });
});
