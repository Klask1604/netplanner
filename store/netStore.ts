import { create } from 'zustand'
import {
  Station,
  Link,
  LinkStats,
  StationType,
  ToolType,
  CoveragePolygons,
  BearingDiagnostic,
  STATION_TYPES,
  okumuraHata,
  freeSpaceRadius,
  linkBudget,
  stationsInterfere,
} from '@/lib/rf'
import { useToastStore } from './toastStore'

interface NetStore {
  // ── State ──────────────────────────────────────────────────────────────────
  stations:          Station[]
  links:             Link[]
  selId:             number | null
  selLinkId:         number | null
  tool:              ToolType
  linkSrc:           number | null
  counters:          Record<StationType, number>
  coveragePolygons:  Record<number, CoveragePolygons>
  coverageDiagnostics: Record<number, {
    buildingsUsed: boolean
    buildingsCount: number
    buildingsSource: 'client' | 'server' | 'none'
    buildingUnderStation?: { detected: boolean; height: number }
    blockedSamples: number
    totalSamples: number
    samplesUsed?: number
    obstructedBearings?: number
    totalBearings?: number
    meanObstructionKm?: number | null
  }>
  polygonPending:    Record<number, boolean>
  terrainLinkStats:  Record<number, LinkStats>
  coverageRays:      Record<number, BearingDiagnostic[]>
  heatmapVisible:    boolean
  coverageOpacity:   number
  hillshadeVisible:  boolean
  terrain3dEnabled:  boolean
  topoMapEnabled:    boolean
  buildingsVisible:  boolean
  diagnosticMode:    boolean

  // ── Actions ────────────────────────────────────────────────────────────────
  setTool:               (tool: ToolType) => void
  addStation:            (lat: number, lng: number, type: StationType) => void
  removeStation:         (id: number) => void
  updateStation:         (id: number, patch: Partial<Station>) => void
  selectStation:         (id: number | null) => void
  selectLink:            (id: number | null) => void
  startLink:             (stationId: number) => void
  completeLink:          (targetStationId: number) => void
  removeLink:            (id: number) => void
  cancelLink:            () => void
  getLinkStats:          (linkId: number) => LinkStats | null
  getInterferences:      (stationId: number) => Station[]
  totalCoverageArea:     () => number
  interferenceCount:     () => number
  exportJSON:            () => string
  importJSON:            (raw: string) => void
  toggleHeatmap:         () => void
  setCoverageOpacity:    (opacity: number) => void
  toggleHillshade:       () => void
  toggleTerrain3d:       () => void
  toggleTopoMap:         () => void
  toggleBuildings:       () => void
  toggleDiagnosticMode:  () => void
  /** Fetch terrain + compute coverage polygon for a station via /api/coverage */
  fetchStationElevation: (stationId: number) => Promise<void>
  /** Compute terrain-aware link budget via /api/link-budget */
  recomputeLinkTerrain:  (linkId: number) => Promise<void>
}

function withComputedRadius(station: Station): Station {
  // Routers use FSPL (short-range); all others use Okumura-Hata (macro-cell/urban)
  const radius = station.type === 'router'
    ? freeSpaceRadius(station)
    : okumuraHata(station)
  return { ...station, radius }
}

let _nextEntityId = 1

// One debounce timer per station — used in updateStation
const _coverageDebounceTimers: Record<number, ReturnType<typeof setTimeout>> = {}

export const useNetStore = create<NetStore>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────────────
  stations:         [],
  links:            [],
  selId:            null,
  selLinkId:        null,
  tool:             'select',
  linkSrc:          null,
  counters:         { bts: 0, antenna: 0, router: 0, repeater: 0 },
  coveragePolygons: {},
  coverageDiagnostics: {},
  polygonPending:   {},
  terrainLinkStats: {},
  coverageRays:     {},
  heatmapVisible:   false,
  coverageOpacity:  1,
  hillshadeVisible:  false,
  terrain3dEnabled:  false,
  topoMapEnabled:    false,
  buildingsVisible:  false,
  diagnosticMode:    false,

  // ── Tool ───────────────────────────────────────────────────────────────────
  setTool: (tool) => set({ tool, linkSrc: null }),

  // ── Stations ───────────────────────────────────────────────────────────────
  addStation: (lat, lng, type) => {
    const entityId   = _nextEntityId++
    const config     = STATION_TYPES[type]
    const newCounters = { ...get().counters, [type]: get().counters[type] + 1 }
    const baseStation: Station = {
      id: entityId, type, lat, lng,
      name: `${config.name} #${newCounters[type]}`,
      ...config.def,
      radius: 0,
    }
    const station = withComputedRadius(baseStation)
    set(s => ({ stations: [...s.stations, station], counters: newCounters, selId: entityId }))
    get().fetchStationElevation(entityId)
  },

  removeStation: (id) =>
    set(s => {
      const { [id]: _rp, ...remainingPolygons } = s.coveragePolygons
      const { [id]: _rd, ...remainingDiagnostics } = s.coverageDiagnostics
      const { [id]: _pp, ...remainingPending  } = s.polygonPending
      const { [id]: _rr, ...remainingRays }   = s.coverageRays
      const affectedLinkIds = s.links
        .filter(link => link.station1Id === id || link.station2Id === id)
        .map(link => link.id)
      const remainingBudgets = { ...s.terrainLinkStats }
      affectedLinkIds.forEach(linkId => delete remainingBudgets[linkId])
      return {
        stations:         s.stations.filter(x => x.id !== id),
        links:            s.links.filter(link => link.station1Id !== id && link.station2Id !== id),
        selId:            s.selId   === id ? null : s.selId,
        linkSrc:          s.linkSrc === id ? null : s.linkSrc,
        coveragePolygons: remainingPolygons,
        coverageDiagnostics: remainingDiagnostics,
        polygonPending:   remainingPending,
        terrainLinkStats: remainingBudgets,
        coverageRays:     remainingRays,
      }
    }),

  updateStation: (id, patch) => {
    set(s => ({
      stations: s.stations.map(st => st.id === id ? withComputedRadius({ ...st, ...patch }) : st),
    }))
    // Debounced coverage recompute — single timer per station
    clearTimeout(_coverageDebounceTimers[id])
    _coverageDebounceTimers[id] = setTimeout(() => get().fetchStationElevation(id), 350)
  },

  selectStation: (id) => set({ selId: id, selLinkId: null }),
  selectLink:    (id) => set({ selLinkId: id, selId: null }),

  // ── Links ──────────────────────────────────────────────────────────────────
  startLink: (stationId) => set({ linkSrc: stationId }),

  completeLink: (targetStationId) => {
    const { linkSrc, links, stations } = get()
    if (!linkSrc || linkSrc === targetStationId) { set({ linkSrc: null }); return }

    const srcStation = stations.find(s => s.id === linkSrc)
    const dstStation = stations.find(s => s.id === targetStationId)

    // Two repeaters cannot link to each other — a repeater re-broadcasts a
    // source signal and has no uplink path to another repeater.
    if (srcStation?.type === 'repeater' && dstStation?.type === 'repeater') {
      useToastStore.getState().addToast(
        'warn',
        'Link invalid: nu se poate conecta Repeater → Repeater. Un repeater necesită o sursă (BTS / Antenă).',
      )
      set({ linkSrc: null })
      return
    }

    const alreadyExists = links.some(
      l => (l.station1Id === linkSrc && l.station2Id === targetStationId) ||
           (l.station1Id === targetStationId && l.station2Id === linkSrc)
    )
    if (!alreadyExists) {
      const linkId = _nextEntityId++
      set(s => ({
        links:   [...s.links, { id: linkId, station1Id: linkSrc, station2Id: targetStationId }],
        linkSrc: null,
      }))
      get().recomputeLinkTerrain(linkId)
    } else {
      set({ linkSrc: null })
    }
  },

  removeLink: (id) =>
    set(s => {
      const { [id]: _removed, ...remainingBudgets } = s.terrainLinkStats
      return {
        links: s.links.filter(l => l.id !== id),
        terrainLinkStats: remainingBudgets,
        selLinkId: s.selLinkId === id ? null : s.selLinkId,
      }
    }),

  cancelLink: () => set({ linkSrc: null }),

  // ── Computed getters ───────────────────────────────────────────────────────
  getLinkStats: (linkId) => {
    const terrainStats = get().terrainLinkStats[linkId]
    if (terrainStats) return terrainStats
    const link = get().links.find(l => l.id === linkId)
    if (!link) return null
    const s1 = get().stations.find(s => s.id === link.station1Id)
    const s2 = get().stations.find(s => s.id === link.station2Id)
    if (!s1 || !s2) return null
    return linkBudget(s1, s2)
  },

  getInterferences: (stationId) => {
    const station = get().stations.find(s => s.id === stationId)
    if (!station) return []
    return get().stations.filter(
      other => other.id !== stationId && stationsInterfere(station, other),
    )
  },

  interferenceCount: () => {
    const { stations } = get()
    let count = 0
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        if (stationsInterfere(stations[i], stations[j])) count++
      }
    }
    return count
  },

  totalCoverageArea: () =>
    get().stations.reduce((sum, s) => sum + Math.PI * s.radius * s.radius, 0),

  // ── Import / Export ────────────────────────────────────────────────────────
  exportJSON: () => JSON.stringify({ stations: get().stations, links: get().links }, null, 2),

  importJSON: (raw) => {
    try {
      const { stations, links } = JSON.parse(raw)
      const recomputedStations: Station[] = stations.map((s: Station) =>
        withComputedRadius({ ...s, elevation: s.elevation ?? 0, beamwidth: s.beamwidth ?? 360 })
      )
      const maxId = [...stations, ...links].reduce((m: number, x: any) => Math.max(m, x.id || 0), 0)
      _nextEntityId = maxId + 1
      set({
        stations: recomputedStations, links,
        selId: null, linkSrc: null,
        coveragePolygons: {}, coverageDiagnostics: {}, terrainLinkStats: {},
        coverageRays: {},
      })
      recomputedStations.forEach((st: Station) => get().fetchStationElevation(st.id))
      links.forEach((l: Link) => get().recomputeLinkTerrain(l.id))
    } catch (error) {
      console.error('Import failed:', error)
    }
  },

  // ── Visibility toggles ─────────────────────────────────────────────────────
  toggleHeatmap:   () => set(s => ({ heatmapVisible:  !s.heatmapVisible })),
  setCoverageOpacity: (opacity) => set({
    coverageOpacity: Math.min(1, Math.max(0.15, opacity)),
  }),
  // Hillshade and topo are mutually exclusive — enabling one disables the other
  toggleHillshade: () => set(s => ({
    hillshadeVisible: !s.hillshadeVisible,
    topoMapEnabled:   s.hillshadeVisible ? s.topoMapEnabled : false,
  })),
  toggleTerrain3d: () => set(s => ({ terrain3dEnabled: !s.terrain3dEnabled })),
  toggleTopoMap:    () => set(s => ({
    topoMapEnabled:   !s.topoMapEnabled,
    hillshadeVisible: s.topoMapEnabled ? s.hillshadeVisible : false,
  })),
  toggleBuildings:  () => {
    const wasVisible = get().buildingsVisible
    set({ buildingsVisible: !wasVisible })
    // When enabling buildings: recompute coverage for all existing stations
    // so their polygons include building obstacles (not just terrain).
    if (!wasVisible) {
      get().stations.forEach(s => get().fetchStationElevation(s.id))
    }
  },
  toggleDiagnosticMode: () => set(s => ({ diagnosticMode: !s.diagnosticMode })),

  // ── Async terrain computation (via Next.js API routes) ────────────────────

  /**
   * Single entry point for station terrain work:
   * 1. Calls /api/coverage which fetches Terrarium tiles server-side
   * 2. Receives ground elevation + all 5 coverage polygons in one response
   * 3. Updates store atomically
   *
   * Replaces the old fetchStationElevation + recomputePolygon pair.
   */
  fetchStationElevation: async (stationId) => {
    const station = get().stations.find(s => s.id === stationId)
    if (!station) return

    set(s => ({ polygonPending: { ...s.polygonPending, [stationId]: true } }))

    try {
      const response = await fetch('/api/coverage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ station }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const { elevation, polygons, diagnostics, bearings } = await response.json()

      set(s => ({
        stations: s.stations.map(st =>
          st.id === stationId ? { ...st, elevation } : st
        ),
        coveragePolygons: { ...s.coveragePolygons, [stationId]: polygons },
        coverageDiagnostics: {
          ...s.coverageDiagnostics,
          [stationId]: diagnostics ?? {
            buildingsUsed: false,
            buildingsCount: 0,
            buildingsSource: 'none',
            blockedSamples: 0,
            totalSamples: 0,
            samplesUsed: 0,
            obstructedBearings: 0,
            totalBearings: 0,
            meanObstructionKm: null,
            meanBuildingLossDb: 0,
            maxBuildingLossDb: 0,
            buildingHitSamples: 0,
          },
        },
        coverageRays: {
          ...s.coverageRays,
          [stationId]: (bearings as BearingDiagnostic[] | undefined) ?? [],
        },
        polygonPending:   { ...s.polygonPending,   [stationId]: false },
      }))

      // Refresh link budgets for all links connected to this station
      get().links
        .filter(link => link.station1Id === stationId || link.station2Id === stationId)
        .forEach(link => get().recomputeLinkTerrain(link.id))

    } catch (error) {
      console.warn('Coverage computation failed for station', stationId, error)
      const stationName = get().stations.find(s => s.id === stationId)?.name ?? `#${stationId}`
      useToastStore.getState().addToast(
        'error',
        `Calculul coverage a eșuat pentru ${stationName}. Verifică conexiunea la internet.`,
      )
      set(s => ({
        polygonPending: { ...s.polygonPending, [stationId]: false },
        coverageDiagnostics: {
          ...s.coverageDiagnostics,
          [stationId]: {
            buildingsUsed: false,
            buildingsCount: 0,
            buildingsSource: 'none',
            blockedSamples: 0,
            totalSamples: 0,
            samplesUsed: 0,
            obstructedBearings: 0,
            totalBearings: 0,
            meanObstructionKm: null,
            meanBuildingLossDb: 0,
            maxBuildingLossDb: 0,
            buildingHitSamples: 0,
          },
        },
      }))
    }
  },

  /**
   * Compute terrain-aware link budget for a link via /api/link-budget.
   */
  recomputeLinkTerrain: async (linkId) => {
    const { links, stations } = get()
    const link = links.find(l => l.id === linkId)
    if (!link) return
    const s1 = stations.find(s => s.id === link.station1Id)
    const s2 = stations.find(s => s.id === link.station2Id)
    if (!s1 || !s2) return

    try {
      const response = await fetch('/api/link-budget', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ station1: s1, station2: s2 }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const { stats } = await response.json()

      set(s => ({ terrainLinkStats: { ...s.terrainLinkStats, [linkId]: stats } }))

      // Warn about frequency mismatch after terrain computation confirms the link
      if (stats.frequencyMismatch) {
        const { links: currentLinks, stations: currentStations } = get()
        const lnk = currentLinks.find(l => l.id === linkId)
        const s1 = currentStations.find(s => s.id === lnk?.station1Id)
        const s2 = currentStations.find(s => s.id === lnk?.station2Id)
        if (s1 && s2) {
          useToastStore.getState().addToast(
            'warn',
            `Frecvențe incompatibile: ${s1.name} (${s1.freq} MHz) ↔ ${s2.name} (${s2.freq} MHz). Linkul nu va funcționa fizic.`,
            6000,
          )
        }
      }
    } catch (error) {
      console.warn('Link terrain computation failed for link', linkId, error)
      useToastStore.getState().addToast(
        'error',
        'Calculul link budget a eșuat. Verifică conexiunea la internet.',
      )
    }
  },
}))
