import { Station, Link, haversineKm } from './rf'

/**
 * Convertește un margin [dB] la culoare RGBA.
 *
 * Problema cu scale absolute (ex: 30dB = verde): un BTS de 900MHz cu EIRP 60dBm
 * are margin de 50+ dB chiar și la 10km, deci tot verde.
 *
 * Soluție: normalizăm margin față de maxPathLoss al stației care oferă cel mai bun
 * semnal. t=1.0 = lângă stație, t=0.0 = exact la limita acoperirii (margin=0).
 * Asta produce gradientul corect indiferent de puterea stației.
 */
function marginToRgba(margin: number, maxPathLoss: number): [number, number, number, number] {
  if (margin < 0) return [0, 0, 0, 0]

  // t = 0 la marginea acoperirii, t = 1 la stație
  // maxPathLoss = EIRP - sens = marginea maximă posibilă (la distanță 0)
  const t = Math.min(margin / maxPathLoss, 1)

  // Gradient: roșu (t=0, margine) → amber → cyan → verde (t=1, centru)
  if (t >= 0.75) {
    // verde intens → verde
    const s = (t - 0.75) / 0.25
    return [
      Math.round(0   + s * 0),
      Math.round(220 + s * 35),
      Math.round(80  + s * 56),
      Math.round(180 + s * 20),
    ]
  }
  if (t >= 0.5) {
    // cyan → verde intens
    const s = (t - 0.5) / 0.25
    return [
      Math.round(0   + s * 0),
      Math.round(200 + s * 20),
      Math.round(200 - s * 120),
      Math.round(165 + s * 15),
    ]
  }
  if (t >= 0.25) {
    // amber → cyan
    const s = (t - 0.25) / 0.25
    return [
      Math.round(255 - s * 255),
      Math.round(160 + s * 40),
      Math.round(0   + s * 200),
      Math.round(150 + s * 15),
    ]
  }
  // roșu → amber (t: 0..0.25)
  const s = t / 0.25
  return [
    255,
    Math.round(50 + s * 110),
    Math.round(80 - s * 80),
    Math.round(110 + s * 40),
  ]
}

function calcFspl(distKm: number, freqMhz: number): number {
  if (distKm < 0.001) return 0
  return 20 * Math.log10(distKm) + 20 * Math.log10(Math.max(freqMhz, 150)) + 32.44
}

/**
 * Returnează { margin, maxPathLoss } pentru cel mai bun semnal la (lat, lng).
 * maxPathLoss = EIRP - sens al stației câștigătoare, folosit pentru normalizare.
 *
 * Relay logic: dacă stația A acoperă P și există link funcțional B→A,
 * B extinde acoperirea prin A. margin_via_relay = min(margin_A_to_P, margin_link).
 */
function computeBest(
  lat: number,
  lng: number,
  stations: Station[],
  links: Link[],
): { margin: number; maxPathLoss: number } | null {
  let bestMargin     = -Infinity
  let bestMaxPL      = 1

  // Pas 1: semnal direct
  const directMargins   = new Map<number, number>()   // id → margin la (lat,lng)
  const directMaxPL     = new Map<number, number>()   // id → EIRP-sens

  for (const st of stations) {
    const dLat = Math.abs(lat - st.lat) * 111.32
    const dLng = Math.abs(lng - st.lng) * 111.32 * Math.cos(st.lat * Math.PI / 180)
    if (Math.sqrt(dLat * dLat + dLng * dLng) > st.radius * 3) continue

    const d      = haversineKm(st.lat, st.lng, lat, lng)
    const fspl   = calcFspl(d, st.freq)
    const rx     = st.txPower + st.gain - fspl
    const margin = rx - st.sens
    const maxPL  = st.txPower + st.gain - st.sens  // EIRP - sens

    directMargins.set(st.id, margin)
    directMaxPL.set(st.id, maxPL)

    if (margin > bestMargin) {
      bestMargin = margin
      bestMaxPL  = maxPL
    }
  }

  // Pas 2: relay prin link-uri
  for (const link of links) {
    const stA = stations.find(s => s.id === link.station1Id)
    const stB = stations.find(s => s.id === link.station2Id)
    if (!stA || !stB) continue

    for (const [relay, source] of [[stA, stB], [stB, stA]] as [Station, Station][]) {
      const marginRelayToPoint = directMargins.get(relay.id) ?? -Infinity
      if (marginRelayToPoint < 0) continue

      const dLink      = haversineKm(relay.lat, relay.lng, source.lat, source.lng)
      const fsplLink   = calcFspl(dLink, (source.freq + relay.freq) / 2)
      const rxAtRelay  = source.txPower + source.gain - fsplLink
      const marginLink = rxAtRelay - relay.sens
      if (marginLink < 0) continue

      const marginViaRelay = Math.min(marginRelayToPoint, marginLink)
      // maxPathLoss pentru relay = maxPL al sursei (limitantul e sursa)
      const maxPLSource = source.txPower + source.gain - source.sens

      if (marginViaRelay > bestMargin) {
        bestMargin = marginViaRelay
        bestMaxPL  = Math.min(directMaxPL.get(relay.id) ?? maxPLSource, maxPLSource)
      }
    }
  }

  if (bestMargin === -Infinity) return null
  return { margin: bestMargin, maxPathLoss: bestMaxPL }
}

export interface HeatBounds {
  northLat: number
  southLat: number
  westLng:  number
  eastLng:  number
}

export function buildHeatImageData(
  bounds: HeatBounds,
  width: number,
  height: number,
  stations: Station[],
  links: Link[],
): ImageData {
  const imageData = new ImageData(width, height)
  const data      = imageData.data
  const latRange  = bounds.northLat - bounds.southLat
  const lngRange  = bounds.eastLng  - bounds.westLng

  for (let py = 0; py < height; py++) {
    const lat = bounds.northLat - (py / height) * latRange
    for (let px = 0; px < width; px++) {
      const lng    = bounds.westLng + (px / width) * lngRange
      const best   = computeBest(lat, lng, stations, links)
      const [r, g, b, a] = best ? marginToRgba(best.margin, best.maxPathLoss) : [0, 0, 0, 0]
      const idx = (py * width + px) * 4
      data[idx]     = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = a
    }
  }
  return imageData
}
