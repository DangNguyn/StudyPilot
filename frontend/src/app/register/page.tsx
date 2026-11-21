import { tx } from "@/lib/i18n";
import AuthScreen from "@/components/auth-screen";

export const metadata = { title: tx("Đăng ký | StudyPilot") };

export default function RegisterPage() {
  return <AuthScreen initialMode="register" />;
}
