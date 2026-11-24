// BAKIM / TAMİRAT / YEDEK PARÇA FORMU — ortak pencere.
//
// NEDEN AYRI BİLEŞEN: Form Araç Bakım sayfasının içindeydi; ana ekrandaki "Yaklaşan Araç
// Bakımları" kutusundan kayıt açmak için sayfayı DEĞİŞTİRMEK gerekiyordu. Artık iki yer de
// AYNI formu kullanıyor — kopya yok, bir yerde düzeltilen her şey ikisinde de geçerli.
//
// Veri DIŞARIDAN gelir (araçlar, personeller): iki sayfa da bunları zaten yüklüyor,
// bileşen aynı sorguları ikinci kez yapmasın.
//
// Kaydedildikten sonra çağıran taraf kendi listesini tazeler (onKaydedildi).
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  insertAracBakim, updateAracBakim, uploadBakimDosyalar,
} from "@/lib/supabase/queries/arac-bakim";
import { updateArac } from "@/lib/supabase/queries/araclar";
import { useAuth } from "@/hooks";
import type { AracBakimWithArac, AracBakimTipi, AracWithRelations } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Search } from "lucide-react";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { dosyaUrl } from "@/lib/utils/dosya-url";

/** İş makinesinde sonraki bakım varsayılanı: güncel saat + bu değer. */
const MAKINE_BAKIM_ARALIK_SAAT = 250;

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export function tipEtiket(tip: string | null | undefined): string {
  return tip === "tamirat" ? "Tamirat" : tip === "yedek_parca" ? "Yedek Parça" : "Bakım";
}

function dosyaAd(url: string): string {
  try {
    const ad = decodeURIComponent(url.split("/").pop() ?? "");
    return ad.replace(/^\d+-/, "") || "dosya";
  } catch { return "dosya"; }
}

/** Bir yıl sonrası — sonraki bakım tarihinin varsayılanı. */
function birYilSonra(tarih: string): string {
  const d = new Date(tarih + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function hataMesaji(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Yeni kayıt açılırken önden doldurulacaklar (kasa defteri bağlantısı, ana ekran sağ tık…). */
export type BakimFormAcilis = {
  tip?: AracBakimTipi;
  aracId?: string;
  tarih?: string;
  tutar?: string;
  detay?: string;
  kasaId?: string | null;
  faturaUrl?: string | null;
  odemeYapildi?: boolean;
};

type Props = {
  acik: boolean;
  onKapat: () => void;
  /** Kaydedildikten sonra çağıranın listesini tazelemesi için. */
  onKaydedildi: () => void | Promise<void>;
  araclar: AracWithRelations[];
  personeller: { id: string; ad_soyad: string; durum?: string | null }[];
  /** Servis/tamirci adı önerileri (geçmiş kayıtlardan). */
  servisOnerileri?: string[];
  /** Dolu ise DÜZENLEME; boşsa yeni kayıt. */
  duzenle?: AracBakimWithArac | null;
  /** Yeni kayıtta önden doldurulacaklar. */
  acilis?: BakimFormAcilis;
  yEkle: boolean;
  yDuzenle: boolean;
};

export default function BakimFormDialog({
  acik, onKapat, onKaydedildi, araclar, personeller, servisOnerileri = [],
  duzenle = null, acilis, yEkle, yDuzenle,
}: Props) {
  const { kullanici } = useAuth();

  const [editId, setEditId] = useState<string | null>(null);
  const [dTip, setDTip] = useState<AracBakimTipi>("bakim");
  const [dAracId, setDAracId] = useState("");
  const [dTarih, setDTarih] = useState("");
  const [dYaptiranId, setDYaptiranId] = useState("");
  const [dServisTamirci, setDServisTamirci] = useState("");
  const [dTutar, setDTutar] = useState("");
  const [dOdemeYapildi, setDOdemeYapildi] = useState(false);
  const [dOdeyenId, setDOdeyenId] = useState("");
  const [dOdeyenAdi, setDOdeyenAdi] = useState("");
  const [dKaynakKasaId, setDKaynakKasaId] = useState<string | null>(null);
  const [dKm, setDKm] = useState("");
  const [dDetay, setDDetay] = useState("");
  const [dSonrakiKm, setDSonrakiKm] = useState("");
  const [dSonrakiTarih, setDSonrakiTarih] = useState("");
  const [dFaturaYeni, setDFaturaYeni] = useState<File[]>([]);
  const [dFaturaMevcut, setDFaturaMevcut] = useState<string[]>([]);
  const [dIsFotoYeni, setDIsFotoYeni] = useState<File[]>([]);
  const [dIsFotoMevcut, setDIsFotoMevcut] = useState<string[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dAracAra, setDAracAra] = useState("");
  const [dAracAcik, setDAracAcik] = useState(false);

  // PENCERE AÇILDIĞINDA alanları kur: düzenleme kaydı varsa ondan, yoksa açılış
  // değerlerinden. Kapalıyken dokunulmaz ki kapanış sırasında alanlar boşalmasın.
  useEffect(() => {
    if (!acik) return;
    setDAracAra(""); setDAracAcik(false); setDialogLoading(false);
    if (duzenle) {
      setEditId(duzenle.id);
      setDTip((duzenle.tip ?? "bakim") as AracBakimTipi);
      setDAracId(duzenle.arac_id);
      setDTarih(duzenle.bakim_tarihi);
      setDYaptiranId(duzenle.yaptiran_id ?? "");
      setDServisTamirci(duzenle.servis_tamirci ?? "");
      setDTutar(duzenle.tutar != null ? formatParaInput(duzenle.tutar.toFixed(2).replace(".", ",")) : "");
      setDOdemeYapildi(!!duzenle.odeme_yapildi || !!duzenle.odeyen_id || !!duzenle.odeyen_adi);
      setDOdeyenId(duzenle.odeyen_id ?? "");
      setDOdeyenAdi(duzenle.odeyen_adi ?? "");
      setDKaynakKasaId(duzenle.kaynak_kasa_id ?? null);
      setDKm(duzenle.km != null ? String(duzenle.km) : "");
      setDDetay(duzenle.detay ?? "");
      setDSonrakiKm(duzenle.sonraki_bakim_km != null ? String(duzenle.sonraki_bakim_km) : "");
      setDSonrakiTarih(duzenle.sonraki_bakim_tarihi ?? "");
      setDFaturaYeni([]);
      const mevcutFatura: string[] = Array.isArray(duzenle.fatura_urls) && duzenle.fatura_urls.length > 0
        ? duzenle.fatura_urls
        : (duzenle.fatura_url ? [duzenle.fatura_url] : []);
      setDFaturaMevcut(mevcutFatura);
      setDIsFotoYeni([]);
      setDIsFotoMevcut(Array.isArray(duzenle.is_foto_urls) ? duzenle.is_foto_urls : []);
      return;
    }
    setEditId(null);
    setDTip(acilis?.tip ?? "bakim");
    setDAracId(acilis?.aracId ?? "");
    setDTarih(acilis?.tarih || new Date().toISOString().slice(0, 10));
    setDYaptiranId("");
    setDServisTamirci("");
    setDTutar(acilis?.tutar ?? "");
    setDKm("");
    setDDetay(acilis?.detay ?? "");
    setDOdemeYapildi(!!acilis?.odemeYapildi);
    setDOdeyenId(acilis?.odemeYapildi ? (kullanici?.id ?? "") : "");
    setDOdeyenAdi(acilis?.odemeYapildi ? (kullanici?.ad_soyad ?? "") : "");
    setDKaynakKasaId(acilis?.kasaId ?? null);
    setDSonrakiKm(""); setDSonrakiTarih("");
    setDFaturaYeni([]); setDFaturaMevcut(acilis?.faturaUrl ? [acilis.faturaUrl] : []);
    setDIsFotoYeni([]); setDIsFotoMevcut([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  const seciliArac = useMemo(() => araclar.find((x) => x.id === dAracId) ?? null, [dAracId, araclar]);
  const seciliAracSayacTipi = useMemo(() => (seciliArac?.sayac_tipi ?? "km") as "km" | "saat", [seciliArac]);
  const seciliAracGuncelKm = seciliArac?.guncel_gosterge ?? null;
  const ozMalAraclar = useMemo(() => araclar.filter((a) => a.tip === "ozmal"), [araclar]);
  const servisTamirciOnerileri = servisOnerileri;

  // Araç seçildiğinde mevcut km'yi araclar.guncel_gosterge'den otomatik doldur
  // (yalnızca yeni kayıt için — düzenlemede mevcut km'yi bozma).
  // ÖNEMLİ: yeni aracın km'si null/boş ise km alanı SIFIRLANIR (önceki araçtan kalan değer kalmasın).
  // İŞ MAKİNESİ (sayac_tipi="saat") → sonraki bakım = güncel saat + 250 oto-önerilir.
  useEffect(() => {
    if (!editId && seciliArac) {
      const g = seciliAracGuncelKm;
      setDKm(g != null ? String(g) : "");
      if (seciliArac.sayac_tipi === "saat" && g != null) setDSonrakiKm(String(g + MAKINE_BAKIM_ARALIK_SAAT));
    }
  }, [dAracId, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sonraki bakım durumu: geçti / yaklaştı / normal (yalnızca bakım). Eşik birime göre: saat→50, km→500.
  const sonrakiKmDurum = useMemo(() => {
    if (dTip !== "bakim") return "normal" as const;
    const sonraki = dSonrakiKm ? parseInt(dSonrakiKm.replace(/\D/g, ""), 10) : null;
    const guncel = seciliAracGuncelKm;
    if (sonraki == null || guncel == null) return "normal" as const;
    if (guncel >= sonraki) return "gecti" as const;
    const yaklasikEsik = seciliAracSayacTipi === "saat" ? 50 : 500;
    if (sonraki - guncel <= yaklasikEsik) return "yaklasti" as const;
    return "normal" as const;
  }, [dTip, dSonrakiKm, seciliAracGuncelKm, seciliAracSayacTipi]);

  // Sonraki bakım TARİHİ: düzenlemede dokunulmaz; bakımda bakım tarihinin 1 yıl sonrası
  // olarak HER değişiklikte yeniden hesaplanır; tamirat/yedek parçada temizlenir.
  useEffect(() => {
    if (editId) return;
    if (dTip !== "bakim") {
      if (dSonrakiTarih) setDSonrakiTarih("");
      return;
    }
    if (!dTarih) return;
    setDSonrakiTarih(birYilSonra(dTarih));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dTarih, dTip, editId]);

  async function kaydet() {
    if (editId ? !yDuzenle : !yEkle) { toast.error(editId ? "Düzenleme yetkiniz yok." : "Ekleme yetkiniz yok."); return; }
    if (!dAracId) { toast.error("Araç seçin."); return; }
    if (!dTarih) { toast.error("Tarih girin."); return; }
    if (!dDetay.trim()) { toast.error(dTip === "yedek_parca" ? "Alınan yedek parça zorunludur." : "Yapılan işin detayı zorunludur."); return; }
    const tutar = dTutar ? parseParaInput(dTutar) : null;
    const km = dTip === "yedek_parca" ? null : (dKm ? parseInt(dKm.replace(/\D/g, ""), 10) : null);
    const sonrakiKm = dTip === "bakim" && dSonrakiKm ? parseInt(dSonrakiKm.replace(/\D/g, ""), 10) : null;
    const sonrakiTarih = dTip === "bakim" ? (dSonrakiTarih || null) : null;
    if (tutar == null || tutar <= 0) { toast.error("Tutar zorunludur."); return; }
    if (!dServisTamirci.trim()) {
      toast.error(dTip === "yedek_parca" ? "Yedek parçacı zorunludur." : "Servis / Tamirci zorunludur.");
      return;
    }
    if (dTip === "bakim" || dTip === "tamirat") {
      if (!dYaptiranId) { toast.error("Yaptıran kişi zorunludur."); return; }
      if (!dKm.trim()) { toast.error("Mevcut km / saat zorunludur."); return; }
    }
    if (dTip === "bakim" && !dSonrakiKm.trim()) {
      toast.error("Bakım yapılacak km / saat zorunludur.");
      return;
    }
    const odemeYapildi = dOdemeYapildi;
    const odeyenId = dOdemeYapildi ? (dOdeyenId || kullanici?.id || null) : null;
    const odeyenAdi = dOdemeYapildi ? (dOdeyenAdi || kullanici?.ad_soyad || null) : null;
    const etiket = tipEtiket(dTip);

    setDialogLoading(true);
    try {
      if (editId) {
        await updateAracBakim(editId, {
          arac_id: dAracId, tip: dTip, bakim_tarihi: dTarih,
          yaptiran_id: dYaptiranId || null, yaptiran_adi: null,
          servis_tamirci: dServisTamirci.trim() || null,
          tutar, odeme_yapildi: odemeYapildi, odeyen_id: odeyenId, odeyen_adi: odeyenAdi,
          km, detay: dDetay.trim() || null,
          sonraki_bakim_km: sonrakiKm, sonraki_bakim_tarihi: sonrakiTarih,
        });
        const faturaYeniUrl = dFaturaYeni.length > 0 ? await uploadBakimDosyalar(dFaturaYeni, editId, "fatura") : [];
        const tumFatura = [...dFaturaMevcut, ...faturaYeniUrl];
        const isFotoYeniUrl = dIsFotoYeni.length > 0 ? await uploadBakimDosyalar(dIsFotoYeni, editId, "is-foto") : [];
        const tumIsFoto = [...dIsFotoMevcut, ...isFotoYeniUrl];
        await updateAracBakim(editId, {
          fatura_urls: tumFatura, fatura_url: tumFatura[0] ?? null, is_foto_urls: tumIsFoto,
        });
        toast.success(`${etiket} kaydı güncellendi.`);
      } else {
        const result = await insertAracBakim({
          arac_id: dAracId, tip: dTip, bakim_tarihi: dTarih,
          yaptiran_id: dYaptiranId || null, yaptiran_adi: null,
          servis_tamirci: dServisTamirci.trim() || null,
          tutar, odeme_yapildi: odemeYapildi, odeyen_id: odeyenId, odeyen_adi: odeyenAdi,
          km, detay: dDetay.trim() || null,
          sonraki_bakim_km: sonrakiKm, sonraki_bakim_tarihi: sonrakiTarih,
          fatura_url: dFaturaMevcut[0] ?? null,
          fatura_urls: dFaturaMevcut,
          is_foto_urls: dIsFotoMevcut,
          kaynak_kasa_id: dKaynakKasaId || null,
          created_by: kullanici?.id ?? null,
        });
        if (result.id && (dFaturaYeni.length > 0 || dIsFotoYeni.length > 0)) {
          const faturaUrls = dFaturaYeni.length > 0 ? await uploadBakimDosyalar(dFaturaYeni, result.id, "fatura") : [];
          const isFotoUrls = dIsFotoYeni.length > 0 ? await uploadBakimDosyalar(dIsFotoYeni, result.id, "is-foto") : [];
          const tumFatura = [...dFaturaMevcut, ...faturaUrls];
          const tumIsFoto = [...dIsFotoMevcut, ...isFotoUrls];
          await updateAracBakim(result.id, {
            fatura_urls: tumFatura, fatura_url: tumFatura[0] ?? null, is_foto_urls: tumIsFoto,
          });
        }
        toast.success(
          dKaynakKasaId
            ? `${etiket} kaydı eklendi. ✓ Kasa hareketine bağlandı (kasada tutar güncellenince burası da güncellenir).`
            : `${etiket} kaydı eklendi.`,
          { duration: toastSuresi(dKaynakKasaId ? 6000 : undefined) },
        );
      }
      // Aracın güncel göstergesi: yalnız girilen km mevcuttan BÜYÜKSE ilerletilir.
      // Geçmiş kayıt düzenlemek göstergeyi geri çekmesin.
      if (km != null && km > 0) {
        const aracObj = araclar.find((a) => a.id === dAracId);
        const mevcut = aracObj?.guncel_gosterge ?? 0;
        if (km > mevcut) {
          try { await updateArac(dAracId, { guncel_gosterge: km }); } catch { /* sessiz */ }
        }
      }
      await onKaydedildi();
      onKapat();
    } catch (err) {
      console.error("Bakım kaydet hatası:", err);
      const msg = hataMesaji(err);
      if (dTip === "yedek_parca" && (msg.includes("tip_check") || msg.includes("23514") || msg.includes("check constraint"))) {
        toast.error("Yedek parça için veritabanı güncellemesi gerekiyor. Lütfen SQL migrasyonunu çalıştırın (arac_bakim_tip_check).", { duration: toastSuresi(8000) });
      } else {
        toast.error(`Hata: ${msg}`, { duration: toastSuresi() });
      }
    } finally {
      setDialogLoading(false);
    }
  }

  return (
      <Dialog open={acik} onOpenChange={(o) => { if (!o) onKapat(); }}>
        <DialogContent className="max-w-xl max-h-[96vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? `${tipEtiket(dTip)} Kaydını Düzenle`
                : `Yeni ${tipEtiket(dTip)} Kaydı`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1 pb-3">
            {/* YAPILAN İŞ — bu kaydın kendisi. Aşağıdaki "sonraki bakım" kutusundan
                ayrı dursun diye kendi çerçevesinde; hangi alanın neye ait olduğu karışmasın. */}
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
              <p className="text-xs font-bold text-slate-700">Yapılan iş</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Araç <span className="text-red-500">*</span></Label>
                  {(() => {
                    // Trafikten çekildi araçlara da bakım/tamirat girilebilmeli — sadece "pasif" hariç
                    const aktifAraclar = ozMalAraclar.filter((a) => (a.durum ?? "aktif") !== "pasif");
                    const q = trAramaNormalize(dAracAra.trim());
                    const filtrelenmisAraclar = q
                      ? aktifAraclar.filter((a) => {
                          const t = trAramaNormalize([a.plaka, a.marka, a.model, a.cinsi].filter(Boolean).join(" "));
                          return t.includes(q);
                        })
                      : aktifAraclar;
                    const seciliArac = aktifAraclar.find((a) => a.id === dAracId);
                    return (
                      <div className="relative">
                        {/* Kapalı durumda görünen buton — seçili aracı gösterir, tıklayınca açılır */}
                        <button
                          type="button"
                          onClick={() => setDAracAcik((v) => !v)}
                          className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 flex items-center justify-between gap-2 text-left"
                        >
                          <span className={seciliArac ? "text-gray-900 truncate" : "text-gray-400"}>
                            {seciliArac
                              ? `${seciliArac.plaka} ${[seciliArac.marka, seciliArac.model].filter(Boolean).join(" ")}`
                              : "Araç seçiniz veya arayın..."}
                          </span>
                          <span className="text-gray-400 text-xs flex-shrink-0">{dAracAcik ? "▲" : "▼"}</span>
                        </button>

                        {/* Açıldığında backdrop + popover */}
                        {dAracAcik && (
                          <>
                            {/* Dışarı tıklayınca kapat */}
                            <div
                              className="fixed inset-0 z-[60]"
                              onClick={() => { setDAracAcik(false); setDAracAra(""); }}
                            />
                            <div className="absolute left-0 right-0 top-full mt-1 z-[61] bg-white border border-input rounded-lg shadow-lg">
                              <div className="relative p-2 border-b">
                                <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                  type="text"
                                  autoFocus
                                  value={dAracAra}
                                  onChange={(e) => setDAracAra(e.target.value)}
                                  placeholder="Plaka, marka veya cins ile ara..."
                                  className="h-8 w-full rounded border border-gray-200 bg-white pl-7 pr-8 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                                />
                                {dAracAra && (
                                  <button
                                    type="button"
                                    onClick={() => setDAracAra("")}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
                                  >✕</button>
                                )}
                              </div>
                              <div className="max-h-48 overflow-y-auto">
                                {filtrelenmisAraclar.length === 0 ? (
                                  <div className="px-3 py-3 text-xs text-gray-400 text-center">Eşleşen araç yok</div>
                                ) : (
                                  filtrelenmisAraclar.map((a) => (
                                    <button
                                      type="button"
                                      key={a.id}
                                      onClick={() => {
                                        setDAracId(a.id);
                                        setDAracAcik(false);
                                        setDAracAra("");
                                      }}
                                      className={`w-full text-left px-3 py-1.5 text-xs border-b last:border-b-0 hover:bg-blue-50 ${
                                        dAracId === a.id ? "bg-blue-100 font-semibold text-blue-900" : ""
                                      }`}
                                    >
                                      <span className="font-bold text-[#1E3A5F]">{a.plaka}</span>
                                      {" "}
                                      <span className="text-gray-600">{[a.marka, a.model].filter(Boolean).join(" ")}</span>
                                      {a.cinsi && <span className="text-gray-400 text-[10px] ml-1">({a.cinsi})</span>}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tipEtiket(dTip)} Tarihi <span className="text-red-500">*</span></Label>
                  <input type="date" value={dTarih} onChange={(e) => setDTarih(e.target.value)} className={selectClass + " w-full"} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {dTip === "yedek_parca" ? "Parçayı Alan (Personel)" : "Yaptıran (Personel)"}
                    {(dTip === "bakim" || dTip === "tamirat") && <span className="text-red-500"> *</span>}
                  </Label>
                  <select value={dYaptiranId} onChange={(e) => setDYaptiranId(e.target.value)} className={selectClass + " w-full"}>
                    <option value="">Seçiniz</option>
                    {personeller
                      .filter((p) => (p.durum ?? "aktif") === "aktif")
                      .slice()
                      .sort((a, b) => (a.ad_soyad ?? "").localeCompare(b.ad_soyad ?? "", "tr"))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.ad_soyad}</option>
                      ))}
                  </select>
                  <p className="text-[9px] text-gray-400 truncate">İşi yaptıran personel · kaydı giren: <strong>{kullanici?.ad_soyad ?? "—"}</strong></p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tutar (TL) <span className="text-red-500">*</span></Label>
                  <input
                    type="text" inputMode="decimal"
                    value={dTutar}
                    onChange={(e) => setDTutar(formatParaInput(e.target.value))}
                    placeholder="0,00"
                    className={selectClass + " w-full"}
                  />
                  {/* Tutarın altında ödeme durumu: tik işaretlenince ödemeyi yapan OTOMATİK
                      olarak işaretleyen (giriş yapan) kullanıcı olarak kaydedilir. */}
                  <label className="flex items-center gap-2 cursor-pointer mt-1.5">
                    <input type="checkbox" checked={dOdemeYapildi}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setDOdemeYapildi(true);
                          // Daha önce kayıtlı ödeyen yoksa, işaretleyen kullanıcı olarak ata.
                          if (!dOdeyenAdi) { setDOdeyenId(kullanici?.id ?? ""); setDOdeyenAdi(kullanici?.ad_soyad ?? ""); }
                        } else {
                          setDOdemeYapildi(false); setDOdeyenId(""); setDOdeyenAdi("");
                        }
                      }}
                      className="w-4 h-4 accent-emerald-600" />
                    <span className="text-[11px] font-semibold text-emerald-700">💵 Ödemesi yapıldı</span>
                  </label>
                  {dOdemeYapildi && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Ödemeyi yapan: <strong className="text-emerald-700">{dOdeyenAdi || kullanici?.ad_soyad || "—"}</strong>
                    </p>
                  )}
                </div>
              </div>

              {/* Yedek parçada km/saat alanına gerek yok.
                  Not: "Bakım yapılacak km/saat" ve "tarih" buradan ALINDI — formun en altında,
                  kendi başlığı altında duruyor. Üstteki alanların hepsi BU SEFER yapılan işle
                  ilgili; o ikisi bir sonraki adım, karışmasın. */}
              {/* Sayaç ve servis YAN YANA: ikisi de kısa alan, alt alta durunca pencere
                  boşuna uzayıp kaydırma çıkarıyordu. Yedek parçada sayaç alanı yok. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {dTip !== "yedek_parca" && (
                <div className="space-y-1">
                  <Label className="text-xs">Mevcut Km / Saat <span className="text-red-500">*</span></Label>
                  <input
                    type="text" inputMode="numeric"
                    value={dKm}
                    onChange={(e) => setDKm(e.target.value.replace(/\D/g, ""))}
                    placeholder="Örn: 120000"
                    className={selectClass + " w-full"}
                  />
                  {/* Alanın NE OLDUĞU yazsın: buraya bakımın yapıldığı gündeki sayaç girilir,
                      bugünkü değil. Birim ve aracın bildiğimiz son değeri yanında durur. */}
                  <p className="text-[9px] text-gray-400">
                    Aracın bakımının yapıldığı tarihteki Km / Saat
                    {seciliAracGuncelKm != null && (
                      <> — araç güncel: <strong>{seciliAracGuncelKm.toLocaleString("tr-TR")}</strong></>
                    )}
                  </p>
                </div>
                )}
              <div className="space-y-1">
                <Label className="text-xs">{dTip === "yedek_parca" ? "Yedek Parçacı" : "Servis / Tamirci"} <span className="text-red-500">*</span></Label>
                <input
                  type="text"
                  list="servis-tamirci-oneri"
                  value={dServisTamirci}
                  onChange={(e) => setDServisTamirci(e.target.value)}
                  placeholder="Örn: Oto Yunus, Özkan Lastik, Kamil Usta..."
                  className={selectClass + " w-full"}
                />
                <datalist id="servis-tamirci-oneri">
                  {servisTamirciOnerileri.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{dTip === "yedek_parca" ? "Alınan Yedek Parça" : "Yapılan İşin Detayı"} <span className="text-red-500">*</span></Label>
                <Textarea
                  value={dDetay}
                  onChange={(e) => setDDetay(e.target.value)}
                  placeholder={dTip === "yedek_parca"
                    ? "Filtre, ampül, lastik, balata, conta, far, akü..."
                    : "Yağ değişimi, balata, lastik rotasyonu, fren kontrolü..."}
                  rows={2}
                  className="text-sm"
                />
              </div>

              {/* DOSYA KUTULARI YAN YANA: ikisi de "bu sefer yapılan iş" belgesi.
                  Alt alta dururken form gereksiz uzuyor, Kaydet'e kadar kaydırmak gerekiyordu.
                  Dar ekranda (sm altı) yine alt alta düşer. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* FATURA dosyaları */}
                <div className="space-y-1 bg-blue-50/30 border border-blue-200 rounded-lg p-2">
                  <Label className="text-[11px] font-semibold text-blue-800">📄 Fatura / Makbuz</Label>
                  <div className="flex gap-2 items-center">
                    <label htmlFor="fatura-dosya-input" className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] rounded cursor-pointer inline-flex items-center gap-1 whitespace-nowrap">
                      📁 Dosya Seç
                    </label>
                    <input
                      id="fatura-dosya-input"
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const liste = e.target.files ? Array.from(e.target.files) : [];
                        setDFaturaYeni((prev) => [...prev, ...liste]);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </div>

                  {dFaturaMevcut.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-gray-500 font-semibold">Mevcut ({dFaturaMevcut.length})</p>
                      {dFaturaMevcut.map((u, i) => (
                        <div key={`fat-mev-${i}`} className="flex items-center justify-between gap-2 min-w-0 bg-white border border-gray-200 rounded px-2 py-1">
                          <a href={dosyaUrl(u)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 truncate min-w-0 flex-1" title={dosyaAd(u)}>
                            <Download size={11} className="flex-shrink-0" /> <span className="truncate">{dosyaAd(u)}</span>
                          </a>
                          <button type="button" onClick={() => setDFaturaMevcut((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1 flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {dFaturaYeni.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-emerald-700 font-semibold">Kaydedince yüklenecek ({dFaturaYeni.length})</p>
                      {dFaturaYeni.map((f, i) => (
                        <div key={`fat-yeni-${i}`} className="flex items-center justify-between gap-2 min-w-0 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                          <span className="text-[11px] text-emerald-800 truncate min-w-0 flex-1" title={f.name}>+ {f.name} <span className="text-gray-500">({(f.size / 1024).toFixed(0)} KB)</span></span>
                          <button type="button" onClick={() => setDFaturaYeni((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1 flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* YAPILAN İŞ — foto / PDF */}
                <div className="space-y-1 bg-amber-50/30 border border-amber-200 rounded-lg p-2">
                  <Label className="text-[11px] font-semibold text-amber-800">{dTip === "yedek_parca" ? "📷 Yedek Parça Fotoğrafı" : "🔧 Yapılan İş Foto / PDF"}</Label>
                  <div className="flex gap-2 items-center">
                    <label htmlFor="isfoto-dosya-input" className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] rounded cursor-pointer inline-flex items-center gap-1 whitespace-nowrap">
                      📁 Dosya Seç
                    </label>
                    <input
                      id="isfoto-dosya-input"
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const liste = e.target.files ? Array.from(e.target.files) : [];
                        setDIsFotoYeni((prev) => [...prev, ...liste]);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </div>

                  {dIsFotoMevcut.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-gray-500 font-semibold">Mevcut ({dIsFotoMevcut.length})</p>
                      {dIsFotoMevcut.map((u, i) => (
                        <div key={`isf-mev-${i}`} className="flex items-center justify-between gap-2 min-w-0 bg-white border border-gray-200 rounded px-2 py-1">
                          <a href={dosyaUrl(u)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-700 hover:underline flex items-center gap-1 truncate min-w-0 flex-1" title={dosyaAd(u)}>
                            <Download size={11} className="flex-shrink-0" /> <span className="truncate">{dosyaAd(u)}</span>
                          </a>
                          <button type="button" onClick={() => setDIsFotoMevcut((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1 flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {dIsFotoYeni.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-emerald-700 font-semibold">Kaydedince yüklenecek ({dIsFotoYeni.length})</p>
                      {dIsFotoYeni.map((f, i) => (
                        <div key={`isf-yeni-${i}`} className="flex items-center justify-between gap-2 min-w-0 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                          <span className="text-[11px] text-emerald-800 truncate min-w-0 flex-1" title={f.name}>+ {f.name} <span className="text-gray-500">({(f.size / 1024).toFixed(0)} KB)</span></span>
                          <button type="button" onClick={() => setDIsFotoYeni((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1 flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SONRAKİ BAKIM — formun en altında, kendi başlığı altında.
                Yukarıdaki alanların hepsi BU SEFER yapılan işi anlatıyor; buradaki iki alan
                ise bir sonraki adımı planlıyor. Ayrı durunca hangisinin ne olduğu karışmıyor. */}
            {dTip === "bakim" && (
              <div className="space-y-1.5 rounded-lg border-2 border-emerald-400 bg-emerald-50 p-2.5 shadow-sm">
                <p className="text-xs font-bold text-emerald-900">⏭ Sonraki bakım planı <span className="font-normal text-emerald-800/70">— bir sonraki adım</span></p>
                <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Bakım Yapılacak Km / Saat <span className="text-red-500">*</span></Label>
                  <input
                    type="text" inputMode="numeric"
                    value={dSonrakiKm}
                    onChange={(e) => setDSonrakiKm(e.target.value.replace(/\D/g, ""))}
                    placeholder="Örn: 130000"
                    className={
                      "h-9 rounded-lg border px-3 text-sm outline-none focus:ring-2 w-full " +
                      (sonrakiKmDurum === "gecti"
                        ? "border-red-500 bg-red-50 text-red-700 font-semibold focus:ring-red-300"
                        : sonrakiKmDurum === "yaklasti"
                        ? "border-amber-500 bg-amber-50 text-amber-800 focus:ring-amber-300"
                        : "border-input bg-white focus:border-ring focus:ring-ring/50")
                    }
                  />
                  {/* Diğer alanlarla aynı: altta ne girileceği yazar. Uyarı çıktığında
                      (geçti/yaklaştı) onun yerini uyarı alır — iki satır üst üste binmesin. */}
                  {sonrakiKmDurum !== "gecti" && sonrakiKmDurum !== "yaklasti" && (
                    <p className="text-[9px] text-gray-400">
                      Bir sonraki bakımın yapılacağı Km / Saat
                    </p>
                  )}
                  {sonrakiKmDurum === "gecti" && seciliAracGuncelKm != null && (
                    <p className="text-[10px] text-red-600 font-semibold">
                      ⚠ Bakım tarihi GEÇTİ — araç {(seciliAracGuncelKm - parseInt(dSonrakiKm.replace(/\D/g, ""), 10)).toLocaleString("tr-TR")} {seciliAracSayacTipi === "saat" ? "saat" : "km"} daha gitmiş
                    </p>
                  )}
                  {sonrakiKmDurum === "yaklasti" && seciliAracGuncelKm != null && (
                    <p className="text-[10px] text-amber-700 font-semibold">
                      ⚠ Bakıma yaklaştı — sadece {(parseInt(dSonrakiKm.replace(/\D/g, ""), 10) - seciliAracGuncelKm).toLocaleString("tr-TR")} {seciliAracSayacTipi === "saat" ? "saat" : "km"} kaldı
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bakım Yapılacak Tarih</Label>
                  <input type="date" value={dSonrakiTarih} onChange={(e) => setDSonrakiTarih(e.target.value)} className={selectClass + " w-full"} />
                  <p className="text-[9px] text-gray-400">Bakım tarihi seçilince 1 yıl sonrası atanır; km dolmazsa bu tarihte yapılır.</p>
                </div>
                </div>
              </div>
            )}

            {/* DÜĞMELER ALTTA SABİT: form uzun, pencere kendi içinde kayıyor. Eskiden
                Kaydet'e ulaşmak için en alta kadar inmek gerekiyordu. sticky + pencerenin
                p-4 dolgusunu kenarlara taşıran negatif marj → çubuk kenardan kenara oturur. */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 flex gap-2 justify-end border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-6px_10px_-8px_rgba(0,0,0,0.25)]">
              <Button variant="outline" onClick={onKapat} disabled={dialogLoading}>İptal</Button>
              <Button
                className={dTip === "tamirat" ? "bg-orange-600 hover:bg-orange-700 text-white" : dTip === "yedek_parca" ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                onClick={kaydet}
                disabled={dialogLoading}
              >
                {dialogLoading ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
}
