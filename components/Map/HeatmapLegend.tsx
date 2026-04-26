"use client";
import { useNetStore } from "@/store/netStore";
import styles from "./HeatmapLegend.module.css";

export default function HeatmapLegend() {
  const { coverageOpacity, setCoverageOpacity } = useNetStore();

  return (
    <div className={styles.legend}>
      <div className={styles.title}>Nivel semnal</div>
      <div className={styles.bar} />
      <div className={styles.labels}>
        <span>+30 dB</span>
        <span>+20 dB</span>
        <span>+10 dB</span>
        <span>+5 dB</span>
        <span>Edge</span>
      </div>
      <label
        className={styles.opacityControl}
        title="Ajusteaza transparenta coverage-ului (intensitatea culorii)"
      >
        <span>Intensitate</span>
        <input
          type="range"
          min={15}
          max={100}
          step={5}
          value={Math.round(coverageOpacity * 100)}
          onChange={(event) => setCoverageOpacity(Number(event.target.value) / 100)}
        />
      </label>
    </div>
  );
}
