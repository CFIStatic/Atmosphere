import type { SVGProps } from 'react';

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true" {...props}>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true" {...props}>
      <path
        d="M3 3l18 18M10.6 10.7a3 3 0 004.2 4.2M9.9 5.6A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3 3.6M6.2 7.2A16 16 0 002.5 12S6 18.5 12 18.5a9 9 0 003.1-.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true" {...props}>
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---- Navigation ------------------------------------------------------- */

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5v-6h-7v6H5A1.5 1.5 0 0 1 3.5 19v-8.5Z" {...stroke} />
    </Glyph>
  );
}

/** The Audit tab: a document with an ordered trace on it. */
export function AuditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M6 3.5h8.5L19 8v12.5H6a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 6 3.5Z" {...stroke} />
      <path d="M14 3.5V8h5" {...stroke} />
      <path d="M8.5 12h7M8.5 15.5h4.5" {...stroke} />
    </Glyph>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
    </Glyph>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6L6 18" {...stroke} />
    </Glyph>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" {...stroke} />
    </Glyph>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M5.5 9.5 12 16l6.5-6.5" {...stroke} />
    </Glyph>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="m16 16 4 4" {...stroke} />
    </Glyph>
  );
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" {...stroke} />
      <path d="M20 4v4h-4" {...stroke} />
    </Glyph>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5" {...stroke} />
      <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" {...stroke} />
    </Glyph>
  );
}

export function SignOutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" {...stroke} />
      <path d="M11 15.5 14.5 12 11 8.5M14.5 12h-10" {...stroke} />
    </Glyph>
  );
}

/* ---- Step types -------------------------------------------------------
 * One glyph per kind of thing an agent does, so a long trace can be skimmed
 * by shape before it is read.
 * -------------------------------------------------------------------- */

export function ThoughtIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5 13.6 8l4.4 1.6L13.6 11l-1.6 4.5L10.4 11 6 9.6 10.4 8 12 3.5Z" {...stroke} />
      <path d="M17.5 16.5 18.2 18.5l2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" {...stroke} />
    </Glyph>
  );
}

export function ToolIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M14.5 4.5a4.5 4.5 0 0 0-5.9 5.7l-4.3 4.3a1.7 1.7 0 0 0 2.4 2.4l4.3-4.3a4.5 4.5 0 0 0 5.7-5.9l-2.4 2.4-2.2-2.2 2.4-2.4Z" {...stroke} />
    </Glyph>
  );
}

export function ResultIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M20 7v4a3 3 0 0 1-3 3H5" {...stroke} />
      <path d="M8.5 10.5 5 14l3.5 3.5" {...stroke} />
    </Glyph>
  );
}

export function NavigationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M15.5 8.5 13.7 13.7 8.5 15.5l1.8-5.2 5.2-1.8Z" {...stroke} />
    </Glyph>
  );
}

export function DecisionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="7" cy="6" r="2.2" {...stroke} />
      <circle cx="17" cy="18" r="2.2" {...stroke} />
      <circle cx="7" cy="18" r="2.2" {...stroke} />
      <path d="M7 8.2v7.6M9.2 6h4.3a2 2 0 0 1 2 2v7.8" {...stroke} />
    </Glyph>
  );
}

export function ArtifactIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M7 3.5h6.5L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" {...stroke} />
      <path d="M13 3.5V8h5" {...stroke} />
    </Glyph>
  );
}

export function UsageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" {...stroke} />
      <path d="M10 4v3.5M14 4v3.5M10 16.5V20M14 16.5V20M4 10h3.5M4 14h3.5M16.5 10H20M16.5 14H20" {...stroke} />
    </Glyph>
  );
}

export function MessageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M20 12.5a6.5 6.5 0 0 1-6.5 6.5H9l-4 2.5.9-3.4A6.5 6.5 0 0 1 9.5 6h4A6.5 6.5 0 0 1 20 12.5Z" {...stroke} />
    </Glyph>
  );
}

export function FlagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M6 21V4m0 0h10.5l-2 3.5 2 3.5H6" {...stroke} />
    </Glyph>
  );
}

export function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M12 7.5V13M12 16h.01" {...stroke} />
    </Glyph>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M12 7v5.2l3.2 2" {...stroke} />
    </Glyph>
  );
}

export function DotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </Glyph>
  );
}
