// Dashboard layout - Sidebar, üst bar, AuthProvider ile sarmalanmış
"use client";

import { useState } from "react";
import { AuthProvider } from "@/lib/auth-context";
import Sidebar from "@/components/shared/sidebar";
import Topbar from "@/components/shared/topbar";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden bg-[#F1F5F9]">
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
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
