import { STATION_TYPES, StationType } from '@/lib/rf'

export const BRASOV: [number, number] = [45.6427, 25.5887]

// Lucide SVG paths — stroke="currentColor" so they inherit the marker color
const STATION_SVGS: Record<StationType, string> = {
  bts: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"></path><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"></path><circle cx="12" cy="9" r="2"></circle><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"></path><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"></path><path d="M9.5 18h5"></path><path d="m8 22 4-11 4 11"></path></svg>`,
  antenna: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12 7 2"></path><path d="m7 12 5-10"></path><path d="m12 12 5-10"></path><path d="m17 12 5-10"></path><path d="M4.5 7h15"></path><path d="M12 16v6"></path></svg>`,
  router: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="14" rx="2"></rect><path d="M6.01 18H6"></path><path d="M10.01 18H10"></path><path d="M15 10v4"></path><path d="M17.84 7.17a4 4 0 0 0-5.66 0"></path><path d="M20.66 4.34a8 8 0 0 0-11.31 0"></path></svg>`,
  repeater: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7 9 3 5 7l4 4"></path><path d="m17 11 4 4-4 4-4-4"></path><path d="m8 12 4 4 6-6-4-4Z"></path><path d="m16 8 3-3"></path><path d="M9 21a6 6 0 0 0-6-6"></path></svg>`,
}

export function makeIconHTML(type: StationType, selected: boolean, blinking: boolean): string {
  const cfg = STATION_TYPES[type]
  const bw = selected ? '3px' : '2px'
  const glow = selected
    ? `0 0 18px ${cfg.color}, 0 0 36px ${cfg.color}55, 0 2px 10px #000a`
    : `0 0 8px ${cfg.color}77, 0 2px 6px #0008`
  return `<div class="${blinking ? 'blinking' : ''}" style="
    width:32px;height:32px;border-radius:50%;
    border:${bw} solid ${cfg.color};background:#0d1420;
    display:flex;align-items:center;justify-content:center;
    box-shadow:${glow};cursor:pointer;color:${cfg.color};
  ">${STATION_SVGS[type]}</div>`
}
