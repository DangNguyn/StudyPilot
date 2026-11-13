
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    name: "Tổng quan",
    href: "/",
    icon: "⌂",
  },
  {
    name: "Kế hoạch ôn thi",
    href: "/study-plans",
    icon: "▤",
  },
  {
    name: "Tài liệu học tập",
    href: "/materials",
    icon: "▧",
  },
  {
    name: "Flashcards",
    href: "/flashcards",
    icon: "▣",
  },
    {
    name: "Kiểm tra kiến thức",
    href: "/quizzes",
    icon: "✎",
  },
  {
    name: "Đánh giá năng lực",
    href: "/weak-areas",
    icon: "▥",
  },
];

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="app-background min-h-screen text-[var(--foreground)]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[268px] flex-col border-r border-[var(--border)] bg-white px-6 py-7 lg:flex">
        <div className="mb-11 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--primary-dark)] text-lg font-bold text-white shadow-sm">
            S
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--primary-dark)]">
              StudyPilot
            </h1>
            <p className="mt-0.5 text-[11px] font-medium text-[var(--muted)]">
              Học đúng cách hơn mỗi ngày
            </p>
          </div>
        </div>

        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#94a49a]">
          Không gian học
        </p>

        <nav className="flex flex-col gap-1.5">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[#eaf4ed] text-[var(--primary-dark)] shadow-sm"
                    : "text-[#708278] hover:bg-[#f4f8f4] hover:text-[var(--primary-dark)]"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl text-base transition ${
                    isActive
                      ? "bg-white text-[var(--primary)]"
                      : "bg-[#f3f7f3] text-[#8ba095] group-hover:text-[var(--primary)]"
                  }`}
                >
                  {item.icon}
                </span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-3xl bg-[#eef6ef] p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-lg">
            ✦
          </div>
          <p className="text-sm font-bold text-[var(--primary-dark)]">
            Học tập có lộ trình
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            AI giúp bạn chia nhỏ tài liệu và biết chính xác hôm nay cần học gì.
          </p>
        </div>
      </aside>

      <div className="min-h-screen lg:ml-[268px]">
        <header className="sticky top-0 z-10 flex min-h-[76px] items-center justify-between border-b border-[#cbdacf] bg-white px-5 shadow-[0_2px_12px_rgba(29,81,60,0.06)] sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--primary-dark)] text-sm font-bold text-white shadow-sm lg:hidden">
              S
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#91a198]">
                StudyPilot
              </p>
              <p className="mt-1 text-sm font-semibold text-[#3e584a]">
                Không gian học tập của bạn
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-[#92a097]">Xin chào</p>
              <p className="text-sm font-bold text-[var(--primary-dark)]">
                Sinh viên
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e6f1e8] text-sm font-bold text-[var(--primary-dark)]">
              S
            </div>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-[#cbdacf] bg-[#f7fbf7] px-4 py-3 shadow-[0_2px_8px_rgba(29,81,60,0.04)] lg:hidden">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${
                  isActive
                    ? "bg-[var(--primary-dark)] text-white shadow-sm"
                    : "border border-[#d8e6db] bg-white text-[#587064] hover:bg-[#edf6ef]"
                }`}
              >
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
