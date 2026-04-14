// Banka yazışmaları için Hızlı Talimat oluşturma dialog'u
// Hesap no (seçmeli), firma, kişi (TC -> isim otomatik), tutar, işlem ve muhatap
// seçildikten sonra otomatik metin üretir ve kaydeder.
"use client";

import { useState, useEffect } from "react";
import { createBankaYazisma, getBankaYazismaSayiNo } from "@/lib/supabase/queries/banka-yazismalari";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import {
  getBankaMuhataplarFull,
  getBankaHesaplariFull,
  getTalimatKisileriFull,
  createTanimlama,
  packHesapKisaAd,
} from "@/lib/supabase/queries/tanimlamalar";
import { useAuth } from "@/hooks";
import type { Firma } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Zap, Save, Plus, Eye, ArrowLeft, Printer } from "lucide-react";
import BankaYazismaOnIzleme from "@/components/shared/banka-yazisma-onizleme";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import { formatKisiAdi } from "@/lib/utils/isim";
import toast from "react-hot-toast";
import { formatParaInput } from "@/lib/utils/para-format";

const selectClass = "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
};

type MuhatapItem = { id: string; deger: string; kisa_ad: string | null };
type HesapItem = {
  id: string;
  hesap_no: string;
  muhatap_id: string | null;
  muhatap_deger: string | null;
  muhatap_kisa_ad: string | null;
  firma_id: string | null;
  firma_adi: string | null;
  firma_kisa_adi: string | null;
};
type KisiItem = { id: string; ad_soyad: string; tc_no: string | null };

// Tutarı Türkçe formata çevir: 100000 -> "100.000,00-TL"
function formatTutar(amount: number): string {
  return amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "-TL";
}

// Kişi adına yönelme eki (-a/-e) ekle
// Örn: "Murat AKKURT" -> "Murat AKKURT'a", "Ali VELİ" -> "Ali VELİ'ye"
function yonelmeEki(ad: string): string {
  const trimmed = ad.trim();
  if (!trimmed) return "";

  const vowelMap: Record<string, string> = {
    "a": "a", "A": "a", "e": "e", "E": "e",
    "ı": "ı", "I": "ı", "i": "i", "İ": "i",
    "o": "o", "O": "o", "ö": "ö", "Ö": "ö",
    "u": "u", "U": "u", "ü": "ü", "Ü": "ü",
  };

  const kelimeler = trimmed.split(/\s+/);
  const sonKelime = kelimeler[kelimeler.length - 1];

  let sonUnlu = "a";
  for (const ch of sonKelime) {
    if (vowelMap[ch]) sonUnlu = vowelMap[ch];
  }

  const sonKarakter = sonKelime.slice(-1);
  const sonKarakterUnlu = !!vowelMap[sonKarakter];

  const inceUnluler = ["e", "i", "ö", "ü"];
  const ek = inceUnluler.includes(sonUnlu) ? "e" : "a";

  return sonKarakterUnlu ? `${trimmed}'y${ek}` : `${trimmed}'${ek}`;
}

export default function HizliTalimatDialog({ open, onOpenChange, onSuccess }: Props) {
  const { kullanici } = useAuth();
  const [loading, setLoading] = useState(false);
  const [onIzleme, setOnIzleme] = useState(false);

  // Yüklenen referans verileri
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [muhataplar, setMuhataplar] = useState<MuhatapItem[]>([]);
  const [hesaplar, setHesaplar] = useState<HesapItem[]>([]);
  const [kisiler, setKisiler] = useState<KisiItem[]>([]);

  // Form alanları
  const [yaziTarihi, setYaziTarihi] = useState(new Date().toISOString().split("T")[0]);
  const [firmaId, setFirmaId] = useState("");
  const [hesapId, setHesapId] = useState("");
  const [hesapNo, setHesapNo] = useState("");
  const [muhatapId, setMuhatapId] = useState("");
  const [muhatap, setMuhatap] = useState("");
  const [kisiId, setKisiId] = useState("");
  const [tcNo, setTcNo] = useState("");
  const [adSoyad, setAdSoyad] = useState("");
  const [tutar, setTutar] = useState("");
  const [kaseDahil, setKaseDahil] = useState(true);

  // Sabit: Sadece ödeme talimatı üretilir
  const islem = "ödenmesini";
  const konuOtomatik = "Ödeme Talimatı";

  // Alt-dialog'lar (yeni hesap / yeni kişi / yeni banka muhatabı)
  const [yeniHesapOpen, setYeniHesapOpen] = useState(false);
  const [yeniHesapNo, setYeniHesapNo] = useState("");
  const [yeniHesapMuhatapId, setYeniHesapMuhatapId] = useState("");
  const [yeniHesapFirmaId, setYeniHesapFirmaId] = useState("");

  const [yeniKisiOpen, setYeniKisiOpen] = useState(false);
  const [yeniKisiAd, setYeniKisiAd] = useState("");
  const [yeniKisiTc, setYeniKisiTc] = useState("");

  // Yeni banka muhatabı (alt-alt dialog, hesap eklerken içinden)
  const [yeniBankaOpen, setYeniBankaOpen] = useState(false);
  const [yeniBankaAd, setYeniBankaAd] = useState("");
  const [yeniBankaKisaAd, setYeniBankaKisaAd] = useState("");

  // Referans verileri yükle
  const yukleReferanslar = async () => {
    try {
      const [fData, mData, hData, kData] = await Promise.all([
        getFirmalar(),
        getBankaMuhataplarFull(),
        getBankaHesaplariFull(),
        getTalimatKisileriFull(),
      ]);
      setFirmalar(fData ?? []);
      setMuhataplar(mData);
      setHesaplar(hData);
      setKisiler(kData);
    } catch { /* sessiz */ }
  };

  // Dialog açılınca formu sıfırla ve verileri yükle
  useEffect(() => {
    if (open) {
      yukleReferanslar();
      setYaziTarihi(new Date().toISOString().split("T")[0]);
      setFirmaId("");
      setHesapId("");
      setHesapNo("");
      setMuhatapId("");
      setMuhatap("");
      setKisiId("");
      setTcNo("");
      setAdSoyad("");
      setTutar("");
      setKaseDahil(true);
    }
  }, [open]);

  // Hesap seçildiğinde hesap no, muhatap (banka) VE firma otomatik dolsun
  function handleHesapChange(id: string) {
    setHesapId(id);
    if (!id) {
      setHesapNo("");
      return;
    }
    const h = hesaplar.find((x) => x.id === id);
    if (!h) return;
    setHesapNo(h.hesap_no);
    // Muhatabı otomatik seç (banka)
    if (h.muhatap_id) {
      const m = muhataplar.find((x) => x.id === h.muhatap_id);
      if (m) {
        setMuhatapId(m.id);
        setMuhatap(m.deger);
      }
    }
    // Firmayı otomatik seç
    if (h.firma_id) {
      setFirmaId(h.firma_id);
    }
  }

  // Kişi dropdown değiştiğinde ad soyad ve TC otomatik dolsun
  function handleKisiChange(id: string) {
    setKisiId(id);
    if (!id) { setAdSoyad(""); setTcNo(""); return; }
    const k = kisiler.find((x) => x.id === id);
    if (k) {
      setAdSoyad(k.ad_soyad);
      setTcNo(k.tc_no ?? "");
    }
  }

  // Yeni hesap ekle (hesap no + banka + firma birlikte)
  async function handleYeniHesap() {
    if (!yeniHesapNo.trim()) { toast.error("Hesap no boş olamaz."); return; }
    if (!yeniHesapMuhatapId) { toast.error("Banka seçilmeli."); return; }
    if (!yeniHesapFirmaId) { toast.error("Firma seçilmeli."); return; }
    try {
      const yeni = await createTanimlama({
        kategori: "banka_hesap",
        sekme: "yazismalar",
        deger: yeniHesapNo.trim(),
        kisa_ad: packHesapKisaAd(yeniHesapMuhatapId, yeniHesapFirmaId),
        sira: hesaplar.length + 1,
        aktif: true,
      });
      await yukleReferanslar();
      // Yeni eklenen hesabı otomatik seç (hesap, muhatap, firma hepsi dolar)
      setHesapId(yeni.id);
      setHesapNo(yeniHesapNo.trim());
      const m = muhataplar.find((x) => x.id === yeniHesapMuhatapId);
      if (m) {
        setMuhatapId(m.id);
        setMuhatap(m.deger);
      }
      setFirmaId(yeniHesapFirmaId);
      setYeniHesapNo("");
      setYeniHesapMuhatapId("");
      setYeniHesapFirmaId("");
      setYeniHesapOpen(false);
      toast.success("Hesap eklendi.");
    } catch { toast.error("Hesap eklenemedi."); }
  }

  // Yeni banka (muhatap) ekle
  async function handleYeniBanka() {
    if (!yeniBankaAd.trim()) { toast.error("Banka adı boş olamaz."); return; }
    try {
      const yeni = await createTanimlama({
        kategori: "banka_muhatap",
        sekme: "yazismalar",
        deger: yeniBankaAd.trim(),
        kisa_ad: yeniBankaKisaAd.trim() || null,
        sira: muhataplar.length + 1,
        aktif: true,
      });
      await yukleReferanslar();
      setYeniHesapMuhatapId(yeni.id);
      setYeniBankaAd("");
      setYeniBankaKisaAd("");
      setYeniBankaOpen(false);
      toast.success("Banka eklendi.");
    } catch { toast.error("Banka eklenemedi."); }
  }

  // Yeni kişi ekle
  async function handleYeniKisi() {
    if (!yeniKisiAd.trim()) { toast.error("Ad soyad boş olamaz."); return; }
    if (!yeniKisiTc.trim() || yeniKisiTc.trim().length !== 11) { toast.error("TC 11 haneli olmalı."); return; }
    // Ad soyadı standart formata çevir: "ahmet can kılınç" -> "Ahmet Can KILINÇ"
    const formatliAd = formatKisiAdi(yeniKisiAd);
    try {
      const yeni = await createTanimlama({
        kategori: "talimat_kisi",
        sekme: "yazismalar",
        deger: formatliAd,
        kisa_ad: yeniKisiTc.trim(),
        sira: kisiler.length + 1,
        aktif: true,
      });
      await yukleReferanslar();
      setKisiId(yeni.id);
      setAdSoyad(formatliAd);
      setTcNo(yeniKisiTc.trim());
      setYeniKisiAd("");
      setYeniKisiTc("");
      setYeniKisiOpen(false);
      toast.success("Kişi eklendi.");
    } catch { toast.error("Kişi eklenemedi."); }
  }

  const seciliFirma = firmalar.find((f) => f.id === firmaId);

  // Tutarı sayıya çevir
  const tutarSayisi = parseFloat(tutar.replace(/[^\d.,]/g, "").replace(",", "."));
  const tutarStr = !isNaN(tutarSayisi) && tutarSayisi > 0 ? formatTutar(tutarSayisi) : "[TUTAR]";

  // Otomatik üretilen metin
  const onizlemeMetni = `\t${hesapNo || "[HESAP NO]"} hesap numaralı ${seciliFirma?.firma_adi ?? "[FİRMA]"} müşteriniziz. Şirket hesabımızdan ${tcNo || "[TC]"} TC kimlik numaralı ${adSoyad ? yonelmeEki(adSoyad) : "[KİŞİ]"} ${tutarStr} ${islem} rica ederiz.`;

  async function handleKaydet() {
    if (!hesapId || !hesapNo.trim()) { toast.error("Hesap numarası seçimi zorunludur."); return; }
    if (!firmaId) { toast.error("Seçili hesaba bağlı firma bulunamadı. Tanımlamalar > Banka Hesap'tan kontrol edin."); return; }
    if (!kisiId || !adSoyad.trim() || !tcNo.trim() || tcNo.trim().length !== 11) {
      toast.error("Kişi seçimi zorunludur. Kayıtlı değilse + Kişi Ekle ile ekleyin.");
      return;
    }
    if (!tutarSayisi || tutarSayisi <= 0) { toast.error("Geçerli bir tutar giriniz."); return; }

    setLoading(true);
    try {
      const evrakSayiNo = await getBankaYazismaSayiNo(firmaId, muhatapId || null);

      await createBankaYazisma({
        evrak_tarihi: yaziTarihi,
        firma_id: firmaId,
        evrak_sayi_no: evrakSayiNo,
        konu: konuOtomatik,
        muhatap: muhatap || null,
        muhatap_id: muhatapId || null,
        ilgi_listesi: [],
        metin: onizlemeMetni,
        ekler: [],
        kase_dahil: kaseDahil,
        pdf_url: null,
        olusturan_id: kullanici?.id ?? "",
        olusturma_tarihi: new Date().toISOString(),
        silindi: false,
        silme_nedeni: null,
      });

      toast.success("Hızlı talimat kaydedildi.");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(`Kaydetme hatası: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={onIzleme ? "!w-[90vw] !max-w-none max-h-[95vh] overflow-y-auto" : "max-w-3xl max-h-[90vh] overflow-y-auto"}>
          {onIzleme ? (
            /* ==================== PDF ÖN İZLEME ==================== */
            <div className="space-y-4">
              <div className="flex items-center justify-between print:hidden">
                <Button variant="ghost" size="sm" onClick={() => setOnIzleme(false)} className="text-gray-500">
                  <ArrowLeft size={16} className="mr-1" /> Düzenlemeye Dön
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer size={16} className="mr-1" /> Yazdır / PDF İndir
                </Button>
              </div>
              <div className="evrak-print-area">
                <div className="border rounded-lg shadow-sm overflow-hidden mx-auto" style={{ width: "210mm" }}>
                  <BankaYazismaOnIzleme
                    firma={seciliFirma ?? undefined}
                    evrakTarihi={yaziTarihi}
                    evrakSayiNo=""
                    konu={konuOtomatik}
                    muhatap={muhatap}
                    ilgiListesi={[]}
                    metin={onizlemeMetni}
                    ekler={[]}
                    kaseDahil={kaseDahil}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end print:hidden">
                <Button variant="outline" onClick={() => setOnIzleme(false)}>Geri Dön</Button>
                <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleKaydet} disabled={loading}>
                  <Save size={14} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </div>
          ) : (
          /* ==================== FORM ==================== */
          <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap size={18} className="text-[#F97316]" /> Hızlı Talimat Oluştur
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* 1. Yazı Tarihi */}
            <div className="space-y-1.5">
              <Label>Yazı Tarihi <span className="text-red-500">*</span></Label>
              <Input type="date" value={yaziTarihi} onChange={(e) => setYaziTarihi(e.target.value)} disabled={loading} />
            </div>

            {/* 2. Hesap Numarası - seçilince firma + banka otomatik gelir */}
            <div className="space-y-1.5">
              <Label>Hesap Numarası <span className="text-red-500">*</span></Label>
              <div className="flex gap-2">
                <select
                  value={hesapId}
                  onChange={(e) => handleHesapChange(e.target.value)}
                  disabled={loading}
                  className={selectClass + " flex-1"}
                >
                  <option value="">Hesap seçin</option>
                  {hesaplar.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.hesap_no}
                      {h.muhatap_kisa_ad ? ` — ${h.muhatap_kisa_ad}` : h.muhatap_deger ? ` — ${tekSatirMuhatap(h.muhatap_deger)}` : ""}
                      {h.firma_kisa_adi ? ` — ${h.firma_kisa_adi}` : h.firma_adi ? ` — ${h.firma_adi}` : ""}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setYeniHesapOpen(true)} disabled={loading}>
                  <Plus size={14} className="mr-1" /> Hesap Ekle
                </Button>
              </div>
              {hesapId && (
                <p className="text-[10px] text-gray-500">
                  Firma: <span className="font-medium">{seciliFirma?.firma_adi ?? "—"}</span> · Banka: <span className="font-medium">{muhatap ? tekSatirMuhatap(muhatap) : "—"}</span>
                </p>
              )}
            </div>

            {/* 3. Kişi - seçilince TC + ad soyad otomatik gelir */}
            <div className="space-y-1.5">
              <Label>Kişi <span className="text-red-500">*</span></Label>
              <div className="flex gap-2">
                <select
                  value={kisiId}
                  onChange={(e) => handleKisiChange(e.target.value)}
                  disabled={loading}
                  className={selectClass + " flex-1"}
                >
                  <option value="">Kişi seçin</option>
                  {kisiler.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.ad_soyad}{k.tc_no ? ` - ${k.tc_no}` : ""}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setYeniKisiOpen(true)} disabled={loading}>
                  <Plus size={14} className="mr-1" /> Kişi Ekle
                </Button>
              </div>
            </div>

            {/* 4. Tutar */}
            <div className="space-y-1.5">
              <Label>Tutar (TL) <span className="text-red-500">*</span></Label>
              <Input
                type="text"
                inputMode="decimal"
                value={tutar}
                onChange={(e) => setTutar(formatParaInput(e.target.value))}
                placeholder="Örn: 100000"
                disabled={loading}
              />
              {tutar && !isNaN(tutarSayisi) && tutarSayisi > 0 && (
                <p className="text-[10px] text-gray-500 font-mono">{formatTutar(tutarSayisi)}</p>
              )}
              <p className="text-[10px] text-gray-400">
                İşlem: <span className="font-medium">Ödeme Talimatı</span> (otomatik)
              </p>
            </div>

            {/* Kaşe toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="kase-dahil-hizli"
                checked={kaseDahil}
                onChange={(e) => setKaseDahil(e.target.checked)}
                disabled={loading}
                className="h-4 w-4"
              />
              <Label htmlFor="kase-dahil-hizli" className="text-sm cursor-pointer">
                Firma kaşesini yazışmaya ekle
              </Label>
              {seciliFirma?.kase_url ? (
                <span className="text-[10px] text-green-600">(Kaşe mevcut)</span>
              ) : seciliFirma ? (
                <span className="text-[10px] text-red-500">(Firmada kaşe yok)</span>
              ) : null}
            </div>

            {/* Otomatik metin ön izlemesi */}
            <div className="space-y-1.5">
              <Label>Otomatik Oluşturulan Metin (Ön İzleme)</Label>
              <div
                className="border rounded-lg p-3 bg-gray-50 text-sm whitespace-pre-wrap"
                style={{ fontFamily: "Times New Roman, serif", lineHeight: "1.7", textAlign: "justify" }}
              >
                {onizlemeMetni}
              </div>
              <p className="text-[10px] text-gray-400">
                Yukarıdaki metin otomatik kaydedilir. Firma, banka, TC ve isim bilgileri yukarıda seçtiğiniz hesap ve kişiden otomatik alınır.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>İptal</Button>
            <Button variant="outline" onClick={() => setOnIzleme(true)} disabled={loading || !firmaId}>
              <Eye size={14} className="mr-1" /> Ön İzleme
            </Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleKaydet} disabled={loading}>
              <Save size={14} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
          </>
          )}
        </DialogContent>
      </Dialog>

      {/* Yeni Hesap Ekleme Alt-Dialog'u */}
      <Dialog open={yeniHesapOpen} onOpenChange={setYeniHesapOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Banka Hesabı</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Hesap Numarası <span className="text-red-500">*</span></Label>
              <Input value={yeniHesapNo} onChange={(e) => setYeniHesapNo(e.target.value)} placeholder="Örn: 965330" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Firma <span className="text-red-500">*</span></Label>
              <select value={yeniHesapFirmaId} onChange={(e) => setYeniHesapFirmaId(e.target.value)} className={selectClass}>
                <option value="">Firma seçin</option>
                {firmalar.filter((f) => (f.durum ?? "aktif") === "aktif").map((f) => (
                  <option key={f.id} value={f.id}>{f.firma_adi}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400">Bu hesap hangi firmaya ait?</p>
            </div>
            <div className="space-y-1.5">
              <Label>Banka <span className="text-red-500">*</span></Label>
              <div className="flex gap-2">
                <select value={yeniHesapMuhatapId} onChange={(e) => setYeniHesapMuhatapId(e.target.value)} className={selectClass + " flex-1"}>
                  <option value="">Banka seçin</option>
                  {muhataplar.map((m) => (
                    <option key={m.id} value={m.id}>
                      {tekSatirMuhatap(m.deger)}{m.kisa_ad ? ` (${m.kisa_ad})` : ""}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setYeniBankaOpen(true)}>
                  <Plus size={14} className="mr-1" /> Banka Ekle
                </Button>
              </div>
              <p className="text-[10px] text-gray-400">Banka muhatapları yalnızca banka yazışmalarında kullanılır.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYeniHesapOpen(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniHesap}>
              <Plus size={14} className="mr-1" /> Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yeni Banka (muhatap) Ekleme Alt-Alt-Dialog'u */}
      <Dialog open={yeniBankaOpen} onOpenChange={setYeniBankaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Banka Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Banka Adı (Çok Satırlı) <span className="text-red-500">*</span></Label>
              <textarea
                value={yeniBankaAd}
                onChange={(e) => setYeniBankaAd(e.target.value)}
                placeholder={"T.C.\nZiraat Bankası A.Ş.\nErbaa Şubesi\nTOKAT"}
                rows={5}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-center outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                autoFocus
              />
              <p className="text-[10px] text-gray-400">Banka yazışmalarında muhatap olarak görünecek. Her satıra bir bilgi yazın, son satır şehir olmalı.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Kısa Ad <span className="text-gray-400 text-[10px]">(Evrak sayı no için)</span></Label>
              <Input
                value={yeniBankaKisaAd}
                onChange={(e) => setYeniBankaKisaAd(e.target.value)}
                placeholder="Örn: ZRT, AKB, İŞB"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYeniBankaOpen(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniBanka}>
              <Plus size={14} className="mr-1" /> Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yeni Kişi Ekleme Alt-Dialog'u */}
      <Dialog open={yeniKisiOpen} onOpenChange={setYeniKisiOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Talimat Kişisi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Ad Soyad <span className="text-red-500">*</span></Label>
              <Input
                value={yeniKisiAd}
                onChange={(e) => setYeniKisiAd(e.target.value)}
                onBlur={(e) => setYeniKisiAd(formatKisiAdi(e.target.value))}
                placeholder="Örn: Murat AKKURT"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>TC Kimlik No <span className="text-red-500">*</span></Label>
              <Input
                value={yeniKisiTc}
                onChange={(e) => setYeniKisiTc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="11 haneli"
                maxLength={11}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYeniKisiOpen(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniKisi}>
              <Plus size={14} className="mr-1" /> Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
