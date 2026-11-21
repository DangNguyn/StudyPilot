import { tx } from "@/lib/i18n";
import AuthScreen from "@/components/auth-screen";

export const metadata = { title: tx("Đăng nhập | StudyPilot") };

export default function LoginPage() {
  return <AuthScreen initialMode="login" />;
}
