// Small inline SVG icons (no emoji fonts needed, so they look the same everywhere).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18, rest: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, focusable: false as const, ...rest,
});

export const PlayIcon = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>;
export const PauseIcon = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor" /></svg>;
export const ReplayIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H4.5A7.5 7.5 0 1 0 12 5z" fill="currentColor" /></svg>
);
export const SkipIcon = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M5 5v14l10-7zM16 5h3v14h-3z" fill="currentColor" /></svg>;
export const CopyIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM4 7h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9z" fill="currentColor" /></svg>
);
export const CheckIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z" fill="currentColor" /></svg>
);
export const CrossIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
);
export const SunIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></g></svg>
);
export const MoonIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" /></svg>
);
export const AutoIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>
);
export const InfoIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M11 10.5h2V17h-2zM11 7h2v2h-2z" fill="currentColor" /></svg>
);
export const DropIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M12 2.5C9 7 6 10.2 6 14a6 6 0 0 0 12 0c0-3.8-3-7-6-11.5z" fill="#f2a900" stroke="#9a6400" strokeWidth="1.2" /><ellipse cx="9.6" cy="13.5" rx="1.3" ry="2.2" fill="#fff" opacity=".7" /></svg>
);
export const FooledIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="12" cy="12" r="10" fill="#c43d4b" /><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /></svg>
);
export const PlusIcon = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" /></svg>;
export const TrophyIcon = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.4 12H7a4 4 0 0 1-4-4V5h3zm0 4H5v1a2 2 0 0 0 1 1.7zm12 0v2.7A2 2 0 0 0 19 8V7z" fill="currentColor" /></svg>
);

/** A small flower icon (logo, tabs, cards). The garden draws its own two varieties. */
export function FlowerHead({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} cx="0" cy="-6.2" rx="3.6" ry="5.6" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth=".7" transform={`rotate(${a})`} />
      ))}
      <circle r="3.6" fill="#ffd166" stroke="#a86b00" strokeWidth=".8" />
    </svg>
  );
}

export function BeeGlyph({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-16 -14 32 28" aria-hidden>
      <ellipse cx="-2" cy="-9" rx="6" ry="4.5" fill="#fff" fillOpacity=".85" stroke="#4b4b4b" strokeWidth=".8" />
      <ellipse cx="4" cy="-9" rx="5" ry="4" fill="#fff" fillOpacity=".85" stroke="#4b4b4b" strokeWidth=".8" />
      <ellipse rx="11" ry="7.5" fill={color} stroke="#2b2118" strokeWidth="1.2" />
      <path d="M-4 -7.2v14.4M2 -7.4v14.8" stroke="#2b2118" strokeWidth="3" />
      <circle cx="11" cy="-1" r="4.4" fill="#2b2118" />
      <circle cx="12.4" cy="-2.2" r="1.2" fill="#fff" />
    </svg>
  );
}
