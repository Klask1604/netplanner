'use client'
import { Info, FlaskConical } from 'lucide-react'
import { useNetStore } from '@/store/netStore'
import { STATION_TYPES, ToolType } from '@/lib/rf'
import styles from './TopBar.module.css'

const TOOL_LABELS: Record<ToolType, string> = {
  select: 'SELECT', bts: 'ADD BTS', antenna: 'ADD ANTENNA',
  router: 'ADD ROUTER', repeater: 'ADD REPEATER',
  link: 'LINK MODE', delete: 'DELETE MODE',
}

interface TopBarProps {
  onInfoOpen: () => void
  onCalcDebugOpen: () => void
}

export default function TopBar({ onInfoOpen, onCalcDebugOpen }: TopBarProps) {
  const {
    stations, links, tool, interferenceCount, totalCoverageArea,
    hillshadeVisible, toggleHillshade, terrain3dEnabled, toggleTerrain3d,
    topoMapEnabled, toggleTopoMap,
    buildingsVisible, toggleBuildings,
  } = useNetStore()

  return (
    <div className={styles.bar}>
      <div className={styles.logo}>
        Net<span className={styles.logoDim}>Planner</span>
      </div>

      <div className={styles.divider} />

      <div className={styles.pill}>
        Stații <b className={styles.pillValue} style={{ color: 'var(--cyan)' }}>{stations.length}</b>
      </div>
      <div className={styles.pill}>
        Coverage <b className={styles.pillValue} style={{ color: 'var(--green)' }}>{totalCoverageArea().toFixed(1)} km²</b>
      </div>
      <div className={styles.pill}>
        Interferențe{' '}
        <b className={styles.pillValue} style={{ color: interferenceCount() > 0 ? 'var(--amber)' : 'var(--dim)' }}>
          {interferenceCount()}
        </b>
      </div>
      <div className={styles.pill}>
        Linkuri <b className={styles.pillValue} style={{ color: 'var(--purple)' }}>{links.length}</b>
      </div>

      <div className={styles.spacer}>
        <div className={styles.modeBadge}>
          MOD: <span className={styles.modeValue}>{TOOL_LABELS[tool]}</span>
        </div>
        <button
          className={`${styles.toggleBtn} ${buildingsVisible ? styles.toggleBtnActive : ''}`}
          onClick={toggleBuildings}
          title="Cladiri 3D din OpenStreetMap (afecteaza si calculul de acoperire)"
        >
          BLDG 3D
        </button>
        <button
          className={`${styles.toggleBtn} ${topoMapEnabled ? styles.toggleBtnActive : ''}`}
          onClick={toggleTopoMap}
          title="Hartă topografică cu altitudine"
        >
          TOPO
        </button>
        <button
          className={`${styles.toggleBtn} ${hillshadeVisible ? styles.toggleBtnActive : ''}`}
          onClick={toggleHillshade}
          title="Umbra de relief 2D (pe harta dark)"
        >
          HILLSHADE
        </button>
        <button
          className={`${styles.toggleBtn} ${terrain3dEnabled ? styles.toggleBtnActive : ''}`}
          onClick={toggleTerrain3d}
          title="Teren 3D (înclinare hartă)"
        >
          3D
        </button>
        <button className={styles.infoBtn} onClick={onCalcDebugOpen} title="Validare Calcule RF" style={{ color: 'var(--cyan)' }}>
          <FlaskConical size={14} strokeWidth={1.75} />
        </button>
        <button className={styles.infoBtn} onClick={onInfoOpen} title="Ajutor">
          <Info size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
