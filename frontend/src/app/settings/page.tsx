"use client";

import { setBgMotion, useBgMotion } from "@/lib/bg-motion";
import { applyLanguage, currentLang, tx } from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePilotRest } from "@/components/home-pilot";
import { OPEN_PILOT_HOUSE_EVENT } from "@/components/pilot-house";
import { notificationRequest, type NotificationSettings } from "@/components/notification-settings";
import { useAuth } from "@/components/auth-provider";
import AvatarCropper from "@/components/avatar-cropper";
import UserAvatar from "@/components/user-avatar";
import {
  IconBell,
  IconCheck,
  IconChevronDown,
  IconEye,
  IconEyeOff,
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
  const savedLanguage = String(meta.sp_language || currentLang());
  const savedContentLanguage = meta.sp_content_language === "en" ? "en" : "vi";
  const provider = String(user?.app_metadata?.provider || "email");
  // Có mật khẩu: tài khoản đăng ký bằng email, hoặc đã tạo mật khẩu ở trang này
  const hasPassword = Boolean(user?.identities?.some((identity) => identity.provider === "email") || meta.sp_has_password);

  const [name, setName] = useState(savedName);
  const bgMotion = useBgMotion();
  const [pilotRest, setPilotRest] = usePilotRest();
  const [theme, setThemeState] = useState<Theme>(() => (typeof document === "undefined" ? "light" : currentTheme()));
  const [savingName, setSavingName] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(next: Toast) {
    setToast(next);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  // Tuỳ chọn giao diện / ngôn ngữ lưu ngay khi đổi, không cần bấm Lưu
  async function saveMeta(data: Record<string, unknown>) {
    const { error } = (await getAuthClient()?.auth.updateUser({ data })) || {};
    if (error) showToast({ tone: "error", text: authErrorMessage(error) });
    return !error;
  }

  function setTheme(next: Theme) {
    setThemeState(next);
    applyTheme(next);
    void saveMeta({ sp_theme: next });
  }

  async function setLanguage(next: string) {
    if (next === savedLanguage) return;
    if (await saveMeta({ sp_language: next })) {
      showToast({ tone: "ok", text: tx("Đã đổi ngôn ngữ, trang sẽ tải lại.") });
      window.setTimeout(() => applyLanguage(next === "en" ? "en" : "vi"), 600);
    }
  }

  async function saveName() {
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      showToast({ tone: "error", text: tx("Tên cần ít nhất 2 ký tự.") });
      return;
    }
    setSavingName(true);
    const ok = await saveMeta({ sp_name: cleanName });
    setSavingName(false);
    if (ok) {
      setName(cleanName);
      showToast({ tone: "ok", text: tx("Đã lưu thay đổi.") });
    }
  }

  const sections = [
    { id: "account", label: tx("Tài khoản"), icon: <IconUser size={15} /> },
    { id: "security", label: tx("Bảo mật & mật khẩu"), icon: <IconLock size={15} /> },
    { id: "appearance", label: tx("Giao diện & ngôn ngữ"), icon: <IconMonitor size={15} /> },
    { id: "notifications", label: tx("Thông báo"), icon: <IconBell size={15} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      {/* Đầu trang: tiêu đề + thẻ tài khoản */}
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div>
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
            {tx("Quản lý tài khoản, bảo mật, giao diện và thông báo học tập.")}
          </p>
        </div>
        <div className="flex max-w-full items-center gap-3.5 rounded-[20px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] py-2.5 pl-2.5 pr-4 shadow-[4px_4px_0_var(--sp-pink-line)]">
          <UserAvatar size={52} />
          <div className="min-w-0">
            <p className="truncate font-bold text-[var(--sp-ink)]">{savedName}</p>
            <p className="truncate text-[12.5px] text-[var(--sp-muted)]">{user?.email}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {provider === "google" && <StatusChip tone="ok">Google</StatusChip>}
              <StatusChip tone={hasPassword ? "ok" : "warn"}>{hasPassword ? tx("Có mật khẩu") : tx("Chưa có mật khẩu")}</StatusChip>
            </div>
          </div>
        </div>
      </section>

      {/* Nhảy nhanh tới từng mục */}
      <nav className="flex flex-wrap gap-2" aria-label={tx("Các mục cài đặt")}>
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border-2 border-[var(--sp-line)] bg-[var(--sp-surface)] px-3.5 text-[13px] font-bold text-[var(--sp-text-2)] transition hover:border-[var(--sp-purple-deep)]"
          >
            {section.icon}
            {section.label}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {/* Tài khoản */}
          <SettingsCard id="account" icon={<IconUser size={22} />} title={tx("Tài khoản")} subtitle={tx("Thông tin hiển thị trên web")}>
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
                <span title={tx("Email dùng để đăng nhập nên không đổi được")} className="text-[var(--sp-soft)]">
                  <IconLock size={16} />
                </span>
              </div>
            </Row>

            <AvatarRow savedAvatar={savedAvatar} userId={user?.id || ""} onToast={showToast} />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={savingName || name.trim() === savedName}
                className="sp-btn sp-btn-primary h-11 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingName ? tx("Đang lưu...") : name.trim() === savedName ? tx("Đã lưu") : tx("Lưu thay đổi")}
              </button>
            </div>
          </SettingsCard>

          {/* Bảo mật & mật khẩu */}
          <SecurityCard
            email={user?.email || ""}
            provider={provider}
            hasPassword={hasPassword}
            onToast={showToast}
          />
        </div>

        <div className="flex flex-col gap-6">
          {/* Giao diện & ngôn ngữ */}
          <SettingsCard id="appearance" icon={<IconMonitor size={22} />} title={tx("Giao diện & ngôn ngữ")} subtitle={tx("Màu sắc, hiệu ứng, Pilot và ngôn ngữ")}>
            <ToggleRow
              title={tx("Chế độ tối")}
              description={tx("Chuyển sang nền tối, đỡ mỏi mắt khi học ban đêm.")}
              checked={theme === "dark"}
              onChange={(dark) => setTheme(dark ? "dark" : "light")}
            />
            <ToggleRow
              title={tx("Hiệu ứng nền")}
              description={tx("Đồ dùng học tập trôi nhẹ trên nền và đường bay tới ngày thi ở chân màn hình.")}
              checked={bgMotion}
              onChange={setBgMotion}
            />
            <ToggleRow
              title={tx("Pilot bay lượn ở Tổng quan")}
              description={tx("Tắt nếu bạn muốn trang chủ yên tĩnh hơn.")}
              checked={!pilotRest}
              onChange={(on) => setPilotRest(!on)}
            />
            <SettingLine title={tx("Nhà của Pilot")} description={tx("Thay đồ, phụ kiện cho Pilot.")}>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(OPEN_PILOT_HOUSE_EVENT))}
                className="sp-btn sp-btn-secondary h-10 px-4 text-[14px]"
              >
                🏠 {tx("Mở nhà")}
              </button>
            </SettingLine>
            <SettingLine title={tx("Ngôn ngữ giao diện")} description={tx("Đổi xong trang tự tải lại.")}>
              <SelectBox
                value={savedLanguage}
                ariaLabel={tx("Ngôn ngữ hiển thị")}
                onChange={(value) => void setLanguage(value)}
                options={[
                  // Tên ngôn ngữ luôn viết bằng chính ngôn ngữ đó
                  { value: "vi", label: "Tiếng Việt" },
                  { value: "en", label: "English" },
                ]}
              />
            </SettingLine>
            <SettingLine title={tx("Ngôn ngữ nội dung mặc định")} description={tx("Cho kế hoạch mới: tóm tắt, câu hỏi, giải thích.")}>
              <SelectBox
                value={savedContentLanguage}
                ariaLabel={tx("Ngôn ngữ nội dung mặc định")}
                onChange={(value) => void saveMeta({ sp_content_language: value }).then((ok) => ok && showToast({ tone: "ok", text: tx("Đã lưu thay đổi.") }))}
                options={[
                  { value: "vi", label: "Tiếng Việt" },
                  { value: "en", label: "English" },
                ]}
              />
            </SettingLine>
          </SettingsCard>

          {/* Thông báo học tập: cùng dữ liệu với nút chuông */}
          <NotificationCard email={user?.email || ""} />
        </div>
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

function SettingsCard({
  id,
  icon,
  title,
  subtitle,
  tone = "pink",
  grow = false,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tone?: "pink" | "blue";
  /* thẻ cuối mỗi cột giãn ra để hai cột cao bằng nhau */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 rounded-[26px] border-2 border-[var(--sp-purple-deep)] bg-[var(--sp-surface)] p-5 sm:p-6 ${
        tone === "blue" ? "shadow-[5px_5px_0_var(--sp-lav-line)]" : "shadow-[5px_5px_0_var(--sp-pink-line)]"
      } ${grow ? "flex flex-1 flex-col" : ""}`}
    >
      <div className="mb-4 flex items-center gap-3.5 border-b-2 border-[var(--sp-line)] pb-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-2 border-[var(--sp-purple-deep)] text-white shadow-[2px_2px_0_var(--sp-purple-deep)] ${
            tone === "blue" ? "bg-[var(--sp-peri)]" : "bg-[var(--sp-pink)]"
          }`}
        >
          {icon}
        </span>
        <div>
          <h2 className="text-[22px] font-extrabold leading-tight text-[var(--sp-purple)]">{title}</h2>
          {subtitle && <p className="text-[13px] font-semibold text-[var(--sp-muted)]">{subtitle}</p>}
        </div>
      </div>
      <div className={`space-y-5 ${grow ? "flex flex-1 flex-col" : ""}`}>{children}</div>
    </section>
  );
}

function StatusChip({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-extrabold ${
        tone === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-[#f3dc9b] bg-[var(--sp-amber-bg)] text-[var(--sp-amber-dark)]"
      }`}
    >
      {tone === "ok" && <IconCheck size={11} />}
      {children}
    </span>
  );
}

function SettingLine({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[16px] font-bold text-[var(--sp-ink)]">{title}</p>
        <p className="mt-1 text-[14px] leading-5 text-[var(--sp-muted)]">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
  compact,
  ariaLabel,
}: {
  icon?: ReactNode;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  wide?: boolean;
  compact?: boolean;
  ariaLabel: string;
}) {
  return (
    <label className={`relative flex h-12 items-center rounded-2xl border-2 border-[var(--sp-line)] bg-white transition focus-within:border-[var(--sp-peri)] ${wide ? "w-full" : compact ? "w-[110px]" : "w-full sm:w-[170px]"} ${disabled ? "opacity-50" : ""}`}>
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

/* ---------- Bảo mật & mật khẩu ---------- */

const PASSWORD_RULES = [
  { key: "len", label: tx("Ít nhất 8 ký tự"), test: (value: string) => value.length >= 8 },
  { key: "num", label: tx("Có chữ số"), test: (value: string) => /\d/.test(value) },
  { key: "case", label: tx("Có chữ hoa và thường"), test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { key: "sym", label: tx("Có ký tự đặc biệt"), test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];
const STRENGTH_COLORS = ["var(--sp-pink)", "#f0954a", "var(--sp-yellow)", "#2f9e6e"];

function SecurityCard({
  email,
  provider,
  hasPassword,
  onToast,
}: {
  email: string;
  provider: string;
  hasPassword: boolean;
  onToast: (toast: Toast) => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const passed = PASSWORD_RULES.filter((rule) => rule.test(password)).length;

  async function submit() {
    setError("");
    if (hasPassword && !current) {
      setError(tx("Nhập mật khẩu hiện tại trước nhé."));
      return;
    }
    // Bắt buộc tối thiểu: 8 ký tự, có chữ và số (2 điều kiện còn lại chỉ để mật khẩu mạnh hơn)
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
    setBusy("save");
    if (hasPassword) {
      // Supabase không tự hỏi mật khẩu cũ: đăng nhập thử để chắc đúng chủ tài khoản
      const { error: checkError } = await client.auth.signInWithPassword({ email, password: current });
      if (checkError) {
        setBusy("");
        setError(tx("Mật khẩu hiện tại chưa đúng."));
        return;
      }
    }
    const { error: updateError } = await client.auth.updateUser({ password, data: { sp_has_password: true } });
    setBusy("");
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    setCurrent("");
    setPassword("");
    setConfirm("");
    onToast({ tone: "ok", text: hasPassword ? tx("Đã đổi mật khẩu.") : tx("Đã tạo mật khẩu. Giờ bạn đăng nhập được bằng email hoặc Google.") });
  }

  async function sendReset() {
    const client = getAuthClient();
    if (!client || !email) return;
    setBusy("reset");
    const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy("");
    onToast(
      resetError
        ? { tone: "error", text: authErrorMessage(resetError) }
        : { tone: "ok", text: tx("Đã gửi link đặt lại mật khẩu tới {0}.", [email]) },
    );
  }

  async function signOutOthers() {
    const client = getAuthClient();
    if (!client) return;
    setBusy("others");
    const { error: signOutError } = await client.auth.signOut({ scope: "others" });
    setBusy("");
    onToast(
      signOutError
        ? { tone: "error", text: authErrorMessage(signOutError) }
        : { tone: "ok", text: tx("Đã đăng xuất khỏi các thiết bị khác.") },
    );
  }

  const inputClass =
    "h-11 w-full rounded-[14px] border-2 border-[var(--sp-line)] bg-white px-4 text-[15px] text-[var(--sp-ink)] outline-none transition focus:border-[var(--sp-peri)]";

  return (
    <SettingsCard id="security" tone="blue" grow icon={<IconLock size={22} />} title={tx("Bảo mật & mật khẩu")} subtitle={tx("Cách bạn đăng nhập vào StudyPilot")}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {[
          { key: "google", mark: "G", label: "Google", on: provider === "google", onText: tx("Đang dùng"), offText: tx("Chưa liên kết") },
          { key: "email", mark: "✉", label: tx("Email + mật khẩu"), on: hasPassword, onText: tx("Đã thiết lập"), offText: tx("Chưa thiết lập") },
        ].map((method) => (
          <div key={method.key} className="flex items-center gap-3 rounded-2xl border-2 border-[var(--sp-line)] px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--sp-line)] bg-white font-extrabold text-[#4285f4]">
              {method.mark}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-[var(--sp-ink)]">{method.label}</p>
              <StatusChip tone={method.on ? "ok" : "warn"}>{method.on ? method.onText : method.offText}</StatusChip>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[18px] border-2 border-[var(--sp-lav-line)] bg-[var(--sp-surface-2)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold text-[var(--sp-ink)]">
            {hasPassword ? tx("Đổi mật khẩu") : tx("Tạo mật khẩu để đăng nhập bằng email")}
          </p>
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            aria-label={show ? tx("Ẩn mật khẩu") : tx("Hiện mật khẩu")}
            className="text-[var(--sp-muted)] hover:text-[var(--sp-ink)]"
          >
            {show ? <IconEyeOff size={19} /> : <IconEye size={19} />}
          </button>
        </div>
        <div className="space-y-2.5">
          {hasPassword && (
            <input
              type={show ? "text" : "password"}
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              placeholder={tx("Mật khẩu hiện tại")}
              autoComplete="current-password"
              aria-label={tx("Mật khẩu hiện tại")}
              className={inputClass}
            />
          )}
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={tx("Mật khẩu mới")}
            autoComplete="new-password"
            aria-label={tx("Mật khẩu mới")}
            className={inputClass}
          />
          <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
            {PASSWORD_RULES.map((rule, index) => (
              <span
                key={rule.key}
                className="h-1.5 rounded-full bg-[var(--sp-line)] transition-colors"
                style={index < passed ? { background: STRENGTH_COLORS[passed - 1] } : undefined}
              />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px]">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.key} className={ok ? "font-bold text-emerald-700" : "text-[var(--sp-muted)]"}>
                  {ok ? "✓" : "○"} {rule.label}
                </li>
              );
            })}
          </ul>
          <input
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={tx("Nhập lại mật khẩu mới")}
            autoComplete="new-password"
            aria-label={tx("Nhập lại mật khẩu mới")}
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className="mt-2.5 rounded-xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--sp-pink-dark)]">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void sendReset()}
            disabled={busy !== ""}
            className="text-[13px] font-bold text-[var(--sp-peri-dark)] underline disabled:opacity-50"
          >
            {busy === "reset" ? tx("Đang gửi...") : tx("Quên mật khẩu? Gửi email đặt lại")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy !== "" || !password}
            className="sp-btn sp-btn-primary h-10 px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "save" ? tx("Đang cập nhật...") : hasPassword ? tx("Đổi mật khẩu") : tx("Tạo mật khẩu")}
          </button>
        </div>
      </div>

      <div className="mt-auto">
        <SettingLine title={tx("Phiên đăng nhập")} description={tx("Đăng xuất tài khoản trên các máy và trình duyệt khác, giữ lại máy này.")}>
          <button
            type="button"
            onClick={() => void signOutOthers()}
            disabled={busy !== ""}
            className="sp-btn sp-btn-secondary h-10 px-4 text-[14px] disabled:opacity-50"
          >
            {busy === "others" ? tx("Đang đăng xuất...") : tx("Đăng xuất thiết bị khác")}
          </button>
        </SettingLine>
      </div>
    </SettingsCard>
  );
}

/* ---------- Thông báo học tập (cùng dữ liệu với nút chuông) ---------- */

function NotificationCard({ email }: { email: string }) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Toast>(null);

  useEffect(() => {
    notificationRequest<{ data: NotificationSettings }>("/settings")
      .then((result) => setSettings(result.data))
      .catch(() => setSettings(null))
      .finally(() => setLoaded(true));
  }, []);

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

  // Thư luôn gửi tới Gmail của tài khoản đang đăng nhập
  const update = (changes: Partial<NotificationSettings>) =>
    run("save", async () => {
      const result = await notificationRequest<{ data: NotificationSettings }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ ...changes, email: email || undefined }),
      });
      setSettings(result.data);
    });

  const sendTest = (kind: "schedule" | "weak") =>
    run(`test-${kind}`, async () => {
      if (email) await notificationRequest("/settings", { method: "PUT", body: JSON.stringify({ email }) });
      const result = await notificationRequest<{ message: string }>("/test", { method: "POST", body: JSON.stringify({ kind }) });
      setNotice({ tone: "ok", text: tx("{0} Kiểm tra cả mục Spam nếu chưa thấy.", [result.message]) });
    });

  return (
    <SettingsCard id="notifications" tone="blue" grow icon={<IconBell size={22} />} title={tx("Thông báo học tập")} subtitle={tx("Gửi tới Gmail bạn dùng để đăng nhập")}>
      {!settings ? (
        <p className="text-sm text-[var(--sp-muted)]">
          {loaded ? tx("Chưa kết nối được backend. Hãy chạy backend rồi mở lại.") : tx("Đang tải...")}
        </p>
      ) : (
        <>
          {settings.disabled_reason && (
            <p className="rounded-xl bg-[var(--sp-pink-bg)] px-3 py-2.5 text-[13px] text-[var(--sp-pink-dark)]">{settings.disabled_reason}</p>
          )}
          <ToggleRow
            title={tx("Bật thông báo")}
            description={tx("Tắt để tạm dừng mọi email nhắc học.")}
            checked={settings.enabled}
            disabled={busy === "save"}
            onChange={(value) => update({ enabled: value })}
          />
          <div className={`space-y-5 ${settings.enabled ? "" : "pointer-events-none opacity-50"}`}>
            <SettingLine title={tx("Nhắc theo lịch học")} description={tx("Bài hôm nay, bài còn nợ, ngày ôn đã chọn, đếm ngược ngày thi.")}>
              <div className="flex items-center gap-3">
                <SelectBox
                  compact
                  value={String(settings.daily_hour)}
                  ariaLabel={tx("Giờ gửi thông báo")}
                  onChange={(value) => update({ daily_hour: Number(value) })}
                  options={Array.from({ length: 17 }, (_, index) => index + 5).map((hour) => ({
                    value: String(hour),
                    label: `${String(hour).padStart(2, "0")}:00`,
                  }))}
                />
                <Toggle label={tx("Nhắc theo lịch học")} checked={settings.daily_enabled} onChange={(value) => update({ daily_enabled: value })} />
              </div>
            </SettingLine>
            <ToggleRow
              title={tx("Nhắc ôn phần còn yếu")}
              description={tx("Còn 7, 5, 3, 2, 1 ngày tới thi mà còn bài dưới 80%.")}
              checked={settings.weak_enabled}
              onChange={(value) => update({ weak_enabled: value })}
            />
          </div>
          <div className="mt-auto space-y-3">
            <SettingLine title={tx("Gửi thử")} description={tx("Xem trước email sẽ trông thế nào.")}>
              <div className="flex gap-2">
                {(["schedule", "weak"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={busy !== "" || !settings.enabled}
                    onClick={() => sendTest(kind)}
                    className="sp-btn sp-btn-secondary h-10 px-3.5 text-[13.5px] disabled:opacity-50"
                  >
                    {busy === `test-${kind}` ? tx("Đang gửi...") : kind === "schedule" ? tx("Lịch học") : tx("Phần còn yếu")}
                  </button>
                ))}
              </div>
            </SettingLine>
            {notice && (
              <p
                className={`rounded-xl px-3 py-2 text-[13px] ${
                  notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                }`}
              >
                {notice.text}
              </p>
            )}
          </div>
        </>
      )}
    </SettingsCard>
  );
}
