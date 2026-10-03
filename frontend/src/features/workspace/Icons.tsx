export type IconName = 'grid' | 'focus' | 'expand' | 'collapse' | 'volume' | 'mute' | 'monitor' | 'settings' | 'signal' | 'eye' | 'eyeOff' | 'swap' | 'stop' | 'close' | 'menu' | 'users' | 'plus' | 'play' | 'popout'
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', focus: 'M3 4h18v12H3z M8 20h8',
  expand: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5', collapse: 'M3 8h5V3 M21 8h-5V3 M16 21v-5h5 M3 16h5v5',
  volume: 'M11 4 5 9H2v6h3l6 5z M15 8c3 2 3 6 0 8 M18 4c6 4 6 12 0 16', mute: 'M11 4 5 9H2v6h3l6 5z M16 9l6 6 M22 9l-6 6',
  monitor: 'M3 3h18v14H3z M12 17v4 M7 21h10', settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6', signal: 'M4 20v-4 M9 20v-8 M14 20V8 M19 20V3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', eyeOff: 'M3 3l18 18 M9 5c7-2 13 7 13 7s-2 3-5 5 M6 6c-2 2-4 6-4 6s4 7 10 7h2',
  swap: 'M3 7h16l-4-4 M21 17H5l4 4 M19 7l-4 4 M5 17l4-4', stop: 'M5 5h14v14H5z', close: 'm6 6 12 12 M6 18 18 6', menu: 'M4 6h16 M4 12h16 M4 18h16',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M18 15a4 4 0 0 1 4 4v2', plus: 'M12 5v14 M5 12h14', play: 'm7 3 14 9-14 9z',
  popout: 'M3 4h18v14H3z M12 11h7v5h-7z',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
