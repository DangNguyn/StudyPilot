import { tx } from "@/lib/i18n";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
 * Đăng ký / đăng nhập bằng Supabase Auth.
 * Cần 2 biến trong frontend/.env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...   (khóa công khai, KHÔNG dùng service role)
 * Thiếu 2 biến này thì web báo lỗi cấu hình (không còn chế độ demo).
 */

let client: SupabaseClient | null | undefined;

export function getAuthClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

/*
 * Trang đăng nhập/đăng ký tự điều khiển việc chuyển trang (để hiệu ứng sách chạy xong).
 * Khi cờ này bật, AppShell không tự đẩy người dùng vừa đăng nhập về trang chủ.
 */
let authRedirectHeld = false;
export function holdAuthRedirect(held: boolean) {
  authRedirectHeld = held;
}
export function isAuthRedirectHeld() {
  return authRedirectHeld;
}

export const AUTH_PATHS = ["/login", "/register", "/reset-password"];

export function isAuthPath(pathname: string) {
  return AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/* Đổi thông báo lỗi tiếng Anh của Supabase sang tiếng Việt dễ hiểu */
export function authErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error || "");
  const text = raw.toLowerCase();
  if (text.includes("invalid login credentials")) return tx("Email hoặc mật khẩu chưa đúng.");
  if (text.includes("email not confirmed")) return tx("Gmail này chưa được xác nhận. Nhập mã 6 số đã gửi tới Gmail nhé.");
  if (text.includes("token has expired") || text.includes("invalid token") || text.includes("otp") && text.includes("invalid"))
    return tx("Mã chưa đúng hoặc đã hết hạn. Kiểm tra lại, hoặc bấm “Gửi lại mã”.");
  if (text.includes("error sending") || text.includes("sending confirmation") || text.includes("smtp"))
    return tx("Chưa gửi được mã tới Gmail. Kiểm tra phần gửi mail (SMTP) trên Supabase.");
  if (text.includes("provider is not enabled") || text.includes("unsupported provider"))
    return tx("Chưa bật đăng nhập bằng Google trên Supabase.");
  if (text.includes("already registered") || text.includes("already been registered"))
    return tx("Email này đã có tài khoản. Bạn đăng nhập nhé.");
  if (text.includes("password should be at least") || text.includes("weak password"))
    return tx("Mật khẩu quá yếu. Hãy dùng ít nhất 8 ký tự, có cả chữ và số.");
  if (text.includes("should be different from the old password"))
    return tx("Mật khẩu mới phải khác mật khẩu cũ.");
  if (text.includes("reauthentication") || text.includes("reauthenticate"))
    return tx("Vì lý do bảo mật, hãy đăng xuất rồi đăng nhập lại trước khi đổi mật khẩu.");
  if (text.includes("rate limit") || text.includes("too many"))
    return tx("Bạn thao tác quá nhanh. Đợi một lát rồi thử lại.");
  if (text.includes("invalid email") || text.includes("unable to validate email"))
    return tx("Email chưa đúng định dạng.");
  if (text.includes("failed to fetch") || text.includes("network"))
    return tx("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  return raw || tx("Đã có lỗi xảy ra. Bạn thử lại nhé.");
}
