'use client'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { useNetStore } from '@/store/netStore'
import { STATION_TYPES } from '@/lib/rf'
import SectionTitle from '@/components/ui/SectionTitle'
import Metric from '@/components/ui/Metric'
import StationIcon from '@/components/ui/StationIcon'
import styles from './LinkProps.module.css'

export default function LinkProps() {
  const { selLinkId, links, stations, getLinkStats, removeLink, selectLink } = useNetStore()

  const link = links.find(l => l.id === selLinkId)
  if (!link) return null
  const s1 = stations.find(s => s.id === link.station1Id)
  const s2 = stations.find(s => s.id === link.station2Id)
  if (!s1 || !s2) return null

  const stats = getLinkStats(link.id)

  const handleDelete = () => {
    removeLink(link.id)
    selectLink(null)
  }

  const marginColor = !stats
    ? 'var(--dim)'
    : stats.ok
      ? (stats.losObstructed ? 'var(--amber)' : 'var(--green)')
      : 'var(--red)'

  return (
    <div className={`fade-in ${styles.container}`}>
      <div className={styles.header}>
        <div className={styles.badge}>Link RF</div>
        <button className={styles.backBtn} onClick={() => selectLink(null)}>
          <ChevronLeft size={14} strokeWidth={1.5} /> Back
        </button>
      </div>

      {/* ── Stații ── */}
      <div className={styles.stationsBox}>
        <div className={styles.stationRow} style={{ '--c': STATION_TYPES[s1.type].color } as React.CSSProperties}>
          <StationIcon type={s1.type} size={11} strokeWidth={1.75} />
          <span className={styles.stationName}>{s1.name}</span>
          <span className={styles.stationFreq}>{s1.freq} MHz</span>
        </div>
        <div className={styles.linkArrow}>↕ {stats ? `${stats.distance.toFixed(3)} km` : '—'}</div>
        <div className={styles.stationRow} style={{ '--c': STATION_TYPES[s2.type].color } as React.CSSProperties}>
          <StationIcon type={s2.type} size={11} strokeWidth={1.75} />
          <span className={styles.stationName}>{s2.name}</span>
          <span className={styles.stationFreq}>{s2.freq} MHz</span>
        </div>
      </div>

      {stats ? (
        <>
          <SectionTitle>Link Budget</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Metric label="FSPL" value={`${stats.fspl.toFixed(1)} dB`} />
            <Metric label="Rx Power" value={`${stats.rxPower.toFixed(1)} dBm`} />
          </div>
          <Metric
            label="Margin (deasupra sens.)"
            value={`${stats.margin.toFixed(1)} dB`}
            color={marginColor}
          />
          {stats.diffractionLoss > 0 && (
            <Metric label="Pierdere diffracție teren" value={`+${stats.diffractionLoss.toFixed(1)} dB`} color="var(--amber)" />
          )}

          <SectionTitle>Status LOS</SectionTitle>
          <div className={styles.statusList}>
            {stats.beamMisaligned && (
              <div className={styles.statusRow} style={{ color: 'var(--red)' }}>
                [FAIL] Fascicul nealiniat — antena nu vizeaza statia destinatie
              </div>
            )}
            {!stats.beamMisaligned && stats.losObstructed && (
              <div className={styles.statusRow} style={{ color: 'var(--red)' }}>
                [FAIL] LOS blocat — obstacol fizic pe traseul semnalului
              </div>
            )}
            {!stats.beamMisaligned && !stats.losObstructed && stats.diffractionLoss > 0 && (
              <div className={styles.statusRow} style={{ color: 'var(--amber)' }}>
                [WARN] Diffractie Fresnel — teren atenueaza partial semnalul
              </div>
            )}
            {stats.frequencyMismatch && (
              <div className={styles.statusRow} style={{ color: 'var(--amber)' }}>
                [WARN] Frecvente incompatibile ({s1.freq} MHz / {s2.freq} MHz)
              </div>
            )}
            {!stats.beamMisaligned && !stats.losObstructed && !stats.frequencyMismatch && stats.ok && (
              <div className={styles.statusRow} style={{ color: 'var(--green)' }}>
                [OK] LOS liber — semnal neobstructionat
              </div>
            )}
            {!stats.ok && !stats.beamMisaligned && (
              <div className={styles.statusRow} style={{ color: 'var(--red)' }}>
                [FAIL] Link inactiv — margin insuficient ({stats.margin.toFixed(1)} dB)
              </div>
            )}
          </div>

          <SectionTitle>Stații</SectionTitle>
          <div className={styles.stationDetails}>
            <div className={styles.stationDetailRow}>
              <span className={styles.detailLabel}>{s1.name}</span>
              <span className={styles.detailValue}>TX {s1.txPower} dBm · G {s1.gain} dBi · {s1.height}m</span>
            </div>
            <div className={styles.stationDetailRow}>
              <span className={styles.detailLabel}>{s2.name}</span>
              <span className={styles.detailValue}>Sens {s2.sens} dBm · G {s2.gain} dBi · {s2.height}m</span>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.pending}>Se calculează link budget...</div>
      )}

      <button className={styles.deleteBtn} onClick={handleDelete}>
        <Trash2 size={12} strokeWidth={1.75} /> ȘTERGE LINK
      </button>
    </div>
  )
}
