'use client'
import { X, FlaskConical, CheckCircle, XCircle, Radio } from 'lucide-react'
import { Station, okumuraHata, linkBudget, calcEIRP, STATION_TYPES } from '@/lib/rf'
import { useNetStore } from '@/store/netStore'
import styles from './CalcDebugModal.module.css'

interface Props {
  isOpen: boolean
  onClose: () => void
}

// ─── Okumura-Hata pas cu pas ──────────────────────────────────────────────────

function OkumuraHataSteps({ station }: { station: Station }) {
  const freq        = Math.max(station.freq, 150)
  const baseHeight  = Math.max(station.height, 5)
  const mobileHeight = 1.5
  const eirp        = station.txPower + station.gain
  const maxPathLoss = eirp - station.sens
  const mobileHeightFactor = (1.1 * Math.log10(freq) - 0.7) * mobileHeight - (1.56 * Math.log10(freq) - 0.8)
  const slope       = 44.9 - 6.55 * Math.log10(baseHeight)
  const intercept   = 69.55 + 26.16 * Math.log10(freq) - 13.82 * Math.log10(baseHeight) - mobileHeightFactor
  const logDistance = (maxPathLoss - intercept) / slope
  const radius      = Math.min(Math.max(Math.pow(10, logDistance), 0.05), 40)

  return (
    <div className={styles.stepsBlock}>
      <div className={styles.stepsTitle}>Okumura-Hata — Raza de acoperire</div>
      <div className={styles.stepsGrid}>
        <Step label="EIRP" formula={`TxPower + Gain = ${station.txPower} + ${station.gain}`} result={`${eirp} dBm`} />
        <Step label="MaxPathLoss" formula={`EIRP − Sensitivitate = ${eirp} − (${station.sens})`} result={`${maxPathLoss.toFixed(2)} dB`} />
        <Step label="freq (clamp ≥150)" formula={`max(${station.freq}, 150)`} result={`${freq} MHz`} />
        <Step label="baseHeight (clamp ≥5)" formula={`max(${station.height}, 5)`} result={`${baseHeight} m`} />
        <Step label="mobileHeightFactor" formula={`(1.1·log₁₀${freq} − 0.7)·${mobileHeight} − (1.56·log₁₀${freq} − 0.8)`} result={mobileHeightFactor.toFixed(4)} />
        <Step label="slope" formula={`44.9 − 6.55·log₁₀(${baseHeight})`} result={slope.toFixed(4)} />
        <Step label="intercept K" formula={`69.55 + 26.16·log₁₀${freq} − 13.82·log₁₀${baseHeight} − mhf`} result={intercept.toFixed(4)} />
        <Step label="log₁₀(d)" formula={`(MaxPL − K) / slope = (${maxPathLoss.toFixed(2)} − ${intercept.toFixed(2)}) / ${slope.toFixed(2)}`} result={logDistance.toFixed(4)} />
        <Step label="radius = 10^log₁₀(d)" formula={`10^${logDistance.toFixed(4)}`} result={`${Math.pow(10, logDistance).toFixed(4)} km`} highlight />
        <Step label="radius (clamp [0.05, 40])" formula={`min(max(${Math.pow(10, logDistance).toFixed(3)}, 0.05), 40)`} result={`${radius.toFixed(3)} km`} highlight accent />
      </div>
    </div>
  )
}

// ─── Link Budget pas cu pas ───────────────────────────────────────────────────

function LinkBudgetSteps({ s1, s2 }: { s1: Station, s2: Station }) {
  const deltaX   = (s1.lat - s2.lat) * 111.32
  const deltaY   = (s1.lng - s2.lng) * 111.32 * Math.cos((s1.lat * Math.PI) / 180)
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const avgFreq  = (s1.freq + s2.freq) / 2
  const fspl     = distance < 0.001 ? 0 : 20 * Math.log10(distance) + 20 * Math.log10(avgFreq) + 32.44
  const rxPower  = s1.txPower + s1.gain - fspl + s2.gain
  const margin   = rxPower - s2.sens
  const ok       = margin > 0

  return (
    <div className={styles.stepsBlock}>
      <div className={styles.stepsTitle}>Free-Space Path Loss — Link Budget</div>
      <div className={styles.stepsGrid}>
        <Step label="Δlat → Δx (km)" formula={`(${s1.lat.toFixed(4)} − ${s2.lat.toFixed(4)}) × 111.32`} result={`${deltaX.toFixed(4)} km`} />
        <Step label="Δlng → Δy (km)" formula={`(${s1.lng.toFixed(4)} − ${s2.lng.toFixed(4)}) × 111.32 × cos(lat₁)`} result={`${deltaY.toFixed(4)} km`} />
        <Step label="Distanță" formula={`√(Δx² + Δy²) = √(${(deltaX*deltaX).toFixed(3)} + ${(deltaY*deltaY).toFixed(3)})`} result={`${distance.toFixed(4)} km`} highlight />
        <Step label="Frecvență medie" formula={`(${s1.freq} + ${s2.freq}) / 2`} result={`${avgFreq.toFixed(1)} MHz`} />
        <Step label="FSPL" formula={`20·log₁₀(${distance.toFixed(3)}) + 20·log₁₀(${avgFreq.toFixed(0)}) + 32.44`} result={`${fspl.toFixed(2)} dB`} highlight />
        <Step label="EIRP sursă" formula={`TxPower₁ + Gain₁ = ${s1.txPower} + ${s1.gain}`} result={`${s1.txPower + s1.gain} dBm`} />
        <Step label="RxPower" formula={`EIRP − FSPL + Gain₂ = ${s1.txPower+s1.gain} − ${fspl.toFixed(2)} + ${s2.gain}`} result={`${rxPower.toFixed(2)} dBm`} highlight />
        <Step label="Margin" formula={`RxPower − Sens₂ = ${rxPower.toFixed(2)} − (${s2.sens})`} result={`${margin.toFixed(2)} dB`} highlight accent={ok} accentRed={!ok} />
        <Step label="Link OK?" formula={`Margin > 0 dB ?`} result={ok ? '✓ DA' : '✗ NU'} accent={ok} accentRed={!ok} />
      </div>
    </div>
  )
}

// ─── Step row ─────────────────────────────────────────────────────────────────

interface StepProps {
  label: string
  formula: string
  result: string
  highlight?: boolean
  accent?: boolean
  accentRed?: boolean
}

function Step({ label, formula, result, highlight, accent, accentRed }: StepProps) {
  return (
    <div className={`${styles.step} ${highlight ? styles.stepHighlight : ''}`}>
      <div className={styles.stepLabel}>{label}</div>
      <div className={styles.stepFormula}>{formula}</div>
      <div className={`${styles.stepResult} ${accent ? styles.resultGreen : ''} ${accentRed ? styles.resultRed : ''}`}>
        = {result}
      </div>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function CalcDebugModal({ isOpen, onClose }: Props) {
  const { stations, links, selId } = useNetStore()
  const selectedStation = stations.find(s => s.id === selId)

  if (!isOpen) return null

  const myLinks = selectedStation
    ? links
        .filter(l => l.station1Id === selectedStation.id || l.station2Id === selectedStation.id)
        .map(l => {
          const otherId = l.station1Id === selectedStation.id ? l.station2Id : l.station1Id
          return stations.find(s => s.id === otherId)
        })
        .filter((s): s is Station => !!s)
    : []

  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <FlaskConical size={16} strokeWidth={1.5} className={styles.headerIcon} />
            <div>
              <div className={styles.modalTitle}>Validare Calcule RF</div>
              <div className={styles.modalSubtitle}>
                {selectedStation
                  ? `Stație selectată: ${selectedStation.name}`
                  : 'Nicio stație selectată — selectează una din hartă'
                }
              </div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {!selectedStation ? (
            <div className={styles.emptyState}>
              <Radio size={32} strokeWidth={1} className={styles.emptyIcon} />
              <p>Selectează o stație din hartă sau din lista din sidebar,<br />
                 apoi redeschide acest panou pentru a vedea calculele detaliate.</p>
            </div>
          ) : (
            <>
              {/* Info stație */}
              <StationInfoCard station={selectedStation} />

              {/* Okumura-Hata */}
              <OkumuraHataSteps station={selectedStation} />

              {/* Link budgets pentru toate link-urile stației */}
              {myLinks.length > 0 && (
                <div>
                  <div className={styles.sectionTitle}>
                    Link Budgets ({myLinks.length} link{myLinks.length > 1 ? 'uri' : ''})
                  </div>
                  {myLinks.map(other => (
                    <div key={other.id} className={styles.linkBudgetWrap}>
                      <div className={styles.linkHeader}>
                        <span className={styles.linkName}>{selectedStation.name}</span>
                        <span className={styles.linkArrow}>↔</span>
                        <span className={styles.linkName}>{other.name}</span>
                        {(() => {
                          const stats = linkBudget(selectedStation, other)
                          return (
                            <span className={styles.linkStatus}>
                              {stats.ok
                                ? <CheckCircle size={13} strokeWidth={2} className={styles.iconGreen} />
                                : <XCircle    size={13} strokeWidth={2} className={styles.iconRed} />
                              }
                              {stats.ok ? 'OK' : 'FAIL'} · {stats.margin.toFixed(1)} dB margin
                            </span>
                          )
                        })()}
                      </div>
                      <LinkBudgetSteps s1={selectedStation} s2={other} />
                    </div>
                  ))}
                </div>
              )}

              {myLinks.length === 0 && (
                <div className={styles.noLinks}>
                  Niciun link creat pentru această stație.
                  Folosește modul <b>Link RF</b> din toolbar pentru a crea conexiuni.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <span className={styles.footerNote}>
            Formule: <span>Okumura-Hata (urban)</span> + <span>FSPL (Friis)</span>
          </span>
          <span className={styles.footerNote}>lib/rf.ts</span>
        </div>

      </div>
    </div>
  )
}

// ─── Station info card ────────────────────────────────────────────────────────

function StationInfoCard({ station }: { station: Station }) {
  const cfg  = STATION_TYPES[station.type]
  const eirp = calcEIRP(station)

  return (
    <div className={styles.stationCard}>
      <div className={styles.stationCardHeader} style={{ '--station-color': cfg.color } as React.CSSProperties}>
        <div className={styles.stationDot} style={{ background: cfg.color }} />
        <div className={styles.stationCardName}>{station.name}</div>
        <div className={styles.stationCardType}>{cfg.name}</div>
      </div>
      <div className={styles.stationParams}>
        <Param label="TX Power"    value={`${station.txPower} dBm`} />
        <Param label="Gain"        value={`${station.gain} dBi`} />
        <Param label="EIRP"        value={`${eirp} dBm`} accent />
        <Param label="Frecvență"   value={`${station.freq} MHz`} />
        <Param label="Înălțime"    value={`${station.height} m`} />
        <Param label="Sensit."     value={`${station.sens} dBm`} />
        <Param label="Radius calc" value={`${station.radius.toFixed(3)} km`} accent />
        <Param label="Lat / Lng"   value={`${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}`} />
      </div>
    </div>
  )
}

function Param({ label, value, accent }: { label: string, value: string, accent?: boolean }) {
  return (
    <div className={styles.param}>
      <div className={styles.paramLabel}>{label}</div>
      <div className={`${styles.paramValue} ${accent ? styles.paramAccent : ''}`}>{value}</div>
    </div>
  )
}
