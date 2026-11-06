// Sidebar bileşeni - İzin bazlı filtrelemeli dashboard navigasyonu
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth, useOkunmamisTebligat } from "@/hooks";
import { hrefToModuleKey } from "@/lib/permissions";
import LogoDonen from "@/components/shared/logo-donen";
import {
  Users, Building2, HardHat, UserCog, Truck, TrendingUp, Settings, Newspaper,
  Mail, MailOpen, Landmark, Trash2,
  Shield, Headphones, BarChart3, Wrench, Satellite,
  ClipboardList, Fuel, Wallet, NotebookPen, Calculator, UserPlus, CalendarClock, Gavel, CreditCard,
  ChevronDown, ChevronUp,
  FileBarChart2, Database, Briefcase, ListChecks, Info, Scale,
} from "lucide-react";

/**
 * iPhone usulü kırmızı rozet. 99'dan sonrası "99+" — menü genişliği bozulmasın.
 * Sayı 0 ise hiç basılmaz (çağıran yerde kontrol ediliyor).
 */
function Rozet({ sayi, baslik }: { sayi: number; baslik: string }) {
  return (
    <span title={baslik} aria-label={baslik}
      className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm">
      {sayi > 99 ? "99+" : sayi}
    </span>
  );
}

type MenuItem = { label: string; href: string; icon: React.ReactNode; moduleKey?: string };
type MenuGroup = { title: string; icon: React.ReactNode; color: string; items: MenuItem[] };

const menuGroups: MenuGroup[] = [
  {
    title: "Büro Yönetimi",
    icon: <Briefcase size={20} />,
    color: "text-slate-700 bg-slate-100",
    items: [
      { label: "İşçilik Durum Raporu", href: "/dashboard/iscilik-takibi", icon: <ClipboardList size={16} /> },
      { label: "Bordro Takibi", href: "/dashboard/bordro-takibi", icon: <UserPlus size={16} /> },
      { label: "Ödeme Planı", href: "/dashboard/odeme-plani", icon: <CalendarClock size={16} /> },
      { label: "Kredi Kartları", href: "/dashboard/kredi-kartlari", icon: <CreditCard size={16} /> },
      { label: "İcra Takibi", href: "/dashboard/icra", icon: <Gavel size={16} /> },
      { label: "Sınır Değer Hesabı", href: "/dashboard/ihale", icon: <Calculator size={16} /> },
    ],
  },
  {
    title: "Yazışmalar",
    icon: <MailOpen size={20} />,
    color: "text-emerald-600 bg-emerald-50",
    items: [
      { label: "E-Tebligat", href: "/dashboard/yazismalar/e-tebligat", icon: <Scale size={16} /> },
      { label: "Gelen Evrak", href: "/dashboard/yazismalar/gelen-evrak", icon: <Mail size={16} /> },
      { label: "Giden Evrak", href: "/dashboard/yazismalar/giden-evrak", icon: <MailOpen size={16} /> },
      { label: "Banka Yazışmaları", href: "/dashboard/yazismalar/banka-yazismalari", icon: <Landmark size={16} /> },
      { label: "Silinen", href: "/dashboard/yazismalar/silinen", icon: <Trash2 size={16} /> },
    ],
  },
  {
    title: "Kasko & Sigorta",
    icon: <Truck size={20} />,
    color: "text-blue-600 bg-blue-50",
    items: [
      { label: "Araç Listesi", href: "/dashboard/araclar/sigorta-muayene", icon: <Shield size={16} /> },
      { label: "Belgeler", href: "/dashboard/araclar/acente-takip", icon: <Headphones size={16} /> },
      { label: "Acente Raporu", href: "/dashboard/araclar/acente-raporu", icon: <BarChart3 size={16} /> },
    ],
  },
  {
    title: "Araç Takip",
    icon: <Satellite size={20} />,
    color: "text-sky-600 bg-sky-50",
    items: [
      { label: "Araç Çalışma Raporu", href: "/dashboard/araclar/arvento-raporu", icon: <Satellite size={16} /> },
    ],
  },
  {
    title: "Maliyet Raporu",
    icon: <FileBarChart2 size={20} />,
    color: "text-rose-600 bg-rose-50",
    items: [
      { label: "Sezon Maliyeti", href: "/dashboard/maliyet-raporu", icon: <FileBarChart2 size={16} /> },
    ],
  },
  {
    title: "Araç Bakım",
    icon: <Wrench size={20} />,
    color: "text-cyan-600 bg-cyan-50",
    items: [
      { label: "Bakım, Tamirat, Yedek Parça", href: "/dashboard/arac-bakim", icon: <Wrench size={16} /> },
      { label: "Araç Listesi", href: "/dashboard/arac-bakim/arac-listesi", icon: <ListChecks size={16} /> },
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
    title: "Yakıt",
    icon: <Fuel size={20} />,
    color: "text-red-500 bg-red-50",
    items: [
      { label: "Yakıt Hareketleri", href: "/dashboard/yakit", icon: <Fuel size={16} /> },
    ],
  },
  {
    title: "Kasa",
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
    title: "Ayarlar",
    icon: <Settings size={20} />,
    color: "text-[#1E3A5F] bg-[#1E3A5F]/10",
    items: [
      { label: "Kullanıcılar", href: "/dashboard/yonetim/kullanicilar", icon: <Users size={16} /> },
      { label: "Firmalar", href: "/dashboard/yonetim/firmalar", icon: <Building2 size={16} /> },
      { label: "İş Deneyim Belgeleri", href: "/dashboard/yonetim/santiyeler", icon: <HardHat size={16} /> },
      { label: "Bizden Haberler", href: "/dashboard/yonetim/haberler", icon: <Newspaper size={16} />, moduleKey: "yonetim-haberler" },
      { label: "Personeller", href: "/dashboard/yonetim/personel", icon: <UserCog size={16} /> },
      { label: "Araçlar", href: "/dashboard/yonetim/araclar", icon: <Truck size={16} /> },
      { label: "Yi-ÜFE", href: "/dashboard/yonetim/yi-ufe", icon: <TrendingUp size={16} /> },
      { label: "Tanımlamalar", href: "/dashboard/yonetim/tanimlamalar", icon: <Settings size={16} /> },
      { label: "Veri Yedeği", href: "/dashboard/yedek", icon: <Database size={16} /> },
      { label: "Hakkında", href: "/dashboard/yonetim/hakkinda", icon: <Info size={16} /> },
    ],
  },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { hasPermission, isYonetici } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    menuGroups.forEach((g) => { initial[g.title] = false; });
    return initial;
  });

  // Dashboard ana sayfasına gelindiğinde tüm alt menüleri kapat
  useEffect(() => {
    if (pathname === "/dashboard") {
      setOpenGroups((p) => {
        const reset: Record<string, boolean> = {};
        for (const k of Object.keys(p)) reset[k] = false;
        return reset;
      });
    }
  }, [pathname]);

  // Okunmamış e-tebligat rozeti. Yetkisi olmayana sayım sorgusu bile atılmaz.
  const tebligatYetki = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");
  const okunmamisTebligat = useOkunmamisTebligat(tebligatYetki);
  // href → rozet sayısı. Başka ekranlara rozet gerekirse buraya eklenir.
  const rozetler: Record<string, number> = {
    "/dashboard/yazismalar/e-tebligat": okunmamisTebligat,
  };

  function canView(item: MenuItem): boolean {
    // "Hakkında" HERKESE açık: sistemin ne olduğunu anlatan bilgi sayfası, veri içermiyor.
    if (item.href === "/dashboard/yonetim/hakkinda") return true;
    // "Veri Yedeği" ve "Maliyet Raporu" SADECE yöneticiye açık — izin matrisinde tanımlı değil.
    if (item.href === "/dashboard/yedek") return isYonetici;
    if (item.href === "/dashboard/maliyet-raporu") return isYonetici;
    // moduleKey verilmişse onu kullan (ör. Ödeme Planı — kasa-defteri sayfasının sekmesi ama izni ayrı modül).
    const key = item.moduleKey ?? hrefToModuleKey(item.href);
    return hasPermission(key, "goruntule");
  }

  const filteredGroups = menuGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canView(i)) }))
    .filter((g) => g.items.length > 0);

  // Aktif olan grubun otomatik açılması
  const activeGroup = filteredGroups.find((g) => g.items.some((i) => pathname === i.href));

  return (
    <nav className="flex flex-col h-full bg-[#E5E9EF] border-r border-gray-300">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#cdd4dc]">
        <Link href="/dashboard" onClick={() => onNavigate?.()}>
          <div className="flex items-center justify-center">
            {/* Grup birden çok firmadan oluşuyor: logolar sırayla dönüyor (bkz. logo-donen). */}
            <LogoDonen className="h-32 w-full" araSn={5} />
          </div>
        </Link>
      </div>

      {/* Menü */}
      <div className="flex-1 overflow-y-auto py-3 px-3 scrollbar-thin">
        {filteredGroups.map((group) => {
          const isOpen = openGroups[group.title] || (activeGroup?.title === group.title && !Object.values(openGroups).some(Boolean));
          const hasActive = group.items.some((i) => pathname === i.href);
          const grupRozet = group.items.reduce((t, i) => t + (rozetler[i.href] ?? 0), 0);

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
                {/* Grup kapalıyken içindeki rozetler toplanıp burada görünür (iOS'ta
                    klasör rozeti gibi); açıkken ilgili satırın kendi rozeti yeter. */}
                {!isOpen && grupRozet > 0 && <Rozet sayi={grupRozet} baslik={`${grupRozet} okunmamış`} />}
                {isOpen
                  ? <ChevronUp size={16} className="ml-2 text-gray-400" />
                  : <ChevronDown size={16} className="ml-2 text-gray-400" />
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
                        {(rozetler[item.href] ?? 0) > 0 && (
                          <Rozet sayi={rozetler[item.href]} baslik={`${rozetler[item.href]} okunmamış tebligat`} />
                        )}
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
