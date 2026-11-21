"use client";

import { tx } from "@/lib/i18n";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/auth-screen";
import { useAuth } from "@/components/auth-provider";
import { IconArrowRight, IconCheck, IconEye, IconEyeOff, IconLock, Sparkle } from "@/components/icons";
import { authErrorMessage, getAuthClient } from "@/lib/auth";

/* Trang đặt mật khẩu mới (mở từ link trong email "Quên mật khẩu") */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
    if (!client) {
      setError(tx("Chưa cấu hình đăng nhập Supabase."));
      return;
    }
    setSaving(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    setDone(true);
    window.setTimeout(() => router.replace("/"), 900);
  }

  const inputClass =
    "h-12 w-full rounded-2xl border-2 border-[var(--sp-line)] bg-white px-4 pr-12 text-[15px] text-[var(--sp-ink)] outline-none transition placeholder:text-[var(--sp-soft)] focus:border-[var(--sp-peri)]";

  return (
    <AuthLayout artText={tx("Chọn một mật khẩu mới thật dễ nhớ với bạn nhưng khó đoán với người khác.")}>
      <div className="relative rounded-[32px] border-2 border-[var(--sp-purple-deep)] bg-white px-6 py-8 shadow-[6px_6px_0_var(--sp-pink-line)] sm:px-10 sm:py-10">
        <Sparkle size={22} className="sp-twinkle absolute right-8 top-8 text-[var(--sp-pink)]" />
        <h2
          style={{ fontFamily: "var(--font-sp-display), Impact, sans-serif", fontWeight: 400, letterSpacing: "0.01em" }}
          className="text-[40px] leading-tight text-[var(--sp-purple)]"
        >

          {tx("Đặt")} <span className="sp-squiggle">{tx("mật khẩu mới")}</span>
        </h2>

        {loading ? (
          <p className="mt-6 text-[var(--sp-muted)]">{tx("Đang kiểm tra link...")}</p>
        ) : !user ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-2xl bg-[var(--sp-pink-bg)] px-4 py-3 text-[14px] text-[var(--sp-pink-dark)]">

              {tx("Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ. Bạn gửi lại link mới nhé.")}
            </p>
            <Link href="/login" className="sp-btn sp-btn-primary px-5 py-3 text-[15px]">

              {tx("Về trang đăng nhập")}
            </Link>
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
            {[
              { id: "new-password", label: tx("Mật khẩu mới"), value: password, set: setPassword, placeholder: tx("Ít nhất 8 ký tự, có chữ và số") },
              { id: "new-confirm", label: tx("Nhập lại mật khẩu mới"), value: confirm, set: setConfirm, placeholder: tx("Nhập lại mật khẩu") },
            ].map((field) => (
              <div key={field.id} className="grid grid-cols-[48px_minmax(0,1fr)] items-end gap-3">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[var(--sp-line)] bg-[#faf6fc] text-[var(--sp-purple)]">
                  <IconLock size={20} />
                </span>
                <div className="min-w-0">
                  <label htmlFor={field.id} className="mb-1.5 block text-[14px] font-bold text-[var(--sp-ink)]">
                    {field.label}
                  </label>
                  <div className="relative">
                    <input
                      id={field.id}
                      type={visible ? "text" : "password"}
                      value={field.value}
                      onChange={(event) => field.set(event.target.value)}
                      placeholder={field.placeholder}
                      autoComplete="new-password"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setVisible((current) => !current)}
                      aria-label={visible ? tx("Ẩn mật khẩu") : tx("Hiện mật khẩu")}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-[var(--sp-muted)] hover:bg-[var(--sp-surface-2)]"
                    >
                      {visible ? <IconEyeOff size={19} /> : <IconEye size={19} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {error && (
              <p role="alert" className="rounded-2xl border-2 border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] px-4 py-3 text-[13.5px] font-semibold text-[var(--sp-pink-dark)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving || done}
              className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[var(--sp-purple-deep)] text-[17px] font-bold text-white shadow-[4px_4px_0_var(--sp-pink)] ${
                done ? "bg-emerald-600" : "bg-[var(--sp-peri)] hover:bg-[var(--sp-peri-dark)]"
              }`}
            >
              {done ? (
                <>
                  <IconCheck size={20} />

                  {tx("Đã đổi mật khẩu")}
                </>
              ) : saving ? (
                tx("Đang lưu...")
              ) : (
                <>

                  {tx("Lưu mật khẩu mới")}
                  <IconArrowRight size={19} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
