// Dashboard — 8 Widget ana sayfa
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks";
import { getYiUfeVerileri } from "@/lib/supabase/queries/yi-ufe";
import { getKasaHareketleri } from "@/lib/supabase/queries/kasa";
import { getAraclar, getTumPoliceler, updateArac, getTeklifGonderimler, insertTeklifGonderim, insertAracPolice, uploadPolice } from "@/lib/supabase/queries/araclar";
import type { TeklifGonderim } from "@/lib/supabase/types";
import { getYakitAlimlarByRange, getAracYakitlarByRange, updateYakitAlim } from "@/lib/supabase/queries/yakit";
import { getGidenEvraklar, updateGidenEvrak } from "@/lib/supabase/queries/giden-evrak";
import { getSantiyelerBasic } from "@/lib/supabase/queries/santiyeler";
import { getPersoneller } from "@/lib/supabase/queries/personel";
import { getDegerler, getTumTanimlamalar, unpackAcenteKisaAd } from "@/lib/supabase/queries/tanimlamalar";
import { createClient } from "@/lib/supabase/client";
import type { AracWithRelations, AracPolice, KasaHareketi, PersonelWithRelations } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  TrendingUp, Wallet, Shield, Fuel, FileText, NotebookPen, AlertTriangle, CheckCircle2, Pencil, Eye, MapPin, Calendar, User,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import jsPDF from "jspdf";
import toast from "react-hot-toast";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

type SantiyeBasic = { id: string; is_adi: string; durum: string };
type YiUfe = { id: string; yil: number; ay: number; endeks: number; created_at: string };
type YakitAlim = { id: string; santiye_id: string; tarih: string; saat: string; tedarikci_firma: string | null; miktar_lt: number; birim_fiyat: number; notu: string | null };
type AracYakit = { id: string; arac_id: string; santiye_id: string; tarih: string; miktar_lt: number };
type GidenEvrak = { id: string; evrak_tarihi: string; evrak_kayit_no: string | null; konu: string | null; muhatap: string | null; firma_id: string | null; santiye_id: string | null; olusturan_id: string | null; firmalar?: { firma_adi: string } | null; santiyeler?: { is_adi: string } | null };
type DefterOzet = { santiye_id: string; santiye_adi: string; tarih: string; kayit_sayisi: number };
type DefterDetay = {
  santiye_id: string;
  santiye_adi: string;
  gunler: { tarih: string; hava: string; sayfaNo: number; kayitlar: { yazan: string; icerik: string }[] }[];
};

const AY_ADLARI = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

function formatSayi(n: number, d = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
}

function CardHeader({ icon: Icon, title, color = "text-[#1E3A5F]" }: { icon: typeof TrendingUp; title: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b">
      <Icon size={18} className={color} />
      <h3 className={`font-bold text-sm ${color}`}>{title}</h3>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { kullanici, isYonetici } = useAuth();
  const [loading, setLoading] = useState(true);
  const [defterLoading, setDefterLoading] = useState(true);

  const [yiUfeData, setYiUfeData] = useState<YiUfe[]>([]);
  const [kasaData, setKasaData] = useState<KasaHareketi[]>([]);
  const [personeller, setPersoneller] = useState<PersonelWithRelations[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  const [teklifGonderimler, setTeklifGonderimler] = useState<TeklifGonderim[]>([]);
  const [yakitAlimlar, setYakitAlimlar] = useState<YakitAlim[]>([]);
  const [yakitDagitimlar, setYakitDagitimlar] = useState<AracYakit[]>([]);
  const [gidenEvraklar, setGidenEvraklar] = useState<GidenEvrak[]>([]);
  const [kullaniciAdlari, setKullaniciAdlari] = useState<Map<string, string>>(new Map());
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [defterOzetler, setDefterOzetler] = useState<DefterOzet[]>([]);
  const [defterDetaylar, setDefterDetaylar] = useState<DefterDetay[]>([]);
  const [yaklasirGun, setYaklasirGun] = useState(30);
  const [editEvrakId, setEditEvrakId] = useState<string | null>(null);
  const [editSigortaKey, setEditSigortaKey] = useState<string | null>(null);

  // Poliçe dialog
  const [sigortaFirmalari, setSigortaFirmalari] = useState<string[]>([]);
  const [sigortaAcenteler, setSigortaAcenteler] = useState<string[]>([]);
  const [policeDialogOpen, setPoliceDialogOpen] = useState(false);
  const [policeAracId, setPoliceAracId] = useState("");
  const [pTip, setPTip] = useState<"kasko" | "trafik">("trafik");
  const [pTutar, setPTutar] = useState("");
  const [pFirma, setPFirma] = useState("");
  const [pAcente, setPAcente] = useState("");
  const [pIslemTarih, setPIslemTarih] = useState(() => new Date().toISOString().slice(0, 10));
  const [pBaslangicTarih, setPBaslangicTarih] = useState("");
  const [pBitisTarih, setPBitisTarih] = useState("");
  const [pPoliceNo, setPPoliceNo] = useState("");
  const [pDosya, setPDosya] = useState<File | null>(null);
  const [policeSaving, setPoliceSaving] = useState(false);

  // Teklif İste dialog
  const [teklifDialogOpen, setTeklifDialogOpen] = useState(false);
  const [teklifArac, setTeklifArac] = useState<{ aracId: string; plaka: string; tip: string; firmaId: string | null; ruhsatUrl: string | null } | null>(null);
  const [acenteListesi, setAcenteListesi] = useState<{ id: string; ad: string; eposta: string }[]>([]);
  const [seciliAcenteler, setSeciliAcenteler] = useState<Set<string>>(new Set());
  const [teklifEkBilgi, setTeklifEkBilgi] = useState("");
  const [teklifGonderiliyor, setTeklifGonderiliyor] = useState(false);
  const [editEvrakNo, setEditEvrakNo] = useState("");

  // Yakıt alım düzenleme
  const [editAlim, setEditAlim] = useState<YakitAlim | null>(null);
  const [eaTarih, setEaTarih] = useState("");
  const [eaTedarikci, setEaTedarikci] = useState("");
  const [eaSantiye, setEaSantiye] = useState("");
  const [eaMiktar, setEaMiktar] = useState("");
  const [eaBirimFiyat, setEaBirimFiyat] = useState("");
  const [eaNotu, setEaNotu] = useState("");
  const [eaSaving, setEaSaving] = useState(false);
  const azKaldiGun = Math.round(yaklasirGun / 3);

  const bugun = new Date();
  const ayBaslangic = `${bugun.getFullYear()}-${String(bugun.getMonth()+1).padStart(2,"0")}-01`;
  const ayBitis = `${bugun.getFullYear()}-${String(bugun.getMonth()+1).padStart(2,"0")}-${String(new Date(bugun.getFullYear(), bugun.getMonth()+1, 0).getDate()).padStart(2,"0")}`;
  const tumZamanBaslangic = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [yi, kasa, pers, arac, pol, tekGon, alim, dagitim, evrak, sant, yakGun, sfData, acData] = await Promise.all([
        getYiUfeVerileri().catch(() => []),
        getKasaHareketleri().catch(() => []),
        getPersoneller().catch(() => []),
        getAraclar().catch(() => []),
        getTumPoliceler().catch(() => []),
        getTeklifGonderimler().catch(() => []),
        getYakitAlimlarByRange(null, tumZamanBaslangic, ayBitis).catch(() => []),
        getAracYakitlarByRange(null, tumZamanBaslangic, ayBitis).catch(() => []),
        getGidenEvraklar().catch(() => []),
        getSantiyelerBasic().catch(() => []),
        getDegerler("sigorta_yaklasir_gun").catch(() => []),
        getDegerler("sigorta_firmasi").catch(() => []),
        getDegerler("sigorta_acente").catch(() => []),
      ]);
      setYiUfeData(yi as YiUfe[]);
      setKasaData(kasa as KasaHareketi[]);
      setPersoneller(pers as PersonelWithRelations[]);
      setAraclar(arac as AracWithRelations[]);
      setPoliceler(pol as AracPolice[]);
      setTeklifGonderimler(tekGon as TeklifGonderim[]);
      setYakitAlimlar(alim as YakitAlim[]);
      setYakitDagitimlar(dagitim as AracYakit[]);
      setGidenEvraklar(evrak as GidenEvrak[]);
      setSantiyeler(sant as SantiyeBasic[]);
      if (yakGun.length > 0) setYaklasirGun(parseInt(yakGun[0]) || 30);
      setSigortaFirmalari(sfData as string[]);
      setSigortaAcenteler(acData as string[]);

      // Ana veriler hazır — sayfayı göster
      setLoading(false);

      // Şantiye defteri özetleri + son 5 gün detay (arka planda)
      try {
        const supabase = createClient();
        const santMapLocal = new Map<string, string>();
        for (const s of sant as SantiyeBasic[]) santMapLocal.set(s.id, s.is_adi);

        // Kullanıcı adları
        const kulMap = new Map<string, string>();
        try {
          const res = await fetch("/api/kullanicilar/adlar");
          if (res.ok) for (const k of (await res.json()) as { id: string; ad_soyad: string }[]) kulMap.set(k.id, k.ad_soyad);
        } catch { /* sessiz */ }
        setKullaniciAdlari(kulMap);

        const { data } = await supabase
          .from("santiye_defteri")
          .select("id, santiye_id, tarih, sayfa_no, hava_durumu, sicaklik")
          .order("tarih", { ascending: false })
          .limit(200);
        if (data) {
          // Özet
          const gruplar = new Map<string, DefterOzet>();
          for (const d of data as { santiye_id: string; tarih: string }[]) {
            if (!gruplar.has(d.santiye_id)) gruplar.set(d.santiye_id, { santiye_id: d.santiye_id, santiye_adi: santMapLocal.get(d.santiye_id) ?? "—", tarih: d.tarih, kayit_sayisi: 0 });
            gruplar.get(d.santiye_id)!.kayit_sayisi++;
          }
          setDefterOzetler(Array.from(gruplar.values()).sort((a, b) => b.tarih.localeCompare(a.tarih)));

          // Detay — şantiye bazlı son 5 gün
          type RawDefter = { id: string; santiye_id: string; tarih: string; sayfa_no: number; hava_durumu: string | null; sicaklik: string | null };
          const santiyeGruplu = new Map<string, RawDefter[]>();
          for (const d of data as RawDefter[]) {
            if (!santiyeGruplu.has(d.santiye_id)) santiyeGruplu.set(d.santiye_id, []);
            santiyeGruplu.get(d.santiye_id)!.push(d);
          }

          // Tüm defter ID'lerini topla ve tek sorguda kayıtları çek
          const tumDefterIds: string[] = [];
          for (const defterler of santiyeGruplu.values()) {
            for (const df of defterler.slice(0, 5)) tumDefterIds.push(df.id);
          }

          // Tek sorgu ile tüm kayıtları çek
          const kayitMap = new Map<string, { yazan_id: string; icerik: string }[]>();
          if (tumDefterIds.length > 0) {
            const { data: tumKayitlar } = await supabase
              .from("santiye_defteri_kayit")
              .select("defter_id, yazan_id, icerik, sira")
              .in("defter_id", tumDefterIds)
              .order("sira", { ascending: true });
            if (tumKayitlar) {
              for (const k of tumKayitlar as { defter_id: string; yazan_id: string; icerik: string }[]) {
                if (!kayitMap.has(k.defter_id)) kayitMap.set(k.defter_id, []);
                const arr = kayitMap.get(k.defter_id)!;
                if (arr.length < 5) arr.push(k);
              }
            }
          }

          const detaylar: DefterDetay[] = [];
          for (const [sid, defterler] of santiyeGruplu) {
            const son5 = defterler.slice(0, 5);
            const gunler: DefterDetay["gunler"] = [];
            for (const df of son5) {
              const hava = [df.sicaklik, df.hava_durumu].filter(Boolean).join("/");
              gunler.push({
                tarih: df.tarih,
                hava,
                sayfaNo: df.sayfa_no ?? 0,
                kayitlar: (kayitMap.get(df.id) ?? []).map((k) => ({
                  yazan: kulMap.get(k.yazan_id) ?? "—",
                  icerik: k.icerik,
                })),
              });
            }
            detaylar.push({ santiye_id: sid, santiye_adi: santMapLocal.get(sid) ?? "—", gunler });
          }
          setDefterDetaylar(detaylar.sort((a, b) => a.santiye_adi.localeCompare(b.santiye_adi, "tr")));
        }
      } catch { /* sessiz */ }
      setDefterLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
      setDefterLoading(false);
    }
  }, [ayBitis, tumZamanBaslangic]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Personel map
  const persMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personeller) m.set(p.id, p.ad_soyad);
    return m;
  }, [personeller]);
  const santMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of santiyeler) m.set(s.id, s.is_adi);
    return m;
  }, [santiyeler]);

  // Widget 1: Yi-ÜFE
  const yiUfeSon = useMemo(() => {
    const sorted = [...yiUfeData].sort((a, b) => b.yil !== a.yil ? b.yil - a.yil : b.ay - a.ay);
    return { son: sorted[0] ?? null, onceki: sorted[1] ?? null };
  }, [yiUfeData]);

  // Widget 2: Kasa kullanıcı özeti — nakit bakiye tüm zamanlar (devir dahil), harcama bu ay
  const kasaOzet = useMemo(() => {
    // Tüm zamanlar kümülatif nakit bakiye (kasa defterindeki bakiye ile birebir tutar)
    const kumulatifBakiye = new Map<string, number>();
    for (const h of kasaData) {
      if (!kullaniciAdlari.has(h.personel_id)) continue;
      if (h.odeme_yontemi !== "nakit") continue;
      const prev = kumulatifBakiye.get(h.personel_id) ?? 0;
      kumulatifBakiye.set(h.personel_id, prev + (h.tip === "gelir" ? h.tutar : -h.tutar));
    }

    // Bu ay harcamalar
    const aylik = kasaData.filter((h) => h.tarih >= ayBaslangic && h.tarih <= ayBitis);
    const map = new Map<string, { gelir: number; giderNakit: number; giderKart: number }>();
    for (const h of aylik) {
      if (!kullaniciAdlari.has(h.personel_id)) continue;
      if (!map.has(h.personel_id)) map.set(h.personel_id, { gelir: 0, giderNakit: 0, giderKart: 0 });
      const e = map.get(h.personel_id)!;
      if (h.tip === "gelir") e.gelir += h.tutar;
      else if (h.odeme_yontemi === "nakit") e.giderNakit += h.tutar;
      else e.giderKart += h.tutar;
    }

    // Hem bu ay işlemi olan hem de geçmişten bakiyesi olan kullanıcıları dahil et
    const tumIds = new Set<string>([...map.keys(), ...kumulatifBakiye.keys()]);
    return Array.from(tumIds).map((pid) => {
      const v = map.get(pid) ?? { gelir: 0, giderNakit: 0, giderKart: 0 };
      return {
        personelId: pid,
        personel: kullaniciAdlari.get(pid) ?? "—",
        nakitBakiye: kumulatifBakiye.get(pid) ?? 0, // tüm zaman kümülatif (devir dahil)
        nakitHarcama: v.giderNakit,
        kartHarcama: v.giderKart,
      };
    })
    // Bu ay işlemi olmayan ve bakiyesi 0 olanları gösterme
    .filter((r) => r.nakitBakiye !== 0 || r.nakitHarcama !== 0 || r.kartHarcama !== 0)
    .sort((a, b) => a.personel.localeCompare(b.personel, "tr"));
  }, [kasaData, ayBaslangic, ayBitis, kullaniciAdlari]);

  // Widget 3: Yaklaşan sigorta/muayene + acente bilgisi
  const yaklasanlar = useMemo(() => {
    const result: { aracId: string; plaka: string; tip: string; field: string; bitis: string; kalanGun: number; acente: string; firmaId: string | null; ruhsatUrl: string | null }[] = [];
    const bugunMs = new Date().setHours(0,0,0,0);
    // Araç bazlı en güncel poliçe (bitiş tarihi en ileri olan) — acente + tarih
    const policeMap = new Map<string, { kasko: { bitis: string; acente: string } | null; trafik: { bitis: string; acente: string } | null }>();
    for (const p of policeler) {
      if (!policeMap.has(p.arac_id)) policeMap.set(p.arac_id, { kasko: null, trafik: null });
      const entry = policeMap.get(p.arac_id)!;
      if (p.police_tipi === "kasko") {
        if (!entry.kasko || (p.bitis_tarihi ?? "") > (entry.kasko.bitis ?? "")) {
          entry.kasko = { bitis: p.bitis_tarihi ?? "", acente: p.acente ?? "" };
        }
      }
      if (p.police_tipi === "trafik") {
        if (!entry.trafik || (p.bitis_tarihi ?? "") > (entry.trafik.bitis ?? "")) {
          entry.trafik = { bitis: p.bitis_tarihi ?? "", acente: p.acente ?? "" };
        }
      }
    }
    for (const a of araclar) {
      if (a.tip !== "ozmal") continue;
      if (a.durum === "trafikten_cekildi") continue;
      const pc = policeMap.get(a.id);
      // Trafik/Kasko: sadece poliçeden gelen bitiş tarihi (araç alanına fallback YOK — stale data'yı gösterme)
      const trafikBitis = pc?.trafik?.bitis || null;
      const kaskoBitis = pc?.kasko?.bitis || null;
      const fields: [string, string, string | null, string][] = [
        ["Trafik Sigorta", "trafik_sigorta_bitis", trafikBitis, pc?.trafik?.acente ?? ""],
        ["Kasko", "kasko_bitis", kaskoBitis, pc?.kasko?.acente ?? ""],
        ["Muayene", "muayene_bitis", a.muayene_bitis, ""],
        ["Taşıt Kartı", "tasit_karti_bitis", a.tasit_karti_bitis, ""],
      ];
      for (const [tip, field, tarih, acente] of fields) {
        if (!tarih) continue;
        const kalan = Math.ceil((new Date(tarih + "T00:00:00").getTime() - bugunMs) / 86400000);
        if (kalan <= yaklasirGun) {
          result.push({ aracId: a.id, plaka: a.plaka, tip, field, bitis: tarih, kalanGun: kalan, acente, firmaId: a.firma_id, ruhsatUrl: a.ruhsat_url });
        }
      }
    }
    return result.sort((a, b) => a.kalanGun - b.kalanGun).slice(0, 15);
  }, [araclar, policeler, yaklasirGun]);

  // Widget 4: Depo yakıt durumu
  const depoOzet = useMemo(() => {
    const alimMap = new Map<string, number>();
    for (const a of yakitAlimlar) alimMap.set(a.santiye_id, (alimMap.get(a.santiye_id) ?? 0) + a.miktar_lt);
    const dagitimMap = new Map<string, number>();
    for (const d of yakitDagitimlar) dagitimMap.set(d.santiye_id, (dagitimMap.get(d.santiye_id) ?? 0) + d.miktar_lt);
    const result: { santiyeId: string; santiye: string; alim: number; dagitim: number; stok: number }[] = [];
    for (const [sid, alim] of alimMap) {
      const dagitim = dagitimMap.get(sid) ?? 0;
      result.push({ santiyeId: sid, santiye: santMap.get(sid) ?? "—", alim, dagitim, stok: alim - dagitim });
    }
    return result.sort((a, b) => a.santiye.localeCompare(b.santiye, "tr"));
  }, [yakitAlimlar, yakitDagitimlar, santMap]);

  // Widget 5: Son yakıt alımları
  const sonAlimlar = useMemo(() => {
    return [...yakitAlimlar].sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 10);
  }, [yakitAlimlar]);

  // Widget 6: Eksik evrak numaraları
  const eksikEvraklar = useMemo(() => {
    return gidenEvraklar.filter((e) => !e.evrak_kayit_no || e.evrak_kayit_no.trim() === "").slice(0, 15);
  }, [gidenEvraklar]);

  function alimDuzenleAc(a: YakitAlim) {
    setEditAlim(a);
    setEaTarih(a.tarih);
    setEaTedarikci(a.tedarikci_firma ?? "");
    setEaSantiye(a.santiye_id);
    setEaMiktar(String(a.miktar_lt));
    setEaBirimFiyat(String(a.birim_fiyat).replace(".", ","));
    setEaNotu(a.notu ?? "");
  }

  async function alimDuzenleKaydet() {
    if (!editAlim) return;
    setEaSaving(true);
    try {
      await updateYakitAlim(editAlim.id, {
        santiye_id: eaSantiye,
        tarih: eaTarih,
        tedarikci_firma: eaTedarikci,
        miktar_lt: parseFloat(eaMiktar) || 0,
        birim_fiyat: parseParaInput(eaBirimFiyat) || 0,
        notu: eaNotu || null,
      });
      setEditAlim(null);
      await loadAll();
      toast.success("Yakıt alımı güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEaSaving(false);
    }
  }

  // Şantiye defteri PDF ön izleme
  function defterPdfOnizle(santiyeAdi: string, gun: DefterDetay["gunler"][0]) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const mx = 15;
    const contentW = pw - mx * 2;

    // Başlık
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(tr("SANTIYE GUNLUK DEFTERI"), pw / 2, 18, { align: "center" });
    // Şantiye adı — başlık altında
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(tr(santiyeAdi), pw / 2, 23, { align: "center" });
    doc.setLineWidth(0.5); doc.line(mx, 26, pw - mx, 26);

    // Üst bilgi
    const infoY = 29;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.rect(mx, infoY, contentW, 8);
    doc.line(mx + 40, infoY, mx + 40, infoY + 8);
    doc.line(mx + contentW * 0.65, infoY, mx + contentW * 0.65, infoY + 8);
    doc.text(tr("TARIH ve GUN"), mx + 3, infoY + 5.5);
    doc.setFont("helvetica", "normal");
    const d = new Date(gun.tarih + "T00:00:00");
    const gunAdi = ["Pazar","Pazartesi","Sali","Carsamba","Persembe","Cuma","Cumartesi"][d.getDay()];
    doc.text(`${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()} ${gunAdi}`, mx + 43, infoY + 5.5);
    doc.setFont("helvetica", "bold");
    doc.text(`SAYFA NO : ${gun.sayfaNo || "-"}`, mx + contentW * 0.65 + 3, infoY + 5.5);

    doc.rect(mx, infoY + 8, contentW, 8);
    doc.line(mx + 40, infoY + 8, mx + 40, infoY + 16);
    doc.text("HAVA DURUMU", mx + 3, infoY + 13.5);
    doc.setFont("helvetica", "normal");
    doc.text(tr(gun.hava || "-"), mx + 43, infoY + 13.5);

    // İçerik alanı
    const icerikY = infoY + 19;
    const icerikH = ph - icerikY - 35;
    doc.rect(mx, icerikY, contentW, icerikH);
    const satirH = 6;
    const satirSayisi = Math.floor(icerikH / satirH);
    for (let i = 1; i < satirSayisi; i++) {
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
      doc.line(mx + 2, icerikY + i * satirH, pw - mx - 2, icerikY + i * satirH);
    }
    doc.setDrawColor(0, 0, 0);

    // Kayıtlar
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    let cl = 0;
    for (const kayit of gun.kayitlar) {
      const lines = doc.splitTextToSize(`• ${tr(kayit.icerik)}`, contentW - 8) as string[];
      for (const line of lines) {
        if (cl >= satirSayisi - 1) break;
        doc.text(line, mx + 4, icerikY + (cl + 1) * satirH - 1.5); cl++;
      }
      if (cl < satirSayisi - 1 && kayit.yazan) {
        doc.setFont("helvetica", "italic");
        doc.text(`- ${tr(kayit.yazan)}`, pw - mx - 4, icerikY + (cl + 1) * satirH - 1.5, { align: "right" });
        doc.setFont("helvetica", "normal"); cl++;
      }
    }

    // İmza kutuları
    const imzaY = ph - 30; doc.setLineWidth(0.5);
    const bw = contentW / 3;
    doc.rect(mx, imzaY, bw, 20); doc.rect(mx + bw, imzaY, bw, 20); doc.rect(mx + bw * 2, imzaY, bw, 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(tr("SANTIYE SEFI"), mx + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("MUTEAHHIT"), mx + bw + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("KONTROL MUHENDISI"), mx + bw * 2 + bw / 2, imzaY + 4, { align: "center" });

    // Yeni sekmede aç
    const pdfBlob = doc.output("blob");
    const url = URL.createObjectURL(pdfBlob);
    window.open(url, "_blank");
  }

  function policeDialogAc(aracId: string, tip: string) {
    setPoliceAracId(aracId);
    setPTip(tip === "Kasko" ? "kasko" : "trafik");
    setPTutar(""); setPFirma(""); setPAcente("");
    setPIslemTarih(new Date().toISOString().slice(0, 10));
    setPBaslangicTarih(""); setPBitisTarih(""); setPPoliceNo(""); setPDosya(null);
    setPoliceDialogOpen(true);
  }

  async function policeKaydet() {
    if (!policeAracId) return;
    if (!pBitisTarih) { toast.error("Bitiş tarihi girin."); return; }
    setPoliceSaving(true);
    try {
      const result = await insertAracPolice({
        arac_id: policeAracId,
        police_tipi: pTip,
        tutar: parseParaInput(pTutar) || null,
        sigorta_firmasi: pFirma || null,
        acente: pAcente || null,
        islem_tarihi: pIslemTarih || null,
        baslangic_tarihi: pBaslangicTarih || null,
        bitis_tarihi: pBitisTarih,
        police_no: pPoliceNo || null,
        police_url: null,
        created_by: kullanici?.id ?? null,
      });

      if (pDosya && result.id) {
        const url = await uploadPolice(pDosya, result.id);
        const supabase = createClient();
        await supabase.from("arac_police").update({ police_url: url }).eq("id", result.id);
      }

      const updateField = pTip === "kasko" ? "kasko_bitis" : "trafik_sigorta_bitis";
      await updateArac(policeAracId, { [updateField]: pBitisTarih });

      await loadAll();
      setPoliceDialogOpen(false);
      toast.success("Poliçe kaydedildi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPoliceSaving(false);
    }
  }

  async function teklifDialogAc(y: { aracId: string; plaka: string; tip: string; firmaId: string | null; ruhsatUrl: string | null }) {
    setTeklifArac(y);
    setSeciliAcenteler(new Set());
    setTeklifEkBilgi("");
    // Acente listesini yükle
    try {
      const tum = await getTumTanimlamalar();
      const acenteler = tum
        .filter((t) => t.kategori === "sigorta_acente")
        .map((t) => {
          const info = unpackAcenteKisaAd(t.kisa_ad);
          return { id: t.id, ad: t.deger, eposta: info.eposta };
        })
        .filter((a) => a.eposta);
      setAcenteListesi(acenteler);
    } catch { setAcenteListesi([]); }
    setTeklifDialogOpen(true);
  }

  function acenteToggle(id: string) {
    setSeciliAcenteler((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function teklifGonder() {
    if (!teklifArac || seciliAcenteler.size === 0) return;
    if (!teklifArac.firmaId) { toast.error("Aracın firma kaydı yok. Araç düzenleme sayfasından firma atayın."); return; }
    setTeklifGonderiliyor(true);
    try {
      const emails = acenteListesi.filter((a) => seciliAcenteler.has(a.id)).map((a) => a.eposta);
      const policeTipi = teklifArac.tip === "Kasko" ? "kasko" : "trafik";
      const res = await fetch("/api/teklif-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acenteEmails: emails,
          plaka: teklifArac.plaka,
          policeTipi,
          ruhsatUrl: teklifArac.ruhsatUrl,
          ekBilgi: teklifEkBilgi,
          firmaId: teklifArac.firmaId,
        }),
      });
      const data = await res.json();
      console.log("Teklif mail sonucu:", JSON.stringify(data, null, 2));
      if (res.ok) {
        if (data.sonuclar) {
          for (const s of data.sonuclar) {
            if (s.basarili) {
              toast.success(`${s.email} → Gönderildi\nSMTP: ${s.hata ?? "OK"}`, { duration: 6000 });
            } else {
              toast.error(`${s.email} → HATA: ${s.hata}`, { duration: 10000 });
            }
          }
        } else {
          toast.success(data.mesaj, { duration: 5000 });
        }
        // Gönderim kaydını veritabanına yaz
        try {
          const seciliAdlar = acenteListesi.filter((a) => seciliAcenteler.has(a.id)).map((a) => a.ad);
          await insertTeklifGonderim({
            arac_id: teklifArac.aracId ?? "",
            police_tipi: policeTipi as "kasko" | "trafik",
            acente_adlari: seciliAdlar.join(", "),
            acente_emailleri: emails.join(", "),
          });
          const fresh = await getTeklifGonderimler().catch(() => []);
          setTeklifGonderimler(fresh as TeklifGonderim[]);
        } catch { /* sessiz */ }
        setTeklifDialogOpen(false);
      } else {
        toast.error(data.error || "Mail gönderilemedi", { duration: 10000 });
        console.error("Teklif mail hatası:", data);
      }
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTeklifGonderiliyor(false);
    }
  }

  async function sigortaTarihKaydet(aracId: string, field: string, value: string) {
    try {
      await updateArac(aracId, { [field]: value || null });
      setEditSigortaKey(null);
      await loadAll();
      toast.success("Tarih güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function evrakNoKaydet(evrakId: string, no: string) {
    try {
      await updateGidenEvrak(evrakId, { evrak_kayit_no: no || null });
      setEditEvrakId(null);
      // Listeyi güncelle
      setGidenEvraklar((prev) => prev.map((e) => e.id === evrakId ? { ...e, evrak_kayit_no: no || null } : e));
      toast.success("Evrak kayıt numarası güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (loading) return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-4">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className={`bg-white rounded-xl border p-4 ${i >= 4 ? "md:col-span-2 lg:col-span-4" : ""}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
              <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Widget görünürlük kontrolü: kullanıcının dashboard_widgets ayarı (boş/null = hepsi)
  const wl = kullanici?.dashboard_widgets;
  const wg = (key: string) => !wl || wl.length === 0 || wl.includes(key);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-4">Dashboard</h1>


      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Widget 1: Yi-ÜFE Endeksler */}
        {wg("yiufe") ? <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-[#1E3A5F]" />
            <h3 className="font-bold text-xs text-[#1E3A5F]">Yi-ÜFE Endeksler</h3>
          </div>
          {yiUfeSon.son ? (
            <div>
              <div className="text-xs text-gray-400 mb-1">{AY_ADLARI[(yiUfeSon.son.ay - 1)] ?? ""} {yiUfeSon.son.yil}</div>
              <div className="text-3xl font-bold text-[#1E3A5F] mb-4">{formatSayi(yiUfeSon.son.endeks)}</div>
              {yiUfeSon.onceki && (
                <>
                  <div className="border-t pt-3">
                    <div className="text-xs text-gray-400 mb-1">{AY_ADLARI[(yiUfeSon.onceki.ay - 1)] ?? ""} {yiUfeSon.onceki.yil}</div>
                    <div className="text-lg font-semibold text-gray-600 mb-3">{formatSayi(yiUfeSon.onceki.endeks)}</div>
                  </div>
                  {(() => {
                    const degisim = ((yiUfeSon.son.endeks - yiUfeSon.onceki.endeks) / yiUfeSon.onceki.endeks) * 100;
                    return (
                      <div className={`text-center py-2 rounded-lg text-sm font-bold ${degisim >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {degisim >= 0 ? "+" : ""}%{formatSayi(degisim)}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ) : <p className="text-sm text-gray-400">Veri yok</p>}
        </div> : null}

        {/* Widget 2: Kasa Defteri Personel Özeti */}
        {wg("kasa_ozet") ? <div className="bg-white rounded-lg border p-3">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={16} className="text-[#1E3A5F]" />
            <h3 className="font-bold text-xs text-[#1E3A5F]">Kasa Defteri — Kullanıcı Özeti</h3>
          </div>
          {kasaOzet.length === 0 ? <p className="text-sm text-gray-400">Bu ay işlem yok</p> : (
            <div className="max-h-[200px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader><TableRow>
                  <TableHead className="px-2 text-[10px]">Personel</TableHead>
                  <TableHead className="px-2 text-[10px] text-right">Nakit Bakiye</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {kasaOzet.map((k) => (
                    <TableRow key={k.personel} className="cursor-pointer hover:bg-blue-50"
                      onClick={() => router.push(`/dashboard/kasa-defteri?personel=${k.personelId}`)}>
                      <TableCell className="px-2">
                        <div className="font-medium text-[#1E3A5F]">{k.personel}</div>
                        <div className="text-[9px] text-gray-400 mt-0.5">
                          Nakit: {formatSayi(k.nakitHarcama)} | Kart: {formatSayi(k.kartHarcama)}
                        </div>
                      </TableCell>
                      <TableCell className={`px-2 text-right font-bold ${k.nakitBakiye < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>{formatSayi(k.nakitBakiye)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div> : null}

        {/* Widget 3: Yaklaşan Sigorta/Muayene */}
        {wg("sigorta_muayene") ? <div className="bg-white rounded-lg border p-4 lg:col-span-2">
          <CardHeader icon={Shield} title="Yaklaşan Sigorta & Muayene" color="text-amber-700" />
          {yaklasanlar.length === 0 ? <p className="text-sm text-gray-400">Yaklaşan bitiş yok</p> : (
            <div className="max-h-[200px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader><TableRow>
                  <TableHead className="px-2 text-[10px]">Plaka</TableHead>
                  <TableHead className="px-2 text-[10px]">Tip</TableHead>
                  <TableHead className="px-2 text-[10px]">Mevcut Acente</TableHead>
                  <TableHead className="px-2 text-[10px] text-center">Bitiş</TableHead>
                  <TableHead className="px-2 text-[10px] text-center">Durum</TableHead>
                  <TableHead className="px-2 text-[10px] text-center w-[60px]"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {yaklasanlar.map((y, i) => (
                    <TableRow key={`${y.plaka}-${y.tip}-${i}`}>
                      <TableCell className="px-2">
                        <div className="font-bold text-[#1E3A5F]">{y.plaka}</div>
                        {(y.tip === "Kasko" || y.tip === "Trafik Sigorta") && (() => {
                          const tipKey = y.tip === "Kasko" ? "kasko" : "trafik";
                          const gonderim = teklifGonderimler.find((g) => g.arac_id === y.aracId && g.police_tipi === tipKey);
                          if (!gonderim) return null;
                          return <div className="text-[9px] text-purple-500 truncate max-w-[120px]" title={gonderim.acente_adlari}>Teklif: {gonderim.acente_adlari}</div>;
                        })()}
                      </TableCell>
                      <TableCell className="px-2">{y.tip}</TableCell>
                      <TableCell className="px-2 text-gray-500 text-[10px]">{y.acente || "—"}</TableCell>
                      <TableCell className="px-2 text-center">
                        {(() => {
                          const key = `${y.aracId}-${y.field}`;
                          const isPolice = y.tip === "Kasko" || y.tip === "Trafik Sigorta";
                          // Kasko ve Trafik Sigorta: sadece Poliçe Gir ile girilir, tıklanarak düzenlenmez
                          if (isPolice) {
                            return <span className="text-xs">{formatTarih(y.bitis)}</span>;
                          }
                          // Muayene ve Taşıt Kartı: elle tarih girişi
                          if (editSigortaKey === key) {
                            return (
                              <div className="flex items-center gap-1">
                                <input type="date" defaultValue={y.bitis} autoFocus
                                  data-sigorta-edit={key}
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter") sigortaTarihKaydet(y.aracId, y.field, (ev.target as HTMLInputElement).value);
                                    if (ev.key === "Escape") setEditSigortaKey(null);
                                  }}
                                  onBlur={() => setEditSigortaKey(null)}
                                  className="h-6 text-[10px] border rounded px-1" />
                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => {
                                  const el = document.querySelector(`[data-sigorta-edit="${key}"]`) as HTMLInputElement | null;
                                  if (el) sigortaTarihKaydet(y.aracId, y.field, el.value);
                                }} className="text-emerald-600"><CheckCircle2 size={12} /></button>
                              </div>
                            );
                          }
                          return (
                            <button type="button" onClick={() => setEditSigortaKey(key)}
                              className="text-xs hover:underline cursor-pointer hover:text-blue-600">
                              {formatTarih(y.bitis)}
                            </button>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="px-2 text-center">
                        {y.kalanGun < 0 ? (
                          <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Süresi Geçmiş</span>
                        ) : y.kalanGun <= azKaldiGun ? (
                          <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Az Kaldı ({y.kalanGun}g)</span>
                        ) : (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Yaklaşıyor ({y.kalanGun}g)</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 text-center">
                        {(y.tip === "Trafik Sigorta" || y.tip === "Kasko") && (
                          <div className="flex items-center gap-1 justify-center">
                            <button type="button"
                              onClick={() => policeDialogAc(y.aracId, y.tip)}
                              className="inline-flex items-center gap-0.5 text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100">
                              Poliçe Gir
                            </button>
                            <button type="button"
                              onClick={() => teklifDialogAc(y)}
                              className="inline-flex items-center gap-0.5 text-[9px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100">
                              Teklif İste
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div> : null}

        {/* Widget 4: Depo Yakıt Durumu — kart tabanlı */}
        {wg("depo_yakit") ? <div className="bg-white rounded-lg border p-4 md:col-span-2 lg:col-span-4">
          <CardHeader icon={Fuel} title="Şantiye Yakıt Stokları" />
          {depoOzet.length === 0 ? <p className="text-sm text-gray-400">Depo verisi yok</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {depoOzet.map((d) => {
                const yuzde = d.alim > 0 ? Math.round((d.stok / d.alim) * 100) : 0;
                const barColor = yuzde > 60 ? "bg-emerald-500" : yuzde > 30 ? "bg-blue-500" : yuzde > 10 ? "bg-amber-500" : "bg-red-500";
                const badgeColor = yuzde > 60 ? "bg-emerald-600" : yuzde > 30 ? "bg-blue-600" : yuzde > 10 ? "bg-amber-600" : "bg-red-600";
                return (
                  <div key={d.santiye} className="bg-gray-50 rounded-lg border p-3 cursor-pointer hover:bg-blue-50 transition-colors"
                    onClick={() => router.push(`/dashboard/yakit?santiye=${d.santiyeId}`)}>
                    <div className="flex items-start gap-3">
                      <div className={`${badgeColor} text-white text-xs font-bold rounded-lg w-12 h-12 flex items-center justify-center flex-shrink-0`}>
                        {yuzde}%
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-[#1E3A5F] truncate" title={d.santiye}>{d.santiye}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {formatSayi(d.stok, 0)} Lt / {formatSayi(d.alim, 0)} Lt
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(yuzde, 100)}%` }} />
                          </div>
                          <span className="text-[9px] text-gray-400">{yuzde}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div> : null}

        {/* Widget 5: Son Yakıt Alımları */}
        {wg("son_yakit") ? <div className="bg-white rounded-lg border p-4 md:col-span-2 lg:col-span-4">
          <CardHeader icon={Fuel} title="Son Yakıt Alımları" color="text-emerald-700" />
          {sonAlimlar.length === 0 ? <p className="text-sm text-gray-400">Alım verisi yok</p> : (
            <div className="max-h-[200px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader><TableRow>
                  <TableHead className="px-2 text-[10px]">Tarih</TableHead>
                  <TableHead className="px-2 text-[10px]">Tedarikçi</TableHead>
                  <TableHead className="px-2 text-[10px]">Şantiye</TableHead>
                  <TableHead className="px-2 text-[10px] text-right">Miktar</TableHead>
                  <TableHead className="px-2 text-[10px] text-right">B.Fiyat</TableHead>
                  <TableHead className="px-2 text-[10px] text-right">Toplam</TableHead>
                  <TableHead className="px-2 text-[10px] text-center w-[40px]"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {sonAlimlar.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="px-2 whitespace-nowrap">{formatTarih(a.tarih)}</TableCell>
                      <TableCell className="px-2 truncate max-w-[100px]">{a.tedarikci_firma ?? "—"}</TableCell>
                      <TableCell className="px-2 truncate max-w-[100px]">{santMap.get(a.santiye_id) ?? "—"}</TableCell>
                      <TableCell className="px-2 text-right">{formatSayi(a.miktar_lt, 0)}</TableCell>
                      <TableCell className="px-2 text-right">{formatSayi(a.birim_fiyat)}</TableCell>
                      <TableCell className="px-2 text-right font-semibold">{formatSayi(a.miktar_lt * a.birim_fiyat)}</TableCell>
                      <TableCell className="px-2 text-center">
                        <button type="button" onClick={() => alimDuzenleAc(a)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div> : null}

        {/* Widget 6: Eksik Evrak Numaraları */}
        {wg("eksik_evrak") ? <div className="bg-white rounded-lg border p-4 md:col-span-2 lg:col-span-4">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b">
            <AlertTriangle size={18} className="text-red-600" />
            <div>
              <h3 className="font-bold text-sm text-red-600">Eksik Evrak Numaraları</h3>
              <p className="text-[10px] text-gray-400">Evrak kayıt numarası eksik — tıklayarak girin</p>
            </div>
          </div>
          {eksikEvraklar.length === 0 ? (<p className="text-sm text-gray-400">Eksik evrak yok</p>) : (
            <div>
            {/* Kişi bazlı özet */}
            <div className="flex flex-wrap gap-2 mb-3">
              {(() => {
                const kisiSayac = new Map<string, number>();
                for (const e of eksikEvraklar) {
                  const ad = (e.olusturan_id && kullaniciAdlari.get(e.olusturan_id)) || "Bilinmiyor";
                  kisiSayac.set(ad, (kisiSayac.get(ad) ?? 0) + 1);
                }
                return Array.from(kisiSayac.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([ad, sayi]) => (
                    <span key={ad} className="inline-flex items-center gap-1 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded-full px-2.5 py-0.5">
                      <User size={12} /> {ad} <span className="font-bold">{sayi} adet</span>
                    </span>
                  ));
              })()}
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader><TableRow>
                  <TableHead className="px-2 text-[10px]">Tarih</TableHead>
                  <TableHead className="px-2 text-[10px]">Konu / Muhatap</TableHead>
                  <TableHead className="px-2 text-[10px]">Firma</TableHead>
                  <TableHead className="px-2 text-[10px] text-center">Kayıt No</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {eksikEvraklar.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="px-2 whitespace-nowrap">{formatTarih(e.evrak_tarihi)}</TableCell>
                      <TableCell className="px-2">
                        <div className="truncate max-w-[150px]" title={e.konu ?? ""}>{e.konu ?? "—"}</div>
                        {e.muhatap && <div className="text-[9px] text-gray-400 truncate max-w-[150px]" title={e.muhatap}>{e.muhatap}</div>}
                      </TableCell>
                      <TableCell className="px-2 truncate max-w-[100px]" title={e.firmalar?.firma_adi ?? ""}>{e.firmalar?.firma_adi ?? "—"}</TableCell>
                      <TableCell className="px-2 text-center">
                        {editEvrakId === e.id ? (
                          <div className="flex items-center gap-1">
                            <input type="text" defaultValue={editEvrakNo} autoFocus
                              data-evrak-edit={e.id}
                              onKeyDown={(ev) => { if (ev.key === "Enter") { const val = (ev.target as HTMLInputElement).value; evrakNoKaydet(e.id, val); } if (ev.key === "Escape") setEditEvrakId(null); }}
                              className="h-6 w-20 text-[10px] border rounded px-1 text-center" />
                            <button type="button" onClick={() => {
                              const el = document.querySelector(`[data-evrak-edit="${e.id}"]`) as HTMLInputElement | null;
                              if (el) evrakNoKaydet(e.id, el.value);
                            }} className="text-emerald-600"><CheckCircle2 size={14} /></button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setEditEvrakId(e.id); setEditEvrakNo(""); }}
                            className="text-[10px] text-red-500 bg-red-50 border border-red-200 rounded px-2 py-0.5 hover:bg-red-100">
                            Numara Gir
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </div>
          )}
        </div> : null}

        {/* Widget 7: Şantiye Günlük Defteri — Son 5 Gün */}
        {wg("santiye_defteri") ? <div className="md:col-span-2 lg:col-span-4">
          <div className="flex items-center gap-2 mb-3">
            <NotebookPen size={18} className="text-[#1E3A5F]" />
            <h3 className="font-bold text-sm text-[#1E3A5F]">Şantiye Günlük Defteri (Son 5 Gün)</h3>
          </div>
          {defterLoading ? (
            <div className="bg-white rounded-lg border p-6">
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                    <div className="h-4 flex-1 bg-gray-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ) : defterDetaylar.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-400 text-sm">Defter verisi yok</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {defterDetaylar.map((det) => (
                <div key={det.santiye_id} className="bg-white rounded-lg border">
                  {/* Şantiye başlığı */}
                  <div className="px-4 py-2 border-b bg-gray-50 rounded-t-lg">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-blue-600" />
                      <span className="text-xs font-bold text-[#1E3A5F]">{det.santiye_adi}</span>
                    </div>
                  </div>
                  {/* Günler */}
                  <div className="divide-y max-h-[350px] overflow-y-auto">
                    {det.gunler.map((gun) => {
                      const d = new Date(gun.tarih + "T00:00:00");
                      const gunAdi = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"][d.getDay()];
                      const tarihStr = `${String(d.getDate()).padStart(2,"0")} ${AY_ADLARI[d.getMonth()]} ${d.getFullYear()}`;
                      return (
                        <div key={gun.tarih} className="px-4 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Calendar size={12} className="text-blue-500" />
                              <span className="text-xs font-semibold text-gray-700">{tarihStr}</span>
                            </div>
                            <button type="button" onClick={() => defterPdfOnizle(det.santiye_adi, gun)}
                              className="text-gray-300 hover:text-blue-600" title="PDF Ön İzleme"><Eye size={14} /></button>
                          </div>
                          {gun.hava && <div className="text-[10px] text-emerald-600 mb-1">{gun.hava}</div>}
                          {gun.kayitlar.map((k, ki) => (
                            <div key={ki} className="flex items-start gap-1 mt-1">
                              <User size={10} className="text-orange-500 mt-0.5 flex-shrink-0" />
                              <div className="text-[10px]">
                                <span className="font-semibold text-orange-600">{k.yazan}</span>
                                <span className="text-gray-500"> — {k.icerik.length > 80 ? k.icerik.substring(0, 80) + "..." : k.icerik}</span>
                              </div>
                            </div>
                          ))}
                          {gun.kayitlar.length === 0 && <div className="text-[10px] text-gray-300 italic">Kayıt yok</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div> : null}

      </div>

      {/* Yakıt Alım Düzenleme Dialog */}
      <Dialog open={!!editAlim} onOpenChange={(o) => !o && setEditAlim(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Yakıt Alımı Düzenle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Tarih</Label>
              <input type="date" value={eaTarih} onChange={(e) => setEaTarih(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tedarikçi Firma</Label>
              <input type="text" value={eaTedarikci} onChange={(e) => setEaTedarikci(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Şantiye</Label>
              <select value={eaSantiye} onChange={(e) => setEaSantiye(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none">
                <option value="">Seçiniz</option>
                {santiyeler.map((s) => <option key={s.id} value={s.id}>{s.is_adi}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Miktar (Lt)</Label>
                <input type="number" value={eaMiktar} onChange={(e) => setEaMiktar(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Birim Fiyat (TL)</Label>
                <input type="text" inputMode="decimal" value={eaBirimFiyat} onChange={(e) => setEaBirimFiyat(formatParaInput(e.target.value))}
                  className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not</Label>
              <input type="text" value={eaNotu} onChange={(e) => setEaNotu(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditAlim(null)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={alimDuzenleKaydet} disabled={eaSaving}>
                {eaSaving ? "Kaydediliyor..." : "Güncelle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Poliçe Ekle Dialog */}
      <Dialog open={policeDialogOpen} onOpenChange={setPoliceDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Poliçe Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Tipi <span className="text-red-500">*</span></Label>
              <select value={pTip} onChange={(e) => setPTip(e.target.value as "kasko" | "trafik")} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]">
                <option value="trafik">Trafik Sigortası</option>
                <option value="kasko">Kasko</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tutar (TL)</Label>
              <input type="text" inputMode="decimal" value={pTutar} onChange={(e) => setPTutar(formatParaInput(e.target.value))}
                placeholder="0,00" className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sigorta Firması</Label>
              <select value={pFirma} onChange={(e) => setPFirma(e.target.value)} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]">
                <option value="">Seçiniz</option>
                {sigortaFirmalari.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acente</Label>
              <select value={pAcente} onChange={(e) => setPAcente(e.target.value)} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]">
                <option value="">Seçiniz</option>
                {sigortaAcenteler.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">İşlem Tarihi (Veri giriş tarihi)</Label>
              <input type="date" value={pIslemTarih} onChange={(e) => setPIslemTarih(e.target.value)} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Başlangıç Tarihi <span className="text-red-500">*</span></Label>
                <input type="date" value={pBaslangicTarih} onChange={(e) => setPBaslangicTarih(e.target.value)} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bitiş Tarihi <span className="text-red-500">*</span></Label>
                <input type="date" value={pBitisTarih} onChange={(e) => setPBitisTarih(e.target.value)} className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Numarası</Label>
              <input type="text" value={pPoliceNo} onChange={(e) => setPPoliceNo(e.target.value)} placeholder="Poliçe No"
                className="w-full h-8 text-xs border rounded px-2 outline-none focus:border-[#1E3A5F]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe PDF</Label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setPDosya(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setPoliceDialogOpen(false)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={policeKaydet} disabled={policeSaving}>
                {policeSaving ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Teklif İste Dialog */}
      <Dialog open={teklifDialogOpen} onOpenChange={setTeklifDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Teklif İste — {teklifArac?.plaka} {teklifArac?.tip}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Acente Listesi */}
            <div>
              <Label className="text-xs font-semibold mb-2 block">
                Acente Listesi <span className="text-red-500">*</span>
                <span className="text-gray-400 font-normal ml-2">{seciliAcenteler.size} seçili</span>
              </Label>
              {acenteListesi.length === 0 ? (
                <p className="text-sm text-gray-400">E-posta adresi olan acente bulunamadı. Tanımlamalardan acente ekleyin.</p>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto border rounded-lg p-2">
                  {acenteListesi.map((a) => (
                    <label key={a.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={seciliAcenteler.has(a.id)}
                        onChange={() => acenteToggle(a.id)}
                        className="rounded border-gray-300" />
                      <div className="flex-1">
                        <div className="text-xs font-semibold">{a.ad}</div>
                      </div>
                      <span className="text-[10px] text-gray-400">{a.eposta}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Ek Bilgi */}
            <div>
              <Label className="text-xs font-semibold mb-1 block">Ek Bilgi / Not (Opsiyonel)</Label>
              <textarea value={teklifEkBilgi} onChange={(e) => setTeklifEkBilgi(e.target.value)}
                placeholder="Mail içeriğine eklemek istediğiniz notu buraya yazabilirsiniz..."
                rows={3} className="w-full text-sm border rounded-lg px-3 py-2 outline-none focus:border-[#1E3A5F]" />
              <p className="text-[9px] text-gray-400 mt-1">* Yazacağınız not &quot;teklif çalışmasının yapılmasını rica ederiz.&quot; cümlesinin altına eklenecektir.</p>
            </div>

            {/* Butonlar */}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setTeklifDialogOpen(false)}>Vazgeç</Button>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={teklifGonder}
                disabled={teklifGonderiliyor || seciliAcenteler.size === 0}>
                {teklifGonderiliyor ? "Gönderiliyor..." : `Seçili Acentelere Gönder (${seciliAcenteler.size})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
