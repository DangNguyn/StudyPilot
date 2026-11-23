"use client";

import { applyLanguage, currentLang, currentLocale, tx } from "@/lib/i18n";
import { applyTheme, currentTheme } from "@/lib/theme";
import Link from "next/link";
import { useCurrentUserName } from "@/lib/current-user";
import UserAvatar from "@/components/user-avatar";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import PilotHouse from "@/components/pilot-house";
import StudyBackdrop from "@/components/study-backdrop";
import { PilotMascot } from "@/components/loading-play";
import { useBgMotion } from "@/lib/bg-motion";
import { useAuth } from "@/components/auth-provider";
import LoginSplash from "@/components/login-splash";
import { getAuthClient, isAuthPath, isAuthRedirectHeld } from "@/lib/auth";
import NotificationBell from "@/components/notification-settings";
import type { ComponentType, SVGProps } from "react";
import {
  IconCalendar,
  IconChart,
  IconFile,
  IconHome,
  IconLayers,
  IconChevronDown,
  IconLogout,
  IconMoon,
  IconSettings,
  IconUser,
  IconPen,
  Sparkle,
} from "@/components/icons";

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /* Các đường dẫn con cũng tính là đang ở mục này */
  match?: string[];
  /* Nhóm trên thanh bên */
  group: "learn" | "practice";
};

const NAV_GROUPS = [
  { key: "learn", label: tx("Học tập") },
  { key: "practice", label: tx("Luyện tập") },
] as const;

const navigation: NavItem[] = [
  { name: tx("Tổng quan"), href: "/", icon: IconHome, group: "learn" },
  {
    name: tx("Kế hoạch ôn thi"),
    href: "/study-plans",
    icon: IconCalendar,
    match: ["/study-sessions", "/review-plans"],
    group: "learn",
  },
  {
    name: tx("Tài liệu học tập"),
    href: "/materials",
    icon: IconFile,
    match: ["/study-materials"],
    group: "learn",
  },
  { name: "Flashcards", href: "/flashcards", icon: IconLayers, group: "learn" },
  {
    name: tx("Kiểm tra kiến thức"),
    href: "/quizzes",
    icon: IconPen,
    match: ["/quiz-results"],
    group: "practice",
  },
  { name: tx("Đánh giá năng lực"), href: "/weak-areas", icon: IconChart, group: "practice" },
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
      <span data-sp-logo className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]">
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

            {tx("Học đúng cách hơn mỗi ngày")}
          </span>
        </span>
      )}
    </Link>
  );
}

/* true sau khi trang đã hydrate xong; trong lúc hydrate luôn là false (khớp với bản máy chủ) */
const noopSubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/* Màn hình chào nằm ngoài cùng để không bị dựng lại khi chuyển từ trang đăng nhập sang trang học */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShellContent>{children}</AppShellContent>
      <LoginSplash />
    </>
  );
}

function AppShellContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, configured } = useAuth();
  const userName = useCurrentUserName();
  const onAuthPage = isAuthPath(pathname);
  const hydrated = useHydrated();

  // Chưa đăng nhập thì đưa về trang đăng nhập; đã đăng nhập thì không ở lại trang đăng nhập
  useEffect(() => {
    if (!configured) return;
    if (loading) return;
    if (!user && !onAuthPage) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (user && (pathname === "/login" || pathname === "/register") && !isAuthRedirectHeld()) {
      router.replace("/");
    }
  }, [configured, loading, user, onAuthPage, pathname, router]);

  // Ngôn ngữ đã chọn trong Cài đặt đi theo tài khoản: đăng nhập ở máy khác cũng tự đổi
  const savedLanguage = user?.user_metadata?.sp_language;
  useEffect(() => {
    if ((savedLanguage === "en" || savedLanguage === "vi") && savedLanguage !== currentLang()) {
      applyLanguage(savedLanguage);
    }
  }, [savedLanguage]);

  // Chế độ tối cũng đi theo tài khoản
  const savedTheme = user?.user_metadata?.sp_theme;
  useEffect(() => {
    if ((savedTheme === "dark" || savedTheme === "light") && savedTheme !== currentTheme()) {
      applyTheme(savedTheme, false);
    }
  }, [savedTheme]);

  // Trong lúc React "hydrate" chỉ vẽ logo (không có chữ) để bản máy chủ và trình duyệt luôn giống nhau,
  // kể cả khi người dùng chọn tiếng Anh (máy chủ luôn vẽ tiếng Việt).
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mr-2 text-[var(--sp-pink)]" />
        StudyPilot
      </div>
    );
  }

  if (!configured) {
    return <AuthConfigMissing />;
  }

  if (onAuthPage) {
    return (
      <div className="min-h-screen text-[var(--sp-ink)]">
        {children}
      </div>
    );
  }

  // Lúc React đang "hydrate" luôn vẽ màn hình chờ giống hệt bản máy chủ đã gửi,
  // tránh lỗi Hydration failed khi phiên đăng nhập được đọc xong trước lúc hydrate.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mr-2 text-[var(--sp-pink)]" />
        {tx("Đang mở StudyPilot...")}
      </div>
    );
  }

  async function signOut() {
    await getAuthClient()?.auth.signOut();
    router.replace("/login");
  }

  return (
    <SignedInShell pathname={pathname} userName={userName} onSignOut={() => void signOut()}>
      {children}
    </SignedInShell>
  );
}

function pageTitle(pathname: string) {
  if (pathname.startsWith("/settings")) return tx("Cài đặt");
  return navigation.find((item) => isActivePath(pathname, item))?.name || tx("Không gian học tập của bạn");
}

function SideLink({ href, active, icon: Icon, children }: { href: string; active: boolean; icon: NavItem["icon"]; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-[46px] items-center gap-3 rounded-2xl border-2 px-2.5 text-[14.5px] font-semibold transition ${
        active
          ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[3px_3px_0_var(--sp-purple-deep)]"
          : "border-transparent text-[var(--sp-text-2)] hover:border-[var(--sp-line)] hover:bg-[var(--sp-surface)]"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition ${
          active
            ? "bg-white/20 text-white"
            : "border border-[var(--sp-line)] bg-[var(--sp-surface)] text-[var(--sp-muted)] group-hover:text-[var(--sp-peri-dark)]"
        }`}
      >
        <Icon size={17} />
      </span>
      {children}
    </Link>
  );
}

/* Thẻ "Nhà của Pilot" cuối thanh bên: ngôi nhà nhỏ, Pilot mặc bộ đồ đang lưu đứng cạnh */
function HouseCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={tx("Mở nhà của Pilot")}
      className="sp-house-card relative block w-full shrink-0 overflow-hidden rounded-[20px] border-2 border-[var(--sp-purple-deep)] text-left shadow-[4px_4px_0_var(--sp-pink-line)] transition"
    >
      <span className="relative block h-[98px]">
        <span className="sp-house-cloud" style={{ left: 130, top: 12, width: 42 }} />
        <span className="sp-house-cloud" style={{ left: 186, top: 26, width: 26 }} />
        <svg className="absolute bottom-1 left-3 h-[84px] w-[104px]" viewBox="0 0 104 84" aria-hidden="true">
          <rect x="70" y="10" width="10" height="20" fill="#c98d4f" stroke="#33094a" strokeWidth="2.5" />
          <path d="M6 42 L52 6 L98 42 Z" fill="#e0457b" stroke="#33094a" strokeWidth="3" strokeLinejoin="round" />
          <rect x="16" y="40" width="72" height="42" fill="#fff5d6" stroke="#33094a" strokeWidth="3" />
          <path d="M42 82 V62 a10 10 0 0 1 20 0 V82 Z" fill="#5b7fe3" stroke="#33094a" strokeWidth="3" />
          <circle cx="57" cy="72" r="1.8" fill="#f6c343" />
          <rect x="22" y="50" width="14" height="14" rx="3" fill="#bfe3ff" stroke="#33094a" strokeWidth="2.5" />
          <rect x="68" y="50" width="14" height="14" rx="3" fill="#bfe3ff" stroke="#33094a" strokeWidth="2.5" />
        </svg>
        <span className="sp-house-peek absolute bottom-[-2px] left-[118px]">
          <PilotMascot size={82} className="sp-pilot-still" />
        </span>
      </span>
      <span className="flex items-center gap-2.5 border-t-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] py-2.5 pl-3.5 pr-3">
        <span className="min-w-0">
          <b className="block text-[14.5px] text-[var(--sp-purple)]">{tx("Nhà của Pilot")}</b>
          <span className="block text-[12px] text-[var(--sp-muted)]">{tx("Thay đồ, phụ kiện cho Pilot")}</span>
        </span>
        <span className="ml-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] font-extrabold text-[#33094a]">
          →
        </span>
      </span>
    </button>
  );
}

function UserMenu({ userName, onOpenHouse, onSignOut }: { userName: string; onOpenHouse: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => currentTheme() === "dark");
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleDark() {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    applyTheme(next);
    // Lưu theo tài khoản như ở trang Cài đặt
    void getAuthClient()?.auth.updateUser({ data: { sp_theme: next } });
  }

  const itemClass =
    "flex h-[42px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-semibold text-[var(--sp-text-2)] hover:bg-[var(--sp-lav)]";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[46px] items-center gap-2.5 rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] py-0 pl-[5px] pr-3 shadow-[3px_3px_0_var(--sp-purple-deep)]"
      >
        <UserAvatar size={34} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[11px] font-semibold text-[var(--sp-soft)]">{tx("Xin chào")}</span>
          <b className="block max-w-[180px] truncate text-[13.5px] text-[var(--sp-ink)]">{userName}</b>
        </span>
        <IconChevronDown size={15} className={`text-[var(--sp-muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] z-30 w-[240px] rounded-[18px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] p-2 shadow-[4px_4px_0_var(--sp-purple-deep)]"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); router.push("/settings"); }}>
            <IconUser size={17} /> {tx("Tài khoản & cài đặt")}
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); onOpenHouse(); }}>
            <span className="w-[17px] text-center">🏠</span> {tx("Nhà của Pilot")}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={dark} className={itemClass} onClick={toggleDark}>
            <IconMoon size={17} /> {tx("Chế độ tối")}
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${dark ? "bg-[var(--sp-peri)] text-white" : "bg-[var(--sp-surface-2)] text-[var(--sp-muted)]"}`}>
              {dark ? tx("Bật") : tx("Tắt")}
            </span>
          </button>
          <hr className="mx-1 my-1.5 border-[var(--sp-line)]" />
          <button type="button" role="menuitem" className={`${itemClass} !text-[var(--sp-pink-dark)]`} onClick={onSignOut}>
            <IconLogout size={17} /> {tx("Đăng xuất")}
          </button>
        </div>
      )}
    </div>
  );
}

function SignedInShell({
  pathname,
  userName,
  onSignOut,
  children,
}: {
  pathname: string;
  userName: string;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [houseOpen, setHouseOpen] = useState(false);
  const [strip, setStrip] = useState(false);
  const bgMotion = useBgMotion();
  const closeHouse = useCallback(() => setHouseOpen(false), []);
  const openHouse = useCallback(() => setHouseOpen(true), []);

  useEffect(() => {
    document.documentElement.classList.toggle("sp-bg-live", bgMotion);
    return () => document.documentElement.classList.remove("sp-bg-live");
  }, [bgMotion]);

  const today = new Date().toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "numeric" });

  return (
    <div className="min-h-screen text-[var(--sp-ink)]">
      {bgMotion && <StudyBackdrop onStrip={setStrip} />}

      {/* Sidebar (máy tính) */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[272px] flex-col overflow-y-auto border-r border-[var(--sp-line)] bg-[var(--sp-sidebar)] px-[18px] pb-[18px] pt-[26px] lg:flex">
        <div className="mb-5 px-1">
          <Logo />
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 mt-3.5 px-3 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[var(--sp-soft)]">{group.label}</p>
            <nav className="flex flex-col gap-1" aria-label={group.label}>
              {navigation
                .filter((item) => item.group === group.key)
                .map((item) => (
                  <SideLink key={item.href} href={item.href} active={isActivePath(pathname, item)} icon={item.icon}>
                    {item.name}
                  </SideLink>
                ))}
            </nav>
          </div>
        ))}

        <div className="min-h-6 flex-1" />

        <HouseCard onOpen={openHouse} />

        <div className="mt-3 border-t border-dashed border-[var(--sp-line)] pt-2.5">
          <SideLink href="/settings" active={pathname.startsWith("/settings")} icon={IconSettings}>
            {tx("Cài đặt")}
          </SideLink>
        </div>
      </aside>

      <div className="min-h-screen lg:ml-[272px]">
        {/* Header */}
        <header className="sticky top-0 z-10 flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--sp-line)] bg-[var(--sp-paper)]/90 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--sp-soft)]">StudyPilot</p>
              <p className="truncate text-[15px] font-bold text-[var(--sp-ink)]">
                {pageTitle(pathname)}
                <span className="ml-1.5 text-[13px] font-semibold text-[var(--sp-muted)]">· {today}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <NotificationBell />
            <UserMenu userName={userName} onOpenHouse={openHouse} onSignOut={onSignOut} />
          </div>
        </header>

        {/* Thanh điều hướng (điện thoại, máy tính bảng) */}
        <nav
          className="flex gap-2 overflow-x-auto border-b border-[var(--sp-line)] bg-[var(--sp-sidebar)] px-4 py-3 lg:hidden"
          aria-label={tx("Điều hướng chính")}
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
          <button
            type="button"
            onClick={openHouse}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sp-text-2)]"
          >
            🏠 {tx("Nhà của Pilot")}
          </button>
        </nav>

        {/* Chừa chỗ cho dải đường bay ở chân màn hình */}
        <main className={`mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8 ${bgMotion && strip ? "lg:pb-28" : ""}`}>
          {children}
        </main>
      </div>

      <PilotHouse open={houseOpen} onClose={closeHouse} />
    </div>
  );
}

/* Chưa có cấu hình Supabase: báo rõ cách sửa thay vì chạy chế độ demo */
function AuthConfigMissing() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-[28px] border-2 border-[var(--sp-purple-deep)] bg-white p-8 shadow-[6px_6px_0_var(--sp-pink-line)]">
        <h1 className="text-[34px] leading-tight text-[var(--sp-purple)]">{tx("Chưa kết nối Supabase")}</h1>
        <p className="mt-3 text-[15px] leading-7 text-[var(--sp-text-2)]">

          {tx("Thêm 2 dòng sau vào file")} <code className="rounded bg-[var(--sp-surface-2)] px-1.5">frontend/.env.local</code>  {tx("rồi chạy lại")} <code className="rounded bg-[var(--sp-surface-2)] px-1.5">npm run dev</code>:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-[var(--sp-surface-2)] p-4 text-[13px] text-[var(--sp-ink)]">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        </pre>
        <p className="mt-3 text-[13px] text-[var(--sp-muted)]">

          {tx("Lấy ở Supabase → Project Settings → API. Chỉ dùng khóa publishable (hoặc anon), không dùng khóa service role.")}
        </p>
      </div>
    </div>
  );
}

