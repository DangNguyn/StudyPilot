"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  IconBell,
  IconCalendar,
  IconChart,
  IconFile,
  IconHome,
  IconInfo,
  IconLayers,
  IconPen,
  Sparkle,
} from "@/components/icons";

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /* Các đường dẫn con cũng tính là đang ở mục này */
  match?: string[];
};

const navigation: NavItem[] = [
  { name: "Tổng quan", href: "/", icon: IconHome },
  {
    name: "Kế hoạch ôn thi",
    href: "/study-plans",
    icon: IconCalendar,
    match: ["/study-sessions", "/review-plans"],
  },
  {
    name: "Tài liệu học tập",
    href: "/materials",
    icon: IconFile,
    match: ["/study-materials"],
  },
  { name: "Flashcards", href: "/flashcards", icon: IconLayers },
  {
    name: "Kiểm tra kiến thức",
    href: "/quizzes",
    icon: IconPen,
    match: ["/quiz-results"],
  },
  { name: "Đánh giá năng lực", href: "/weak-areas", icon: IconChart },
];

function isActivePath(pathname: string, item: NavItem) {
  if (item.href === "/") {
    return pathname === "/";
  }

  const prefixes = [item.href, ...(item.match || [])];

  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]">
        <span className="font-[family-name:var(--font-sp-display)] text-xl leading-none">
          S
        </span>
        <Sparkle
          size={14}
          className="sp-twinkle absolute -right-2 -top-2 text-[var(--sp-pink)]"
        />
      </span>

      {!compact && (
        <span>
          <span className="block font-[family-name:var(--font-sp-display)] text-[26px] leading-none tracking-[0.01em] text-[var(--sp-purple)]">
            StudyPilot
          </span>
          <span className="mt-1 block text-[11.5px] font-medium text-[var(--sp-muted)]">
            Học đúng cách hơn mỗi ngày
          </span>
        </span>
      )}
    </Link>
  );
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen text-[var(--sp-ink)]">
      {/* Sidebar (máy tính) */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[272px] flex-col border-r border-[var(--sp-line)] bg-[var(--sp-sidebar)] px-5 py-7 lg:flex">
        <div className="mb-10 px-1">
          <Logo />
        </div>

        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--sp-soft)]">
          Không gian học
        </p>

        <nav className="flex flex-col gap-2" aria-label="Điều hướng chính">
          {navigation.map((item) => {
            const isActive = isActivePath(pathname, item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-[15px] font-semibold transition ${
                  isActive
                    ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[4px_4px_0_var(--sp-purple-deep)]"
                    : "border-transparent text-[var(--sp-text-2)] hover:border-[var(--sp-line)] hover:bg-white"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "border border-[var(--sp-line)] bg-white text-[var(--sp-muted)] group-hover:text-[var(--sp-peri-dark)]"
                  }`}
                >
                  <Icon size={18} />
                </span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-[20px] border border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] p-5">
          <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--sp-pink-line)] bg-white text-[var(--sp-pink)]">
            <Sparkle size={16} />
          </span>
          <p className="text-[15px] font-bold text-[var(--sp-purple)]">
            Học tập có lộ trình
          </p>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--sp-text-2)]">
            AI giúp bạn chia nhỏ tài liệu và biết chính xác hôm nay cần học gì.
          </p>
        </div>
      </aside>

      <div className="min-h-screen lg:ml-[272px]">
        {/* Header */}
        <header className="sticky top-0 z-10 flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--sp-line)] bg-[var(--sp-paper)]/90 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="hidden sm:block">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--sp-soft)]">
                StudyPilot
              </p>
              <p className="text-sm font-semibold text-[var(--sp-text-2)]">
                Không gian học tập của bạn
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <span
              className="sp-chip hidden border border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] md:inline-flex"
              title="Ứng dụng đang chạy với tài khoản demo"
            >
              <IconInfo size={15} />
              Dữ liệu demo
            </span>

            <button
              type="button"
              aria-label="Thông báo"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] transition hover:text-[var(--sp-peri-dark)]"
            >
              <IconBell size={18} />
            </button>

            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-[var(--sp-soft)]">
                Xin chào
              </p>
              <p className="text-sm font-bold text-[var(--sp-ink)]">
                Sinh viên
              </p>
            </div>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sp-pink-bg)] text-sm font-bold text-[var(--sp-pink-dark)]">
              S
            </div>
          </div>
        </header>

        {/* Thanh điều hướng (điện thoại, máy tính bảng) */}
        <nav
          className="flex gap-2 overflow-x-auto border-b border-[var(--sp-line)] bg-[var(--sp-sidebar)] px-4 py-3 lg:hidden"
          aria-label="Điều hướng chính"
        >
          {navigation.map((item) => {
            const isActive = isActivePath(pathname, item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-xs font-semibold ${
                  isActive
                    ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]"
                    : "border-[var(--sp-line)] bg-white text-[var(--sp-text-2)]"
                }`}
              >
                <Icon size={15} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
