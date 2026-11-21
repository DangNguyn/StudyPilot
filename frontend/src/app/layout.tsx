
import type { Metadata } from "next";
import {
  Anton,
  Be_Vietnam_Pro,
  Geist_Mono,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";
import AppShell from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { Suspense } from "react";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Chữ tiêu đề lớn (cô đặc, đậm)
const anton = Anton({
  variable: "--font-sp-display",
  subsets: ["latin", "vietnamese"],
  weight: "400",
});

// Chữ nội dung: thiết kế riêng cho tiếng Việt, dễ đọc
const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-sp-body",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

// Chữ nghiêng trang trí (ngày tháng, lời chào)
const playfair = Playfair_Display({
  variable: "--font-sp-accent",
  subsets: ["latin", "vietnamese"],
  weight: ["600", "700"],
  style: ["italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StudyPilot | Đồng hành học tập cùng AI",
  description: "Lập kế hoạch, học tập và đánh giá năng lực cùng StudyPilot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${anton.variable} ${beVietnamPro.variable} ${playfair.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Bật chế độ tối trước khi trang hiện ra */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AuthProvider>
          <Suspense fallback={<div className="min-h-screen bg-[var(--sp-paper)]" />}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
