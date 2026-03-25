import { create } from 'zustand'
import {
  Station,
  Link,
  LinkStats,
  StationType,
  ToolType,
  CoveragePolygons,
  STATION_TYPES,
  okumuraHata,
  freeSpaceRadius,
  linkBudget,
} from '@/lib/rf'

interface NetStore {
  // ── State ──────────────────────────────────────────────────────────────────
  stations:          Station[]
  links:             Link[]
  selId:             number | null
  tool:              ToolType
  linkSrc:           number | null
  counters:          Record<StationType, number>
  coveragePolygons:  Record<number, CoveragePolygons>
  polygonPending:    Record<number, boolean>
  terrainLinkStats:  Record<number, LinkStats>
  heatmapVisible:    boolean
  hillshadeVisible:  boolean
  terrain3dEnabled:  boolean
  topoMapEnabled:    boolean
  buildingsVisible:  boolean

  // ── Actions ────────────────────────────────────────────────────────────────
  setTool:               (tool: ToolType) => void
  addStation:            (lat: number, lng: number, type: StationType) => void
  removeStation:         (id: number) => void
  updateStation:         (id: number, patch: Partial<Station>) => void
  selectStation:         (id: number | null) => void
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
  toggleHillshade:       () => void
  toggleTerrain3d:       () => void
  toggleTopoMap:         () => void
  toggleBuildings:       () => void
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
  tool:             'select',
  linkSrc:          null,
  counters:         { bts: 0, antenna: 0, router: 0, repeater: 0 },
  coveragePolygons: {},
  polygonPending:   {},
  terrainLinkStats: {},
  heatmapVisible:   false,
  hillshadeVisible:  false,
  terrain3dEnabled:  false,
  topoMapEnabled:    false,
  buildingsVisible:  false,

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
      const { [id]: _pp, ...remainingPending  } = s.polygonPending
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
        polygonPending:   remainingPending,
        terrainLinkStats: remainingBudgets,
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

  selectStation: (id) => set({ selId: id }),

  // ── Links ──────────────────────────────────────────────────────────────────
  startLink: (stationId) => set({ linkSrc: stationId }),

  completeLink: (targetStationId) => {
    const { linkSrc, links } = get()
    if (!linkSrc || linkSrc === targetStationId) { set({ linkSrc: null }); return }
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
      return { links: s.links.filter(l => l.id !== id), terrainLinkStats: remainingBudgets }
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
    return get().stations.filter(other => {
      if (other.id === stationId || other.type !== station.type) return false
      const dx = (station.lat - other.lat) * 111.32
      const dy = (station.lng - other.lng) * 111.32 * Math.cos(station.lat * Math.PI / 180)
      return Math.sqrt(dx * dx + dy * dy) < station.radius + other.radius
    })
  },

  interferenceCount: () => {
    const { stations } = get()
    let count = 0
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const a = stations[i], b = stations[j]
        if (a.type !== b.type) continue
        const dx = (a.lat - b.lat) * 111.32
        const dy = (a.lng - b.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180)
        if (Math.sqrt(dx * dx + dy * dy) < a.radius + b.radius) count++
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
        coveragePolygons: {}, terrainLinkStats: {},
      })
      recomputedStations.forEach((st: Station) => get().fetchStationElevation(st.id))
      links.forEach((l: Link) => get().recomputeLinkTerrain(l.id))
    } catch (error) {
      console.error('Import failed:', error)
    }
  },

  // ── Visibility toggles ─────────────────────────────────────────────────────
  toggleHeatmap:   () => set(s => ({ heatmapVisible:  !s.heatmapVisible })),
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
      const { elevation, polygons } = await response.json()

      set(s => ({
        stations: s.stations.map(st =>
          st.id === stationId ? { ...st, elevation } : st
        ),
        coveragePolygons: { ...s.coveragePolygons, [stationId]: polygons },
        polygonPending:   { ...s.polygonPending,   [stationId]: false },
      }))

      // Refresh link budgets for all links connected to this station
      get().links
        .filter(link => link.station1Id === stationId || link.station2Id === stationId)
        .forEach(link => get().recomputeLinkTerrain(link.id))

    } catch (error) {
      console.warn('Coverage computation failed for station', stationId, error)
      set(s => ({ polygonPending: { ...s.polygonPending, [stationId]: false } }))
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
    } catch (error) {
      console.warn('Link terrain computation failed for link', linkId, error)
    }
  },
}))
