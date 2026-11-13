
import type { Metadata } from "next";
import { Anton, Geist_Mono, Montserrat } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/app-shell";
import { Suspense } from "react";

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin", "vietnamese"],
  weight: "400",
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
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
      className={`${anton.variable} ${montserrat.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Suspense fallback={<div className="min-h-screen bg-[#F7F5EF]" />}>
  <AppShell>{children}</AppShell>
</Suspense>
      </body>
    </html>
  );
}
