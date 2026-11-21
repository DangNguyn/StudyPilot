"use client";

import { tx } from "@/lib/i18n";
import { IconCalendar, IconCheck, IconFile, IconFlag, IconPen, Sparkle } from "@/components/icons";

export type HeroStep = {
  number: string;
  title: string;
  detail: string;
  complete: boolean;
};

/*
 * Banner đầu trang "Kế hoạch ôn thi": nền tím đậm của thương hiệu,
 * điểm nhấn hồng/vàng, gộp luôn 4 bước tạo kế hoạch ở cạnh dưới.
 */
export default function PlanHeroBanner({
  steps,
  showSteps = true,
}: {
  steps: HeroStep[];
  showSteps?: boolean;
}) {
  const doneCount = steps.filter((step) => step.complete).length;
  const currentIndex = steps.findIndex((step) => !step.complete);

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[var(--sp-purple)] text-white shadow-[6px_6px_0_var(--sp-lav-line)]">
      {/* Hoạ tiết nền */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(#ffffff_1.2px,transparent_1.2px)] [background-size:18px_18px]"
      />
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-32 w-32 rounded-full bg-[var(--sp-pink)] opacity-90 sm:-right-16 sm:-top-24 sm:h-72 sm:w-72" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-40 hidden h-56 w-56 rounded-full bg-[var(--sp-peri)] opacity-80 lg:block" />

      <div className="relative grid gap-6 px-6 pb-6 pt-8 sm:px-10 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        {/* Nội dung */}
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-xs font-bold tracking-wide text-[#ffd3e2] ring-1 ring-white/15">
            <Sparkle size={12} className="text-[var(--sp-yellow)]" />

            {tx("TRỢ LÝ AI STUDYPILOT")}
          </span>
          <h2 className="mt-4 font-[family-name:var(--font-sp-display)] text-[34px] uppercase leading-[1.05] tracking-wide sm:text-[44px]">

            {tx("Chuẩn bị cho")}{" "}
            <span className="relative inline-block text-[var(--sp-yellow)]">

              {tx("kỳ thi")}
              <svg
                aria-hidden="true"
                viewBox="0 0 120 12"
                className="absolute -bottom-2 left-0 h-3 w-full"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 8 Q 15 2 30 7 T 60 7 T 90 7 T 118 6"
                  fill="none"
                  stroke="var(--sp-pink)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>{" "}

            {tx("tiếp theo")}
          </h2>
          <p className="mt-4 max-w-lg text-[15px] leading-6 text-white/80">

            {tx("Cho biết môn học, ngày thi và tài liệu. AI sẽ chia nội dung thành từng bài, xếp vào những ngày bạn rảnh và tạo bài kiểm tra sau mỗi buổi.")}
          </p>
        </div>

        {/* Minh hoạ: thẻ lịch học thu nhỏ */}
        <div aria-hidden="true" className="relative hidden h-[190px] lg:block">
          <div className="absolute right-6 top-2 w-[250px] rotate-[4deg] rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-white p-4 text-[var(--sp-ink)] shadow-[5px_5px_0_var(--sp-purple-deep)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--sp-muted)]">{tx("Tuần này")}</p>
              <span className="rounded-full bg-[var(--sp-pink-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--sp-pink-dark)]">

                {tx("còn 21 ngày")}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[var(--sp-muted)]">
              {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day, index) => (
                <div key={day}>
                  {day}
                  <span
                    className={`mx-auto mt-1 block h-5 w-5 rounded-md ${
                      index === 6
                        ? "bg-[var(--sp-surface-2)]"
                        : index < 2
                          ? "bg-[var(--sp-peri)]"
                          : index === 2
                            ? "bg-[var(--sp-pink)]"
                            : "bg-[var(--sp-lav)]"
                    }`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 text-[12px] font-semibold">
              <p className="flex items-center gap-2 rounded-lg bg-[var(--sp-lav)] px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--sp-peri)]" />

                {tx("Học mới · Chương 3")}
              </p>
              <p className="flex items-center gap-2 rounded-lg bg-[var(--sp-pink-bg)] px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--sp-pink)]" />

                {tx("Kiểm tra · 10 câu")}
              </p>
            </div>
          </div>
          <span className="absolute left-2 top-10 flex h-12 w-12 -rotate-12 items-center justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)] shadow-[3px_3px_0_var(--sp-purple-deep)]">
            <IconFlag size={22} />
          </span>
          <Sparkle size={22} className="sp-twinkle absolute right-0 top-0 text-[var(--sp-yellow)]" />
          <Sparkle size={14} className="sp-twinkle absolute bottom-4 left-14 text-white" />
        </div>
      </div>

      {/* 4 bước */}
      {showSteps && (
      <div className="relative border-t border-white/10 bg-[var(--sp-purple-deep)] px-4 py-4 sm:px-8">
        <div className="mb-3 flex items-center justify-between gap-3 px-2">
          <p className="text-xs font-bold uppercase tracking-wide text-white/60">

            {tx("Các bước tạo kế hoạch")}
          </p>
          <p className="text-xs font-bold text-[var(--sp-yellow)]">
            {tx("{0}/{1} hoàn thành", [doneCount, steps.length])}</p>
        </div>
        <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const icons = [IconPen, IconCalendar, IconFile, Sparkle];
            const Icon = icons[index] || Sparkle;
            return (
              <li
                key={step.number}
                className={`flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                  step.complete
                    ? "bg-white/10"
                    : isCurrent
                      ? "bg-white text-[var(--sp-ink)] shadow-[3px_3px_0_var(--sp-pink)]"
                      : "bg-white/5"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    step.complete
                      ? "bg-[var(--sp-yellow)] text-[var(--sp-purple-deep)]"
                      : isCurrent
                        ? "bg-[var(--sp-pink)] text-white"
                        : "bg-white/10 text-white/70"
                  }`}
                >
                  {step.complete ? <IconCheck size={17} /> : <Icon size={16} />}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-bold ${
                      isCurrent ? "text-[var(--sp-ink)]" : "text-white"
                    }`}
                  >
                    {step.number}. {step.title}
                  </span>
                  <span
                    className={`block truncate text-xs ${
                      isCurrent ? "text-[var(--sp-muted)]" : "text-white/60"
                    }`}
                  >
                    {step.detail}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      )}
    </section>
  );
}
