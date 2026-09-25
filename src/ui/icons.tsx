// Inline SVG icon set. No icon dependency, no network fetch - the preview iframe
// has no network, so every glyph must be embedded.

export type IconName =
  | 'cloud-sun' | 'rain' | 'snow' | 'storm' | 'fog'
  | 'spark' | 'chat' | 'agent' | 'tools' | 'skills' | 'flow' | 'crew' | 'routine'
  | 'memory' | 'trace' | 'mode' | 'idea' | 'cloud' | 'settings' | 'pulse' | 'home'
  | 'send' | 'stop' | 'plus' | 'trash' | 'check' | 'close' | 'chevron' | 'back' | 'up' | 'down'
  | 'search' | 'code' | 'chart' | 'pen' | 'bolt' | 'layers' | 'shield' | 'lock'
  | 'eye' | 'target' | 'server' | 'phone' | 'type' | 'gauge' | 'flame' | 'activity'
  | 'copy' | 'download' | 'upload' | 'play' | 'pause' | 'refresh' | 'warn' | 'info'
  | 'grid' | 'more' | 'user' | 'github' | 'sun' | 'moon' | 'mic' | 'file' | 'link'
  | 'sync' | 'star' | 'pin' | 'menu' | 'edit'
  | 'key' | 'rocket' | 'wand' | 'compass' | 'boxes' | 'clock' | 'zap' | 'command'
  | 'sliders' | 'book' | 'heart' | 'trophy' | 'filter' | 'terminal' | 'globe'
  | 'mail' | 'wallet' | 'contacts' | 'paperplane' | 'image' | 'camera' | 'screen'
  | 'assistant';

const P: Record<IconName, string> = {
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  screen: 'M3 5h18v11H3z M8 20h8 M12 16v4 M9 10.5l2 2 4-4',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15v-4 M3 9h18v5H3z M16 11.5h.01',
  contacts: 'M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z M21 8v2 M21 14v2 M11 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6.5 18a4.5 4.5 0 0 1 9 0',
  paperplane: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z',
  assistant: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M5 20a7 7 0 0 1 14 0 M8 11l2 2 4-4',
  key: 'M15.5 3a5.5 5.5 0 1 0-5.2 7.3L3 17.6V21h3.4v-2.2h2.2V16.6h2.1l1.6-1.6A5.5 5.5 0 0 0 15.5 3z M16.4 7.2h.01',
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.8-.9.8-2.2-.1-3s-2.2-.8-2.9 0z M12 15l-3-3a19 19 0 0 1 8-9 9 9 0 0 1 4 4 19 19 0 0 1-9 8z M9 12H5s.4-2.4 1.6-3.6C7.9 7 12 7 12 7 M12 15v4s2.4-.4 3.6-1.6C17 16 17 12 17 12',
  wand: 'M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8l1.4 1.4 M17.8 6.2l1.4-1.4 M12.2 6.2 10.8 4.8 M3 21l9-9',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M16.2 7.8l-2.9 6.5-6.5 2.9 2.9-6.5z',
  boxes: 'M3 7l4-2 4 2-4 2z M13 7l4-2 4 2-4 2z M8 15l4-2 4 2-4 2z M3 7v4l4 2 M11 7v4l-4 2 M13 7v4l4 2 M21 7v4l-4 2 M8 15v4l4 2 M16 15v4l-4 2',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  command: 'M15 6a3 3 0 1 1 3 3h-3zm0 0v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M6 2h12v7a6 6 0 0 1-12 0z M9 22h6 M12 15v7',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  terminal: 'M4 17l6-5-6-5 M12 19h8',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12z',
  agent: 'M12 3v3 M7 9h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M9 14h.01 M15 14h.01 M4 12H2 M22 12h-2',
  tools: 'M14.7 6.3a4 4 0 0 1 5 5L8.5 22.5a2.1 2.1 0 0 1-3-3z M9.5 11.5L3 5a2 2 0 0 1 0-3 2 2 0 0 1 3 0l6.5 6.5',
  skills: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
  flow: 'M5 6h5 M14 6h5 M5 18h5 M14 18h5 M7.5 8.5v7 M16.5 8.5v7 M10 6h4 M10 18h4',
  crew: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20a6 6 0 0 1 12 0 M17 11a3 3 0 1 0 0-6 M15.5 14.6A6 6 0 0 1 21 20',
  routine: 'M21 12a9 9 0 1 1-3-6.7 M21 3v5h-5',
  memory: 'M9 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z M6 8H3 M6 12H3 M6 16H3 M21 8h-3 M21 12h-3 M21 16h-3',
  trace: 'M3 17l5-5 4 3 5-7 4 4',
  mode: 'M4 6h16 M4 12h10 M4 18h6 M18 10v8 M15 15l3 3 3-3',
  idea: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 1 4 10.5V16H8v-2.5A6 6 0 0 1 12 3z',
  cloud: 'M6.5 19a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 9.4 4 4 0 0 1 17.5 19z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 4.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  pulse: 'M3 12h4l2-7 4 14 2-7h6',
  home: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  send: 'M4 12l16-8-6 8 6 8z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  check: 'M4 12.5l5 5L20 6.5',
  close: 'M6 6l12 12 M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M13 4l-2 16',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  pen: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6z',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  shield: 'M12 3l8 3v6c0 5-3.4 8.4-8 9.9C7.4 20.4 4 17 4 12V6z',
  lock: 'M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M10 18h4',
  type: 'M4 6h16 M12 6v14 M9 20h6',
  gauge: 'M12 21a9 9 0 1 1 9-9 M12 12l5-4',
  flame: 'M12 22c4 0 7-2.7 7-6.5C19 11 15 9 13.5 2 12 6 9 7 7.5 10.5 6 14 6.5 22 12 22z',
  activity: 'M22 12h-4l-3 8-6-16-3 8H2',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  download: 'M12 3v12 M7 11l5 5 5-5 M4 21h16',
  upload: 'M12 21V9 M7 13l5-5 5 5 M4 3h16',
  play: 'M7 4l13 8-13 8z',
  pause: 'M8 5h3v14H8z M13 5h3v14h-3z',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4 M21 4v5h-5',
  warn: 'M12 3l10 18H2z M12 9v5 M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 7.5h.01',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  github: 'M9 19c-4.5 1.5-4.5-2.5-6-3m12 5v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.6 4.9 4.9 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13 13 0 0 0-7 0C5.4 1.6 4.2 2 4.2 2a4.9 4.9 0 0 0-.1 3.6A5.3 5.3 0 0 0 2.7 9.2c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.6V22',
  'cloud-sun': 'M12 4V2 M5.6 6.6 4.2 5.2 M4 12H2 M18.4 6.6l1.4-1.4 M8.2 8.6a4 4 0 0 1 7.2 1.2 M6.5 20a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17 11.5a3.6 3.6 0 0 1 .3 8.5z',
  rain: 'M7 16a4.2 4.2 0 0 1-.3-8.4A5.6 5.6 0 0 1 17.6 9a3.7 3.7 0 0 1 .3 7 M8 19l-1 2.5 M12 19l-1 2.5 M16 19l-1 2.5',
  snow: 'M7 15a4.2 4.2 0 0 1-.3-8.4A5.6 5.6 0 0 1 17.6 8a3.7 3.7 0 0 1 .3 7 M8 19h.01 M12 21h.01 M16 19h.01 M12 17h.01',
  storm: 'M7 15a4.2 4.2 0 0 1-.3-8.4A5.6 5.6 0 0 1 17.6 8a3.7 3.7 0 0 1 .3 7 M13 13l-3 4.5h3.5L11 22',
  fog: 'M6.5 13a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17 8.5a3.6 3.6 0 0 1 .3 4.5 M4 17h16 M6 20.5h12',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z M19 11a7 7 0 0 1-14 0 M12 18v4 M8 22h8',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  sync: 'M21 2v6h-6 M3 22v-6h6 M20 12a8 8 0 0 1-13.7 5.7L3 16 M4 12a8 8 0 0 1 13.7-5.7L21 8',
  star: 'M12 3l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 18.3 5.9 21.6l1.4-6.8L2.2 10.1l6.9-.8z',
  pin: 'M12 17v5 M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
};

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icn ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name].split(' M').map((d, i) => (
        <path key={i} d={i === 0 ? d : `M${d}`} />
      ))}
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="jlg" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="17" stroke="url(#jlg)" strokeWidth="1.6" opacity="0.55" />
      <circle cx="20" cy="20" r="11" stroke="url(#jlg)" strokeWidth="1.2" opacity="0.35" />
      <path d="M20 8v10.5" stroke="url(#jlg)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="22.5" r="4" fill="url(#jlg)" />
      <path d="M31 12a13 13 0 0 1 0 16" stroke="url(#jlg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <path d="M9 28a13 13 0 0 1 0-16" stroke="url(#jlg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}
