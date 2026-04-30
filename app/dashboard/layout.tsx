// Dashboard layout - Sidebar, üst bar, AuthProvider ile sarmalanmış
"use client";

import { useState, useEffect } from "react";
import { AuthProvider } from "@/lib/auth-context";
import Sidebar from "@/components/shared/sidebar";
import Topbar from "@/components/shared/topbar";
import PullToRefresh from "@/components/shared/pull-to-refresh";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Service worker'dan gelen "BILDIRIM_NAVIGATE" mesajını dinle.
  // Bildirime tıklayınca SW bu mesajı yollar; biz window.location.href ile
  // tam yönlendirme yaparak sayfanın doğru URL'e gitmesini garanti ederiz
  // (client.navigate iOS Safari'de bazen sessizce başarısız oluyor).
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | undefined;
      if (data?.type === "BILDIRIM_NAVIGATE" && data.url) {
        window.location.href = data.url;
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  return (
    <AuthProvider>
      <div
        className="flex overflow-hidden bg-[#FAFAFA]"
        style={{
          // PWA standalone modda status bar (telefon saati) ile çakışmasın diye
          // safe-area-inset-top kadar boşluk bırakılır. Tarayıcıda env değeri 0'dır.
          height: "100dvh",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0">
          <Sidebar />
        </aside>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="p-0 w-64 border-0">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar onMenuToggle={() => setSidebarOpen(true)} />
          <PullToRefresh scrollTargetId="dashboard-main" />
          <main className="flex-1 overflow-auto p-4 md:p-6" id="dashboard-main">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
