"use client";

import { setBgMotion, useBgMotion } from "@/lib/bg-motion";
import { applyLanguage, currentLang, tx } from "@/lib/i18n";
import { useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import AvatarCropper from "@/components/avatar-cropper";
import UserAvatar from "@/components/user-avatar";
import {
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconIdCard,
  IconImage,
  IconLock,
  IconMail,
  IconMonitor,
  IconTrash,
  IconUser,
  Sparkle,
} from "@/components/icons";
import { authErrorMessage, getAuthClient } from "@/lib/auth";
import { useCurrentUserAvatar, useCurrentUserName } from "@/lib/current-user";
import { applyTheme, currentTheme, type Theme } from "@/lib/theme";

/*
 * Trang Cài đặt: tài khoản (tên, ảnh đại diện, mật khẩu), giao diện, nhắc nhở học tập, ngôn ngữ.
 * Mọi tuỳ chọn lưu vào user_metadata của Supabase với tiền tố sp_ (Google không ghi đè khi đăng nhập lại).
 */

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_MB = 5;
const PRESET_AVATARS = [
  { src: "/avatars/girl.png", label: tx("Bạn nữ đeo tai nghe") },
  { src: "/avatars/boy.png", label: tx("Bạn nam tóc đen") },
];
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// Lưu giờ nhắc + bật/tắt sang backend gửi thông báo (cùng dữ liệu với nút chuông)
async function syncReminder(reminder: { enabled: boolean; hour: number }, email: string) {
  try {
    await fetch(`${API_URL}/api/notifications/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || undefined, enabled: reminder.enabled, daily_hour: reminder.hour }),
    });
  } catch {
    /* backend chưa chạy: vẫn giữ lựa chọn trong tài khoản */
  }
}

const REMINDER_HOURS = Array.from({ length: 17 }, (_, index) => index + 5); // 05:00 → 21:00

type Reminder = { enabled: boolean; hour: number };
type Toast = { tone: "ok" | "error"; text: string } | null;

function storageErrorMessage(error: unknown) {
  const text = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  if (text.includes("bucket not found"))
    return tx("Chưa có kho ảnh “avatars” trên Supabase. Chạy lệnh SQL tạo kho ảnh rồi thử lại.");
  if (text.includes("row-level security") || text.includes("unauthorized") || text.includes("403"))
    return tx("Supabase chưa cho phép tải ảnh lên. Kiểm tra lại lệnh SQL phân quyền kho ảnh.");
  if (text.includes("payload too large") || text.includes("exceeded"))
    return tx("Ảnh quá lớn, chọn ảnh dưới {0}MB nhé.", [MAX_AVATAR_MB]);
  return authErrorMessage(error);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const savedName = useCurrentUserName();
  const savedAvatar = useCurrentUserAvatar();
  const meta = user?.user_metadata || {};
  const savedReminder: Reminder = {
    enabled: meta.sp_reminder?.enabled ?? true,
    hour: Number(meta.sp_reminder?.hour ?? 19),
  };
  const savedLanguage = String(meta.sp_language || currentLang());
  const provider = String(user?.app_metadata?.provider || "email");

  const [name, setName] = useState(savedName);
  const [reminder, setReminder] = useState<Reminder>(savedReminder);
  const [language, setLanguage] = useState(savedLanguage);
  const bgMotion = useBgMotion();
  const savedTheme: Theme = meta.sp_theme === "dark" ? "dark" : "light";
  const [theme, setThemeState] = useState<Theme>(() => (typeof document === "undefined" ? savedTheme : currentTheme()));
  // Xem trước ngay khi gạt công tắc; bấm Lưu để giữ cho các lần đăng nhập sau
  const setTheme = (next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  };
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | null>(null);

  const dirty =
    name.trim() !== savedName ||
    reminder.enabled !== savedReminder.enabled ||
    reminder.hour !== savedReminder.hour ||
    theme !== savedTheme ||
    language !== savedLanguage;

  function showToast(next: Toast) {
    setToast(next);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  async function saveAll() {
    const client = getAuthClient();
    if (!client || saving) return;
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      showToast({ tone: "error", text: tx("Tên cần ít nhất 2 ký tự.") });
      return;
    }
    setSaving(true);
    const { error } = await client.auth.updateUser({
      data: { sp_name: cleanName, sp_reminder: reminder, sp_language: language, sp_theme: theme },
    });
    // Đồng bộ nhắc nhở với bảng thông báo (nút chuông) để cả hai luôn khớp nhau
    if (!error) await syncReminder(reminder, user?.email || "");
    setSaving(false);
    if (error) showToast({ tone: "error", text: authErrorMessage(error) });
    else {
      setName(cleanName);
      showToast({ tone: "ok", text: tx("Đã lưu thay đổi.") });
      // Đổi ngôn ngữ: tải lại trang để cả web chuyển sang ngôn ngữ mới
      if (language !== currentLang()) {
        window.setTimeout(() => applyLanguage(language === "en" ? "en" : "vi"), 600);
      }
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {/* Đầu trang */}
      <section>
        <p className="text-sm font-medium text-[var(--sp-muted)]">{tx("KHÔNG GIAN HỌC TẬP / CÀI ĐẶT")}</p>
        <h1 className="mt-2 flex items-end gap-3 text-[40px] leading-tight sm:text-[50px]">
          <span>

            {currentLang() === "en" ? (
              <span className="sp-squiggle">Settings</span>
            ) : (
              <>
                Cài <span className="sp-squiggle">đặt</span>
              </>
            )}
          </span>
          <Sparkle size={24} className="sp-twinkle mb-3 text-[var(--sp-yellow)]" />
        </h1>
        <p className="mt-1 text-[15px] text-[var(--sp-muted)]">

          {tx("Quản lý tài khoản, giao diện và các tuỳ chọn học tập của bạn.")}
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Tài khoản */}
        <SettingsCard icon={<IconUser size={22} />} title={tx("Tài khoản")}>
          <Row icon={<IconIdCard size={20} />} label={tx("Tên")}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              aria-label={tx("Tên hiển thị")}
              className="h-12 w-full rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 text-[15px] font-semibold text-[var(--sp-ink)] outline-none transition focus:border-[var(--sp-peri)]"
            />
          </Row>

          <Row icon={<IconMail size={20} />} label="Email">
            <div className="flex h-12 w-full items-center gap-3 rounded-2xl border-2 border-[var(--sp-line)] bg-[var(--sp-surface-2)] px-4">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--sp-text-2)]">{user?.email}</span>
              {provider === "google" ? (
                <span className="sp-chip shrink-0 bg-white text-[12px]">Google</span>
              ) : (
                <span title={tx("Email dùng để đăng nhập nên không đổi được")} className="text-[var(--sp-soft)]">
                  <IconLock size={16} />
                </span>
              )}
            </div>
          </Row>

          <AvatarRow savedAvatar={savedAvatar} userId={user?.id || ""} onToast={showToast} />

          <PasswordRow provider={provider} onToast={showToast} />
        </SettingsCard>

        <div className="space-y-6">
          {/* Giao diện */}
          <SettingsCard icon={<IconMonitor size={22} />} title={tx("Giao diện")}>
            <ToggleRow
              title={tx("Chế độ tối")}
              description={tx("Chuyển sang nền tối, đỡ mỏi mắt khi học ban đêm.")}
              checked={theme === "dark"}
              onChange={(dark) => setTheme(dark ? "dark" : "light")}
            />
            <div className="my-5 border-t border-[var(--sp-line)]" />
            <ToggleRow
              title={tx("Hiệu ứng nền")}
              description={tx("Đồ dùng học tập trôi nhẹ trên nền và đường bay tới ngày thi ở chân màn hình.")}
              checked={bgMotion}
              onChange={setBgMotion}
            />
          </SettingsCard>

          {/* Nhắc nhở học tập */}
          <SettingsCard icon={<IconBell size={22} />} title={tx("Nhắc nhở học tập")}>
            <ToggleRow
              title={tx("Bật nhắc nhở")}
              description={tx("Nhắc bạn học bài và ôn lại phần còn yếu đúng lịch mỗi ngày.")}
              checked={reminder.enabled}
              onChange={(enabled) => setReminder((current) => ({ ...current, enabled }))}
            />
            <div className="flex flex-col gap-3 border-t border-[var(--sp-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className={`text-[16px] font-bold ${reminder.enabled ? "text-[var(--sp-ink)]" : "text-[var(--sp-soft)]"}`}>

                {tx("Thời gian nhắc nhở")}
              </p>
              <SelectBox
                icon={<IconClock size={18} />}
                value={String(reminder.hour)}
                disabled={!reminder.enabled}
                ariaLabel={tx("Giờ nhận mail nhắc học")}
                onChange={(value) => setReminder((current) => ({ ...current, hour: Number(value) }))}
                options={REMINDER_HOURS.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))}
              />
            </div>
          </SettingsCard>

          {/* Ngôn ngữ */}
          <SettingsCard icon={<IconGlobe size={22} />} title={tx("Ngôn ngữ")}>
            <SelectBox
              value={language}
              ariaLabel={tx("Ngôn ngữ hiển thị")}
              onChange={setLanguage}
              wide
              options={[
                // Tên ngôn ngữ luôn viết bằng chính ngôn ngữ đó
                { value: "vi", label: "Tiếng Việt" },
                { value: "en", label: "English" },
              ]}
            />
          </SettingsCard>
        </div>
      </div>

      {/* Lưu thay đổi */}
      <div className="flex justify-end border-t border-[var(--sp-line)] pt-6">
        <button
          type="button"
          onClick={() => void saveAll()}
          disabled={!dirty || saving}
          className="flex h-13 items-center gap-2.5 rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] px-8 py-3.5 text-[17px] font-bold text-white shadow-[5px_5px_0_var(--sp-pink)] transition hover:bg-[var(--sp-peri-dark)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[3px_3px_0_var(--sp-pink)] disabled:cursor-not-allowed disabled:border-[var(--sp-lav-line)] disabled:bg-[var(--sp-lav-line)] disabled:text-white/90 disabled:shadow-none"
        >
          {saving ? <Sparkle size={18} className="sp-twinkle" /> : <IconCheck size={20} />}
          {saving ? tx("Đang lưu...") : dirty ? tx("Lưu thay đổi") : tx("Đã lưu")}
        </button>
      </div>

      {toast && (
        <div
          role="status"
          className={`sp-fade-in fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border-2 px-5 py-3 text-[14.5px] font-bold shadow-[4px_4px_0_var(--sp-purple-deep)] ${
            toast.tone === "ok"
              ? "border-[var(--sp-purple-deep)] bg-emerald-50 text-emerald-700"
              : "border-[var(--sp-purple-deep)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
          }`}
        >
          {toast.tone === "ok" ? <IconCheck size={18} /> : <Sparkle size={14} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ---------- Khối giao diện dùng chung ---------- */

function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[26px] border-2 border-[var(--sp-purple-deep)] bg-white p-5 shadow-[5px_5px_0_var(--sp-pink-line)] sm:p-7">
      <div className="mb-5 flex items-center gap-4 border-b border-[var(--sp-line)] pb-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-pink)] text-white">
          {icon}
        </span>
        <h2 className="text-[24px] font-extrabold text-[var(--sp-purple)]">{title}</h2>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 border-b border-[var(--sp-line)] pb-5 last:border-b-0 last:pb-0 sm:grid-cols-[160px_minmax(0,1fr)]">
      <p className="flex items-center gap-3 text-[16px] font-bold text-[var(--sp-ink)] sm:min-h-12">
        <span className="text-[var(--sp-purple)]">{icon}</span>
        {label}
      </p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-9 w-16 shrink-0 rounded-full border-2 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-[var(--sp-purple-deep)] bg-[var(--sp-peri)]" : "border-[var(--sp-line)] bg-[var(--sp-surface-2)]"
      }`}
    >
      <span
        className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(36,18,58,0.25)] transition-all ${
          checked ? "left-[calc(100%-1.75rem)]" : "left-1"
        }`}
      />
    </button>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  badge,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  badge?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[16px] font-bold text-[var(--sp-ink)]">
          {title}
          {badge && <span className="sp-chip bg-[var(--sp-amber-bg)] text-[11.5px] text-[var(--sp-amber-dark)]">{badge}</span>}
        </p>
        <p className="mt-1 text-[14px] leading-5 text-[var(--sp-muted)]">{description}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function SelectBox({
  icon,
  value,
  options,
  onChange,
  disabled,
  wide,
  ariaLabel,
}: {
  icon?: ReactNode;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  wide?: boolean;
  ariaLabel: string;
}) {
  return (
    <label className={`relative flex h-12 items-center rounded-2xl border-2 border-[var(--sp-line)] bg-white transition focus-within:border-[var(--sp-peri)] ${wide ? "w-full" : "w-full sm:w-[260px]"} ${disabled ? "opacity-50" : ""}`}>
      {icon && <span className="pointer-events-none absolute left-4 text-[var(--sp-text-2)]">{icon}</span>}
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className={`h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pr-11 text-[16px] font-semibold text-[var(--sp-ink)] outline-none disabled:cursor-not-allowed ${icon ? "pl-11" : "pl-4"}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={18} className="pointer-events-none absolute right-4 text-[var(--sp-text-2)]" />
    </label>
  );
}

/* ---------- Ảnh đại diện ---------- */

function AvatarRow({
  savedAvatar,
  userId,
  onToast,
}: {
  savedAvatar: string | null;
  userId: string;
  onToast: (toast: Toast) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "preset" | "remove">("");
  const [pickerOpen, setPickerOpen] = useState(false);

  async function removeOldFiles(keepPath?: string) {
    const client = getAuthClient();
    if (!client || !userId) return;
    const { data } = await client.storage.from(AVATAR_BUCKET).list(userId);
    const stale = (data || []).map((file) => `${userId}/${file.name}`).filter((path) => path !== keepPath);
    if (stale.length) await client.storage.from(AVATAR_BUCKET).remove(stale);
  }

  async function saveAvatar(url: string) {
    const client = getAuthClient();
    if (!client) throw new Error(tx("Chưa kết nối Supabase."));
    const { error } = await client.auth.updateUser({ data: { sp_avatar: url } });
    if (error) throw error;
  }

  /* Chọn ảnh xong: mở khung căn chỉnh, chưa lưu gì cả */
  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onToast({ tone: "error", text: tx("Hãy chọn một file ảnh (PNG, JPG, WEBP…).") });
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      onToast({ tone: "error", text: tx("Ảnh quá lớn, chọn ảnh dưới {0}MB nhé.", [MAX_AVATAR_MB]) });
      return;
    }
    setCropFile(file);
  }

  /* Bấm "Xác nhận" trong khung căn chỉnh: tải ảnh đã cắt lên rồi mới đổi ảnh đại diện */
  async function uploadCropped(blob: Blob) {
    const client = getAuthClient();
    if (!client || !userId) return;
    setBusy("upload");
    try {
      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${userId}/avatar-${Date.now()}.${extension}`;
      const { error } = await client.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      await saveAvatar(data.publicUrl);
      await removeOldFiles(path).catch(() => undefined);
      onToast({ tone: "ok", text: tx("Đã đổi ảnh đại diện.") });
      setCropFile(null);
      setPickerOpen(false);
    } catch (error) {
      onToast({ tone: "error", text: storageErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function pickPreset(src: string) {
    setBusy("preset");
    try {
      await saveAvatar(src);
      await removeOldFiles().catch(() => undefined);
      onToast({ tone: "ok", text: tx("Đã đổi ảnh đại diện.") });
      setPickerOpen(false);
    } catch (error) {
      onToast({ tone: "error", text: authErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function removeAvatar() {
    setBusy("remove");
    try {
      // Chuỗi rỗng = đã xoá ảnh (kể cả ảnh Google), sẽ hiện chữ viết tắt của tên
      await saveAvatar("");
      await removeOldFiles().catch(() => undefined);
      onToast({ tone: "ok", text: tx("Đã xoá ảnh đại diện.") });
    } catch (error) {
      onToast({ tone: "error", text: authErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  return (
    <Row icon={<IconImage size={20} />} label={tx("Ảnh đại diện")}>
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="relative">
          <UserAvatar size={96} rounded="rounded-full" src={savedAvatar} className="border-2 border-[var(--sp-lav-line)]" />
          {busy === "upload" && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
              <Sparkle size={22} className="sp-twinkle text-[var(--sp-pink)]" />
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={Boolean(busy)}
            aria-expanded={pickerOpen}
            className="flex h-12 items-center gap-2 rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 text-[15px] font-bold text-[var(--sp-ink)] transition hover:border-[var(--sp-lav-line)] hover:bg-[var(--sp-surface-2)] disabled:opacity-60"
          >
            <IconImage size={18} />

            {tx("Thay đổi ảnh")}
          </button>
          {savedAvatar && (
            <button
              type="button"
              onClick={() => void removeAvatar()}
              disabled={Boolean(busy)}
              title={tx("Xoá ảnh đại diện")}
              aria-label={tx("Xoá ảnh đại diện")}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)] transition hover:border-[var(--sp-pink)] disabled:opacity-60"
            >
              <IconTrash size={19} />
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="sp-fade-in mt-4 rounded-2xl border-2 border-dashed border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] p-4">
          <p className="text-[14px] font-bold text-[var(--sp-text-2)]">{tx("Chọn ảnh có sẵn")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {PRESET_AVATARS.map((preset) => (
              <button
                key={preset.src}
                type="button"
                onClick={() => void pickPreset(preset.src)}
                disabled={Boolean(busy)}
                title={preset.label}
                aria-label={tx("Dùng ảnh: {0}", [preset.label])}
                className={`rounded-full border-[3px] transition hover:scale-105 disabled:opacity-60 ${
                  savedAvatar === preset.src ? "border-[var(--sp-peri)]" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preset.src} alt="" className="h-16 w-16 rounded-full" />
              </button>
            ))}

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={Boolean(busy)}
              className="flex h-16 items-center gap-2 rounded-2xl border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-peri)] px-4 text-[14.5px] font-bold text-white shadow-[3px_3px_0_var(--sp-pink)] transition hover:bg-[var(--sp-peri-dark)] disabled:opacity-60"
            >
              <IconImage size={18} />

              {tx("Tải ảnh từ máy")}
            </button>
          </div>
          <p className="mt-3 text-[12.5px] text-[var(--sp-muted)]">
            {tx("Ảnh PNG, JPG hoặc WEBP dưới {0}MB. Bạn có thể căn chỉnh, cắt ảnh trước khi lưu.", [MAX_AVATAR_MB])}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </div>
      )}

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          busy={busy === "upload"}
          onCancel={() => setCropFile(null)}
          onPickAnother={() => fileRef.current?.click()}
          onConfirm={(blob) => void uploadCropped(blob)}
        />
      )}
    </Row>
  );
}

/* ---------- Đổi mật khẩu ---------- */

function PasswordRow({ provider, onToast }: { provider: string; onToast: (toast: Toast) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError(tx("Mật khẩu cần ít nhất 8 ký tự, có cả chữ và số."));
      return;
    }
    if (confirm !== password) {
      setError(tx("Mật khẩu nhập lại chưa khớp."));
      return;
    }
    const client = getAuthClient();
    if (!client) return;
    setBusy(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    setPassword("");
    setConfirm("");
    setOpen(false);
    onToast({ tone: "ok", text: tx("Đã đổi mật khẩu.") });
  }

  const inputClass =
    "h-12 w-full rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 pr-12 text-[15px] text-[var(--sp-ink)] outline-none transition focus:border-[var(--sp-peri)]";

  return (
    <Row icon={<IconLock size={20} />} label={tx("Đổi mật khẩu")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex h-12 w-full items-center justify-between rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-5 text-[15.5px] font-bold text-[var(--sp-pink-dark)] transition hover:border-[var(--sp-pink)]"
      >
        {provider === "google" ? tx("Tạo mật khẩu để đăng nhập bằng email") : tx("Đổi mật khẩu")}
        <IconChevronRight size={18} className={`transition ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="sp-fade-in mt-3 space-y-3">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={tx("Mật khẩu mới (ít nhất 8 ký tự, có chữ và số)")}
              autoComplete="new-password"
              aria-label={tx("Mật khẩu mới")}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? tx("Ẩn mật khẩu") : tx("Hiện mật khẩu")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
            >
              {show ? <IconEyeOff size={19} /> : <IconEye size={19} />}
            </button>
          </div>
          <input
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={tx("Nhập lại mật khẩu mới")}
            autoComplete="new-password"
            aria-label={tx("Nhập lại mật khẩu mới")}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--sp-pink-dark)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="sp-btn sp-btn-secondary h-11 px-5 text-[15px]">

              {tx("Huỷ")}
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy} className="sp-btn sp-btn-primary h-11 px-5 text-[15px]">
              {busy ? tx("Đang cập nhật...") : tx("Cập nhật mật khẩu")}
            </button>
          </div>
        </div>
      )}
    </Row>
  );
}
