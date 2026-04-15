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
  DollarSign, Shield, Headphones,
  ClipboardList, Fuel, Wallet, NotebookPen, Calculator,
  ChevronDown, ChevronRight,
} from "lucide-react";

type MenuItem = { label: string; href: string; icon: React.ReactNode };
type MenuGroup = { title: string; items: MenuItem[] };

const menuGroups: MenuGroup[] = [
  {
    title: "Yönetim",
    items: [
      { label: "Kullanıcılar", href: "/dashboard/yonetim/kullanicilar", icon: <Users size={18} /> },
      { label: "Firmalar", href: "/dashboard/yonetim/firmalar", icon: <Building2 size={18} /> },
      { label: "Şantiyeler", href: "/dashboard/yonetim/santiyeler", icon: <HardHat size={18} /> },
      { label: "Personeller", href: "/dashboard/yonetim/personel", icon: <UserCog size={18} /> },
      { label: "Araçlar", href: "/dashboard/yonetim/araclar", icon: <Truck size={18} /> },
      { label: "Yi-ÜFE", href: "/dashboard/yonetim/yi-ufe", icon: <TrendingUp size={18} /> },
      { label: "Tanımlamalar", href: "/dashboard/yonetim/tanimlamalar", icon: <Settings size={18} /> },
    ],
  },
  {
    title: "Yazışmalar",
    items: [
      { label: "Gelen Evrak", href: "/dashboard/yazismalar/gelen-evrak", icon: <Mail size={18} /> },
      { label: "Giden Evrak", href: "/dashboard/yazismalar/giden-evrak", icon: <MailOpen size={18} /> },
      { label: "Banka Yazışmaları", href: "/dashboard/yazismalar/banka-yazismalari", icon: <Landmark size={18} /> },
      { label: "Silinen", href: "/dashboard/yazismalar/silinen", icon: <Trash2 size={18} /> },
    ],
  },
  {
    title: "Araçlar",
    items: [
      { label: "Sigorta & Muayene", href: "/dashboard/araclar/sigorta-muayene", icon: <Shield size={18} /> },
      { label: "Acente Takip", href: "/dashboard/araclar/acente-takip", icon: <Headphones size={18} /> },
    ],
  },
  {
    title: "Puantaj",
    items: [
      { label: "Personel Puantaj", href: "/dashboard/puantaj/personel", icon: <ClipboardList size={18} /> },
      { label: "Araç Puantaj", href: "/dashboard/puantaj/arac", icon: <Truck size={18} /> },
    ],
  },
  {
    title: "İşçilik Takibi",
    items: [
      { label: "Takip Listesi", href: "/dashboard/iscilik-takibi", icon: <ClipboardList size={18} /> },
    ],
  },
  {
    title: "Yakıt",
    items: [
      { label: "Yakıt Hareketleri", href: "/dashboard/yakit", icon: <Fuel size={18} /> },
    ],
  },
  {
    title: "Kasa Defteri",
    items: [
      { label: "Kasa Hareketleri", href: "/dashboard/kasa-defteri", icon: <Wallet size={18} /> },
    ],
  },
  {
    title: "Şantiye Defteri",
    items: [
      { label: "Günlük Kayıtlar", href: "/dashboard/santiye-defteri", icon: <NotebookPen size={18} /> },
    ],
  },
  {
    title: "İhale",
    items: [
      { label: "Sınır Değer", href: "/dashboard/ihale", icon: <Calculator size={18} /> },
    ],
  },
];

const singlePages: MenuItem[] = [];

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

  // İzne göre filtrele
  const filteredGroups = menuGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canView(i.href)) }))
    .filter((g) => g.items.length > 0);

  const filteredSingles = singlePages.filter((i) => canView(i.href));

  return (
    <nav className="flex flex-col h-full bg-[#1E3A5F] text-gray-200">
      <div className="px-4 py-4 border-b border-[#2a4f7a]">
        <Link href="/dashboard" onClick={() => onNavigate?.()}>
          <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="KAD-TEM" className="h-12 object-contain brightness-0 invert mb-1" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <h2 className="text-sm font-bold text-white">KAD-TEM A.Ş.</h2>
          </div>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {filteredGroups.map((group) => (
          <div key={group.title} className="mb-0.5">
            <button
              onClick={() => setOpenGroups((p) => {
                const yeniDurum: Record<string, boolean> = {};
                for (const k of Object.keys(p)) yeniDurum[k] = false;
                yeniDurum[group.title] = !p[group.title];
                return yeniDurum;
              })}
              className={`flex items-center justify-between w-full px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-colors rounded-md ${
                openGroups[group.title]
                  ? "bg-[#2a4f7a] text-white"
                  : "text-gray-400 hover:text-white hover:bg-[#253f5f]"
              }`}
            >
              <span>{group.title}</span>
              {openGroups[group.title] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {openGroups[group.title] && (
              <div className="ml-2 pl-2 border-l border-[#2a4f7a] space-y-0.5 mt-0.5 mb-1">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => onNavigate?.()}
                    className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                      pathname === item.href
                        ? "bg-[#F97316] text-white font-medium"
                        : "text-gray-300 hover:bg-[#2a4f7a] hover:text-white"
                    }`}>
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}

        {filteredSingles.length > 0 && (
          <div className="mt-2 border-t border-[#2a4f7a] pt-2 space-y-0.5">
            {filteredSingles.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => onNavigate?.()}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  pathname === item.href
                    ? "bg-[#F97316] text-white font-medium"
                    : "text-gray-300 hover:bg-[#2a4f7a] hover:text-white"
                }`}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
