"use client";

import { applyLanguage, currentLang, tx } from "@/lib/i18n";
import Link from "next/link";
import { useCurrentUserName } from "@/lib/current-user";
import UserAvatar from "@/components/user-avatar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
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
  IconLogout,
  IconSettings,
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
  { name: tx("Tổng quan"), href: "/", icon: IconHome },
  {
    name: tx("Kế hoạch ôn thi"),
    href: "/study-plans",
    icon: IconCalendar,
    match: ["/study-sessions", "/review-plans"],
  },
  {
    name: tx("Tài liệu học tập"),
    href: "/materials",
    icon: IconFile,
    match: ["/study-materials"],
  },
  { name: "Flashcards", href: "/flashcards", icon: IconLayers },
  {
    name: tx("Kiểm tra kiến thức"),
    href: "/quizzes",
    icon: IconPen,
    match: ["/quiz-results"],
  },
  { name: tx("Đánh giá năng lực"), href: "/weak-areas", icon: IconChart },
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
    <div className="min-h-screen text-[var(--sp-ink)]">
      {/* Sidebar (máy tính) */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[272px] flex-col border-r border-[var(--sp-line)] bg-[var(--sp-sidebar)] px-5 py-7 lg:flex">
        <div className="mb-10 px-1">
          <Logo />
        </div>

        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--sp-soft)]">

          {tx("Không gian học")}
        </p>

        <nav className="flex flex-col gap-2" aria-label={tx("Điều hướng chính")}>
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

        {/* Cài đặt nằm cuối menu */}
        <Link
          href="/settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={`group mt-auto mb-4 flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-[15px] font-semibold transition ${
            pathname.startsWith("/settings")
              ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[4px_4px_0_var(--sp-purple-deep)]"
              : "border-transparent text-[var(--sp-text-2)] hover:border-[var(--sp-line)] hover:bg-white"
          }`}
        >
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
              pathname.startsWith("/settings")
                ? "bg-white/20 text-white"
                : "border border-[var(--sp-line)] bg-white text-[var(--sp-muted)] group-hover:text-[var(--sp-peri-dark)]"
            }`}
          >
            <IconSettings size={18} />
          </span>

          {tx("Cài đặt")}
        </Link>

        <div className="rounded-[20px] border border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] p-5">
          <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--sp-pink-line)] bg-white text-[var(--sp-pink)]">
            <Sparkle size={16} />
          </span>
          <p className="text-[15px] font-bold text-[var(--sp-purple)]">

            {tx("Học tập có lộ trình")}
          </p>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--sp-text-2)]">

            {tx("AI giúp bạn chia nhỏ tài liệu và biết chính xác hôm nay cần học gì.")}
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

                {tx("Không gian học tập của bạn")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <NotificationBell />

            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-[var(--sp-soft)]">

                {tx("Xin chào")}
              </p>
              <p className="text-sm font-bold text-[var(--sp-ink)]">
                {userName}
              </p>
            </div>

            <Link
              href="/settings"
              title={tx("Cài đặt tài khoản")}
              aria-label={tx("Cài đặt tài khoản")}
              className="rounded-xl ring-[var(--sp-peri)] ring-offset-2 ring-offset-[var(--sp-paper)] transition hover:ring-2"
            >
              <UserAvatar size={40} />
            </Link>

            {(
              <button
                type="button"
                onClick={() => void signOut()}
                title={tx("Đăng xuất")}
                aria-label={tx("Đăng xuất")}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--sp-line)] bg-white text-[var(--sp-muted)] transition hover:border-[var(--sp-pink-line)] hover:text-[var(--sp-pink-dark)]"
              >
                <IconLogout size={18} />
              </button>
            )}
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
        </nav>

        <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
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

