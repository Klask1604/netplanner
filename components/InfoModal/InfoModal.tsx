'use client'
import {
  X, MousePointer2, RadioTower, Antenna, Router, Satellite,
  ArrowLeftRight, Trash2, Link2, Cpu, FileJson, Map,
} from 'lucide-react'
import styles from './InfoModal.module.css'

interface InfoModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ToolItemProps {
  icon: React.ReactNode
  color: string
  name: string
  desc: string
}

function ToolItem({ icon, color, name, desc }: ToolItemProps) {
  return (
    <div className={styles.toolItem}>
      <div className={styles.toolIconWrap} style={{ borderColor: color, color }}>
        {icon}
      </div>
      <div className={styles.toolInfo}>
        <div className={styles.toolName}>{name}</div>
        <div className={styles.toolDesc}>{desc}</div>
      </div>
    </div>
  )
}

export default function InfoModal({ isOpen, onClose }: InfoModalProps) {
  if (!isOpen) return null

  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalTitle}>NetPlanner</div>
            <div className={styles.modalSubtitle}>Ghid de utilizare — RF Network Planning Tool</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>

          {/* Introducere */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Map size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Ce este NetPlanner?</span>
            </div>
            <p className={styles.sectionText}>
              NetPlanner este un instrument de <b>planificare a rețelelor RF</b> pentru ingineri de
              telecomunicații. Permite plasarea stațiilor de rețea pe o hartă interactivă,
              configurarea parametrilor RF și simularea acoperirii și a link-urilor dintre stații
              folosind modele matematice reale (<b>Okumura-Hata</b> și <b>Free-Space Path Loss</b>).
            </p>
          </div>

          {/* Instrumente */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <MousePointer2 size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Instrumente (Toolbar)</span>
            </div>
            <div className={styles.toolGrid}>
              <ToolItem
                icon={<MousePointer2 size={14} strokeWidth={1.5} />}
                color="#00d4ff"
                name="Select / Move"
                desc="Selectează sau trage stațiile pe hartă. Click pe hartă gol deselectează."
              />
              <ToolItem
                icon={<RadioTower size={14} strokeWidth={1.5} />}
                color="#00d4ff"
                name="BTS / eNodeB"
                desc="Plasează o stație de bază (900 MHz, 43 dBm, 15 dBi, h=30m)."
              />
              <ToolItem
                icon={<Antenna size={14} strokeWidth={1.5} />}
                color="#ff8c00"
                name="Antenă Radio"
                desc="Plasează o antenă radio (2.4 GHz, 30 dBm, 10 dBi, h=15m)."
              />
              <ToolItem
                icon={<Router size={14} strokeWidth={1.5} />}
                color="#00ff88"
                name="Router / Switch"
                desc="Plasează un echipament de rețea (5.8 GHz, 20 dBm, 5 dBi, h=5m)."
              />
              <ToolItem
                icon={<Satellite size={14} strokeWidth={1.5} />}
                color="#cc00ff"
                name="Repeater"
                desc="Plasează un repetor RF (1.8 GHz, 37 dBm, 12 dBi, h=20m)."
              />
              <ToolItem
                icon={<ArrowLeftRight size={14} strokeWidth={1.5} />}
                color="#ffffff"
                name="Link RF"
                desc="Click pe stația sursă, apoi pe destinație pentru a crea un link cu budget RF automat."
              />
              <ToolItem
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                color="#ff3860"
                name="Ștergere"
                desc="Click pe orice stație de pe hartă pentru a o elimina din topologie."
              />
            </div>
          </div>

          {/* Parametri RF */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Cpu size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Parametri RF</span>
            </div>
            <p className={styles.sectionText}>
              Selectează o stație (click în modul <b>Select</b>) pentru a edita parametrii săi RF
              din panoul din dreapta:
            </p>
            <p className={styles.sectionText}>
              <b>TX Power (dBm)</b> — Puterea de transmisie a emițătorului.<br />
              <b>Gain antenă (dBi)</b> — Câștigul antenei față de un izotrop ideal.<br />
              <b>Frecvență (MHz)</b> — Frecvența de operare, influențează raza calculată.<br />
              <b>Înălțime BTS (m)</b> — Înălțimea stației, factor cheie în Okumura-Hata.<br />
              <b>Sensitivitate (dBm)</b> — Nivelul minim de semnal detectabil al receptorului.<br />
              <b>Azimut (°)</b> — Orientarea antenei (informativ, nu afectează cercul de acoperire).
            </p>
          </div>

          {/* Calcule RF */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Cpu size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Calcule RF</span>
            </div>

            <div>
              <div className={styles.formulaLabel}>Okumura-Hata — Raza de acoperire</div>
              <div className={styles.formula}>
                EIRP = TxPower + Gain<br />
                MaxPL = EIRP − Sensitivitate<br />
                ahm = (1.1·log₁₀f − 0.7)·hm − (1.56·log₁₀f − 0.8)<br />
                K = 69.55 + 26.16·log₁₀f − 13.82·log₁₀hb − ahm<br />
                r = 10^((MaxPL − K) / slope)  [km]
              </div>
            </div>

            <div>
              <div className={styles.formulaLabel}>Free-Space Path Loss — Link Budget</div>
              <div className={styles.formula}>
                FSPL = 20·log₁₀(d) + 20·log₁₀(f) + 32.44  [dB]<br />
                Rx = EIRP_sursa − FSPL + Gain_dest  [dBm]<br />
                Margin = Rx − Sensitivitate_dest  [dB]<br />
                Link OK ↔ Margin {'>'} 0 dB  (verde)  |  Fail ↔ Margin ≤ 0 dB  (roșu)
              </div>
            </div>

            <p className={styles.sectionText}>
              Două stații de <b>același tip</b> interferează dacă distanța dintre ele este mai mică
              decât suma razelor lor de acoperire. Un avertisment <b style={{ color: 'var(--amber)' }}>⚠</b> apare
              în lista de stații și în panoul de proprietăți.
            </p>
          </div>

          {/* Linkuri */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Link2 size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Linkuri între stații</span>
            </div>
            <p className={styles.sectionText}>
              Activează modul <b>Link RF</b> din toolbar, click pe <b>stația sursă</b>,
              apoi click pe <b>stația destinație</b>. Linia creată se colorează:
            </p>
            <p className={styles.sectionText}>
              <b style={{ color: 'var(--green)' }}>Verde</b> — link funcțional (Margin {'>'} 0 dB)<br />
              <b style={{ color: 'var(--red)' }}>Roșu</b> — link defectuos (Margin ≤ 0 dB)
            </p>
            <p className={styles.sectionText}>
              Hover pe linie → afișează distanța, FSPL, Rx și Margin calculat.
              Click pe linie → șterge link-ul. Poți gestiona linkurile și din panoul de proprietăți
              al stației.
            </p>
          </div>

          {/* Export / Import */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <FileJson size={16} strokeWidth={1.5} className={styles.sectionIcon} />
              <span className={styles.sectionTitle}>Export / Import</span>
            </div>
            <p className={styles.sectionText}>
              <b>EXPORT</b> — salvează configurația curentă (stații + linkuri) într-un fișier
              <b> .json</b>. Poți relua sesiunea ulterior fără a reintroduce datele manual.
            </p>
            <p className={styles.sectionText}>
              <b>IMPORT</b> — încarcă un fișier <b>.json</b> exportat anterior. Raza de acoperire
              este recalculată automat la import pe baza parametrilor RF.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <span className={styles.footerNote}>
            Universitatea Transilvania Brașov — <span>UNITBV Telecomunicații</span>
          </span>
          <span className={styles.footerNote}>v0.1.0</span>
        </div>

      </div>
    </div>
  )
}
