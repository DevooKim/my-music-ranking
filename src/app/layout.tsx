import type { Metadata, Viewport } from "next";
import { Manrope, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { ScrollToTopButton } from "@/lib/ui/common/ScrollToTopButton";
import { ServiceWorkerRegister } from "@/lib/ui/common/ServiceWorkerRegister";

const manrope = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const notoSansKr = Noto_Sans_KR({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "my-music-ranking",
  description: "My Music Ranking - 주간/월간/연간 랭킹을 S3 처리본 기반으로 보여주는 앱",
  manifest: "/manifest.webmanifest",
  applicationName: "My Music Ranking",
  themeColor: "#02060e",
  appleWebApp: {
    capable: true,
    title: "My Music Ranking",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#02060e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="My Music Ranking" />
        <meta name="application-name" content="my-music-ranking" />
        <meta name="theme-color" content="#02060e" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/pwa-192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/pwa-512.png" sizes="512x512" />
      </head>
      <body className={`${manrope.variable} ${notoSansKr.variable} antialiased`}>
        {children}
        <ScrollToTopButton />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
