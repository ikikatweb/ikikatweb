"use client";

// Ana ekran uyarısı: ŞANTİYEDE ÇALIŞILMAYAN DÖNEM BAŞLADI.
//
// Dönem şantiye kaydında "AA-GG" olarak tutulur ve her yıl tekrar eder. Uyarı tam
// BAŞLANGIÇ GÜNÜNDE çıkar (bordroda satırların gri+italik olduğu gün) ve dönem bitene
// kadar durur — ta ki kullanıcı "Anladım" diyene dek.
//
// Kimler görür: yalnız YÖNETİCİ ve ŞANTİYE YÖNETİCİSİ (kısıtlı kullanıcı görmez).
// Şantiye yöneticisine yalnız kendi şantiyeleri gösterilir.
//
// "Anladım" KULLANICI BAZLIDIR: yalnız basan kişide kaybolur, diğerleri görmeye devam
// eder. Dönem her yıl tekrar ettiği için onay anahtarına o yılki başlangıç tarihi de
// girer (…:<santiyeId>-2026-11-25) → gelecek yıl uyarı yeniden çıkar.
// Kimin ne zaman onayladığı uyari_onaylari günlüğüne yazılır (sql/uyari_onaylari.sql).
import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { filtreliSantiyeler } from "@/lib/utils/santiye-filtre";
import { aktifDonem } from "@/lib/utils/calisilmayan-donem";
import {
  getCalisilmayanDonemliSantiyeler,
  type CalisilmayanDonemRow,
} from "@/lib/supabase/queries/santiyeler";
import { uyariGizle, uyariAnahtari } from "@/lib/supabase/queries/uyari-gizle";

const UYARI_TIPI = "calisilmayan-donem";
const trTarih = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");

export default function CalisilmayanDonemHatirlatma() {
  const { kullanici, isYonetici, isShantiyeAdmin, profilYenile } = useAuth();
  const yetkili = isYonetici || isShantiyeAdmin;
  const [santiyeler, setSantiyeler] = useState<CalisilmayanDonemRow[]>([]);
  const [gizlenenler, setGizlenenler] = useState<string[]>([]);
  const [isleniyor, setIsleniyor] = useState<string | null>(null);

  useEffect(() => { setGizlenenler(kullanici?.gizlenen_uyarilar ?? []); }, [kullanici]);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setSantiyeler([]); return; }
    try {
      const veri = await getCalisilmayanDonemliSantiyeler();
      // Şantiye yöneticisi yalnız kendi işlerini görür; yönetici hepsini.
      setSantiyeler(filtreliSantiyeler(veri, kullanici));
    } catch {
      // Liste okunamazsa uyarı çıkmaz; ana ekranın geri kalanı ayakta kalsın.
      setSantiyeler([]);
    }
  }, [yetkili, kullanici]);

  useEffect(() => {
    void kontrol();
    // Gece yarısını devirince / sekmeye dönünce tazelensin: dönem bugün başlamış olabilir.
    const onFocus = () => void kontrol();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [kontrol]);

  const anladim = async (anahtar: string) => {
    setIsleniyor(anahtar);
    try {
      const { gizlenenler: yeni, kayitHatasi } = await uyariGizle(anahtar);
      setGizlenenler(yeni);
      // PROFİL TAZELENİR — YOKSA UYARI GERİ GELİR (09.11.2026). Gerekçe için
      // bkz. gecici-kabul-prim-hatirlatma; buradaki kalıp birebir aynıydı.
      await profilYenile();
      toast.success("Uyarı bu kullanıcı için kapatıldı.");
      // Onay günlüğü tutulamadıysa SÖYLE — "kim onayladı" kaydı tutuluyor sanılmasın.
      if (kayitHatasi) toast.error(`Onay kaydı tutulamadı: ${kayitHatasi}`, { duration: 8000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uyarı kapatılamadı.");
    } finally { setIsleniyor(null); }
  };

  // Bugün dönemi SÜREN işler; onay anahtarı o yılki tekrarın başlangıcını taşır.
  const kayitlar = santiyeler
    .map((s) => {
      const donem = aktifDonem(s.calisilmayan_bas, s.calisilmayan_bit);
      if (!donem) return null;
      return { ...s, ...donem, anahtar: uyariAnahtari(UYARI_TIPI, `${s.id}-${donem.basTarih}`) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .filter((x) => !gizlenenler.includes(x.anahtar));

  if (!yetkili || kayitlar.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-800 shadow-sm">
      <div className="flex items-center gap-3">
        <CalendarOff size={22} className="shrink-0 text-slate-500" />
        <div className="flex-1">
          <div className="font-semibold">
            ❄️ {kayitlar.length} şantiyede çalışılmayan dönem başladı
          </div>
          <div className="text-xs text-slate-600">
            Bu işlerde bordro satırları dönem boyunca gri gösterilir. &quot;Anladım&quot; yalnız sizde kapatır.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {kayitlar.map((k) => (
          <li key={k.anahtar} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            <span className="flex flex-1 flex-wrap items-baseline gap-x-1.5">
              <span className="font-medium text-slate-900">{k.is_adi}</span>
              <span>şantiyesinde çalışılmayan dönem</span>
              <span className="font-bold text-slate-900">{trTarih(k.basTarih)}</span>
              <span>tarihinde başladı,</span>
              <span className="font-bold text-slate-900">{trTarih(k.bitTarih)}</span>
              <span>tarihine kadar sürecek.</span>
            </span>
            <button
              type="button"
              disabled={isleniyor === k.anahtar}
              onClick={() => anladim(k.anahtar)}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-60"
              title="Bu uyarıyı kendim için kapat (bu yılki dönem boyunca)"
            ><Check size={14} /> Anladım</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
