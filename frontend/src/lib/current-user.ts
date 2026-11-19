/*
 * Người dùng đang đăng nhập.
 * Chưa có trang đăng ký / đăng nhập nên tạm dùng tên cố định.
 * Khi làm đăng nhập, chỉ cần thay chỗ này bằng tên lấy từ tài khoản.
 */
export const CURRENT_USER = {
  name: "Đăng Nguyên",
};

export function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0][0]];
  return letters.join("").toUpperCase();
}
