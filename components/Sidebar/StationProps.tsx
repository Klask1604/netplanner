'use client'
import { AlertTriangle, ChevronLeft, Trash2, X, WifiOff } from 'lucide-react'
import { useNetStore } from '@/store/netStore'
import { STATION_TYPES, calcEIRP, linkBudget } from '@/lib/rf'
import PropRow from '@/components/ui/PropRow'
import Metric from '@/components/ui/Metric'
import SectionTitle from '@/components/ui/SectionTitle'
import StationIcon from '@/components/ui/StationIcon'
import styles from './StationProps.module.css'

export default function StationProps() {
  const { selId, stations, links, updateStation, removeStation, removeLink, selectStation, polygonPending } = useNetStore()
  const station = stations.find(s => s.id === selId)
  if (!station) return null

  const isPending      = polygonPending[station.id] ?? false
  const stationConfig  = STATION_TYPES[station.type]
  const eirp           = calcEIRP(station)
  const maxPathLoss    = eirp - station.sens

  const update = (key: keyof typeof station) => (value: number) =>
    updateStation(station.id, { [key]: value } as any)

  const interferers = stations.filter(other => {
    if (other.id === station.id || other.type !== station.type) return false
    const dx = (station.lat - other.lat) * 111.32
    const dy = (station.lng - other.lng) * 111.32 * Math.cos(station.lat * Math.PI / 180)
    return Math.sqrt(dx * dx + dy * dy) < station.radius + other.radius
  })

  const stationLinks = links
    .filter(link => link.station1Id === station.id || link.station2Id === station.id)
    .map(link => {
      const otherId    = link.station1Id === station.id ? link.station2Id : link.station1Id
      const other      = stations.find(s => s.id === otherId)
      const linkStats  = other ? linkBudget(station, other) : null
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
        <div className={styles.warning}>
          <AlertTriangle size={13} strokeWidth={1.75} className={styles.warningIcon} />
          Interferență cu {interferers.map(i => i.name).join(', ')}
        </div>
      )}

      {isInactiveRepeater && (
        <div className={styles.repeaterInactive}>
          <WifiOff size={13} strokeWidth={1.75} />
          Repeater inactiv — fara acoperire pana nu e linkeduit la un BTS/Antena cu link OK
        </div>
      )}

      <SectionTitle>Parametri RF</SectionTitle>
      <PropRow label="TX Power"       value={station.txPower}          unit="dBm" onChange={update('txPower')}   min={0}   max={60} />
      <PropRow label="Gain antenă"    value={station.gain}             unit="dBi" onChange={update('gain')}      min={0}   max={40} />
      <PropRow label="Frecvență"      value={station.freq}             unit="MHz" onChange={update('freq')}      min={1} />
      <PropRow label="Înălțime BTS"   value={station.height}           unit="m"   onChange={update('height')}   min={0.1} />
      <PropRow label="Sensitivitate"  value={station.sens}             unit="dBm" onChange={update('sens')}      max={0} />
      <PropRow label="Azimut"         value={station.azimuth}          unit="°"   onChange={update('azimuth')}  min={0}   max={360} />
      <PropRow label="Unghi fascicul" value={station.beamwidth ?? 360} unit="°"   onChange={update('beamwidth')} min={1}  max={360} />

      <SectionTitle>Metrici Calculați</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Metric label="EIRP"          value={`${eirp.toFixed(0)} dBm`} />
        <Metric label="Max Path Loss" value={`${maxPathLoss.toFixed(0)} dB`} />
      </div>
      <Metric label="Coverage Radius (Okumura-Hata)" value={`${station.radius.toFixed(3)} km`}                          color="var(--green)" />
      <Metric label="Coverage Area"                  value={`${(Math.PI * station.radius * station.radius).toFixed(2)} km²`} color="var(--green)" />

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
                {linkStats.beamMisaligned && (
                  <div className={styles.linkTerrain} style={{ color: 'var(--red)' }}>
                    Fascicul nealiniat — antena nu vizeaza statia destinatie
                  </div>
                )}
                {!linkStats.beamMisaligned && linkStats.diffractionLoss > 0 && (
                  <div className={styles.linkTerrain}>
                    Terrain: +{linkStats.diffractionLoss.toFixed(1)} dB{' '}
                    {linkStats.losObstructed
                      ? <span style={{ color: 'var(--amber)' }}>⚠ LOS blocked</span>
                      : <span style={{ color: 'var(--dim)' }}>Fresnel</span>
                    }
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
        <div className={styles.pendingHint}>calculare polygon...</div>
      )}

      <button className={styles.deleteBtn} onClick={() => removeStation(station.id)}>
        <Trash2 size={12} strokeWidth={1.75} /> ȘTERGE STAȚIE
      </button>
    </div>
  )
}
