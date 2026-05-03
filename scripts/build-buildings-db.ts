#!/usr/bin/env tsx
/**
 * scripts/build-buildings-db.ts
 *
 * Citeste un PBF OSM din data/ si scrie data/buildings.db (SQLite).
 * Rulare: npm run build:buildings
 * Exemplu fisier: romania-latest.osm.pbf in data/
 * https://download.geofabrik.de/europe/romania.html
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const osmPbf = require("osm-pbf-parser");

// Filtru bbox: null = toata aria din PBF (pass 1 tine toate nodurile in SQLite).
// Exemplu mai jos: zona Brasov (FILTRU ingust in pass 2; pass 1 foloseste bbox extins).
type OsmBbox = { south: number; north: number; west: number; east: number };

const FILTER_BBOX: OsmBbox | null = {
  south: 45.45,
  north: 45.85,
  west: 25.35,
  east: 25.9,
};

// Pass 1: noduri din bbox extins (FILTRU + padding), ca inelele cladirilor sa aiba toate varfurile in DB.
// 0.12 deg lat ~ 13 km. Daca vezi multe cladiri sarite in log, mareste NODE_CAPTURE_PADDING_DEG.
const NODE_CAPTURE_PADDING_DEG = 0.12;

// Helpers

function expandBbox(b: OsmBbox, padDeg: number): OsmBbox {
  return {
    south: b.south - padDeg,
    north: b.north + padDeg,
    west: b.west - padDeg,
    east: b.east + padDeg,
  };
}

/** Bbox inel (min/max) intersecteaza bbox-ul tinta (filtru pass 2). */
function ringBboxIntersectsFilter(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  target: OsmBbox,
): boolean {
  return (
    maxLat >= target.south &&
    minLat <= target.north &&
    maxLng >= target.west &&
    minLng <= target.east
  );
}

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
  if (!fs.existsSync(dataDir)) throw new Error("Directorul data/ nu exista.");
  const files = fs.readdirSync(dataDir);
  const pbf = files.find((f) => f.endsWith(".pbf"));
  if (!pbf) {
    throw new Error(
      "Nu am gasit niciun fisier .pbf in data/.\n" +
        "Descarca de la: https://download.geofabrik.de/europe/romania.html\n" +
        "si pune fisierul in data/",
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

// Main
//
// De ce doua parcurgeri ale aceluiasi PBF?
// In PBF, nodurile si way-urile sunt amestecate. Un way are lista de id-uri de noduri,
// fara coordonate. Mai intai trebuie tabel id -> (lat, lng). Pass 1 scrie nodurile in SQLite.
// Pass 2 citeste way-urile cu tag building si citeste coordonatele din acel tabel.
// Doua treceri: nu tinem tot graful in RAM. O singura trecere ar insemna alt design (ex. sortare pe disc).

async function main() {
  const pbfPath = findPbfFile();
  const sizeMB = (fs.statSync(pbfPath).size / 1024 / 1024).toFixed(0);
  console.log(`\n[INFO] Fisier PBF: ${path.basename(pbfPath)} (${sizeMB} MB)`);

  const nodeCaptureBbox: OsmBbox | null = FILTER_BBOX
    ? expandBbox(FILTER_BBOX, NODE_CAPTURE_PADDING_DEG)
    : null;
  if (FILTER_BBOX) {
    console.log(
      `[INFO] Cladiri in bbox utilizator. Pass 1: noduri in bbox extins (+${NODE_CAPTURE_PADDING_DEG} deg fata de filtru).`,
    );
  } else {
    console.log("[INFO] Fara FILTER_BBOX: toate nodurile, toate cladirile din PBF.");
  }

  const dataDir = path.join(process.cwd(), "data");
  const dbPath = path.join(dataDir, "buildings.db");
  const tmpDbPath = path.join(dataDir, "_nodes_tmp.db");

  for (const p of [dbPath, tmpDbPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // Pass 1: noduri (id, lat, lng) in SQLite temporar
  console.log("\n[INFO] Pass 1/2: citire noduri OSM...");
  console.log(
    "   (pentru Romania intreaga poate dura multe minute, milioane de noduri)\n",
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
      if (nodeCaptureBbox) {
        if (
          item.lat < nodeCaptureBbox.south ||
          item.lat > nodeCaptureBbox.north ||
          item.lon < nodeCaptureBbox.west ||
          item.lon > nodeCaptureBbox.east
        ) {
          continue;
        }
      }
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

  // Pass 2: way-uri cu tag building
  console.log("\n[INFO] Pass 2/2: procesare cladiri...\n");

  let buildingsSkippedIncompleteRing = 0;

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

      const refs: number[] = item.refs ?? [];
      const ring: [number, number][] = [];
      for (const ref of refs) {
        const node = getNode.get(ref) as
          | { lat: number; lng: number }
          | undefined;
        if (node) ring.push([node.lat, node.lng]);
      }

      // Noduri lipsa (in afara bbox-ului extins din pass 1): nu insera poligon trunchiat.
      if (refs.length > 0 && ring.length < refs.length) {
        buildingsSkippedIncompleteRing++;
        continue;
      }

      if (ring.length < 3) continue;

      const first = ring[0],
        last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

      const lats = ring.map((p) => p[0]);
      const lngs = ring.map((p) => p[1]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      if (
        FILTER_BBOX &&
        !ringBboxIntersectsFilter(minLat, maxLat, minLng, maxLng, FILTER_BBOX)
      ) {
        continue;
      }

      buildingBatch.push({
        minLat,
        maxLat,
        minLng,
        maxLng,
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

  if (buildingsSkippedIncompleteRing > 0) {
    console.log(
      `[INFO] Sarite ${buildingsSkippedIncompleteRing.toLocaleString("ro-RO")} cladiri: inel incomplet (noduri in afara zonei captate pass 1). Poti mari NODE_CAPTURE_PADDING_DEG.`,
    );
  }

  // Finalizare
  db.exec("ANALYZE;");
  db.close();
  nodeDb.close();
  fs.unlinkSync(tmpDbPath);

  const finalMB = (fs.statSync(dbPath).size / 1024 / 1024).toFixed(1);
  console.log(
    `\n[DONE] ${buildingCount.toLocaleString("ro-RO")} cladiri -> ${dbPath} (${finalMB} MB)`,
  );
  console.log("   Porneste aplicatia: foloseste buildings.db din data/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
