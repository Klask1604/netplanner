'use client'
import { AlertTriangle, ChevronLeft, Trash2, X, WifiOff } from 'lucide-react'
import { useNetStore } from '@/store/netStore'
import { STATION_TYPES, StationType, calcEIRP, stationsInterfere, haversineKm } from '@/lib/rf'
import PropRow from '@/components/ui/PropRow'
import Metric from '@/components/ui/Metric'
import SectionTitle from '@/components/ui/SectionTitle'
import StationIcon from '@/components/ui/StationIcon'
import styles from './StationProps.module.css'

const HEIGHT_LABEL: Record<StationType, string> = {
  bts:      'Înălțime turn',
  antenna:  'Înălțime pol',
  router:   'Înălțime',
  repeater: 'Înălțime catarg',
}

export default function StationProps() {
  const {
    selId, stations, links, updateStation, removeStation, removeLink, selectStation,
    polygonPending, coverageDiagnostics, fetchStationElevation,
    diagnosticMode, coverageRays, getLinkStats,
  } = useNetStore()
  const station = stations.find(s => s.id === selId)
  if (!station) return null

  const isPending      = polygonPending[station.id] ?? false
  const coverageDiag   = coverageDiagnostics[station.id]
  const stationConfig  = STATION_TYPES[station.type]
  const eirp           = calcEIRP(station)
  const maxPathLoss    = eirp - station.sens

  const update = (key: keyof typeof station) => (value: number) =>
    updateStation(station.id, { [key]: value } as any)

  // Use stationsInterfere (haversine + frequency check) — no inline flat approximation.
  const interferers = stations.filter(
    other => other.id !== station.id && stationsInterfere(station, other),
  )

  const stationLinks = links
    .filter(link => link.station1Id === station.id || link.station2Id === station.id)
    .map(link => {
      const otherId   = link.station1Id === station.id ? link.station2Id : link.station1Id
      const other     = stations.find(s => s.id === otherId)
      // Prefer terrain-aware stats from store (includes losObstructed, diffractionLoss).
      const linkStats = getLinkStats(link.id)
      return { link, other, linkStats }
    })

  // Repeater is active only when it has at least one OK link to a non-repeater source
  const isInactiveRepeater = station.type === 'repeater' && !stationLinks.some(
    ({ other, linkStats }) => other && other.type !== 'repeater' && linkStats?.ok
  )

  return (
    <div className={`fade-in ${styles.container}`}>
      <div className={styles.header}>
        <div
          className={styles.typeBadge}
          style={{ '--station-color': stationConfig.color } as React.CSSProperties}
        >
          <StationIcon type={station.type} size={12} strokeWidth={1.75} />
          {stationConfig.name}
        </div>
        <button className={styles.backBtn} onClick={() => selectStation(null)}>
          <ChevronLeft size={14} strokeWidth={1.5} /> Back
        </button>
      </div>

      <input
        value={station.name}
        onChange={e => updateStation(station.id, { name: e.target.value })}
        className={styles.nameInput}
      />

      {interferers.length > 0 && (
        <div
          className={styles.warning}
          title={`Ariile de acoperire ale stațiilor de același tip și frecvență se suprapun. Raza de acoperire a acestei stații: ${station.radius.toFixed(2)} km. Soluție: mărește distanța dintre stații, reduce puterea TX sau schimbă frecvența pe una din stații.`}
        >
          <AlertTriangle size={13} strokeWidth={1.75} className={styles.warningIcon} />
          <div>
            Interferență co-canal cu{' '}
            {interferers.map(i => {
              const dist = haversineKm(station.lat, station.lng, i.lat, i.lng)
              return `${i.name} (${dist.toFixed(2)} km)`
            }).join(', ')}
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              Ariile de acoperire se suprapun pe aceeași frecvență — hover pentru detalii
            </div>
          </div>
        </div>
      )}

      {isInactiveRepeater && (
        <div className={styles.repeaterInactive}>
          <WifiOff size={13} strokeWidth={1.75} />
          Repeater inactiv — fara acoperire pana nu e linkeduit la un BTS/Antena cu link OK
        </div>
      )}

      <SectionTitle>Parametri RF</SectionTitle>
      <PropRow label="TX Power"              value={station.txPower}          unit="dBm" onChange={update('txPower')}   min={0}   max={60} />
      <PropRow label="Gain antenă"           value={station.gain}             unit="dBi" onChange={update('gain')}      min={0}   max={40} />
      <PropRow label="Frecvență"             value={station.freq}             unit="MHz" onChange={update('freq')}      min={1} />
      <PropRow label={HEIGHT_LABEL[station.type]} value={station.height}      unit="m"   onChange={update('height')}   min={0.1} />
      <PropRow label="Sensitivitate"         value={station.sens}             unit="dBm" onChange={update('sens')}      max={0} />
      <PropRow label="Azimut"                value={station.azimuth}          unit="°"   onChange={update('azimuth')}  min={0}   max={360} />
      <PropRow label="Unghi fascicul"        value={station.beamwidth ?? 360} unit="°"   onChange={update('beamwidth')} min={1}  max={360} />

      <SectionTitle>Metrici Calculați</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Metric label="EIRP"          value={`${eirp.toFixed(0)} dBm`} />
        <Metric label="Max Path Loss" value={`${maxPathLoss.toFixed(0)} dB`} />
      </div>
      <Metric
        label={`Rază acoperire (${station.type === 'router' ? 'FSPL' : 'Okumura-Hata'})`}
        value={`${station.radius.toFixed(3)} km`}
        color="var(--green)"
      />
      <Metric label="Coverage Area"                  value={`${(Math.PI * station.radius * station.radius).toFixed(2)} km²`} color="var(--green)" />
      <SectionTitle>Coverage Validator</SectionTitle>
      <div className={styles.coverageValidation}>
        <div className={styles.coverageValidationRow}>
          <span>Status</span>
          <span
            style={{
              color: coverageDiag?.buildingsUsed ? 'var(--green)' : 'var(--amber)',
            }}
            title={
              coverageDiag?.buildingsUsed
                ? 'Coverage-ul este deformat cu obstacole de cladiri'
                : 'Nu s-au gasit cladiri pentru zona sau request-ul de cladiri a esuat'
            }
          >
            {coverageDiag?.buildingsUsed ? 'building-aware' : 'terrain-only'}
          </span>
        </div>
        <div className={styles.coverageValidationRow}>
          <span>Cladiri folosite</span>
          <span>{coverageDiag?.buildingsCount ?? 0}</span>
        </div>
        <div className={styles.coverageValidationRow}>
          <span>Sample-uri in cladiri</span>
          <span>{coverageDiag?.blockedSamples ?? 0}/{coverageDiag?.totalSamples ?? 0}</span>
        </div>
        <div className={styles.coverageValidationRow}>
          <span>Rezolutie</span>
          <span>{coverageDiag?.samplesUsed?.toLocaleString() ?? '—'} samples</span>
        </div>
        <div className={styles.coverageValidationRow}>
          <span>Bearings obstructionate</span>
          <span>
            {coverageDiag?.obstructedBearings ?? 0}/{coverageDiag?.totalBearings ?? 0}
          </span>
        </div>
        <div className={styles.coverageValidationRow}>
          <span>Distanta medie obstructie</span>
          <span>
            {coverageDiag?.meanObstructionKm != null
              ? `${(coverageDiag.meanObstructionKm * 1000).toFixed(0)} m`
              : '—'}
          </span>
        </div>
        {coverageDiag?.buildingUnderStation?.detected && (
          <div className={styles.coverageValidationRow}>
            <span>Cladire sub statie</span>
            <span style={{ color: 'var(--green)' }}>
              +{coverageDiag.buildingUnderStation.height.toFixed(0)} m roof
            </span>
          </div>
        )}
        {diagnosticMode && (
          <div
            className={styles.diagnosticHint}
            title={
              (coverageRays[station.id]?.length ?? 0) > 0
                ? `${coverageRays[station.id].length} raze afisate pe harta`
                : 'Razele apar dupa primul calcul de coverage'
            }
          >
            <span className={styles.diagnosticHintDot} />
            <span>
              MOD DIAGNOSTIC ACTIV — {coverageRays[station.id]?.length ?? 0} raze pe harta (hover pentru detalii)
            </span>
          </div>
        )}
        <button
          className={styles.recomputeCoverageBtn}
          onClick={() => fetchStationElevation(station.id)}
          disabled={isPending}
          title="Recalculeaza coverage-ul pentru aceasta statie"
        >
          Revalideaza coverage
        </button>
      </div>

      {stationLinks.length > 0 && (
        <>
          <SectionTitle>Linkuri ({stationLinks.length})</SectionTitle>
          {stationLinks.map(({ link, other, linkStats }) => other && linkStats ? (
            <div key={link.id} className={styles.linkItem}>
              <div>
                <div className={styles.linkName}>{other.name}</div>
                <div className={styles.linkStats}>
                  {linkStats.distance.toFixed(2)} km · Margin:{' '}
                  <span style={{ color: linkStats.ok ? (linkStats.losObstructed ? 'var(--amber)' : 'var(--green)') : 'var(--red)' }}>
                    {linkStats.beamMisaligned ? 'N/A' : `${linkStats.margin.toFixed(1)} dB`}
                  </span>
                  {!linkStats.beamMisaligned && <>{' · FSPL: '}{linkStats.fspl.toFixed(1)} dB</>}
                </div>

                {/* ── Avertismente ordonate de severitate ── */}
                {linkStats.beamMisaligned && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--red)' }}>
                    ✗ Fascicul nealiniat — antena nu vizează stația destinație
                  </div>
                )}
                {!linkStats.beamMisaligned && linkStats.losObstructed && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--red)' }}>
                    ✗ LOS blocat — obstacol fizic pe traseul semnalului
                  </div>
                )}
                {!linkStats.beamMisaligned && linkStats.frequencyMismatch && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--amber)' }}>
                    ⚠ Frecvențe incompatibile — stațiile operează pe benzi diferite
                  </div>
                )}
                {!linkStats.beamMisaligned && !linkStats.losObstructed && linkStats.diffractionLoss > 0 && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--amber)' }}>
                    ⚠ Diffracție teren: +{linkStats.diffractionLoss.toFixed(1)} dB pierdere Fresnel
                  </div>
                )}
                {!linkStats.beamMisaligned && !linkStats.losObstructed && !linkStats.frequencyMismatch && linkStats.ok && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--green)' }}>
                    ✓ LOS liber
                  </div>
                )}
              </div>
              <button className={styles.removeLinkBtn} onClick={() => removeLink(link.id)}>
                <X size={13} strokeWidth={1.75} />
              </button>
            </div>
          ) : null)}
        </>
      )}

      <SectionTitle>Locație</SectionTitle>
      <div className={styles.coords}>
        Lat: <span className={styles.coordValue}>{station.lat.toFixed(6)}</span><br />
        Lng: <span className={styles.coordValue}>{station.lng.toFixed(6)}</span>
      </div>
      <PropRow
        label="Elevație teren"
        value={station.elevation}
        unit="m AMSL"
        onChange={update('elevation')}
        min={0}
      />
      {isPending && (
        <div className={styles.pendingHint}>
          <span className={styles.pendingSpinner} />
          Calcul HD coverage (28 800 samples)...
        </div>
      )}

      <button className={styles.deleteBtn} onClick={() => removeStation(station.id)}>
        <Trash2 size={12} strokeWidth={1.75} /> ȘTERGE STAȚIE
      </button>
    </div>
  )
}
