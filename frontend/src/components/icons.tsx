import type { SVGProps } from 'react';

/**
 * A small, hand-rolled set of line icons — only the ones this app actually
 * uses, each ~10 lines of SVG. Deliberately not a dependency: the project
 * already avoids adding libraries for things a few components cover (the
 * topology layout, the data-fetching hook), and a handful of nav/status
 * icons is the same case. Every icon is `aria-hidden` by default since it
 * always sits next to real text (a nav label, a badge label, a button
 * label) that already carries the accessible name -- see
 * `docs/phases.md`'s "don't rely on color alone" requirement, which this
 * extends to "icons decorate text, they don't replace it."
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function IconOverview({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconTopology({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="5" cy="6" r="2.5" />
      <circle cx="19" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M7 7.3 10.2 16" />
      <path d="M17 7.3 13.8 16" />
      <path d="M7.5 6h9" />
    </svg>
  );
}

export function IconIncidents({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSimulation({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M9 3h6" />
      <path d="M10 3v5.2L4.8 17a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 8.2V3" />
      <path d="M7.5 14.5h9" />
    </svg>
  );
}

export function IconAssistant({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M12 3v3M12 3l2 2M12 3l-2 2" />
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M9 13.2v1.1M15 13.2v1.1" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function IconExecutions({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconLogout({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M14 16l4-4-4-4" />
      <path d="M18 12H9" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </svg>
  );
}

export function IconArrowLeft({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function IconCheck({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M12 4 21.5 20h-19L12 4Z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconAlertCircle({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.2" />
      <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRefresh({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </svg>
  );
}

export function IconInbox({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M3.5 12.5h5l1.5 3h4l1.5-3h5" />
      <path d="M5.5 5.5h13l2 7v6a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5v-6l2-7Z" />
    </svg>
  );
}

export function IconSearchOff({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3 20 20" />
    </svg>
  );
}

export function IconClock({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 1.8" />
    </svg>
  );
}

export function IconArrowRight({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconDocument({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M7 3.5h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 13h6M9 16.5h6" />
    </svg>
  );
}
