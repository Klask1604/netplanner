'use client'
import { Map, AlertTriangle, Link2 } from 'lucide-react'
import { useNetStore } from '@/store/netStore'
import { STATION_TYPES } from '@/lib/rf'
import StationIcon from '@/components/ui/StationIcon'
import styles from './StationList.module.css'

export default function StationList() {
  const { stations, links, selId, selectStation, getInterferences } = useNetStore()

  if (stations.length === 0) {
    return (
      <div className={styles.empty}>
        <Map size={32} strokeWidth={1} className={styles.emptyIcon} />
        Selectează un tool din stânga<br />și click pe hartă pentru<br />a plasa stații
      </div>
    )
  }

  return (
    <div>
      {stations.map(st => {
        const cfg = STATION_TYPES[st.type]
        const isSel = st.id === selId
        const hasInterf = getInterferences(st.id).length > 0
        const hasLink = links.some(l => l.station1Id === st.id || l.station2Id === st.id)

        return (
          <div
            key={st.id}
            onClick={() => selectStation(isSel ? null : st.id)}
            className={`fade-in ${styles.item} ${isSel ? styles.selected : ''}`}
            style={{ '--station-color': cfg.color } as React.CSSProperties}
          >
            <div
              className={styles.dot}
              style={{
                background: cfg.color,
                boxShadow: hasInterf ? `0 0 6px ${cfg.color}` : 'none',
              }}
            />
            <div className={styles.itemContent}>
              <div className={styles.itemName}>{st.name}</div>
              <div className={styles.itemSub}>
                <StationIcon type={st.type} size={11} strokeWidth={1.5} style={{ color: cfg.color }} />
                {cfg.name} · {st.radius.toFixed(2)} km
                {hasInterf && <AlertTriangle size={10} strokeWidth={2} style={{ color: 'var(--amber)' }} />}
                {hasLink && <Link2 size={10} strokeWidth={2} style={{ color: 'var(--purple)' }} />}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
