interface IconProps {
  className?: string
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  )
}

export function StatusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M7.5 9.5h9M7.5 13.5h6M7.5 17h4" />
    </svg>
  )
}

export function ProfileIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  )
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  )
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  )
}

export function BusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="3.5" width="16" height="15" rx="2.5" />
      <path d="M4 11.5h16M7.5 21v-2.5M16.5 21v-2.5M7 15.2h.01M17 15.2h.01" />
    </svg>
  )
}

export function GlobeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z" />
    </svg>
  )
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 8 8 5.5L20 8" />
    </svg>
  )
}

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 3.5h-.5A2.5 2.5 0 0 0 4 6.05C4 14 10 20 17.95 20A2.5 2.5 0 0 0 20.5 17.5V17a1.5 1.5 0 0 0-1.3-1.49l-2.4-.2a1.5 1.5 0 0 0-1.5.9l-.4.8a11.5 11.5 0 0 1-5.32-5.32l.8-.4a1.5 1.5 0 0 0 .9-1.5l-.2-2.4A1.5 1.5 0 0 0 9.5 6z" />
    </svg>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.75a4 4 0 0 1 8 0v2.75" />
    </svg>
  )
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </svg>
  )
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 8V5.5A1.5 1.5 0 0 0 13 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H13a1.5 1.5 0 0 0 1.5-1.5V16" />
      <path d="M9.5 12h11m0 0-3.5-3.5M20.5 12 17 15.5" />
    </svg>
  )
}

export function QrCodeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M17 20.5h3.5M13.5 20.5h1" />
    </svg>
  )
}

/**
 * Used for both saving and sharing the ticket image. The arrow leaving a box
 * reads as "send this out", which covers the share sheet and the download
 * fallback without needing two different glyphs for one action.
 */
export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 15.5V4m0 0L8.5 7.5M12 4l3.5 3.5" />
      <path d="M5 13.5v4A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-4" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  )
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 5 6v5.5c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6l-7-2.5z" />
    </svg>
  )
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3 19.5c.95-3.2 3.4-4.9 6.5-4.9s5.55 1.7 6.5 4.9" />
      <path d="M16.5 5.3a3.5 3.5 0 0 1 0 6.4M18.5 14.9c1.6.7 2.6 1.9 2.9 3.6" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.75" />
    </svg>
  )
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  )
}

/** Shown when the app is currently light, meaning "switch to dark". */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  )
}

/** Shown when the app is currently dark, meaning "switch to light". */
export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  )
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 8.5A2 2 0 0 0 2.5 10.5v8a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2.3a2 2 0 0 1-1.42-.59l-1.56-1.56a2 2 0 0 0-1.42-.59H9.2a2 2 0 0 0-1.42.59L6.22 7.91A2 2 0 0 1 4.8 8.5H4.5z" />
      <circle cx="12" cy="14.5" r="3.75" />
    </svg>
  )
}

/**
 * A frame with a scan line through it, for "scan another".
 *
 * Deliberately not `SearchIcon`. A magnifying glass reads as find-and-filter,
 * which is a different job from re-aiming the camera at the next pass, and the
 * two sit on the same screen often enough that reusing one glyph for both makes
 * the page look like it cannot decide what it wants.
 */
export function ScanFrameIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
    </svg>
  )
}