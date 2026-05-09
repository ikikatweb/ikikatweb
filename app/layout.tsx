// Root layout - Inter font, Toaster, global meta bilgileri
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ToasterX from "@/components/shared/toaster-x";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* Yazı boyutu tercihi: sayfa açılır açılmaz uygulansın (flicker olmasın).
             FontSizeAyari komponenti localStorage'a "site-font-zoom" anahtarıyla yazıyor. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var z=localStorage.getItem("site-font-zoom");if(z){var p=parseInt(z,10);if(p>=50&&p<=200){document.documentElement.style.fontSize=(p/100*16)+"px";}}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <ToasterX />
        <TruncateTooltip />
      </body>
    </html>
  );
}
