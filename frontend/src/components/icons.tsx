import type { SVGProps } from "react";

/*
 * Bộ icon nét mảnh dùng chung cho StudyPilot.
 * Tất cả icon dùng currentColor nên đổi màu bằng class text-*.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    </Svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2.5H6.5A2 2 0 0 0 4.5 4.5v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
      <path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5" />
    </Svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 9 4.5-9 4.5-9-4.5z" />
      <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
    </Svg>
  );
}

export function IconPen(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20.5h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3.5v17h18" />
      <path d="M7.5 16.5v-5M12 16.5V8M16.5 16.5v-3" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8.5a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3s3-1.5 3-8.5" />
      <path d="M10.3 20.5a1.9 1.9 0 0 0 3.4 0" />
    </Svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4.5M12 8h.01" />
    </Svg>
  );
}

export function IconFlag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 21.5V4" />
      <path d="M5 4.5h11l-2 4 2 4H5" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h5a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5h-7z" />
      <path d="M21.5 5.5A1.5 1.5 0 0 0 20 4h-5a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h7z" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.5v15l12-7.5z" />
    </Svg>
  );
}

export function IconRepeat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7" />
      <path d="M3.5 12A8.5 8.5 0 0 1 18.3 6.3" />
      <path d="M18.5 2.5v4h-4M5.5 21.5v-4h4" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0" />
      <path d="M12 9v4.5M12 17h.01" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" />
    </Svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 4.5H5.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13" />
      <path d="M18 3a2.1 2.1 0 0 1 3 3l-8.5 8.5-4 1 1-4z" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.5 6.5 0 0 0 11 11" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </Svg>
  );
}

export function IconBulb(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3" />
    </Svg>
  );
}

export function IconFormula(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h7M4 17h7M7.5 4v6" />
      <path d="M14 14l6 6M20 14l-6 6M14 7.5h6" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5.5 9 6.5 6.5L18.5 9" />
    </Svg>
  );
}

export function IconTrendUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Svg>
  );
}

export function IconTrendDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 7 6 6 4-4 8 8" />
      <path d="M15 17h6v-6" />
    </Svg>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/* Ngôi sao 4 cánh dùng để trang trí (tô đặc). */
export function Sparkle({
  size = 20,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M12 0c.7 5.9 3.1 9.6 12 12-8.9 2.4-11.3 6.1-12 12-.7-5.9-3.1-9.6-12-12 8.9-2.4 11.3-6.1 12-12" />
    </svg>
  );
}
