// lib/buildings.server.ts
// Building data — served from local SQLite DB (data/buildings.db).
// Falls back to Overpass API if DB is not found (dev without setup).
//
// Run `npx tsx scripts/build-buildings-db.ts` once to generate the DB.

import path from "path";
import fs from "fs";
import { COVERAGE_BEARINGS, COVERAGE_SAMPLES } from "@/lib/rf";

export interface Building {
  ring: [number, number][];
  height: number;
}

// ── Spatial grid pentru raycasting rapid ───────────────────────────────────

interface GridCell {
  // Segmente de perete pre-calculate:
  // [ax, ay, bx, by, height, buildingIdx, segmentIdx]
  segments: [number, number, number, number, number, number, number][];
}

function buildGrid(
  buildings: Building[],
  stationLat: number,
  stationLng: number,
  cellSizeKm = 0.1,
): { grid: Map<string, GridCell>; kmPerLat: number; kmPerLng: number } {
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos((stationLat * Math.PI) / 180);

  const grid = new Map<string, GridCell>();
  let segmentCounter = 0;

  for (let buildingIdx = 0; buildingIdx < buildings.length; buildingIdx++) {
    const { ring, height } = buildings[buildingIdx];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const segmentIdx = segmentCounter++;
      const ax = (ring[j][1] - stationLng) * kmPerLng;
      const ay = (ring[j][0] - stationLat) * kmPerLat;
      const bx = (ring[i][1] - stationLng) * kmPerLng;
      const by = (ring[i][0] - stationLat) * kmPerLat;

      const cMinX = Math.floor(Math.min(ax, bx) / cellSizeKm);
      const cMaxX = Math.floor(Math.max(ax, bx) / cellSizeKm);
      const cMinY = Math.floor(Math.min(ay, by) / cellSizeKm);
      const cMaxY = Math.floor(Math.max(ay, by) / cellSizeKm);

      for (let cy = cMinY; cy <= cMaxY; cy++) {
        for (let cx = cMinX; cx <= cMaxX; cx++) {
          const key = `${cx},${cy}`;
          if (!grid.has(key)) grid.set(key, { segments: [] });
          grid.get(key)!.segments.push([
            ax, ay, bx, by, height, buildingIdx, segmentIdx,
          ]);
        }
      }
    }
  }

  return { grid, kmPerLat, kmPerLng };
}

// ── Ray-segment geometry ───────────────────────────────────────────────────

function raySegmentT(
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number | null {
  const ex = bx - ax,
    ey = by - ay;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-12) return null;
  const t = (ax * ey - ay * ex) / det;
  const u = (ax * dy - ay * dx) / det;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

interface BuildingRayHit {
  distanceKm: number;
  buildingIdx: number;
  height: number;
}

/**
 * Returnează TOATE intersecțiile razei cu pereții clădirilor, sortate ascendent
 * după distanță. Folosit pentru calculul corect al înălțimii clădirii la fiecare
 * sample (parity counting per buildingIdx → "în interior" / "în afară").
 */
function findAllBuildingHitsOnRay(
  bearingDeg: number,
  maxKm: number,
  grid: Map<string, GridCell>,
  cellSizeKm: number,
): BuildingRayHit[] {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const dx = Math.sin(bearingRad);
  const dy = Math.cos(bearingRad);

  let cx = 0,
    cy = 0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = Math.abs(cellSizeKm / dx);
  const tDeltaY = Math.abs(cellSizeKm / dy);
  let tMaxX = Math.abs((dx > 0 ? cellSizeKm : 0) / dx);
  let tMaxY = Math.abs((dy > 0 ? cellSizeKm : 0) / dy);

  const visited = new Set<string>();
  // Dedupe segmente — același perete poate fi vizitat din celule diferite.
  const seenSegments = new Set<number>();
  const hits: BuildingRayHit[] = [];

  while (Math.min(tMaxX, tMaxY) <= maxKm) {
    const key = `${cx},${cy}`;
    if (!visited.has(key)) {
      visited.add(key);
      const cell = grid.get(key);
      if (cell) {
        for (const seg of cell.segments) {
          const segmentIdx = seg[6];
          if (seenSegments.has(segmentIdx)) continue;
          const ax = seg[0],
            ay = seg[1],
            bx = seg[2],
            by = seg[3],
            height = seg[4],
            buildingIdx = seg[5];
          const t = raySegmentT(dx, dy, ax, ay, bx, by);
          if (t !== null && t >= 0 && t <= maxKm) {
            seenSegments.add(segmentIdx);
            hits.push({ distanceKm: t, buildingIdx, height });
          }
        }
      }
    }

    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxY += tDeltaY;
      cy += stepY;
    }
  }

  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return hits;
}

// ── SQLite backend ─────────────────────────────────────────────────────────

let _db: any = null;

function getDb(): any | null {
  if (_db) return _db;
  const dbPath = path.join(process.cwd(), "data", "buildings.db");
  if (!fs.existsSync(dbPath)) {
    console.warn(
      "[buildings] data/buildings.db nu există — rulează: npx tsx scripts/build-buildings-db.ts",
    );
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    _db = new Database(dbPath, { readonly: true, fileMustExist: true });
    _db.pragma("cache_size = -32000"); // 32MB page cache
    console.log("[buildings] Connected to local SQLite DB");
    return _db;
  } catch (e) {
    console.warn(
      "[buildings] better-sqlite3 unavailable:",
      (e as Error).message,
    );
    return null;
  }
}

// In-memory cache pentru rezultate frecvente (LRU simplu cu Map)
const _queryCache = new Map<string, { data: Building[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minute
const GRID_DEG = 0.005; // ~500m snap grid

function snapBbox(s: number, w: number, n: number, e: number) {
  return {
    south: Math.floor(s / GRID_DEG) * GRID_DEG,
    west: Math.floor(w / GRID_DEG) * GRID_DEG,
    north: Math.ceil(n / GRID_DEG) * GRID_DEG,
    east: Math.ceil(e / GRID_DEG) * GRID_DEG,
  };
}

function queryLocalDb(
  south: number,
  west: number,
  north: number,
  east: number,
): Building[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `
    SELECT ring, height FROM buildings
    WHERE max_lat >= ? AND min_lat <= ?
      AND max_lng >= ? AND min_lng <= ?
  `,
    )
    .all(south, north, west, east) as { ring: string; height: number }[];

  return rows.map((r) => ({
    ring: JSON.parse(r.ring) as [number, number][],
    height: r.height,
  }));
}

// ── Overpass fallback (dev fără DB) ───────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function getBuildingHeight(tags: Record<string, string>): number {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!isNaN(h) && h > 0) return h;
  }
  if (tags["building:levels"]) {
    const l = parseFloat(tags["building:levels"]);
    if (!isNaN(l) && l > 0) return l * 3;
  }
  return 8;
}

async function queryOverpass(query: string): Promise<any> {
  const body = `data=${encodeURIComponent(query)}`;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
        next: { revalidate: 0 },
      } as RequestInit);
      clearTimeout(id);
      if (!res.ok) {
        console.warn(`[buildings] Overpass ${endpoint} → ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      clearTimeout(id);
      console.warn(
        `[buildings] Overpass ${endpoint} failed:`,
        (e as Error).message,
      );
    }
  }
  throw new Error("All Overpass endpoints failed");
}

async function fetchFromOverpass(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<Building[]> {
  const query =
    `[out:json][timeout:20];` +
    `way["building"](${south},${west},${north},${east});` +
    `out geom;`;
  const json = await queryOverpass(query);
  const buildings: Building[] = [];

  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const ring: [number, number][] = el.geometry.map(
      (n: { lat: number; lon: number }) => [n.lat, n.lon] as [number, number],
    );
    const first = ring[0],
      last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    buildings.push({ ring, height: getBuildingHeight(el.tags ?? {}) });
  }

  return buildings;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returnează clădirile din bbox.
 * Prioritate: SQLite local → Overpass fallback.
 * Rezultatele sunt cached in-memory 5 minute.
 */
export async function fetchBuildingsInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<Building[]> {
  const snapped = snapBbox(south, west, north, east);
  const cacheKey = `${snapped.south.toFixed(3)},${snapped.west.toFixed(3)},${snapped.north.toFixed(3)},${snapped.east.toFixed(3)}`;

  const cached = _queryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let data: Building[];
  const db = getDb();

  if (db) {
    data = queryLocalDb(
      snapped.south,
      snapped.west,
      snapped.north,
      snapped.east,
    );
    console.log(
      `[buildings] DB local → ${data.length} clădiri pentru ${cacheKey}`,
    );
  } else {
    try {
      data = await fetchFromOverpass(
        snapped.south,
        snapped.west,
        snapped.north,
        snapped.east,
      );
      console.log(`[buildings] Overpass fallback → ${data.length} clădiri`);
    } catch {
      data = [];
    }
  }

  if (_queryCache.size > 200) {
    let oldestKey = "";
    let oldestTs = Infinity;
    _queryCache.forEach((v, k) => {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    });
    if (oldestKey) _queryCache.delete(oldestKey);
  }
  _queryCache.set(cacheKey, { data, ts: Date.now() });

  return data;
}

/**
 * Calculează înălțimea clădirii (în metri) la fiecare sample point al razelor
 * de coverage. Returnează un array paralel cu `points` care conține:
 *  - 0  → sample-ul NU este în interiorul niciunei clădiri
 *  - h  → înălțimea celei mai înalte clădiri în care se află sample-ul
 *
 * Folosește parity counting pe wall-crossings (raycasting clasic):
 * dacă numărul de pereți traversați pentru o clădire `i` (înainte de sample)
 * este impar, sample-ul e în interiorul polygon-ului acelei clădiri.
 *
 * Spre deosebire de varianta anterioară (`+9999` magic offset, doar prima
 * clădire / rază), această funcție:
 *  - tratează corect orașe dense cu clădiri suprapuse pe aceeași rază
 *  - permite LOS-ului să "sară peste" clădiri scunde dacă antena e suficient de înaltă
 *  - oferă obstacle MSL real ( terrain + buildingHeight ) pentru fiecare sample
 */
export function computeBuildingHeightsAlongRays(
  stationLat: number,
  stationLng: number,
  points: { lat: number; lng: number }[],
  buildings: Building[],
): number[] {
  const numBearings: number = COVERAGE_BEARINGS;
  const samplesPerBearing: number = COVERAGE_SAMPLES;
  const totalSamples = numBearings * samplesPerBearing;

  const result = new Array<number>(points.length).fill(0);
  if (buildings.length === 0) return result;
  if (samplesPerBearing === 0) return result;
  if (points.length !== totalSamples) return result;

  const CELL_SIZE_KM = 0.05; // 50m — echilibru overhead grid vs celule verificate

  const { grid } = buildGrid(buildings, stationLat, stationLng, CELL_SIZE_KM);

  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos((stationLat * Math.PI) / 180);

  // Reused per-bearing buffers
  const sampleDistancesKm = new Array<number>(samplesPerBearing);

  for (let bearingIndex = 0; bearingIndex < numBearings; bearingIndex++) {
    const bearingDeg = bearingIndex * (360 / numBearings);

    let maxKm = 0;
    for (let s = 0; s < samplesPerBearing; s++) {
      const pt = points[bearingIndex * samplesPerBearing + s];
      const dX = (pt.lat - stationLat) * kmPerLat;
      const dY = (pt.lng - stationLng) * kmPerLng;
      const distKm = Math.sqrt(dX * dX + dY * dY);
      sampleDistancesKm[s] = distKm;
      if (distKm > maxKm) maxKm = distKm;
    }

    const hits = findAllBuildingHitsOnRay(
      bearingDeg,
      maxKm,
      grid,
      CELL_SIZE_KM,
    );
    if (hits.length === 0) continue;

    // Parity-count per buildingIdx, slide forward together with sample distance.
    const insideCount = new Map<number, number>();
    const insideHeight = new Map<number, number>();
    let hitIdx = 0;

    for (let s = 0; s < samplesPerBearing; s++) {
      const d = sampleDistancesKm[s];
      while (hitIdx < hits.length && hits[hitIdx].distanceKm <= d) {
        const h = hits[hitIdx];
        const cnt = (insideCount.get(h.buildingIdx) ?? 0) + 1;
        insideCount.set(h.buildingIdx, cnt);
        insideHeight.set(h.buildingIdx, h.height);
        hitIdx++;
      }

      let maxH = 0;
      insideCount.forEach((cnt, bIdx) => {
        if ((cnt & 1) === 1) {
          const bH = insideHeight.get(bIdx) ?? 0;
          if (bH > maxH) maxH = bH;
        }
      });
      result[bearingIndex * samplesPerBearing + s] = maxH;
    }
  }

  return result;
}
