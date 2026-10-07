// Small stroke icon set (24px grid) replacing emoji and text glyphs, so every symbol shares
// the same weight and colour as the type around it.
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  pause: 'M8 5v14M16 5v14',
  check: 'M5 12.5l4.5 4.5L19 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
  cloud: 'M7 18h10a4 4 0 00.6-7.95A6 6 0 006.2 9.2 4.5 4.5 0 007 18z',
  wind: 'M3 9h11a3 3 0 10-3-3M3 15h15a3 3 0 11-3 3M3 12h8',
  rain: 'M7 14h10a4 4 0 00.6-7.95A6 6 0 006.2 5.2 4.5 4.5 0 007 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  temp: 'M10 14.5V4a2 2 0 014 0v10.5a4 4 0 11-4 0zM12 9v8',
  gauge: 'M4 16a8 8 0 1116 0M12 16l4-5M12 16h.01',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 6.5M18 14a6 6 0 013.5 6',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  leaf: 'M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l7-7',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H4.5a3 3 0 003.6 3.6M16 6h3.5a3 3 0 01-3.6 3.6M12 13v4M8 20h8M9.5 17h5',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  rotate: 'M4 12a8 8 0 0114-5.3M20 4v4h-4M20 12a8 8 0 01-14 5.3M4 20v-4h4',
  sound: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11',
  mute: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9.5l5 5M21 9.5l-5 5',
  fish: 'M3 12c3-4.5 7-6 11-6 3.5 0 6 3 7 6-1 3-3.5 6-7 6-4 0-8-1.5-11-6zM3 12l-1.5-3.5M3 12l-1.5 3.5M16.5 10.5h.01',
  boat: 'M3 15l2 4h14l2-4H3zM6 15V9h8l4 6M10 9V5',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2',
  scale: 'M12 4v16M6 20h12M4 8h16M4 8l-2.5 6a3 3 0 005 0zM20 8l-2.5 6a3 3 0 005 0z',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon-svg ${className ?? ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={size ? { width: size, height: size } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
