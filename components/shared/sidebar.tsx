// Sidebar bileşeni - İzin bazlı filtrelemeli dashboard navigasyonu
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/hooks";
import { hrefToModuleKey } from "@/lib/permissions";
import {
  Users, Building2, HardHat, UserCog, Truck, TrendingUp, Settings,
  Mail, MailOpen, Landmark, Trash2,
  Shield, Headphones,
  ClipboardList, Fuel, Wallet, NotebookPen, Calculator,
  ChevronDown, ChevronUp,
} from "lucide-react";

type MenuItem = { label: string; href: string; icon: React.ReactNode };
type MenuGroup = { title: string; icon: React.ReactNode; color: string; items: MenuItem[] };

const menuGroups: MenuGroup[] = [
  {
    title: "Yönetim",
    icon: <Settings size={20} />,
    color: "text-[#1E3A5F] bg-[#1E3A5F]/10",
    items: [
      { label: "Kullanıcılar", href: "/dashboard/yonetim/kullanicilar", icon: <Users size={16} /> },
      { label: "Firmalar", href: "/dashboard/yonetim/firmalar", icon: <Building2 size={16} /> },
      { label: "Şantiyeler", href: "/dashboard/yonetim/santiyeler", icon: <HardHat size={16} /> },
      { label: "Personeller", href: "/dashboard/yonetim/personel", icon: <UserCog size={16} /> },
      { label: "Araçlar", href: "/dashboard/yonetim/araclar", icon: <Truck size={16} /> },
      { label: "Yi-ÜFE", href: "/dashboard/yonetim/yi-ufe", icon: <TrendingUp size={16} /> },
      { label: "Tanımlamalar", href: "/dashboard/yonetim/tanimlamalar", icon: <Settings size={16} /> },
    ],
  },
  {
    title: "Yazışmalar",
    icon: <MailOpen size={20} />,
    color: "text-emerald-600 bg-emerald-50",
    items: [
      { label: "Gelen Evrak", href: "/dashboard/yazismalar/gelen-evrak", icon: <Mail size={16} /> },
      { label: "Giden Evrak", href: "/dashboard/yazismalar/giden-evrak", icon: <MailOpen size={16} /> },
      { label: "Banka Yazışmaları", href: "/dashboard/yazismalar/banka-yazismalari", icon: <Landmark size={16} /> },
      { label: "Silinen", href: "/dashboard/yazismalar/silinen", icon: <Trash2 size={16} /> },
    ],
  },
  {
    title: "Araçlar",
    icon: <Truck size={20} />,
    color: "text-blue-600 bg-blue-50",
    items: [
      { label: "Sigorta & Muayene", href: "/dashboard/araclar/sigorta-muayene", icon: <Shield size={16} /> },
      { label: "Acente Takip", href: "/dashboard/araclar/acente-takip", icon: <Headphones size={16} /> },
    ],
  },
  {
    title: "Puantaj",
    icon: <ClipboardList size={20} />,
    color: "text-purple-600 bg-purple-50",
    items: [
      { label: "Personel Puantaj", href: "/dashboard/puantaj/personel", icon: <ClipboardList size={16} /> },
      { label: "Araç Puantaj", href: "/dashboard/puantaj/arac", icon: <Truck size={16} /> },
    ],
  },
  {
    title: "İşçilik Takibi",
    icon: <ClipboardList size={20} />,
    color: "text-amber-600 bg-amber-50",
    items: [
      { label: "Takip Listesi", href: "/dashboard/iscilik-takibi", icon: <ClipboardList size={16} /> },
    ],
  },
  {
    title: "Yakıt",
    icon: <Fuel size={20} />,
    color: "text-red-500 bg-red-50",
    items: [
      { label: "Yakıt Hareketleri", href: "/dashboard/yakit", icon: <Fuel size={16} /> },
    ],
  },
  {
    title: "Kasa Defteri",
    icon: <Wallet size={20} />,
    color: "text-teal-600 bg-teal-50",
    items: [
      { label: "Kasa Hareketleri", href: "/dashboard/kasa-defteri", icon: <Wallet size={16} /> },
    ],
  },
  {
    title: "Şantiye Defteri",
    icon: <NotebookPen size={20} />,
    color: "text-indigo-600 bg-indigo-50",
    items: [
      { label: "Günlük Kayıtlar", href: "/dashboard/santiye-defteri", icon: <NotebookPen size={16} /> },
    ],
  },
  {
    title: "İhale",
    icon: <Calculator size={20} />,
    color: "text-orange-600 bg-orange-50",
    items: [
      { label: "Sınır Değer", href: "/dashboard/ihale", icon: <Calculator size={16} /> },
    ],
  },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    menuGroups.forEach((g) => { initial[g.title] = false; });
    return initial;
  });

  function canView(href: string): boolean {
    const key = hrefToModuleKey(href);
    return hasPermission(key, "goruntule");
  }

  const filteredGroups = menuGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canView(i.href)) }))
    .filter((g) => g.items.length > 0);

  // Aktif olan grubun otomatik açılması
  const activeGroup = filteredGroups.find((g) => g.items.some((i) => pathname === i.href));

  return (
    <nav className="flex flex-col h-full bg-[#E5E9EF] border-r border-gray-300">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#cdd4dc]">
        <Link href="/dashboard" onClick={() => onNavigate?.()}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="KAD-TEM" className="h-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <div>
              <h2 className="text-sm font-bold text-[#1E3A5F]">KAD-TEM A.Ş.</h2>
              <p className="text-[10px] text-gray-400">Yönetim Sistemi</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Menü */}
      <div className="flex-1 overflow-y-auto py-3 px-3 scrollbar-thin">
        {filteredGroups.map((group) => {
          const isOpen = openGroups[group.title] || (activeGroup?.title === group.title && !Object.values(openGroups).some(Boolean));
          const hasActive = group.items.some((i) => pathname === i.href);

          return (
            <div key={group.title} className="mb-1">
              <button
                onClick={() => setOpenGroups((p) => {
                  const yeniDurum: Record<string, boolean> = {};
                  for (const k of Object.keys(p)) yeniDurum[k] = false;
                  yeniDurum[group.title] = !p[group.title];
                  return yeniDurum;
                })}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isOpen || hasActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:bg-white/70 hover:text-gray-900"
                }`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${group.color}`}>
                  {group.icon}
                </span>
                <span className="flex-1 text-left">{group.title}</span>
                {isOpen
                  ? <ChevronUp size={16} className="text-gray-400" />
                  : <ChevronDown size={16} className="text-gray-400" />
                }
              </button>

              {isOpen && (
                <div className="ml-6 pl-4 border-l-2 border-[#c0c9d4] mt-1 mb-2 space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => onNavigate?.()}
                        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                          isActive
                            ? "bg-[#1E3A5F] text-white font-medium shadow-sm"
                            : "text-gray-500 hover:bg-white hover:text-gray-900"
                        }`}>
                        {/* Sol nokta */}
                        <span className={`absolute -left-[21px] w-2 h-2 rounded-full ${
                          isActive ? "bg-[#1E3A5F]" : "bg-[#b8c2ce]"
                        }`} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
