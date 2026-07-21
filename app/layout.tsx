// Root layout - Inter font, Toaster, global meta bilgileri
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import ToasterX from "@/components/shared/toaster-x";
import TarihYilKoruma from "@/components/shared/tarih-yil-koruma";
import TruncateTooltip from "@/components/shared/truncate-tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "İkikat Yönetim",
  description: "Taahhüt şirketi yönetim uygulaması",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "İkikat",
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport = {
  themeColor: "#1E3A5F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // viewportFit: "cover" — iOS notch'lu cihazlarda tam ekran kullansın
  viewportFit: "cover" as const,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Yazı boyutu tercihi: COOKIE'den SSR'da okunup <html>'e inline stil basılır → açılışta flicker yok.
  // React ağacında <script> YOK — inline script çözümleri (next/script beforeInteractive ve düz
  // dangerouslySetInnerHTML) React 19'un "Encountered a script tag" uyarısını tetikliyordu (client
  // re-mount'ta script'ler çalıştırılmadığı için React her koşulda uyarıyor). Cookie'yi topbar'daki
  // zoom ayarı yazar; yalnız localStorage'ı olan eski tercih, topbar mount olunca uygulanıp cookie'ye
  // de yazılır → bir sonraki açılıştan itibaren flicker'sız.
  const zoomHam = (await cookies()).get("site-font-zoom")?.value;
  const zoom = zoomHam ? parseInt(zoomHam, 10) : NaN;
  const fontSize = Number.isFinite(zoom) && zoom >= 50 && zoom <= 200 ? `${(zoom / 100) * 16}px` : undefined;
  return (
    <html lang="tr" className={`${inter.variable} h-full antialiased`}
      style={fontSize ? { fontSize } : undefined} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <ToasterX />
        <TarihYilKoruma />
        <TruncateTooltip />
      </body>
    </html>
  );
}
