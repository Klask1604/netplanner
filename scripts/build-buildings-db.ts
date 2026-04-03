#!/usr/bin/env tsx
/**
 * scripts/build-buildings-db.ts
 *
 * Citește un fișier OSM PBF local și construiește data/buildings.db.
 *
 * Rulare: npm run build:buildings
 *
 * Plasează fișierul OSM PBF în data/ (ex: romania-latest.osm.pbf sau romania-buildings.pbf)
 * Descarcă de la: https://download.geofabrik.de/europe/romania.html
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const osmPbf = require("osm-pbf-parser");

// ── Filtru bbox ────────────────────────────────────────────────────────────
// Setează la null pentru a procesa toată România.
// Brașov + împrejurimi (~30km rază):
const FILTER_BBOX = {
  south: 45.45,
  north: 45.85,
  west:  25.35,
  east:  25.90,
};

// ── Helpers ────────────────────────────────────────────────────────────────

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

function findPbfFile(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) throw new Error("Directorul data/ nu există.");
  const files = fs.readdirSync(dataDir);
  const pbf = files.find((f) => f.endsWith(".pbf") || f.endsWith(".pbj"));
  if (!pbf) {
    throw new Error(
      "Nu am găsit niciun fișier .pbf/.pbj în data/.\n" +
        "Descarcă de la: https://download.geofabrik.de/europe/romania.html\n" +
        "și plasează fișierul în data/",
    );
  }
  return path.join(dataDir, pbf);
}

function streamPbf(
  pbfPath: string,
  onItems: (items: any[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(pbfPath).pipe(osmPbf());
    stream.on("data", onItems);
    stream.on("end", resolve);
    stream.on("error", reject);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pbfPath = findPbfFile();
  const sizeMB = (fs.statSync(pbfPath).size / 1024 / 1024).toFixed(0);
  console.log(`\n📂 Fișier PBF: ${path.basename(pbfPath)} (${sizeMB} MB)`);

  const dataDir = path.join(process.cwd(), "data");
  const dbPath = path.join(dataDir, "buildings.db");
  const tmpDbPath = path.join(dataDir, "_nodes_tmp.db");

  for (const p of [dbPath, tmpDbPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // ── Pass 1: Colectează TOATE nodurile (id → lat/lng) în SQLite temp ──────
  console.log("\n🔄 Pass 1/2: Citire noduri OSM...");
  console.log(
    "   (Poate dura 5-10 minute pentru România — ~15 milioane noduri)\n",
  );

  const nodeDb = new Database(tmpDbPath);
  nodeDb.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous  = OFF;
    PRAGMA cache_size   = -131072;
    CREATE TABLE nodes (
      id  INTEGER PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
  `);

  const insertNode = nodeDb.prepare(
    "INSERT OR IGNORE INTO nodes VALUES (?, ?, ?)",
  );
  const insertNodes = nodeDb.transaction((batch: any[]) => {
    for (const n of batch) insertNode.run(n.id, n.lat, n.lon);
  });

  let nodeCount = 0;
  let nodeBatch: any[] = [];
  const NODE_BATCH = 100_000;

  await streamPbf(pbfPath, (items) => {
    for (const item of items) {
      if (item.type !== "node") continue;
      if (
        FILTER_BBOX &&
        (item.lat < FILTER_BBOX.south ||
          item.lat > FILTER_BBOX.north ||
          item.lon < FILTER_BBOX.west ||
          item.lon > FILTER_BBOX.east)
      )
        continue;
      nodeBatch.push(item);
      if (nodeBatch.length >= NODE_BATCH) {
        insertNodes(nodeBatch);
        nodeCount += nodeBatch.length;
        nodeBatch = [];
        process.stdout.write(
          `\r  ${nodeCount.toLocaleString("ro-RO")} noduri stocate...`,
        );
      }
    }
  });

  if (nodeBatch.length > 0) {
    insertNodes(nodeBatch);
    nodeCount += nodeBatch.length;
  }
  console.log(
    `\r  ${nodeCount.toLocaleString("ro-RO")} noduri stocate.         `,
  );

  // ── Pass 2: Procesează way-urile cu tag building ──────────────────────────
  console.log("\n🔄 Pass 2/2: Procesare clădiri...\n");

  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous  = NORMAL;
    PRAGMA cache_size   = -32000;

    CREATE TABLE buildings (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      min_lat REAL NOT NULL,
      max_lat REAL NOT NULL,
      min_lng REAL NOT NULL,
      max_lng REAL NOT NULL,
      height  REAL NOT NULL,
      ring    TEXT NOT NULL
    );

    CREATE INDEX idx_lat ON buildings(min_lat, max_lat);
    CREATE INDEX idx_lng ON buildings(min_lng, max_lng);
  `);

  const getNode = nodeDb.prepare(
    "SELECT lat, lng FROM nodes WHERE id = ?",
  ) as any;
  const insertBuilding = db.prepare(
    `INSERT INTO buildings (min_lat, max_lat, min_lng, max_lng, height, ring)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertBuildings = db.transaction((rows: any[]) => {
    for (const r of rows)
      insertBuilding.run(
        r.minLat,
        r.maxLat,
        r.minLng,
        r.maxLng,
        r.height,
        r.ring,
      );
  });

  let buildingCount = 0;
  let buildingBatch: any[] = [];
  const BUILDING_BATCH = 2_000;

  await streamPbf(pbfPath, (items) => {
    for (const item of items) {
      if (item.type !== "way" || !item.tags?.building) continue;

      const ring: [number, number][] = [];
      for (const ref of item.refs ?? []) {
        const node = getNode.get(ref) as
          | { lat: number; lng: number }
          | undefined;
        if (node) ring.push([node.lat, node.lng]);
      }

      if (ring.length < 3) continue;

      const first = ring[0],
        last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

      const lats = ring.map((p) => p[0]);
      const lngs = ring.map((p) => p[1]);

      buildingBatch.push({
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs),
        height: getBuildingHeight(item.tags),
        ring: JSON.stringify(ring),
      });

      if (buildingBatch.length >= BUILDING_BATCH) {
        insertBuildings(buildingBatch);
        buildingCount += buildingBatch.length;
        buildingBatch = [];
        process.stdout.write(
          `\r  ${buildingCount.toLocaleString("ro-RO")} clădiri procesate...`,
        );
      }
    }
  });

  if (buildingBatch.length > 0) {
    insertBuildings(buildingBatch);
    buildingCount += buildingBatch.length;
  }
  console.log(
    `\r  ${buildingCount.toLocaleString("ro-RO")} clădiri procesate.         `,
  );

  // ── Finalizare ─────────────────────────────────────────────────────────
  db.exec("ANALYZE;");
  db.close();
  nodeDb.close();
  fs.unlinkSync(tmpDbPath);

  const finalMB = (fs.statSync(dbPath).size / 1024 / 1024).toFixed(1);
  console.log(
    `\n✅ Done! ${buildingCount.toLocaleString("ro-RO")} clădiri → ${dbPath} (${finalMB} MB)`,
  );
  console.log("   Rulează aplicația — va folosi DB-ul local automat.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
