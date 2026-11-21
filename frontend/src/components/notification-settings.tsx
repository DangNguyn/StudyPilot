"use client";

import { tx } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { IconAlert, IconBell, IconCheck, IconX, Sparkle } from "@/components/icons";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Settings = {
  email: string | null;
  verified: boolean;
  enabled: boolean;
  daily_enabled: boolean;
  daily_hour: number;
  weak_enabled: boolean;
  disabled_reason: string | null;
  pending_email: string | null;
  gmail_configured: boolean;
};

type Notice = { tone: "ok" | "error"; text: string } | null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api/notifications${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || tx("Có lỗi xảy ra, vui lòng thử lại."));
  return data as T;
}

/* Nút chuông + bảng cài đặt thông báo học tập qua Gmail */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const reload = () =>
    request<{ data: Settings }>("/settings")
      .then((result) => setSettings(result.data))
      .catch(() => setSettings(null));

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={tx("Thông báo qua Gmail")}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) reload();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--sp-line)] bg-white text-[var(--sp-text-2)] transition hover:text-[var(--sp-peri-dark)]"
      >
        <IconBell size={18} />
        {settings?.enabled && (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
        )}
        {settings?.disabled_reason && (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--sp-pink)]" />
        )}
      </button>

      {open && (
        <div className="sp-task-expand fixed inset-x-3 top-20 z-50 max-h-[80vh] overflow-y-auto rounded-[22px] border-2 border-[var(--sp-purple)] bg-white p-5 shadow-[6px_6px_0_var(--sp-lav-line)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]">
          <NotificationPanel settings={settings} onChange={setSettings} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function NotificationPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings | null;
  onChange: (settings: Settings) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : tx("Có lỗi xảy ra.") });
    } finally {
      setBusy("");
    }
  };

  const update = (changes: Partial<Settings>) =>
    run("save", async () => {
      const result = await request<{ data: Settings }>("/settings", {
        method: "PUT",
        body: JSON.stringify(changes),
      });
      onChange(result.data);
    });

  const sendCode = (address: string) =>
    run("code", async () => {
      const result = await request<{ message: string }>("/verify/start", {
        method: "POST",
        body: JSON.stringify({ email: address }),
      });
      setNotice({ tone: "ok", text: result.message });
      const refreshed = await request<{ data: Settings }>("/settings");
      onChange(refreshed.data);
    });

  const confirmCode = () =>
    run("confirm", async () => {
      const result = await request<{ message: string; data: Settings }>("/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      onChange(result.data);
      setCode("");
      setChangingEmail(false);
      setNotice({ tone: "ok", text: result.message });
    });

  const sendTest = (kind: "schedule" | "weak") =>
    run(`test-${kind}`, async () => {
      const result = await request<{ message: string }>("/test", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setNotice({ tone: "ok", text: tx("{0} Kiểm tra cả mục Spam nếu chưa thấy.", [result.message]) });
    });

  if (!settings) {
    return (
      <p className="text-sm text-[var(--sp-muted)]">

        {tx("Chưa kết nối được backend. Hãy chạy backend rồi mở lại.")}
      </p>
    );
  }

  const showEmailForm = !settings.verified || changingEmail;
  const waitingCode = Boolean(settings.pending_email) && showEmailForm;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="sp-accent text-[15px] text-[var(--sp-pink)]">{tx("Nhắc lịch học")}</p>
          <h2 className="text-[19px] text-[var(--sp-ink)]">{tx("Thông báo qua Gmail")}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tx("Đóng")}
          className="rounded-lg p-1.5 text-[var(--sp-muted)] hover:bg-[var(--sp-surface-2)]"
        >
          <IconX size={16} />
        </button>
      </div>

      {!settings.gmail_configured && (
        <p className="mt-3 flex gap-2 rounded-xl bg-[var(--sp-amber-bg)] px-3 py-2.5 text-[13px] text-[var(--sp-amber-dark)]">
          <IconAlert size={15} className="mt-0.5 shrink-0" />

          {tx("Backend chưa có GMAIL_ADDRESS và GMAIL_APP_PASSWORD trong file .env nên chưa gửi được thư.")}
        </p>
      )}

      {settings.disabled_reason && (
        <p className="mt-3 flex gap-2 rounded-xl bg-[var(--sp-pink-bg)] px-3 py-2.5 text-[13px] text-[var(--sp-pink-dark)]">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          {settings.disabled_reason}
        </p>
      )}

      {/* Bước 1–2: nhập email và mã xác minh */}
      {showEmailForm ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[13px] font-semibold text-[var(--sp-text-2)]">{tx("Email nhận thông báo")}</span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="email"
                value={email || (waitingCode ? settings.pending_email || "" : "")}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ten.ban@gmail.com"
                className="min-w-0 flex-1 rounded-xl border-2 border-[var(--sp-line)] px-3 py-2 text-sm outline-none focus:border-[var(--sp-peri)]"
              />
              <button
                type="button"
                disabled={busy !== "" || !(email || settings.pending_email)}
                onClick={() => sendCode(email || settings.pending_email || "")}
                className="sp-btn sp-btn-primary shrink-0 px-3 py-2 text-[13px] disabled:opacity-50"
              >
                {busy === "code" ? tx("Đang gửi...") : waitingCode ? tx("Gửi lại mã") : tx("Gửi mã")}
              </button>
            </div>
          </label>

          {waitingCode && (
            <label className="block">
              <span className="text-[13px] font-semibold text-[var(--sp-text-2)]">
                {tx("Mã 6 số đã gửi tới {0}", [settings.pending_email])}
              </span>
              <div className="mt-1.5 flex gap-2">
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="min-w-0 flex-1 rounded-xl border-2 border-[var(--sp-line)] px-3 py-2 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-[var(--sp-peri)]"
                />
                <button
                  type="button"
                  disabled={busy !== "" || code.length !== 6}
                  onClick={confirmCode}
                  className="sp-btn sp-btn-primary shrink-0 px-3 py-2 text-[13px] disabled:opacity-50"
                >
                  {busy === "confirm" ? tx("Đang kiểm tra...") : tx("Xác nhận")}
                </button>
              </div>
            </label>
          )}

          {settings.verified && changingEmail && (
            <button
              type="button"
              onClick={() => setChangingEmail(false)}
              className="text-[13px] font-bold text-[var(--sp-muted)] hover:underline"
            >

              {tx("Huỷ đổi email")}
            </button>
          )}
          <p className="text-[12px] leading-5 text-[var(--sp-muted)]">

            {tx("Cần xác minh để chắc chắn email có thật, tránh gửi thư vào địa chỉ không tồn tại.")}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
          <IconCheck size={16} className="shrink-0 text-emerald-700" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-emerald-900">{settings.email}</p>
          <button
            type="button"
            onClick={() => {
              setChangingEmail(true);
              setEmail("");
            }}
            className="shrink-0 text-[12px] font-bold text-[var(--sp-peri-dark)] hover:underline"
          >

            {tx("Đổi email")}
          </button>
        </div>
      )}

      {/* Bước 3: chọn loại thông báo */}
      {settings.verified && !changingEmail && (
        <div className="mt-4 space-y-2.5">
          <Toggle
            label={tx("Bật thông báo")}
            hint={tx("Tắt để tạm dừng mọi thư")}
            checked={settings.enabled}
            onChange={(value) => update({ enabled: value })}
          />
          <div className={settings.enabled ? "" : "pointer-events-none opacity-50"}>
            <Toggle
              label={tx("Thông báo theo lịch học")}
              hint={tx("Bài hôm nay, bài còn nợ, ngày ôn lại đã chọn, đếm ngược ngày thi")}
              checked={settings.daily_enabled}
              onChange={(value) => update({ daily_enabled: value })}
            >
              <select
                value={settings.daily_hour}
                onChange={(event) => update({ daily_hour: Number(event.target.value) })}
                className="rounded-lg border-2 border-[var(--sp-line)] bg-white px-2 py-1 text-[13px] font-semibold"
                aria-label={tx("Giờ gửi thông báo")}
                title={tx("Cả 2 loại thông báo được gửi vào giờ này")}
              >
                {Array.from({ length: 17 }, (_, index) => index + 5).map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}:00
                  </option>
                ))}
              </select>
            </Toggle>
            <div className="mt-2.5">
              <Toggle
                label={tx("Ôn tập phần còn yếu")}
                hint={tx("Còn 7, 5, 3, 2, 1 ngày tới ngày thi mà vẫn có bài dưới 80% thì nhắc vào ôn lại")}
                checked={settings.weak_enabled}
                onChange={(value) => update({ weak_enabled: value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => sendTest("schedule")}
              className="sp-btn sp-btn-secondary px-3 py-1.5 text-[13px] disabled:opacity-50"
            >
              {busy === "test-schedule" ? tx("Đang gửi...") : tx("Gửi thử: lịch học")}
            </button>
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => sendTest("weak")}
              className="sp-btn sp-btn-secondary px-3 py-1.5 text-[13px] disabled:opacity-50"
            >
              {busy === "test-weak" ? tx("Đang gửi...") : tx("Gửi thử: ôn phần còn yếu")}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`mt-3 rounded-xl px-3 py-2 text-[13px] ${
            notice.tone === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
          }`}
        >
          {notice.text}
        </p>
      )}

      <p className="mt-4 flex gap-1.5 border-t border-[var(--sp-line)] pt-3 text-[11.5px] leading-5 text-[var(--sp-muted)]">
        <Sparkle size={12} className="mt-1 shrink-0 text-[var(--sp-yellow)]" />

        {tx("Thư được gửi tự động khi backend đang chạy. Nếu không thấy thư, hãy xem mục Spam.")}
      </p>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-[var(--sp-line)] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[var(--sp-ink)]">{label}</p>
        <p className="text-[12px] leading-4 text-[var(--sp-muted)]">{hint}</p>
      </div>
      {children}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-[var(--sp-line)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
