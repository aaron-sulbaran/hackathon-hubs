import type { SVGProps } from "react";

// Line icons drawn for the hub at 24px on a 1.75 stroke with round ends.
// currentColor everywhere so state colors come from CSS.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5h4.5v-6h4v6h4.5V9" />
    </Icon>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="9.75" y="4" width="4.5" height="11" rx="1.5" />
      <rect x="16" y="4" width="4.5" height="7" rx="1.5" />
    </Icon>
  );
}

export function DecideIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5Z" />
      <path d="m8.5 10.5 2.25 2.25L15.5 8" />
    </Icon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8 13.5h3v3H8z" />
    </Icon>
  );
}

export function GraphIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="6" r="1.75" />
      <circle cx="19" cy="5.5" r="1.75" />
      <circle cx="18.5" cy="18.5" r="1.75" />
      <circle cx="5.5" cy="18" r="1.75" />
      <path d="m6.5 7.1 3.6 3.2M17.6 6.7l-3.8 3.6M17.2 17.3l-3.4-3.4M6.9 16.9l3.3-3.1" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  );
}

export function DesignIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="m3.5 17 5-4.5 3.5 3 3.5-3.5 5 4.5" />
    </Icon>
  );
}

/** Two rings that share a middle: the same file in two people's hands. */
export function OverlapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Icon>
  );
}

/** A branch: two commits and the line that forks from one. */
export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="M7 7.5v9" />
      <path d="M17 10c0 3.5-4 4-8.5 7" />
    </Icon>
  );
}

/** A plane seen from above, nose to the right. Filled, for the flight path and the wordmark. */
export function PlaneIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d="M21.5 12c0-.85-.7-1.45-1.6-1.45h-4.6L10.6 3.6H8.4l2.35 6.95H6.3L4.6 8.3H3.2l1.05 3.7-1.05 3.7h1.4l1.7-2.25h4.45L8.4 20.4h2.2l4.7-6.95h4.6c.9 0 1.6-.6 1.6-1.45Z" />
    </svg>
  );
}

/** The schedule as a route: three stops on a dashed line. */
export function RouteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <path d="M6 7.5v9" strokeDasharray="2 2.25" />
      <path d="M11 5.5h9M11 12h7M11 18.5h9" />
      <circle cx="6" cy="12" r="1.25" fill="currentColor" />
    </Icon>
  );
}
