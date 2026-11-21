"use client";

import { currentLang, tx } from "@/lib/i18n";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconArrowRight,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconUser,
  Sparkle,
} from "@/components/icons";
import { startLoginSplash } from "@/components/login-splash";
import { authErrorMessage, getAuthClient, holdAuthRedirect } from "@/lib/auth";

export type AuthMode = "login" | "register" | "forgot" | "verify";

const MODE_PATH: Record<AuthMode, string> = {
  login: "/login",
  register: "/register",
  forgot: "/login",
  verify: "/register",
};

const ART_TEXT: Record<AuthMode, string> = {
  login: tx("Lập kế hoạch – Học – Ôn thi – Đánh giá trong một không gian duy nhất."),
  register: tx("Tạo tài khoản StudyPilot để lập kế hoạch, học tập, ôn thi và đánh giá năng lực dễ dàng."),
  forgot: tx("Đừng lo, chỉ cần email bạn đã đăng ký là lấy lại được tài khoản."),
  verify: tx("Mã 6 số giúp chắc chắn Gmail của bạn có thật, để StudyPilot gửi được lịch nhắc học."),
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/* Đăng ký chỉ nhận Gmail để StudyPilot gửi được thông báo học tập */
const GMAIL_PATTERN = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/i;

/* ================= Khung chung của trang tài khoản ================= */

export function AuthLayout({ artText, children }: { artText: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-4 sm:px-6">
      <div className="grid w-full max-w-[1080px] items-stretch gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Bên trái: lời chào + hình minh họa (ẩn trên điện thoại) */}
        <section className="hidden flex-col rounded-[32px] border-2 border-[var(--sp-purple-deep)] bg-[#fbf3f9] p-8 shadow-[6px_6px_0_var(--sp-pink-line)] lg:flex xl:p-9">
          <h1 className="text-[40px] leading-[1.1] text-[var(--sp-purple)] xl:text-[44px]">

            {tx("Học tập thông minh, hiệu quả hơn")}{" "}
            <span className="whitespace-nowrap">
              <span className="sp-squiggle">{tx("mỗi ngày")}</span>
              <Sparkle size={26} className="sp-twinkle ml-2 inline-block align-top text-[var(--sp-yellow)]" />
            </span>
          </h1>
          <p key={artText} className="sp-fade-in mt-3 max-w-md text-[15px] leading-6 text-[var(--sp-text-2)]">
            {artText}
          </p>
          <div className="mt-auto flex min-h-0 flex-1 items-end justify-center pt-4">
            <AuthIllustration />
          </div>
        </section>

        {/* Bên phải: thẻ đăng nhập / đăng ký */}
        <div className="mx-auto flex w-full max-w-[540px] flex-col lg:max-w-none">{children}</div>
      </div>
    </div>
  );
}

/* Hình minh họa: dùng ảnh /auth-illustration.png nếu có, không thì vẽ bằng SVG */
function AuthIllustration({
  className,
  src = "/auth-illustration.png",
  alt = tx("Bạn học sinh đang học với StudyPilot"),
}: {
  className?: string;
  src?: string;
  alt?: string;
}) {
  const [useImage, setUseImage] = useState(true);
  if (useImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className ?? "mx-auto max-h-[42vh] w-full max-w-[480px] object-contain"}
        onError={() => setUseImage(false)}
      />
    );
  }
  return <DeskIllustration />;
}

/* Góc học tập vẽ bằng SVG: dùng cho trang trái của phần đăng ký */
function DeskIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 330" className={className ?? "mx-auto w-full max-w-[460px]"} role="img" aria-label={tx("Góc học tập với laptop, sách và lịch học")}>
      <ellipse cx="260" cy="250" rx="240" ry="70" fill="#ebe0f7" />
      {/* Thẻ việc cần làm */}
      <g transform="rotate(-4 110 90)">
        <rect x="40" y="40" width="150" height="104" rx="18" fill="#fff" stroke="#e6dcf2" strokeWidth="2" />
        <circle cx="70" cy="75" r="11" fill="#3ba776" />
        <path d="m64 75 4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="90" y="69" width="76" height="8" rx="4" fill="#e5e0ee" />
        <circle cx="70" cy="111" r="11" fill="#3ba776" />
        <path d="m64 111 4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="90" y="105" width="60" height="8" rx="4" fill="#e5e0ee" />
      </g>
      {/* Lịch học */}
      <g transform="rotate(4 410 85)">
        <rect x="340" y="28" width="140" height="116" rx="18" fill="#fff" stroke="#e6dcf2" strokeWidth="2" />
        <path d="M340 46a18 18 0 0 1 18-18h104a18 18 0 0 1 18 18v12H340Z" fill="#8c6fe0" />
        {[364, 388, 412, 436, 460].map((x) => (
          <rect key={x} x={x - 3} y="20" width="6" height="16" rx="3" fill="#5b3fb8" />
        ))}
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={356 + col * 29}
              y={70 + row * 22}
              width="21"
              height="14"
              rx="4"
              fill={row === 0 && col === 3 ? "#8c6fe0" : "#e9e3f6"}
            />
          ))
        )}
      </g>
      {/* Sách */}
      <rect x="54" y="262" width="150" height="26" rx="8" fill="#5b7fe3" />
      <rect x="66" y="266" width="128" height="8" rx="3" fill="#fff" opacity=".9" />
      <rect x="70" y="236" width="128" height="26" rx="8" fill="#7a4fd0" />
      <rect x="82" y="240" width="108" height="8" rx="3" fill="#fff" opacity=".9" />
      {/* Cốc */}
      <rect x="214" y="246" width="40" height="44" rx="10" fill="#fff" stroke="#e6dcf2" strokeWidth="2" />
      <path d="M254 256h6a8 8 0 0 1 0 16h-6" stroke="#e6dcf2" strokeWidth="4" fill="none" />
      <path d="m234 256 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#f6c343" />
      {/* Laptop */}
      <rect x="270" y="150" width="170" height="112" rx="14" fill="#9c8ce8" />
      <rect x="282" y="162" width="146" height="88" rx="8" fill="#b6a9f0" />
      <circle cx="355" cy="206" r="20" fill="#fff" opacity=".85" />
      <text x="355" y="214" textAnchor="middle" fontSize="22" fontWeight="800" fill="#7a63d6" fontFamily="var(--font-sp-display), sans-serif">
        S
      </text>
      <path d="M252 262h206l-12 28H264Z" fill="#8576dc" />
      {/* Chậu cây */}
      <path d="M462 248h44l-6 42h-32Z" fill="#efe9fb" stroke="#d9cdf2" strokeWidth="2" />
      <ellipse cx="472" cy="222" rx="12" ry="26" fill="#5fbf73" transform="rotate(-24 472 222)" />
      <ellipse cx="496" cy="218" rx="12" ry="28" fill="#4aa862" transform="rotate(20 496 218)" />
      <ellipse cx="485" cy="206" rx="10" ry="28" fill="#6fcf83" />
      {/* Ngôi sao trang trí */}
      <path d="M250 70l5 13 13 5-13 5-5 13-5-13-13-5 13-5Z" fill="#e0457b" />
      <path d="M300 104l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill="#f6c343" />
    </svg>
  );
}

/* ================= Ô nhập ================= */

function Field({
  id,
  label,
  icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-end gap-3 [@media(max-height:760px)]:grid-cols-[40px_minmax(0,1fr)]">
      <span
        aria-hidden="true"
        className={`flex h-11 w-11 items-center justify-center rounded-2xl border-2 [@media(max-height:760px)]:h-10 [@media(max-height:760px)]:w-10 ${
          error
            ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
            : "border-[var(--sp-line)] bg-[#faf6fc] text-[var(--sp-purple)]"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <label htmlFor={id} className="mb-1 block text-[13.5px] font-bold text-[var(--sp-ink)]">
          {label}
        </label>
        {children}
      </div>
      {error && (
        <p id={`${id}-error`} className="col-start-2 -mt-2 text-[12px] font-semibold text-[var(--sp-pink-dark)]">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(error?: string) {
  return `h-11 w-full rounded-2xl border-2 [@media(max-height:760px)]:h-10 bg-white px-4 text-[15px] text-[var(--sp-ink)] outline-none transition placeholder:text-[var(--sp-soft)] ${
    error
      ? "border-[var(--sp-pink)] bg-[#fff8fb]"
      : "border-[var(--sp-line)] hover:border-[var(--sp-lav-line)] focus:border-[var(--sp-peri)]"
  }`;
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  error,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass(error)} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? tx("Ẩn mật khẩu") : tx("Hiện mật khẩu")}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-[var(--sp-muted)] transition hover:bg-[var(--sp-surface-2)] hover:text-[var(--sp-ink)]"
      >
        {visible ? <IconEyeOff size={19} /> : <IconEye size={19} />}
      </button>
    </div>
  );
}

/* ================= Cuốn sách đăng nhập / đăng ký ================= */

type Errors = Partial<Record<"name" | "email" | "password" | "confirm" | "code", string>>;
type BookMode = "login" | "register";

const FLIP_MS = 900; // lật một trang
const CLOSE_MS = 700; // hai nửa sách úp vào
const OPEN_MS = 750; // mở sách ra
const SHEETS = 12; // số lớp giấy mỗi bên

const DISPLAY_FONT = { fontFamily: "var(--font-sp-display), Impact, sans-serif", fontWeight: 400, letterSpacing: "0.01em" };

/* Màn hình rộng (≥1024px) mới hiện cuốn sách 2 trang; điện thoại chỉ hiện 1 trang form */
function useWideScreen() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(min-width: 1024px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true
  );
}

/* Trang trái đi kèm từng chế độ */
function artFor(mode: AuthMode): BookMode {
  return mode === "register" || mode === "verify" ? "register" : "login";
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Một nửa cuốn sách: bìa cứng + nhiều lớp giấy + mép giấy, trang trên cùng là nội dung */
function BookSide({ side, className, children }: { side: "left" | "right"; className: string; children: ReactNode }) {
  const left = side === "left";
  return (
    <div className={`sp-book-side ${left ? "is-left" : "is-right"} ${className}`}>
      <div className="sp-book-board" />
      {Array.from({ length: SHEETS }, (_, index) => {
        const depth = SHEETS - index; // lớp sâu nhất vẽ trước
        const offset = Math.round(depth * 0.8);
        return (
          <div
            key={depth}
            className="sp-book-sheet"
            style={{
              transform: `translateZ(calc(var(--sp-book-depth) * -${depth / SHEETS}))`,
              left: left ? -offset : offset,
              top: Math.round(depth * 0.45),
            }}
          />
        );
      })}
      <div className="sp-book-edge" />
      <div className="sp-book-edge-x is-top" />
      <div className="sp-book-edge-x is-bottom" />
      {children}
    </div>
  );
}

/* Biểu tượng Google: đặt file logo chính thức của Google vào frontend/public/google-g.svg là tự hiện.
   Chưa có file thì hiện chữ G đơn giản. */
function GoogleMark() {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--sp-line)] text-[13px] font-extrabold text-[var(--sp-peri-dark)]">
        G
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/google-g.svg" alt="" aria-hidden="true" className="h-5 w-5" onError={() => setMissing(true)} />;
}

function PageNumber({ value }: { value: number }) {
  return <p className="mt-auto pt-2 text-center text-[12px] font-medium tracking-[0.2em] text-[var(--sp-soft)]">— {value} —</p>;
}

/* Trang trái: lời chào + hình, mỗi chế độ một nội dung riêng */
function ArtPage({ mode }: { mode: BookMode }) {
  if (mode === "register") {
    return (
      <div className="flex h-full flex-col bg-[#fbf3f9] px-9 pb-4 pt-9">
        <p style={DISPLAY_FONT} className="text-[38px] leading-[1.1] text-[var(--sp-purple)]">

          {currentLang() === "en" ? "Start your" : "Bắt đầu"}{" "}
          <span className="whitespace-nowrap">
            <span className="sp-squiggle">{currentLang() === "en" ? "learning journey" : "hành trình"}</span>
            <Sparkle size={22} className="sp-twinkle ml-2 inline-block align-top text-[var(--sp-yellow)]" />
          </span>{" "}

          {currentLang() === "en" ? "" : "học của bạn"}
        </p>
        <p className="mt-3 text-[15px] leading-6 text-[var(--sp-text-2)]">{ART_TEXT.register}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {[tx("AI chia nhỏ tài liệu"), tx("Lịch ôn tự động"), tx("Nhắc học qua Gmail")].map((item) => (
            <li key={item} className="sp-chip flex items-center gap-1.5 bg-white text-[13px]">
              <IconCheck size={14} className="text-emerald-600" />
              {item}
            </li>
          ))}
        </ul>
        <div className="flex min-h-0 flex-1 items-center justify-center pt-3">
          {/* Đặt ảnh vào frontend/public/auth-register.png là tự hiện; chưa có ảnh thì dùng hình vẽ SVG */}
          <AuthIllustration
            src="/auth-register.png"
            alt={tx("Bạn học sinh bắt đầu hành trình học với StudyPilot")}
            className="mx-auto max-h-full w-full max-w-[440px] object-contain"
          />
        </div>
        <PageNumber value={3} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-[#fbf3f9] px-9 pb-4 pt-9">
      <p style={DISPLAY_FONT} className="text-[38px] leading-[1.1] text-[var(--sp-purple)]">

        {tx("Học tập thông minh, hiệu quả hơn")}{" "}
        <span className="whitespace-nowrap">
          <span className="sp-squiggle">{tx("mỗi ngày")}</span>
          <Sparkle size={22} className="sp-twinkle ml-2 inline-block align-top text-[var(--sp-yellow)]" />
        </span>
      </p>
      <p className="mt-3 text-[15px] leading-6 text-[var(--sp-text-2)]">{ART_TEXT.login}</p>
      <div className="flex min-h-0 flex-1 items-end justify-center pt-3">
        <AuthIllustration className="mx-auto max-h-full w-full max-w-[440px] object-contain" />
      </div>
      <PageNumber value={1} />
    </div>
  );
}

type FormPageProps = {
  mode: AuthMode;
  idPrefix?: string;
  ghost?: boolean;
  name: string;
  email: string;
  password: string;
  confirm: string;
  setName?: (value: string) => void;
  setEmail?: (value: string) => void;
  setPassword?: (value: string) => void;
  setConfirm?: (value: string) => void;
  errors?: Errors;
  formError?: string;
  notice?: string;
  submitting?: boolean;
  success?: boolean;
  shake?: number;
  fadeIn?: boolean;
  firstFieldRef?: React.Ref<HTMLInputElement>;
  onSubmit?: (event: FormEvent) => void;
  onSwitch?: () => void;
  onForgot?: () => void;
  onGoogle?: () => void;
  googleBusy?: boolean;
  code?: string;
  setCode?: (value: string) => void;
  resendIn?: number;
  onResend?: () => void;
  onEditEmail?: () => void;
  pageNumber?: number;
};

const noop = () => {};

/* Trang phải: form đăng nhập / đăng ký / quên mật khẩu.
   ghost = bản sao không bấm được, in lên mặt trước của tờ giấy đang lật */
function FormPage({
  mode,
  idPrefix = "auth",
  ghost = false,
  name,
  email,
  password,
  confirm,
  setName = noop,
  setEmail = noop,
  setPassword = noop,
  setConfirm = noop,
  errors = {},
  formError = "",
  notice = "",
  submitting = false,
  success = false,
  shake = 0,
  fadeIn = false,
  firstFieldRef,
  onSubmit = (event) => event.preventDefault(),
  onSwitch = noop,
  onForgot = noop,
  onGoogle = noop,
  googleBusy = false,
  code = "",
  setCode = noop,
  resendIn = 0,
  onResend = noop,
  onEditEmail = noop,
  pageNumber,
}: FormPageProps) {
  const id = (key: string) => `${idPrefix}-${key}`;
  // Tiêu đề chia 2 phần (phần sau có gạch xoăn); tiếng Anh đặt chữ khác nên viết riêng
  const title = (
    currentLang() === "en"
      ? { login: ["Log", "in"], register: ["Sign", "up"], forgot: ["Forgot", "password"], verify: ["Enter", "your code"] }
      : { login: ["Đăng", "nhập"], register: ["Đăng", "ký"], forgot: ["Quên", "mật khẩu"], verify: ["Nhập", "mã xác nhận"] }
  )[mode];
  const submitLabel = { login: tx("Đăng nhập"), register: tx("Tạo tài khoản"), forgot: tx("Gửi link đặt lại"), verify: tx("Xác nhận") }[mode];
  const showGoogle = mode === "login" || mode === "register";

  return (
    <div
      inert={ghost}
      aria-hidden={ghost || undefined}
      className="relative flex h-full flex-col overflow-y-auto bg-white px-8 pb-4 pt-7 [scrollbar-width:none] xl:px-10 [@media(max-height:760px)]:pb-3 [@media(max-height:760px)]:pt-5"
    >
      <Sparkle size={20} className="sp-twinkle absolute right-8 top-8 text-[var(--sp-pink)]" />
      <Sparkle size={12} className="sp-twinkle absolute right-[3.75rem] top-[3.75rem] text-[var(--sp-yellow)]" />

      {/* Logo */}
      <Link href="/" tabIndex={ghost ? -1 : undefined} className="flex w-fit items-center gap-3">
        <span className="relative flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)]">
          <span className="font-[family-name:var(--font-sp-display)] text-[22px] leading-none">S</span>
          <Sparkle size={14} className="absolute -right-2 -top-2 text-[var(--sp-pink)]" />
        </span>
        <span>
          <span className="block font-[family-name:var(--font-sp-display)] text-[26px] leading-none text-[var(--sp-purple)]">
            StudyPilot
          </span>
          <span className="mt-1 block text-[12px] font-medium text-[var(--sp-muted)] [@media(max-height:760px)]:hidden">

            {tx("Học đúng cách hơn mỗi ngày")}
          </span>
        </span>
      </Link>

      <div key={`${mode}-${shake}`} className={`flex flex-1 flex-col justify-center ${shake > 0 ? "sp-shake" : fadeIn && !ghost ? "sp-fade-in" : ""}`}>
        <h2 style={DISPLAY_FONT} className="mt-3 text-[36px] leading-tight text-[var(--sp-purple)]">
          {title[0]} <span className="sp-squiggle">{title[1]}</span>
        </h2>
        {mode === "forgot" && (
          <p className="mt-2 text-[14px] leading-6 text-[var(--sp-muted)]">

            {tx("Nhập email đã đăng ký, StudyPilot sẽ gửi link để bạn đặt mật khẩu mới.")}
          </p>
        )}
        {mode === "verify" && (
          <p className="mt-2 text-[14px] leading-6 text-[var(--sp-muted)]">

            {tx("Mã 6 số vừa được gửi tới")} <b className="font-bold text-[var(--sp-ink)]">{email}</b>{tx(". Mở Gmail, chép mã rồi nhập vào đây.")}{" "}
            <button type="button" onClick={onEditEmail} className="font-bold text-[var(--sp-peri-dark)] underline underline-offset-4">

              {tx("Sửa Gmail")}
            </button>
          </p>
        )}

        {notice && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-2xl bg-[var(--sp-lav)] px-4 py-3 text-[13px] leading-5 text-[var(--sp-peri-dark)]">
            <IconMail size={16} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        <form noValidate onSubmit={onSubmit} className="mt-3 space-y-3 [@media(max-height:760px)]:mt-2 [@media(max-height:760px)]:space-y-2.5">
          {mode === "register" && (
            <Field id={id("name")} label={tx("Họ và tên")} icon={<IconUser size={20} />} error={errors.name}>
              <input
                ref={firstFieldRef}
                id={id("name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={tx("Nhập họ và tên của bạn")}
                autoComplete="name"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `${id("name")}-error` : undefined}
                className={inputClass(errors.name)}
              />
            </Field>
          )}

          {mode !== "verify" && (
          <Field
            id={id("email")}
            label={mode === "register" ? tx("Gmail (để nhận thông báo)") : "Email"}
            icon={<IconMail size={20} />}
            error={errors.email}
          >
            <input
              ref={mode === "register" ? undefined : firstFieldRef}
              id={id("email")}
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={mode === "register" ? "tenban@gmail.com" : tx("Nhập email của bạn")}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? `${id("email")}-error` : undefined}
              className={inputClass(errors.email)}
            />
          </Field>
          )}

          {mode === "verify" && (
            <Field id={id("code")} label={tx("Mã xác nhận")} icon={<IconLock size={20} />} error={errors.code}>
              <input
                ref={firstFieldRef}
                id={id("code")}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="• • • • • •"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? `${id("code")}-error` : undefined}
                className={`${inputClass(errors.code)} text-center text-[22px] font-bold tracking-[0.5em]`}
              />
            </Field>
          )}

          {(mode === "login" || mode === "register") && (
            <Field id={id("password")} label={tx("Mật khẩu")} icon={<IconLock size={20} />} error={errors.password}>
              <PasswordInput
                id={id("password")}
                value={password}
                onChange={setPassword}
                placeholder={mode === "register" ? tx("Ít nhất 8 ký tự, có chữ và số") : tx("Nhập mật khẩu")}
                error={errors.password}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </Field>
          )}

          {mode === "register" && (
            <Field id={id("confirm")} label={tx("Xác nhận mật khẩu")} icon={<IconLock size={20} />} error={errors.confirm}>
              <PasswordInput
                id={id("confirm")}
                value={confirm}
                onChange={setConfirm}
                placeholder={tx("Nhập lại mật khẩu")}
                error={errors.confirm}
                autoComplete="new-password"
              />
            </Field>
          )}

          {mode === "login" && (
            <div className="-mt-2 text-right">
              <button
                type="button"
                onClick={onForgot}
                className="text-[14px] font-bold text-[var(--sp-peri-dark)] underline underline-offset-4 hover:text-[var(--sp-purple)]"
              >

                {tx("Quên mật khẩu?")}
              </button>
            </div>
          )}

          {formError && (
            <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-3 text-[13.5px] font-semibold text-[var(--sp-pink-dark)]">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 [@media(max-height:760px)]:h-11 border-[var(--sp-purple-deep)] text-[17px] font-bold text-white shadow-[4px_4px_0_var(--sp-pink)] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_var(--sp-pink)] disabled:cursor-wait ${
              success ? "bg-emerald-600" : "bg-[var(--sp-peri)] hover:bg-[var(--sp-peri-dark)]"
            }`}
          >
            {success ? (
              <>
                <IconCheck size={20} />
                {mode === "register" ? tx("Đã tạo tài khoản") : mode === "verify" ? tx("Đã xác nhận Gmail") : tx("Đăng nhập thành công")}
              </>
            ) : submitting ? (
              <>
                <Sparkle size={16} className="sp-twinkle" />

                {tx("Đang xử lý...")}
              </>
            ) : (
              <>
                {submitLabel}
                <IconArrowRight size={19} />
              </>
            )}
          </button>
        </form>

        {/* Đăng nhập / đăng ký bằng Google: Gmail luôn có thật, không cần nhập mã */}
        {showGoogle && (
          <>
            <div className="mt-3 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--sp-soft)] [@media(max-height:760px)]:hidden">
              <span className="h-px flex-1 bg-[var(--sp-line)]" />

              {tx("hoặc")}
              <span className="h-px flex-1 bg-[var(--sp-line)]" />
            </div>
            <button
              type="button"
              onClick={onGoogle}
              disabled={googleBusy || submitting}
              className="mt-3 flex h-11 w-full items-center justify-center gap-3 rounded-2xl border-2 [@media(max-height:760px)]:h-10 border-[var(--sp-line)] bg-white text-[15px] font-bold text-[var(--sp-ink)] transition hover:border-[var(--sp-lav-line)] hover:bg-[#faf6fc] disabled:cursor-wait disabled:opacity-70"
            >
              <GoogleMark />
              {googleBusy ? tx("Đang mở Google...") : mode === "register" ? tx("Đăng ký bằng Google") : tx("Tiếp tục với Google")}
            </button>
          </>
        )}

        {/* Bước nhập mã: gửi lại mã */}
        {mode === "verify" ? (
          <div className="mt-5 flex items-center gap-4 [@media(max-height:760px)]:mt-3">
            <span className="h-px flex-1 bg-[var(--sp-line)]" />
            <p className="text-[15px] text-[var(--sp-text-2)]">

              {tx("Chưa nhận được mã?")}{" "}
              <button
                type="button"
                onClick={onResend}
                disabled={resendIn > 0}
                className="font-bold text-[var(--sp-pink-dark)] underline decoration-2 underline-offset-4 hover:text-[var(--sp-pink)] disabled:cursor-default disabled:text-[var(--sp-soft)] disabled:no-underline"
              >
                {resendIn > 0 ? tx("Gửi lại sau {0}s", [resendIn]) : tx("Gửi lại mã")}
              </button>
            </p>
            <span className="h-px flex-1 bg-[var(--sp-line)]" />
          </div>
        ) : (
        <div className="mt-5 flex items-center gap-4 [@media(max-height:760px)]:mt-3">
          <span className="h-px flex-1 bg-[var(--sp-line)]" />
          <p className="text-[15px] text-[var(--sp-text-2)]">
            {mode === "register" ? tx("Đã có tài khoản? ") : mode === "forgot" ? tx("Nhớ ra rồi? ") : tx("Chưa có tài khoản? ")}
            <button
              type="button"
              onClick={onSwitch}
              className="font-bold text-[var(--sp-pink-dark)] underline decoration-2 underline-offset-4 hover:text-[var(--sp-pink)]"
            >
              {mode === "login" ? tx("Đăng ký") : tx("Đăng nhập")}
            </button>
          </p>
          <span className="h-px flex-1 bg-[var(--sp-line)]" />
        </div>
        )}
      </div>

      {pageNumber && <PageNumber value={pageNumber} />}
    </div>
  );
}

type Leaf = {
  forward: boolean; // true: lật từ đăng nhập sang đăng ký
  angle: number;
  animate: boolean;
  visible: boolean;
  ghostEmail: string;
  ghostPassword: string;
};

export default function AuthScreen({ initialMode }: { initialMode: "login" | "register" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wide = useWideScreen();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [leftArt, setLeftArt] = useState<BookMode>(initialMode);
  // Tờ giấy lật luôn có sẵn trong trang (chỉ ẩn đi) để trình duyệt không phải dựng lại lúc lật -> hết nháy
  const [leaf, setLeaf] = useState<Leaf>({ forward: true, angle: 0, animate: false, visible: false, ghostEmail: "", ghostPassword: "" });
  const [shut, setShut] = useState(true); // vào trang: sách đang gập, rồi mở ra
  const [motion, setMotion] = useState<"closing" | "opening">("opening");
  const [thud, setThud] = useState(false);
  const [leaving, setLeaving] = useState(false); // sách thu nhỏ lại trước màn hình chào
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(0);
  // Chỉ mờ dần khi đổi nội dung tại chỗ (quên mật khẩu). Lật trang thì không, tránh bị nháy khi tờ giấy vừa lật xong.
  const [fadeIn, setFadeIn] = useState(false);
  const [code, setCode] = useState(""); // mã 6 số gửi tới Gmail
  const [resendIn, setResendIn] = useState(0); // đếm ngược trước khi được gửi lại mã
  const [googleBusy, setGoogleBusy] = useState(false);
  // Vừa quay về từ trang đăng nhập Google: chưa mở sách, chờ Supabase nhận phiên đăng nhập
  const [oauthReturning, setOauthReturning] = useState(() => searchParams.get("oauth") === "1");
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const busy = useRef(false);

  /* Mở sách khi vừa vào trang (trừ lúc vừa đăng nhập Google xong) */
  useEffect(() => {
    const frame = oauthReturning ? 0 : window.requestAnimationFrame(() => setShut(false));
    const list = timers.current;
    return () => {
      window.cancelAnimationFrame(frame);
      list.forEach((timer) => window.clearTimeout(timer));
      holdAuthRedirect(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Quay về từ Google: có phiên đăng nhập thì vào màn hình chào, có lỗi thì mở sách và báo lỗi */
  useEffect(() => {
    if (!oauthReturning) return;
    holdAuthRedirect(true);
    const client = getAuthClient();
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const oauthError = url.searchParams.get("error_description") || hash.get("error_description");
    let done = false;

    const giveUp = (message: string) => {
      if (done) return;
      done = true;
      holdAuthRedirect(false);
      url.searchParams.delete("oauth");
      url.searchParams.delete("error");
      url.searchParams.delete("error_code");
      url.searchParams.delete("error_description");
      window.history.replaceState(null, "", url.pathname + url.search);
      setOauthReturning(false);
      setFormError(message);
      window.requestAnimationFrame(() => setShut(false));
    };
    const enter = () => {
      if (done) return;
      done = true;
      const next = searchParams.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      startLoginSplash();
      router.replace(target);
    };

    if (!client) {
      window.setTimeout(() => giveUp(tx("Chưa cấu hình đăng nhập (thiếu biến Supabase trong frontend/.env.local).")), 0);
      return;
    }
    if (oauthError) {
      window.setTimeout(() => giveUp(tx("Đăng nhập Google chưa thành công: {0}", [oauthError])), 0);
      return;
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session) enter();
    });
    client.auth.getSession().then(({ data: current }) => {
      if (current.session) enter();
    });
    const timeout = window.setTimeout(() => giveUp(tx("Đăng nhập Google chưa xong. Bạn thử lại nhé.")), 12000);
    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthReturning]);

  /* Đếm ngược nút "Gửi lại mã" */
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.current.push(window.setTimeout(resolve, ms));
    });
  const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  const setUrl = (next: AuthMode) => window.history.replaceState(null, "", MODE_PATH[next] + window.location.search);
  const focusLater = (id?: string) =>
    timers.current.push(
      window.setTimeout(() => (id ? document.getElementById(id)?.focus() : firstFieldRef.current?.focus()), 60)
    );

  function clearForm(keepNotice = false) {
    setErrors({});
    setFormError("");
    if (!keepNotice) setNotice("");
    setPassword("");
    setConfirm("");
  }

  /* Lật trang giữa đăng nhập ⇄ đăng ký */
  async function flipTo(next: AuthMode) {
    if (busy.current || next === mode) return;

    // Quên mật khẩu nằm cùng trang với đăng nhập: chỉ đổi nội dung trang phải
    const samePage =
      next === "forgot" || mode === "forgot" || (mode === "register" && next === "verify") || (mode === "verify" && next === "register");
    if (samePage || !wide || prefersReducedMotion()) {
      clearForm();
      setShake(0);
      setFadeIn(true);
      setMode(next);
      setLeftArt(artFor(next));
      setUrl(next);
      focusLater();
      return;
    }

    busy.current = true;
    setShake(0);
    setFadeIn(false);
    const forward = next === "register" || next === "verify";
    const snapshot = { ghostEmail: email, ghostPassword: forward ? password : "" };
    clearForm();
    setUrl(next);
    // 1) Hiện tờ giấy đúng chỗ, che trang sắp đổi (chưa đổi nội dung bên dưới).
    // 2) Khi tờ giấy đã vẽ xong mới đổi nội dung bên dưới và bắt đầu lật, nên không lộ khung hình nào bị trống.
    setLeaf({ forward, angle: forward ? 0 : -180, animate: false, visible: true, ...snapshot });
    await nextFrame();
    await nextFrame();
    if (forward) setMode(next);
    else setLeftArt("login");
    setLeaf({ forward, angle: forward ? -180 : 0, animate: true, visible: true, ...snapshot });
    await wait(FLIP_MS + 40);
    if (forward) setLeftArt("register");
    else setMode(next);
    await nextFrame();
    setLeaf((current) => ({ ...current, animate: false, visible: false }));
    busy.current = false;
    focusLater();
  }

  /* Đăng ký xong: úp sách lại cho khít, dừng một nhịp, rồi mở ra trang đăng nhập */
  async function closeAndOpenToLogin() {
    busy.current = true;
    const animate = wide && !prefersReducedMotion();
    if (animate) {
      await wait(650);
      setMotion("closing");
      setShut(true);
      await wait(CLOSE_MS + 20);
      setThud(true);
      await wait(140);
      setThud(false);
      await wait(450);
    }
    // Đổi nội dung khi sách đang úp kín nên người dùng không thấy
    setSuccess(false);
    setSubmitting(false);
    clearForm();
    setCode("");
    setShake(0);
    setFadeIn(false);
    setMode("login");
    setLeftArt("login");
    setUrl("login");
    if (animate) {
      setMotion("opening");
      setShut(false);
      await wait(OPEN_MS + 50);
    }
    busy.current = false;
    focusLater("auth-password");
  }

  function validate(): Errors {
    const next: Errors = {};
    if (mode === "verify") {
      if (code.length < 6) next.code = tx("Nhập đủ mã 6 số trong Gmail.");
      return next;
    }
    if (mode === "register" && name.trim().length < 2) next.name = tx("Hãy nhập họ và tên của bạn.");
    if (!email.trim()) next.email = tx("Hãy nhập email.");
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = tx("Email chưa đúng định dạng.");
    else if (mode === "register" && !GMAIL_PATTERN.test(email.trim()))
      next.email = tx("Hãy dùng địa chỉ Gmail (…@gmail.com) để nhận thông báo học tập.");
    if (mode === "login" || mode === "register") {
      if (!password) next.password = tx("Hãy nhập mật khẩu.");
      else if (mode === "register" && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)))
        next.password = tx("Ít nhất 8 ký tự, có cả chữ và số.");
    }
    if (mode === "register" && confirm !== password) next.confirm = tx("Mật khẩu nhập lại chưa khớp.");
    return next;
  }

  function fail(message?: string) {
    if (message) setFormError(message);
    setShake((value) => value + 1);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || success || busy.current) return;
    setFormError("");
    setNotice("");

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      fail();
      return;
    }

    const client = getAuthClient();
    if (!client) {
      fail(tx("Chưa cấu hình đăng nhập (thiếu biến Supabase trong frontend/.env.local)."));
      return;
    }

    setSubmitting(true);
    holdAuthRedirect(mode === "login" || mode === "verify");
    try {
      const cleanEmail = email.trim().toLowerCase();

      if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          // Đăng ký rồi mà chưa nhập mã: gửi mã mới và chuyển sang bước nhập mã
          if (error.message.toLowerCase().includes("email not confirmed")) {
            holdAuthRedirect(false);
            setSubmitting(false);
            await client.auth.resend({ type: "signup", email: cleanEmail }).catch(() => undefined);
            setEmail(cleanEmail);
            setCode("");
            setResendIn(60);
            await flipTo("verify");
            setNotice(tx("Gmail này chưa được xác nhận. StudyPilot vừa gửi mã mới cho bạn."));
            return;
          }
          throw error;
        }
        finishLogin();
      } else if (mode === "register") {
        const { data, error } = await client.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: name.trim().replace(/\s+/g, " ") },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) throw error;
        // Supabase trả về user không có identities khi email đã tồn tại
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error("User already registered");
        }
        setEmail(cleanEmail);
        setSubmitting(false);
        if (data.session) {
          // Supabase đang tắt xác nhận email: đăng ký xong quay về trang đăng nhập luôn
          await client.auth.signOut();
          holdAuthRedirect(false);
          setSuccess(true);
          await closeAndOpenToLogin();
        } else {
          // Supabase đã gửi mã 6 số tới Gmail: chuyển sang bước nhập mã ngay trong trang
          holdAuthRedirect(false);
          setCode("");
          setResendIn(60);
          setPassword("");
          setConfirm("");
          setErrors({});
          setShake(0);
          setFadeIn(true);
          setMode("verify");
          setUrl("verify");
          focusLater();
        }
      } else if (mode === "verify") {
        const { error } = await client.auth.verifyOtp({ email: cleanEmail, token: code, type: "signup" });
        if (error) throw error;
        // Mã đúng = Gmail có thật. Đăng xuất để người dùng đăng nhập ở trang đăng nhập như thường.
        await client.auth.signOut();
        holdAuthRedirect(false);
        setSuccess(true);
        await closeAndOpenToLogin();
      } else {
        const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSubmitting(false);
        setNotice(tx("Nếu {0} đã đăng ký, bạn sẽ nhận được email có link đặt lại mật khẩu.", [cleanEmail]));
      }
    } catch (error) {
      holdAuthRedirect(false);
      setSubmitting(false);
      fail(authErrorMessage(error));
    }
  }

  /* Gửi lại mã 6 số */
  async function resendCode() {
    if (resendIn > 0) return;
    const client = getAuthClient();
    if (!client) return;
    setFormError("");
    setResendIn(60);
    const { error } = await client.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
    if (error) {
      setResendIn(0);
      fail(authErrorMessage(error));
    } else {
      setNotice(tx("Đã gửi mã mới. Mã cũ sẽ không dùng được nữa."));
    }
  }

  /* Đăng nhập / đăng ký bằng Google: chuyển sang trang của Google rồi quay về /login?oauth=1 */
  async function signInWithGoogle() {
    if (googleBusy || busy.current) return;
    const client = getAuthClient();
    if (!client) {
      fail(tx("Chưa cấu hình đăng nhập (thiếu biến Supabase trong frontend/.env.local)."));
      return;
    }
    setFormError("");
    setGoogleBusy(true);
    const back = new URL("/login", window.location.origin);
    back.searchParams.set("oauth", "1");
    const next = searchParams.get("next");
    if (next) back.searchParams.set("next", next);
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: back.toString(), queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setGoogleBusy(false);
      fail(authErrorMessage(error));
    }
  }

  /* Đăng nhập xong: sách úp lại → thu nhỏ → màn hình chào (logo, lời chào) → vào trang học */
  async function finishLogin() {
    busy.current = true;
    setSubmitting(false);
    setSuccess(true);
    const next = searchParams.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    if (wide && !prefersReducedMotion()) {
      await wait(450);
      setMotion("closing");
      setShut(true);
      await wait(CLOSE_MS + 20);
      // úp xong: nhún nhẹ rồi để sách nằm yên khoảng 1 giây trước khi hiện lời chào
      setThud(true);
      await wait(140);
      setThud(false);
      await wait(1000);
      setLeaving(true);
      await wait(320);
    } else {
      await wait(400);
    }
    startLoginSplash();
    router.replace(target);
  }

  const formProps: FormPageProps = {
    mode,
    name,
    email,
    password,
    confirm,
    setName,
    setEmail,
    setPassword,
    setConfirm,
    errors,
    formError,
    notice,
    submitting,
    success,
    shake,
    fadeIn,
    firstFieldRef,
    onSubmit: handleSubmit,
    onSwitch: () => flipTo(mode === "login" ? "register" : "login"),
    onForgot: () => flipTo("forgot"),
    onGoogle: signInWithGoogle,
    googleBusy,
    code,
    setCode,
    resendIn,
    onResend: resendCode,
    onEditEmail: () => flipTo("register"),
  };

  /* Vừa đăng nhập Google xong: chờ một chút rồi vào màn hình chào */
  if (oauthReturning) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[15px] font-semibold text-[var(--sp-muted)]">
        <Sparkle size={22} className="sp-twinkle mr-2 text-[var(--sp-pink)]" />

        {tx("Đang đăng nhập bằng Google...")}
      </div>
    );
  }

  /* Điện thoại / màn hình hẹp: chỉ một trang form */
  if (!wide) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-4 sm:px-6">
        <div className="w-full max-w-[540px] overflow-hidden rounded-[32px] border-2 border-[var(--sp-purple-deep)] shadow-[6px_6px_0_var(--sp-pink-line)]">
          <FormPage {...formProps} />
        </div>
      </div>
    );
  }

  const sideMotion = motion === "closing" ? "is-closing" : "is-opening";

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden px-6 py-6">
      <div
        className="sp-book-stage transition-[transform,opacity] duration-300 ease-in"
        style={leaving ? { transform: "scale(0.35)", opacity: 0 } : undefined}
      >
        <div className={`sp-book ${shut ? "is-shut" : ""} ${thud ? "is-thud" : ""}`}>
          <BookSide side="left" className={sideMotion}>
            <div className="sp-book-page is-left">
              {/* Giữ sẵn cả 2 trang trái, chỉ ẩn/hiện -> ảnh không phải tải lại khi đổi trang */}
              {(["login", "register"] as const).map((art) => (
                <div key={art} aria-hidden={art !== leftArt || undefined} className={`absolute inset-0 ${art === leftArt ? "" : "invisible"}`}>
                  <ArtPage mode={art} />
                </div>
              ))}
            </div>
          </BookSide>

          <BookSide side="right" className={sideMotion}>
            <div className="sp-book-page is-right">
              <FormPage {...formProps} pageNumber={mode === "register" || mode === "verify" ? 4 : 2} />
            </div>

            {/* Tờ giấy đang lật: mặt trước là form đăng nhập, mặt sau là trang trái của đăng ký */}
            {(
              <div
                aria-hidden="true"
                className="sp-book-leaf"
                style={{
                  visibility: leaf.visible ? "visible" : "hidden",
                  transform: `translateZ(2px) rotateY(${leaf.angle}deg)`,
                  transition: leaf.animate ? `transform ${FLIP_MS}ms cubic-bezier(.45,.05,.3,1)` : "none",
                }}
              >
                <div className="sp-book-face is-front">
                  <FormPage
                    mode="login"
                    ghost
                    idPrefix="ghost"
                    name=""
                    email={leaf.ghostEmail}
                    password={leaf.ghostPassword}
                    confirm=""
                    pageNumber={2}
                  />
                </div>
                <div className="sp-book-face is-back">
                  <ArtPage mode="register" />
                </div>
              </div>
            )}
          </BookSide>
        </div>
      </div>
    </div>
  );
}
