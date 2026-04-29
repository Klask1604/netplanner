import { NextRequest, NextResponse } from "next/server";
import {
  Station,
  coverageSamplePoints,
  terrainCoveragePolygon,
} from "@/lib/rf";
import {
  getElevationServer,
  getElevationsServer,
} from "@/lib/terrarium.server";
import {
  Building,
  fetchBuildingsInBbox,
  computeBuildingHeightsAlongRays,
} from "@/lib/buildings.server";

function pointInPolygon(
  lat: number,
  lng: number,
  ring: [number, number][],
): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];

    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

export async function POST(request: NextRequest) {
  try {
    const {
      station,
      buildings = [],
    }: { station: Station; buildings: Building[] } = await request.json();

    // Always fetch terrain elevation for the current coordinates.
    // Using a previously stored station.elevation after dragging can introduce
    // large mismatches and unstable coverage geometry.
    let groundElevation = await getElevationServer(station.lat, station.lng);

    const requestedBuildings = buildings ?? [];
    let effectiveBuildings = requestedBuildings;
    let buildingsSource: "client" | "server" | "none" =
      requestedBuildings.length > 0 ? "client" : "none";

    // Auto-load surrounding buildings when client does not provide them.
    // This keeps coverage deformation consistent without depending on map layer state.
    if (effectiveBuildings.length === 0) {
      const halfSpanDeg = Math.max(station.radius, 0.5) / 111.32;
      const bbox = {
        south: station.lat - halfSpanDeg,
        north: station.lat + halfSpanDeg,
        west:
          station.lng -
          halfSpanDeg / Math.cos((station.lat * Math.PI) / 180),
        east:
          station.lng +
          halfSpanDeg / Math.cos((station.lat * Math.PI) / 180),
      };
      effectiveBuildings = await fetchBuildingsInBbox(
        bbox.south,
        bbox.west,
        bbox.north,
        bbox.east,
      );
      buildingsSource = effectiveBuildings.length > 0 ? "server" : "none";
    }

    let buildingUnderStation: { detected: boolean; height: number } = {
      detected: false,
      height: 0,
    };
    for (const building of effectiveBuildings) {
      if (!pointInPolygon(station.lat, station.lng, building.ring)) continue;
      const previousGroundElevation = groundElevation;
      groundElevation = previousGroundElevation + building.height;
      buildingUnderStation = { detected: true, height: building.height };
      console.log(
        `[coverage] Stație pe clădire de ${building.height}m → groundElevation ajustat: ${previousGroundElevation}m → ${groundElevation}m`,
      );
      break;
    }

    const stationWithElevation: Station = {
      ...station,
      elevation: groundElevation,
    };

    // Sample terrain elevations along all bearing directions.
    // Resolution: COVERAGE_BEARINGS · COVERAGE_SAMPLES = 360 · 80 = 28 800 samples.
    const samplePoints = coverageSamplePoints(stationWithElevation);
    const terrainElevations = await getElevationsServer(samplePoints);

    console.log(`\n=== COVERAGE HD [Station ${station.id}] ===`);
    console.log(
      `Poziție: ${station.lat.toFixed(5)}, ${station.lng.toFixed(5)}`,
    );
    console.log(
      `Elevation sol: ${groundElevation.toFixed(1)}m | Antenă: ${stationWithElevation.height}m | AntennaMSL: ${(stationWithElevation.elevation + stationWithElevation.height).toFixed(1)}m`,
    );
    console.log(
      `Radius nominal: ${station.radius.toFixed(3)}km | Sample-uri: ${samplePoints.length}`,
    );

    // Building height profile per sample point (0 outside any footprint).
    // Replaces the legacy "augmentElevationsWithBuildings + +9999 hack" with a
    // physics-correct LOS-able obstacle map.
    const buildingHeights =
      effectiveBuildings.length > 0
        ? computeBuildingHeightsAlongRays(
            stationWithElevation.lat,
            stationWithElevation.lng,
            samplePoints,
            effectiveBuildings,
          )
        : new Array<number>(samplePoints.length).fill(0);

    const samplesInsideBuilding = buildingHeights.filter((h) => h > 0).length;
    if (effectiveBuildings.length > 0) {
      console.log(
        `[/api/coverage] ${effectiveBuildings.length} buildings (${buildingsSource}) → ${samplesInsideBuilding}/${samplePoints.length} samples inside footprints`,
      );
    }

    // Compute terrain + building-aware coverage polygons. The polygon function
    // performs the LOS check + 6-iter bisection per bearing internally and
    // emits per-bearing diagnostic data for the client ray overlay.
    const {
      polygons: coveragePolygons,
      diagnostics: rawDiagnostics,
      bearings: bearingDiagnostics,
    } = terrainCoveragePolygon(
      stationWithElevation,
      terrainElevations,
      buildingHeights,
    );

    console.log(
      `[/api/coverage] obstructed bearings ${rawDiagnostics.obstructedBearings}/${rawDiagnostics.totalBearings}` +
        (rawDiagnostics.meanObstructionKm !== null
          ? ` · mean obstruction ${rawDiagnostics.meanObstructionKm.toFixed(3)}km`
          : ""),
    );

    return NextResponse.json({
      elevation: groundElevation,
      polygons: coveragePolygons,
      bearings: bearingDiagnostics,
      diagnostics: {
        buildingsUsed: effectiveBuildings.length > 0,
        buildingsCount: effectiveBuildings.length,
        buildingsSource,
        buildingUnderStation,
        blockedSamples: samplesInsideBuilding,
        totalSamples: samplePoints.length,
        samplesUsed: rawDiagnostics.samplesUsed,
        obstructedBearings: rawDiagnostics.obstructedBearings,
        totalBearings: rawDiagnostics.totalBearings,
        meanObstructionKm: rawDiagnostics.meanObstructionKm,
        meanBuildingLossDb: rawDiagnostics.meanBuildingLossDb,
        maxBuildingLossDb: rawDiagnostics.maxBuildingLossDb,
        buildingHitSamples: rawDiagnostics.buildingHitSamples,
      },
    });
  } catch (error) {
    console.error("[/api/coverage] error:", error);
    return NextResponse.json(
      { error: "Coverage computation failed" },
      { status: 500 },
    );
  }
}
