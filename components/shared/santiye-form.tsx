// Şantiye formu bileşeni - 4 sekmeli: Genel, Sözleşme, Kabul, Depo
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  createSantiye,
  updateSantiye,
  uploadSantiyeFile,
  saveOrtaklar,
  getOrtaklar,
} from "@/lib/supabase/queries/santiyeler";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { getSantiyeIsGruplari, saveSantiyeIsGruplari } from "@/lib/supabase/queries/santiyeler";
import { upsertIscilikTakibi } from "@/lib/supabase/queries/iscilik-takibi";
import { getKullanicilar, updateKullanici } from "@/lib/supabase/queries/kullanicilar";
import { getSantiyePrimHesabi } from "@/lib/supabase/queries/prim-hesap";
import { createClient } from "@/lib/supabase/client";
import { formatBaslik } from "@/lib/utils/isim";
import type { Santiye, SantiyeInsert, Firma, Tanimlama, Kullanici } from "@/lib/supabase/types";
import { TR_ILLER } from "@/lib/tr-iller";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, X, Upload, Plus, Trash2 } from "lucide-react";
import { getDegerler, getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import toast from "react-hot-toast";

// onSuccess/onCancel verilirse: kayıt/iptal sonrası yönlendirme YAPILMAZ, callback çağrılır
// (dialog/pencere içinde kullanım için). Verilmezse eski davranış: santiyeler sayfasına gider.
type SantiyeFormProps = { santiye?: Santiye; onSuccess?: () => void; onCancel?: () => void };

type OrtakRow = { firma_id: string; oran: number; is_pilot: boolean };

// IS_GRUPLARI artık tanımlamalardan çekilecek

const selectClass =
  // min-w-0: uzun seçenekli <select> (ör. uzun firma adı) grid/flex içinde min-content ile track'i şişirip
  // kartı viewport'tan geniş yapıyordu → mobilde her şey sağa taşıp Kaydet butonu ekran dışına kayıyordu.
  "w-full min-w-0 h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap [&>option]:truncate";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatParaInput(value: number | null): string {
  if (value == null) return "";
  return value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseParaInput(value: string): number | null {
  const cleaned = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export default function SantiyeForm({ santiye, onSuccess, onCancel }: SantiyeFormProps) {
  const isEdit = !!santiye;
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  // Kullanıcı atama dialogu — yeni iş kaydı sonrası açılır, hangi kullanıcılara atanacak
  const [kullaniciDialogAcik, setKullaniciDialogAcik] = useState(false);
  const [kullaniciListesi, setKullaniciListesi] = useState<Kullanici[]>([]);
  const [seciliKullaniciIds, setSeciliKullaniciIds] = useState<Set<string>>(new Set());
  const [yeniKaydedilenSantiyeId, setYeniKaydedilenSantiyeId] = useState<string | null>(null);
  const [kullaniciAtamaYukleniyor, setKullaniciAtamaYukleniyor] = useState(false);
  // Geçici kabul prim onay dialogu — eksik prim varsa yine de onaylasın mı?
  const [primOnayDialog, setPrimOnayDialog] = useState<{
    yatmasiGereken: number;
    yatan: number;
    bordro: number;
    sonuc: number;
    resolve: (cevap: "evet" | "hayir") => void;
  } | null>(null);
  const [ortaklar, setOrtaklar] = useState<OrtakRow[]>([]);
  const [isGruplari, setIsGruplari] = useState<string[]>([]);
  const [isGrupListesi, setIsGrupListesi] = useState<string[]>([]);
  // İş grubu dağılımı (Kabul sekmesinde) — 3 kademeli seçim
  const [isGrupDagilimi, setIsGrupDagilimi] = useState<{ ana: string; alt: string; detay: string; tutar: string }[]>([]);
  const [isGrupAnaList, setIsGrupAnaList] = useState<Tanimlama[]>([]);
  const [isGrupAltList, setIsGrupAltList] = useState<Tanimlama[]>([]);
  const [isGrupDetayList, setIsGrupDetayList] = useState<Tanimlama[]>([]);
  const [isGrupDigerList, setIsGrupDigerList] = useState<Tanimlama[]>([]);
  const [depoVar, setDepoVar] = useState(
    santiye?.depo_kapasitesi != null && santiye.depo_kapasitesi > 0
  );

  // Geçici kabulü yapılmış işler tamamlandı kabul edilir.
  // Sözleşme bedeli, gerçekleşen tutar ve iş grubu dağılımı bu durumda kilitlidir.
  // (Geçici kabul tarihi/PDF, kesin kabul vb. kabul-sonrası alanlar düzenlenebilir kalır.)
  const tutarKilitli = !!santiye?.gecici_kabul_tarihi;

  // Sözleşme bedeli ayrı tutulur (formatlı gösterim)
  const [sozlesmeBedeliStr, setSozlesmeBedeliStr] = useState(
    formatParaInput(santiye?.sozlesme_bedeli ?? null)
  );

  // Keşif Artışı — iscilik_takibi tablosunda tutulur, işçilik takibi sayfasıyla ortak veri
  const [kesifArtisiStr, setKesifArtisiStr] = useState("");

  const [geciciKabulFile, setGeciciKabulFile] = useState<File | null>(null);
  const [kesinKabulFile, setKesinKabulFile] = useState<File | null>(null);
  const [isDeneyimFile, setIsDeneyimFile] = useState<File | null>(null);

  // Teknik personel listesi — yeni form: serbest metin girişi, + tuşuyla çoğaltılabilir.
  // Eski (sayı) verisi varsa: o sayı kadar boş input'la başlangıç.
  const [teknikPersonelList, setTeknikPersonelList] = useState<string[]>(() => {
    if (santiye?.teknik_personeller && santiye.teknik_personeller.length > 0) {
      return [...santiye.teknik_personeller];
    }
    const eskiSayi = santiye?.teknik_personel_sayisi ?? 0;
    if (eskiSayi > 0) {
      // Eski sayım varsa o kadar boş slot
      return Array(eskiSayi).fill("");
    }
    return [""]; // varsayılan: 1 boş input
  });

  // "Bu iş için teknik personel gerekli değil" — DB durumundan başlangıç değeri alınır:
  //   • teknik_personeller = []  (boş dizi)  → "gerek yok" TIKLI (kullanıcı kapatmış)
  //   • teknik_personeller = null/undefined  → TIK KAPALI (tanımsız / eski kayıt)
  //   • teknik_personeller = ["A", "B"]      → TIK KAPALI (isimler var)
  // Eski kod sabit `false` veriyordu, bu yüzden tik düzenleme dialog'unda kayboluyordu.
  const [teknikPersonelGerekliDegil, setTeknikPersonelGerekliDegil] = useState<boolean>(
    Array.isArray(santiye?.teknik_personeller) && santiye!.teknik_personeller!.length === 0,
  );

  const [formData, setFormData] = useState<SantiyeInsert>({
    durum: santiye?.durum ?? "aktif",
    is_adi: santiye?.is_adi ?? "",
    il: santiye?.il ?? null,
    is_grubu: santiye?.is_grubu ?? null,
    benzer_is_grubu: santiye?.benzer_is_grubu ?? null,
    ekap_belge_no: santiye?.ekap_belge_no ?? "",
    ihale_kayit_no: santiye?.ihale_kayit_no ?? "",
    ilan_tarihi: santiye?.ilan_tarihi ?? null,
    ihale_tarihi: santiye?.ihale_tarihi ?? null,
    yuklenici_firma_id: santiye?.yuklenici_firma_id ?? null,
    is_ortak_girisim: santiye?.is_ortak_girisim ?? false,
    ortaklik_orani: santiye?.ortaklik_orani ?? null,
    sozlesme_bedeli: santiye?.sozlesme_bedeli ?? null,
    para_birimi: santiye?.para_birimi ?? "TRY",
    ff_hesaplanacak: santiye?.ff_hesaplanacak ?? true,
    teknik_personel_sayisi: santiye?.teknik_personel_sayisi ?? null,
    teknik_personeller: santiye?.teknik_personeller ?? null,
    sozlesme_tarihi: santiye?.sozlesme_tarihi ?? null,
    isyeri_teslim_tarihi: santiye?.isyeri_teslim_tarihi ?? null,
    is_suresi: santiye?.is_suresi ?? null,
    is_bitim_tarihi: santiye?.is_bitim_tarihi ?? null,
    sure_uzatimlari: santiye?.sure_uzatimlari ?? [],
    sure_uzatimi: santiye?.sure_uzatimi ?? null,
    sure_uzatimli_tarih: santiye?.sure_uzatimli_tarih ?? null,
    ff_dahil_kalan_tutar: santiye?.ff_dahil_kalan_tutar ?? null,
    sozlesme_fiyatlariyla_gerceklesen: santiye?.sozlesme_fiyatlariyla_gerceklesen ?? null,
    tasfiye_tarihi: santiye?.tasfiye_tarihi ?? null,
    devir_tarihi: santiye?.devir_tarihi ?? null,
    gecici_kabul_tarihi: santiye?.gecici_kabul_tarihi ?? null,
    gecici_kabul_url: santiye?.gecici_kabul_url ?? null,
    kesin_kabul_tarihi: santiye?.kesin_kabul_tarihi ?? null,
    kesin_kabul_url: santiye?.kesin_kabul_url ?? null,
    is_deneyim_url: santiye?.is_deneyim_url ?? null,
    calisilmayan_bas: santiye?.calisilmayan_bas ?? null,
    calisilmayan_bit: santiye?.calisilmayan_bit ?? null,
    depo_kapasitesi: santiye?.depo_kapasitesi ?? null,
  });

  const loadDropdowns = useCallback(async () => {
    try {
      const [data, gruplar] = await Promise.all([
        getFirmalar(),
        getDegerler("is_tanimlari"),
      ]);
      setFirmalar(data ?? []);
      setIsGruplari(gruplar);
      // İş gruplarını yükle (3-kademeli: ana, alt, detay)
      try {
        const [anaData, altData, detayData, digerData] = await Promise.all([
          getTanimlamalar("is_gruplari_ana").catch(() => []),
          getTanimlamalar("is_gruplari_alt").catch(() => []),
          getTanimlamalar("is_gruplari_detay").catch(() => []),
          getTanimlamalar("is_gruplari_diger").catch(() => []),
        ]);
        setIsGrupAnaList(anaData as Tanimlama[]);
        setIsGrupAltList(altData as Tanimlama[]);
        setIsGrupDetayList(detayData as Tanimlama[]);
        setIsGrupDigerList(digerData as Tanimlama[]);
        // Düz liste de doldur (İş Grubu Benzer İş dropdown'u için)
        setIsGrupListesi((altData as Tanimlama[]).map((t) => `(${t.kisa_ad ?? ""}) ${t.deger}`));
      } catch {
        setIsGrupListesi([]);
      }
      // Düzenleme modunda mevcut iş grubu dağılımını yükle
      if (santiye?.id) {
        try {
          const dagilim = await getSantiyeIsGruplari(santiye.id);
          if (dagilim.length > 0) {
            setIsGrupDagilimi(dagilim.map((d) => {
              // is_grubu formatı: "(A) V. Karayolu İşleri" → parse et
              const match = d.is_grubu.match(/^\(([A-E])\)\s*(.+)$/);
              const ana = match?.[1] ?? "";
              const altDeger = match?.[2]?.trim() ?? d.is_grubu;
              const romMatch = altDeger.match(/^([IVXLCDM]+)\./);
              const detayKey = romMatch ? `${ana}-${romMatch[1]}` : "";
              return { ana, alt: altDeger, detay: "", tutar: String(d.tutar) };
            }));
          }
        } catch { /* sessiz */ }
      }
    } catch { /* sessiz */ }

    if (isEdit && santiye) {
      try {
        const ortakData = await getOrtaklar(santiye.id);
        if (ortakData && ortakData.length > 0) {
          setOrtaklar(ortakData.map((o) => ({
            firma_id: o.firma_id,
            oran: o.oran,
            is_pilot: o.is_pilot,
          })));
        }
      } catch { /* sessiz */ }
    }
  }, [isEdit, santiye]);

  useEffect(() => { loadDropdowns(); }, [loadDropdowns]);

  // Edit modunda iscilik_takibi kaydından kesif_artisi değerini yükle
  useEffect(() => {
    if (!isEdit || !santiye?.id) return;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("iscilik_takibi")
          .select("kesif_artisi")
          .eq("santiye_id", santiye.id)
          .maybeSingle();
        if (data?.kesif_artisi != null) {
          setKesifArtisiStr(formatParaInput(data.kesif_artisi));
        }
      } catch { /* sessiz */ }
    })();
  }, [isEdit, santiye?.id]);

  // İş süresi değişince iş bitim tarihini hesapla
  useEffect(() => {
    if (formData.isyeri_teslim_tarihi && formData.is_suresi && formData.is_suresi > 0) {
      const bitim = addDays(formData.isyeri_teslim_tarihi, formData.is_suresi);
      setFormData((prev) => ({ ...prev, is_bitim_tarihi: bitim }));
    }
  }, [formData.isyeri_teslim_tarihi, formData.is_suresi]);

  // Süre uzatımları toplamı değişince süre uzatımlı tarihi ve toplam gün hesapla
  useEffect(() => {
    const toplam = formData.sure_uzatimlari.reduce((a, b) => a + (b || 0), 0);
    if (formData.is_bitim_tarihi && toplam > 0) {
      const uzatimli = addDays(formData.is_bitim_tarihi, toplam);
      setFormData((prev) => ({ ...prev, sure_uzatimi: toplam, sure_uzatimli_tarih: uzatimli }));
    } else if (toplam === 0) {
      setFormData((prev) => ({ ...prev, sure_uzatimi: null, sure_uzatimli_tarih: null }));
    }
  }, [formData.is_bitim_tarihi, formData.sure_uzatimlari]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    const numericFields = ["ortaklik_orani", "depo_kapasitesi", "is_suresi", "sure_uzatimi"];
    setFormData((prev) => ({
      ...prev,
      [name]: numericFields.includes(name)
        ? value ? parseFloat(value) : null
        : value || null,
    }));
  }

  function handleSelectChange(name: string, value: string) {
    setFormData((prev) => ({ ...prev, [name]: value === "" ? null : value }));
  }

  // Çalışılmayan dönem alanı (yıl YOK, her yıl tekrar eder) → "AA-GG" gün-ay metni. Ay VEYA gün seçimi
  // KORUNUR (sıra bağımsız): gün'ü ay'dan önce seçmek günü kaybetmez. İkisi de boşsa alan null.
  function setGunAy(field: "calisilmayan_bas" | "calisilmayan_bit", ay: string, gun: string) {
    const a = ay ? ay.padStart(2, "0") : "";
    const g = gun ? gun.padStart(2, "0") : "";
    setFormData((prev) => ({ ...prev, [field]: a || g ? `${a}-${g}` : null }));
  }

  // Ortak girişim fonksiyonları
  function addOrtak() {
    setOrtaklar((prev) => [...prev, { firma_id: "", oran: 0, is_pilot: false }]);
  }
  function removeOrtak(index: number) {
    setOrtaklar((prev) => prev.filter((_, i) => i !== index));
  }
  function updateOrtak(index: number, field: keyof OrtakRow, value: string | number | boolean) {
    setOrtaklar((prev) => prev.map((o, i) => i === index ? { ...o, [field]: value } : o));
  }

  // Yüklenmiş PDF'i sil — sadece url alanını NULL yap (storage'da dosya kalır ama bağlı değil).
  // Ya da storage'dan da silmek istersek ekstra adım gerekir; şimdilik hızlı çözüm.
  async function pdfSil(field: "gecici_kabul_url" | "kesin_kabul_url" | "is_deneyim_url") {
    if (!santiye?.id) return;
    if (!confirm("Bu PDF'i silmek istediğinize emin misiniz? Yeni bir dosya yükleyebilirsiniz.")) return;
    try {
      await updateSantiye(santiye.id, { [field]: null });
      // Form state'ini de güncelle
      setFormData((prev) => ({ ...prev, [field]: null }));
      // Mevcut santiye objesini de güncellemek için (santiye prop'u mutable değil ama UI'ı yenilemek için)
      if (santiye) {
        // Bu obje read-only — sayfayı yenileyince yeni veri gelir
        (santiye as Record<string, unknown>)[field] = null;
      }
      toast.success("PDF silindi.");
    } catch (err) {
      toast.error(`Silme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.is_adi?.trim()) { toast.error("İşin adı zorunludur."); return; }
    if (!isEdit && !formData.il) { toast.error("İl seçimi zorunludur."); return; } // yeni iş deneyim belgesinde il zorunlu
    // Teknik personel listesi — eğer "gerekli değil" tikli ise atlanır, aksi halde en az 1 dolu kayıt zorunlu
    const teknikPersonellerTemiz = teknikPersonelGerekliDegil
      ? []
      : teknikPersonelList.map((s) => s.trim()).filter((s) => s.length > 0);
    if (!teknikPersonelGerekliDegil && teknikPersonellerTemiz.length === 0) {
      toast.error("En az 1 teknik personel girilmelidir veya 'Teknik personel gerekli değil' işaretlenmelidir.");
      return;
    }
    // Sözleşme ve işyeri teslim tarihi ihale tarihinden önce olamaz
    if (formData.ihale_tarihi) {
      if (formData.sozlesme_tarihi && formData.sozlesme_tarihi < formData.ihale_tarihi) {
        toast.error("Sözleşme tarihi ihale tarihinden önce olamaz.");
        return;
      }
      if (formData.isyeri_teslim_tarihi && formData.isyeri_teslim_tarihi < formData.ihale_tarihi) {
        toast.error("İşyeri teslim tarihi ihale tarihinden önce olamaz.");
        return;
      }
    }
    // İşyeri teslim tarihi sözleşme tarihinden önce olamaz
    if (formData.sozlesme_tarihi && formData.isyeri_teslim_tarihi
        && formData.isyeri_teslim_tarihi < formData.sozlesme_tarihi) {
      toast.error("İşyeri teslim tarihi sözleşme tarihinden önce olamaz.");
      return;
    }

    // Geçici Kabul Tarihi YENİ ATANMIŞSA — eksik prim varsa kullanıcıya sor (Evet/Hayır).
    // Evet'e basarsa devam, Hayır'a basarsa iptal. Sadece edit modunda + santiye id varsa.
    if (santiye?.id && formData.gecici_kabul_tarihi
        && formData.gecici_kabul_tarihi !== (santiye.gecici_kabul_tarihi ?? "")) {
      try {
        const prim = await getSantiyePrimHesabi(santiye.id);
        if (prim.sonuc > 0.01) {
          // Sayfa ortasında dialog aç → kullanıcının cevabını bekle
          const cevap = await new Promise<"evet" | "hayir">((resolve) => {
            setPrimOnayDialog({
              yatmasiGereken: prim.yatmasiGereken,
              yatan: prim.yatan,
              bordro: prim.bordroTahmini,
              sonuc: prim.sonuc,
              resolve,
            });
          });
          setPrimOnayDialog(null);
          if (cevap === "hayir") return; // iptal — kayıt yapma
          // "evet" → uyarıya rağmen kayıt yapılır, akış devam eder
        }
      } catch (err) {
        console.warn("Prim hesabı kontrolü başarısız:", err);
      }
    }

    setLoading(true);
    let basarili = false;
    let savedId: string | null = null;

    try {
      const submitData: SantiyeInsert = {
        ...formData,
        is_adi: formatBaslik(formData.is_adi),
        sozlesme_bedeli: parseParaInput(sozlesmeBedeliStr),
        depo_kapasitesi: depoVar ? formData.depo_kapasitesi : null,
        // Teknik personel listesi ve sayım birlikte güncellenir
        teknik_personeller: teknikPersonellerTemiz,
        teknik_personel_sayisi: teknikPersonellerTemiz.length,
      };

      if (isEdit) {
        await updateSantiye(santiye.id, submitData);
        savedId = santiye.id;
      } else {
        const created = await createSantiye(submitData);
        savedId = created.id;
      }
      // Local non-null kopyası — try block içinde geri kalan operasyonlar için
      const sId: string = savedId!;

      // Ortakları kaydet
      if (formData.is_ortak_girisim && ortaklar.length > 0) {
        await saveOrtaklar(sId, ortaklar.filter((o) => o.firma_id));
      }

      // İş grubu dağılımını kaydet
      const gecerliDagilim = isGrupDagilimi
        .filter((d) => d.ana && d.tutar && (d.ana.startsWith("DGR-") || d.alt))
        .map((d) => {
          // "Diğer" gruplarda is_grubu = ad, normal gruplarda = "(A) Alt Grup - Detay"
          const isDiger = d.ana.startsWith("DGR-");
          const isGrubu = isDiger
            ? d.ana.replace("DGR-", "")
            : `(${d.ana}) ${d.alt}${d.detay ? " - " + d.detay : ""}`;
          return {
            is_grubu: isGrubu,
            tutar: parseFloat(d.tutar.replace(/\./g, "").replace(",", ".")) || 0,
          };
        })
        .filter((d) => d.tutar > 0);
      try {
        await saveSantiyeIsGruplari(sId, gecerliDagilim);
      } catch { /* tablo yoksa sessiz atla */ }

      // Keşif Artışı + İşyeri Teslim Tarihi + İş Süresi → iscilik_takibi tablosuna sync.
      // Bu alanlar iki sayfada da (Yönetim>Şantiyeler ve İşçilik Durum Raporu) görünür,
      // birinden değiştirildiğinde diğerine yansıması için her iki tabloda da güncellenir.
      try {
        const kesifArtisi = parseParaInput(kesifArtisiStr);
        const sureGun = formData.is_suresi ?? null;
        await upsertIscilikTakibi(sId, {
          kesif_artisi: kesifArtisi,
          // SYNC: isyeri_teslim_tarihi → iscilik_takibi.baslangic_tarihi
          baslangic_tarihi: formData.isyeri_teslim_tarihi ?? null,
          // SYNC: is_suresi (sayı) → iscilik_takibi.sure_text (string)
          sure_text: sureGun != null ? String(sureGun) : null,
        });
      } catch (err) {
        console.warn("İşçilik takibi sync hatası:", err);
      }

      // Dosya yüklemeleri
      if (geciciKabulFile) {
        const url = await uploadSantiyeFile(geciciKabulFile, sId, "gecici_kabul");
        await updateSantiye(sId, { gecici_kabul_url: url });
      }
      if (kesinKabulFile) {
        const url = await uploadSantiyeFile(kesinKabulFile, sId, "kesin_kabul");
        await updateSantiye(sId, { kesin_kabul_url: url });
      }
      if (isDeneyimFile) {
        const url = await uploadSantiyeFile(isDeneyimFile, sId, "is_deneyim");
        await updateSantiye(sId, { is_deneyim_url: url });
      }

      basarili = true;
    } catch {
      toast.error(isEdit ? "İş güncellenirken hata oluştu." : "İş eklenirken hata oluştu.");
      setLoading(false);
    }

    if (basarili && savedId) {
      toast.success(isEdit ? "İş başarıyla güncellendi." : "İş başarıyla eklendi.");
      // Yeni iş eklendiyse: kullanıcı atama dialogu aç, kullanıcı seçimi sonrası yönlendir.
      // Düzenleme ise direkt yönlendir.
      if (!isEdit) {
        try {
          // Kullanıcı listesini çek (sadece santiye_admin + kisitli)
          const tumKullanicilar = await getKullanicilar();
          const filtreli = tumKullanicilar.filter(
            (k) => (k.rol === "santiye_admin" || k.rol === "kisitli") && k.aktif,
          );
          if (filtreli.length === 0) {
            // Hiç atanacak kullanıcı yok → dialog modunda callback, değilse yönlendir
            if (onSuccess) { onSuccess(); return; }
            window.location.href = "/dashboard/yonetim/santiyeler";
            return;
          }
          setKullaniciListesi(filtreli);
          setSeciliKullaniciIds(new Set());
          setYeniKaydedilenSantiyeId(savedId);
          setKullaniciDialogAcik(true);
          // Loading durumunu bırak — dialog açıldı, kullanıcı seçim yapacak
          setLoading(false);
          return;
        } catch (err) {
          console.warn("Kullanıcı listesi yüklenemedi:", err);
          // Yine de kapat/yönlendir
          if (onSuccess) { onSuccess(); return; }
          window.location.href = "/dashboard/yonetim/santiyeler";
        }
      } else {
        // Düzenleme: dialog içinde açıldıysa (onSuccess varsa) yönlendirme yapma, callback çağır.
        if (onSuccess) { onSuccess(); return; }
        window.location.href = "/dashboard/yonetim/santiyeler";
      }
    }
  }

  // Kullanıcı atama: seçili kullanıcılara bu yeni şantiyeyi ata
  async function kullaniciAtamasiKaydet() {
    if (!yeniKaydedilenSantiyeId) return;
    setKullaniciAtamaYukleniyor(true);
    try {
      let basari = 0;
      for (const kullaniciId of seciliKullaniciIds) {
        try {
          const k = kullaniciListesi.find((x) => x.id === kullaniciId);
          if (!k) continue;
          const yeniSantiyeIds = Array.from(new Set([...(k.santiye_ids ?? []), yeniKaydedilenSantiyeId]));
          await updateKullanici(kullaniciId, { santiye_ids: yeniSantiyeIds });
          basari++;
        } catch (e) {
          console.warn("Kullanıcı atama hatası:", e);
        }
      }
      if (seciliKullaniciIds.size > 0) {
        toast.success(`${basari}/${seciliKullaniciIds.size} kullanıcıya iş atandı.`);
      } else {
        toast("Hiç kullanıcı seçilmedi — atama yapılmadı.", { icon: "ℹ️" });
      }
      setKullaniciDialogAcik(false);
      if (onSuccess) { onSuccess(); return; }
      window.location.href = "/dashboard/yonetim/santiyeler";
    } finally {
      setKullaniciAtamaYukleniyor(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-0 w-full overflow-x-clip">
      <Tabs defaultValue="genel" className="w-full min-w-0">
        <TabsList className="mb-4 w-full overflow-x-auto">
          <TabsTrigger value="genel">Genel Bilgiler</TabsTrigger>
          <TabsTrigger value="sozlesme">Sözleşme ve Mali Veri</TabsTrigger>
          <TabsTrigger value="kabul">Kabul</TabsTrigger>
          <TabsTrigger value="depo">Depo</TabsTrigger>
        </TabsList>

        {/* Sekme 1: Genel Bilgiler */}
        <TabsContent value="genel">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="is_adi">İşin Adı <span className="text-red-500">*</span></Label>
                  <Input
                    id="is_adi"
                    name="is_adi"
                    placeholder="Karabük Cevizlidere Merkez"
                    className="text-ellipsis"
                    value={formData.is_adi}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, is_adi: formatBaslik(e.target.value) }))}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="il">İl <span className="text-red-500">*</span></Label>
                  <select id="il" name="il" value={formData.il ?? ""} onChange={(e) => setFormData((p) => ({ ...p, il: e.target.value || null }))} disabled={loading} className={selectClass}>
                    <option value="">Seçiniz</option>
                    {TR_ILLER.map((il) => (<option key={il} value={il}>{il}</option>))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>İş Tanımları</Label>
                  <select name="is_grubu" value={formData.is_grubu ?? ""} onChange={(e) => handleSelectChange("is_grubu", e.target.value)} disabled={loading} className={selectClass}>
                    <option value="">Seçiniz</option>
                    {isGruplari.map((g) => (<option key={g} value={g}>{g}</option>))}
                  </select>
                </div>
                {/* İş Grubu (Benzer İş) genel bilgilerde gösterilmez — kabul sekmesindeki İş Grubu Dağılımı'ndan seçilir */}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Yüklenici Firma</Label>
                  <select name="yuklenici_firma_id" value={formData.yuklenici_firma_id ?? ""} onChange={(e) => handleSelectChange("yuklenici_firma_id", e.target.value)} disabled={loading} className={selectClass}>
                    <option value="">Seçiniz</option>
                    {firmalar.map((f) => (<option key={f.id} value={f.id}>{f.firma_adi}</option>))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ortaklik_orani">Ortaklık Oranı (%)</Label>
                  <Input id="ortaklik_orani" name="ortaklik_orani" type="text" inputMode="decimal" placeholder="100" value={formData.ortaklik_orani ?? ""} onChange={handleChange} disabled={loading} />
                </div>
              </div>

              {/* Ortak Girişim */}
              <div className="flex items-center gap-3 py-2">
                <Switch checked={formData.is_ortak_girisim} onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_ortak_girisim: checked }))} disabled={loading} />
                <Label>Ortak Girişim</Label>
              </div>

              {formData.is_ortak_girisim && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-[#1E3A5F]">Ortaklar</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addOrtak} disabled={loading}>
                      <Plus size={14} className="mr-1" /> Ortak Ekle
                    </Button>
                  </div>
                  {ortaklar.map((ortak, i) => (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_120px_40px] gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Firma</Label>
                        <select value={ortak.firma_id} onChange={(e) => updateOrtak(i, "firma_id", e.target.value)} disabled={loading} className={selectClass}>
                          <option value="">Firma seçin</option>
                          {firmalar.map((f) => (<option key={f.id} value={f.id}>{f.firma_adi}</option>))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Oran (%)</Label>
                        <Input type="text" inputMode="decimal" value={ortak.oran || ""} onChange={(e) => updateOrtak(i, "oran", parseFloat(e.target.value) || 0)} disabled={loading} />
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="text-red-500" onClick={() => removeOrtak(i)} disabled={loading}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                  {ortaklar.length === 0 && (
                    <p className="text-sm text-gray-400">&quot;Ortak Ekle&quot; butonuna tıklayarak ortakları ekleyin.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ilan_tarihi">İlan Tarihi</Label>
                  <Input id="ilan_tarihi" name="ilan_tarihi" type="date" value={formData.ilan_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ihale_tarihi">İhale Tarihi</Label>
                  <Input id="ihale_tarihi" name="ihale_tarihi" type="date" value={formData.ihale_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ihale_kayit_no">İhale Kayıt Numarası</Label>
                  <Input id="ihale_kayit_no" name="ihale_kayit_no" placeholder="İhale kayıt no" value={formData.ihale_kayit_no ?? ""} onChange={handleChange} disabled={loading} />
                </div>
              </div>

              {/* Çalışılmayan Dönem (opsiyonel, YIL YOK — her yıl tekrar eder) — gün + ay. Bordro'da bu aralıktaki
                  personeller gri+italik gösterilir. */}
              {(() => {
                const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
                const parse = (v: string | null) => { const [a, g] = (v ?? "").split("-"); return { ay: a ?? "", gun: g ?? "" }; };
                const bas = parse(formData.calisilmayan_bas);
                const bit = parse(formData.calisilmayan_bit);
                const gunOpts = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
                // flex-1 min-w-0 → mobilde iki select yan yana KÜÇÜLEREK sığar (yoksa form yatay taşıp
                // "Ay" ile Kaydet/İptal ekran dışına kayıyordu).
                const gunSelect = (val: string, onCh: (v: string) => void) => (
                  <select className={`${selectClass} flex-1 min-w-0`} disabled={loading} value={val} onChange={(e) => onCh(e.target.value)}>
                    <option value="">Gün</option>
                    {gunOpts.map((g) => <option key={g} value={g}>{Number(g)}</option>)}
                  </select>
                );
                const aySelect = (val: string, onCh: (v: string) => void) => (
                  <select className={`${selectClass} flex-1 min-w-0`} disabled={loading} value={val} onChange={(e) => onCh(e.target.value)}>
                    <option value="">Ay</option>
                    {AYLAR.map((a, i) => <option key={a} value={String(i + 1).padStart(2, "0")}>{a}</option>)}
                  </select>
                );
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Çalışılmayan Dönem — Başlangıç (gün · ay)</Label>
                      <div className="flex gap-2">
                        {gunSelect(bas.gun, (v) => setGunAy("calisilmayan_bas", bas.ay, v))}
                        {aySelect(bas.ay, (v) => setGunAy("calisilmayan_bas", v, bas.gun))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Çalışılmayan Dönem — Bitiş (gün · ay)</Label>
                      <div className="flex gap-2">
                        {gunSelect(bit.gun, (v) => setGunAy("calisilmayan_bit", bit.ay, v))}
                        {aySelect(bit.ay, (v) => setGunAy("calisilmayan_bit", v, bit.gun))}
                      </div>
                    </div>
                    <div className="space-y-2 flex items-end">
                      <p className="text-xs text-gray-500">Opsiyonel · <strong>yıl yok, her yıl tekrar eder</strong>. Bu aralıkta bu şantiyedeki personeller Bordro&apos;da <span className="italic text-gray-400">gri + italik</span> gösterilir.</p>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sekme 2: Sözleşme ve Mali Veri */}
        <TabsContent value="sozlesme">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sozlesme_bedeli">Sözleşme Bedeli (KDV ve FF Hariç)</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="sozlesme_bedeli"
                        placeholder="0,00"
                        value={sozlesmeBedeliStr}
                        onChange={(e) => setSozlesmeBedeliStr(e.target.value)}
                        onBlur={() => {
                          const val = parseParaInput(sozlesmeBedeliStr);
                          setSozlesmeBedeliStr(val != null ? formatParaInput(val) : "");
                        }}
                        disabled={loading || tutarKilitli}
                        title={tutarKilitli ? "Geçici kabulü yapılmış işin sözleşme bedeli değiştirilemez" : undefined}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                        {formData.para_birimi === "USD" ? "$" : formData.para_birimi === "EUR" ? "€" : "₺"}
                      </span>
                    </div>
                    <select
                      value={formData.para_birimi ?? "TRY"}
                      onChange={(e) => setFormData((prev) => ({ ...prev, para_birimi: e.target.value as "TRY" | "USD" | "EUR" }))}
                      disabled={loading || tutarKilitli}
                      className="h-10 px-2 text-sm border border-gray-300 rounded-md bg-white outline-none focus:border-[#1E3A5F] w-20 disabled:opacity-60 disabled:cursor-not-allowed"
                      title={tutarKilitli ? "Kilitli" : "Para birimi"}
                    >
                      <option value="TRY">TL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sozlesme_tarihi">Sözleşme Tarihi</Label>
                  <Input
                    id="sozlesme_tarihi"
                    name="sozlesme_tarihi"
                    type="date"
                    value={formData.sozlesme_tarihi ?? ""}
                    min={formData.ihale_tarihi ?? undefined}
                    onChange={handleChange}
                    disabled={loading}
                  />
                  {formData.ihale_tarihi && formData.sozlesme_tarihi && formData.sozlesme_tarihi < formData.ihale_tarihi && (
                    <p className="text-[10px] text-red-600 font-semibold">⚠️ Sözleşme tarihi ihale tarihinden önce olamaz.</p>
                  )}
                </div>
              </div>

              {/* Fiyat Farkı + Teknik Personel Sayısı — yan yana */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Fiyat Farkı Hesaplaması Toggle */}
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 h-full">
                  <input
                    type="checkbox"
                    id="ff_hesaplanacak"
                    checked={formData.ff_hesaplanacak ?? true}
                    onChange={(e) => setFormData((prev) => ({ ...prev, ff_hesaplanacak: e.target.checked }))}
                    disabled={loading}
                    className="w-4 h-4 accent-[#1E3A5F] flex-shrink-0"
                  />
                  <Label htmlFor="ff_hesaplanacak" className="text-sm cursor-pointer flex-1"
                    title={(formData.ff_hesaplanacak ?? true)
                      ? "FF Dahil Kalan Tutar ve Fiyat Farkı sütunlarında Yi-ÜFE hesabı yapılır"
                      : "FF hesaplaması atlanır — sadece sözleşme bedeli baz alınır"}>
                    Fiyat Farkı Hesaplanacaktır
                  </Label>
                </div>

                {/* Teknik Personel listesi — serbest metin, + ile çoğaltılabilir.
                    "Gerekli değil" tikli ise gizlenir ve zorunluluk kalkar. */}
                <div className="space-y-1">
                  <Label className="text-sm">
                    Teknik Personel {!teknikPersonelGerekliDegil && <span className="text-red-500">*</span>}
                  </Label>
                  {/* "Teknik personel gerekli değil" tiki */}
                  <label className={`flex items-start gap-2 p-2 mb-1.5 rounded border cursor-pointer ${
                    teknikPersonelGerekliDegil ? "bg-amber-50 border-amber-300" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 mt-0.5 accent-amber-600"
                      checked={teknikPersonelGerekliDegil}
                      onChange={(e) => setTeknikPersonelGerekliDegil(e.target.checked)}
                      disabled={loading}
                    />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-[#1E3A5F]">
                        Bu iş için teknik personel gerekli değil
                      </div>
                      <div className="text-[10px] text-gray-500">
                        İşaretlerseniz teknik personel listesi atlanır ve bu iş için zorunluluk kalkar.
                      </div>
                    </div>
                  </label>
                  {!teknikPersonelGerekliDegil && (
                    <>
                      <div className="space-y-1.5">
                        {teknikPersonelList.map((deger, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <Input
                              type="text"
                              placeholder={`Teknik personel ${i + 1}`}
                              value={deger}
                              onChange={(e) => {
                                const yeni = [...teknikPersonelList];
                                yeni[i] = e.target.value;
                                setTeknikPersonelList(yeni);
                              }}
                              disabled={loading}
                            />
                            {teknikPersonelList.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTeknikPersonelList(teknikPersonelList.filter((_, idx) => idx !== i));
                                }}
                                disabled={loading}
                                className="h-9 w-9 flex-shrink-0 rounded-md border border-red-200 text-red-600 hover:bg-red-50 flex items-center justify-center disabled:opacity-50"
                                title="Bu personeli kaldır"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setTeknikPersonelList([...teknikPersonelList, ""])}
                          disabled={loading}
                          className="w-full h-9 rounded-md border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 text-sm font-semibold transition-colors disabled:opacity-50"
                        >
                          + Teknik personel ekle
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">
                        Boş bırakılan satırlar kaydedilmez. İsim yerine görev veya açıklama da yazabilirsiniz.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Keşif Artışı — işçilik takibi sayfasıyla ortak veri */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="kesif_artisi">Keşif Artışı</Label>
                  <div className="relative">
                    <Input
                      id="kesif_artisi"
                      placeholder="0,00"
                      value={kesifArtisiStr}
                      onChange={(e) => setKesifArtisiStr(e.target.value)}
                      onBlur={() => {
                        const val = parseParaInput(kesifArtisiStr);
                        setKesifArtisiStr(val != null ? formatParaInput(val) : "");
                      }}
                      disabled={loading}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                      {formData.para_birimi === "USD" ? "$" : formData.para_birimi === "EUR" ? "€" : "₺"}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    İşçilik Takibi sayfasındaki Keşif Artışı ile aynı veridir — biri değişince diğeri de güncellenir.
                    Para birimi sözleşme ile aynı (yukarıdan değiştirilebilir).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="isyeri_teslim_tarihi">İş Yeri Teslim Tarihi</Label>
                  <Input
                    id="isyeri_teslim_tarihi"
                    name="isyeri_teslim_tarihi"
                    type="date"
                    value={formData.isyeri_teslim_tarihi ?? ""}
                    // Min: hem ihale hem sözleşme tarihinden büyük/eşit olmalı → max'larını al
                    min={(() => {
                      const candidates = [formData.ihale_tarihi, formData.sozlesme_tarihi].filter(Boolean) as string[];
                      if (candidates.length === 0) return undefined;
                      return candidates.reduce((a, b) => (a > b ? a : b));
                    })()}
                    onChange={handleChange}
                    disabled={loading}
                  />
                  {formData.ihale_tarihi && formData.isyeri_teslim_tarihi && formData.isyeri_teslim_tarihi < formData.ihale_tarihi && (
                    <p className="text-[10px] text-red-600 font-semibold">⚠️ İşyeri teslim tarihi ihale tarihinden önce olamaz.</p>
                  )}
                  {formData.sozlesme_tarihi && formData.isyeri_teslim_tarihi && formData.isyeri_teslim_tarihi < formData.sozlesme_tarihi && (
                    <p className="text-[10px] text-red-600 font-semibold">⚠️ İşyeri teslim tarihi sözleşme tarihinden önce olamaz.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="is_suresi">İş Süresi (Gün)</Label>
                  <Input id="is_suresi" name="is_suresi" type="text" inputMode="numeric" placeholder="Örn: 365" value={formData.is_suresi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>İş Bitim Tarihi</Label>
                  <Input value={formData.is_bitim_tarihi ?? ""} disabled className="bg-gray-100" />
                  <p className="text-xs text-gray-400">Teslim tarihi + iş süresinden otomatik hesaplanır</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Süre Uzatımları (Gün)</Label>
                    <Button type="button" variant="outline" size="sm" disabled={loading}
                      onClick={() => setFormData((p) => ({ ...p, sure_uzatimlari: [...p.sure_uzatimlari, 0] }))}>
                      <Plus size={14} className="mr-1" /> Uzatım Ekle
                    </Button>
                  </div>
                  {formData.sure_uzatimlari.length > 0 ? (
                    <div className="space-y-2">
                      {formData.sure_uzatimlari.map((gun, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                          <Input type="text" inputMode="numeric" placeholder="Gün" value={gun || ""} className="max-w-[120px]"
                            onChange={(e) => {
                              const yeni = [...formData.sure_uzatimlari];
                              yeni[idx] = parseInt(e.target.value) || 0;
                              setFormData((p) => ({ ...p, sure_uzatimlari: yeni }));
                            }} disabled={loading} />
                          <span className="text-xs text-gray-400">gün</span>
                          <button type="button" className="text-red-400 hover:text-red-600"
                            onClick={() => setFormData((p) => ({ ...p, sure_uzatimlari: p.sure_uzatimlari.filter((_, i) => i !== idx) }))}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <p className="text-xs font-medium text-[#1E3A5F]">
                        Toplam: {formData.sure_uzatimlari.reduce((a, b) => a + (b || 0), 0)} gün
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Henüz süre uzatımı eklenmedi.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Süre Uzatımlı Bitiş Tarihi</Label>
                  <Input value={formData.sure_uzatimli_tarih ?? ""} disabled className="bg-gray-100" />
                  <p className="text-xs text-gray-400">İş bitim tarihi + toplam uzatım günlerinden otomatik hesaplanır</p>
                </div>
                <div className="space-y-2">
                  <Label>Toplam Uzatım</Label>
                  <Input value={formData.sure_uzatimi ? `${formData.sure_uzatimi} gün` : "—"} disabled className="bg-gray-100" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sekme 3: Kabul */}
        <TabsContent value="kabul">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tasfiye_tarihi">Tasfiye Tarihi</Label>
                  <Input id="tasfiye_tarihi" name="tasfiye_tarihi" type="date" value={formData.tasfiye_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                  <p className="text-xs text-gray-400">Tasfiye edildiyse tarihi girin.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="devir_tarihi">Devir Tarihi</Label>
                  <Input id="devir_tarihi" name="devir_tarihi" type="date" value={formData.devir_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                  <p className="text-xs text-gray-400">Devir edildiyse tarihi girin.</p>
                </div>
              </div>

              <hr className="my-2" />

              <div className="space-y-2">
                <Label htmlFor="ekap_belge_no">Ekap Belge No</Label>
                <Input id="ekap_belge_no" name="ekap_belge_no" placeholder="Ekap belge numarası" value={formData.ekap_belge_no ?? ""} onChange={handleChange} disabled={loading} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gecici_kabul_tarihi">Geçici Kabul Tarihi</Label>
                  <Input id="gecici_kabul_tarihi" name="gecici_kabul_tarihi" type="date" value={formData.gecici_kabul_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label>Geçici Kabul Belgesi (PDF)</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                      <Upload size={16} />
                      {geciciKabulFile ? geciciKabulFile.name : "PDF Yükle"}
                      <input type="file" accept=".pdf" className="hidden" onChange={(e) => setGeciciKabulFile(e.target.files?.[0] ?? null)} disabled={loading} />
                    </label>
                    {formData.gecici_kabul_url && !geciciKabulFile && (
                      <>
                        <a href={formData.gecici_kabul_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-green-700 underline hover:text-green-800">
                          Mevcut PDF
                        </a>
                        <button type="button" onClick={() => pdfSil("gecici_kabul_url")}
                          disabled={loading}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"
                          title="Yüklenmiş PDF'i sil">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="kesin_kabul_tarihi">Kesin Kabul Tarihi</Label>
                  <Input id="kesin_kabul_tarihi" name="kesin_kabul_tarihi" type="date" value={formData.kesin_kabul_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label>Kesin Kabul Belgesi (PDF)</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                      <Upload size={16} />
                      {kesinKabulFile ? kesinKabulFile.name : "PDF Yükle"}
                      <input type="file" accept=".pdf" className="hidden" onChange={(e) => setKesinKabulFile(e.target.files?.[0] ?? null)} disabled={loading} />
                    </label>
                    {formData.kesin_kabul_url && !kesinKabulFile && (
                      <>
                        <a href={formData.kesin_kabul_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-green-700 underline hover:text-green-800">
                          Mevcut PDF
                        </a>
                        <button type="button" onClick={() => pdfSil("kesin_kabul_url")}
                          disabled={loading}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"
                          title="Yüklenmiş PDF'i sil">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>İş Deneyim Belgesi (PDF)</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                    <Upload size={16} />
                    {isDeneyimFile ? isDeneyimFile.name : "PDF Yükle"}
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setIsDeneyimFile(e.target.files?.[0] ?? null)} disabled={loading} />
                  </label>
                  {formData.is_deneyim_url && !isDeneyimFile && (
                    <>
                      <a href={formData.is_deneyim_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-green-700 underline hover:text-green-800">
                        Mevcut PDF
                      </a>
                      <button type="button" onClick={() => pdfSil("is_deneyim_url")}
                        disabled={loading}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"
                        title="Yüklenmiş PDF'i sil">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* İş Grubu Dağılımı — 3 kademeli seçim */}
              {isGrupAnaList.length > 0 && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-lg border mt-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-[#1E3A5F]">İş Grubu Dağılımı</Label>
                    <Button type="button" size="sm" variant="outline" onClick={() => setIsGrupDagilimi((prev) => [...prev, { ana: "", alt: "", detay: "", tutar: "" }])} disabled={loading || tutarKilitli}>
                      <Plus size={14} className="mr-1" /> İş Grubu Ekle
                    </Button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {tutarKilitli
                      ? "Geçici kabulü yapılmış işin dağılımı kilitlidir."
                      : "Sözleşme fiyatlarıyla gerçekleşen tutarın iş gruplarına dağılımını girin. Toplamları gerçekleşen tutara eşit olmalıdır."}
                  </p>
                  {isGrupDagilimi.map((d, i) => {
                    const isDigerGrup = d.ana.startsWith("DGR-");
                    const filtreliAlt = isDigerGrup ? [] : isGrupAltList.filter((a) => a.kisa_ad === d.ana);
                    const romMatch = d.alt.match(/^([IVXLCDM]+)\./);
                    const detayKey = romMatch ? `${d.ana}-${romMatch[1]}` : "";
                    const filtreliDetay = isDigerGrup ? [] : isGrupDetayList.filter((dt) => dt.kisa_ad === detayKey);
                    return (
                      <div key={i} className="border rounded-lg p-3 bg-white space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_40px] gap-2 items-end">
                          {/* Ana Grup */}
                          <div className="space-y-1">
                            <Label className="text-[10px] text-gray-500">Ana Grup</Label>
                            <select
                              value={d.ana}
                              onChange={(e) => setIsGrupDagilimi((prev) => prev.map((x, j) => j === i ? { ...x, ana: e.target.value, alt: "", detay: "" } : x))}
                              disabled={loading || tutarKilitli}
                              className={selectClass + " text-xs disabled:opacity-60 disabled:cursor-not-allowed"}
                            >
                              <option value="">Seçiniz</option>
                              {isGrupAnaList.map((a) => (
                                <option key={a.id} value={a.kisa_ad ?? ""}>({a.kisa_ad}) {a.deger}</option>
                              ))}
                              {isGrupDigerList.length > 0 && (
                                <optgroup label="Diğer">
                                  {isGrupDigerList.map((d) => (
                                    <option key={d.id} value={`DGR-${d.deger}`}>{d.deger}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                          {/* Alt Grup — Diğer gruplarda gizli */}
                          {!isDigerGrup && (
                            <div className="space-y-1">
                              <Label className="text-[10px] text-gray-500">Alt Grup</Label>
                              <select
                                value={d.alt}
                                onChange={(e) => setIsGrupDagilimi((prev) => prev.map((x, j) => j === i ? { ...x, alt: e.target.value, detay: "" } : x))}
                                disabled={loading || !d.ana || tutarKilitli}
                                className={selectClass + " text-xs disabled:opacity-60 disabled:cursor-not-allowed"}
                              >
                                <option value="">Seçiniz</option>
                                {filtreliAlt.map((a) => (
                                  <option key={a.id} value={a.deger}>{a.deger}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {/* Detay — Diğer gruplarda gizli */}
                          {!isDigerGrup && (
                            <div className="space-y-1">
                              <Label className="text-[10px] text-gray-500">Detay</Label>
                              <select
                                value={d.detay}
                                onChange={(e) => setIsGrupDagilimi((prev) => prev.map((x, j) => j === i ? { ...x, detay: e.target.value } : x))}
                                disabled={loading || !d.alt || filtreliDetay.length === 0 || tutarKilitli}
                                className={selectClass + " text-xs disabled:opacity-60 disabled:cursor-not-allowed"}
                              >
                                <option value="">{filtreliDetay.length === 0 ? "Detay yok" : "Seçiniz"}</option>
                                {filtreliDetay.map((dt) => (
                                  <option key={dt.id} value={dt.deger}>{dt.deger}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {/* Sil */}
                          <Button type="button" variant="ghost" size="sm" className="text-red-500"
                            onClick={() => setIsGrupDagilimi((prev) => prev.filter((_, j) => j !== i))} disabled={loading || tutarKilitli}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        {/* Tutar */}
                        <div className="space-y-1 max-w-[200px]">
                          <Label className="text-[10px] text-gray-500">Tutar (TL)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={d.tutar}
                            onChange={(e) => setIsGrupDagilimi((prev) => prev.map((x, j) => j === i ? { ...x, tutar: e.target.value } : x))}
                            placeholder="0,00"
                            disabled={loading || tutarKilitli}
                            title={tutarKilitli ? "Geçici kabul yapıldı — kilitli" : undefined}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {isGrupDagilimi.length > 0 && (() => {
                    const toplam = isGrupDagilimi.reduce((acc, d) => {
                      const v = parseFloat((d.tutar || "0").replace(/\./g, "").replace(",", "."));
                      return acc + (isNaN(v) ? 0 : v);
                    }, 0);
                    const gerceklesen = formData.sozlesme_fiyatlariyla_gerceklesen ?? 0;
                    const esit = Math.abs(toplam - gerceklesen) < 0.01;
                    return (
                      <div className={`text-xs p-2 rounded ${esit ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        Toplam: {toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                        {" / "}Gerçekleşen: {gerceklesen.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                        {esit ? " ✓" : " — Tutarlar eşit değil!"}
                      </div>
                    );
                  })()}
                  {isGrupDagilimi.length === 0 && (
                    <p className="text-xs text-gray-400">Henüz iş grubu dağılımı eklenmemiş.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sekme 4: Depo */}
        <TabsContent value="depo">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={depoVar} onCheckedChange={setDepoVar} disabled={loading} />
                <Label>Bu şantiyede yakıt deposu var</Label>
              </div>
              {depoVar && (
                <div className="space-y-2 max-w-sm">
                  <Label htmlFor="depo_kapasitesi">Depo Kapasitesi (Litre)</Label>
                  <Input id="depo_kapasitesi" name="depo_kapasitesi" type="text" inputMode="numeric" placeholder="Örn: 5000" value={formData.depo_kapasitesi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
              )}
              <p className="text-sm text-gray-400">Depo eklediğinizde, Yakıt modülünde bu şantiye otomatik olarak görünecektir.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Buton çubuğu ALTA YAPIŞIK (sticky) → uzun formda kaydırırken Kaydet/İptal ekranın altında görünür kalır,
          içeriği örtmez (akışta son öğe). Yatay taşma select düzeltmesiyle giderildiği için sağ kenardan da kaçmaz. */}
      {/* Butonlar mobilde ALT ALTA (flex-col-reverse → Kaydet üstte, İptal altta), her biri tam genişlik → uzun
          form yatay taşısa bile butonlar sola dayalı ve GÖRÜNÜR kalır. Masaüstünde yan yana, sağa dayalı. */}
      <div className="sticky bottom-0 z-20 mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 border-t bg-white py-3">
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onCancel ? onCancel() : router.push("/dashboard/yonetim/santiyeler")} disabled={loading}>
          <X size={16} className="mr-1" /> İptal
        </Button>
        <Button type="submit" className="w-full sm:w-auto bg-[#F97316] hover:bg-[#ea580c] text-white" disabled={loading}>
          <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>

      {/* Geçici Kabul Prim Onay Dialogu — eksik prim varsa kullanıcıya sorulur */}
      <Dialog
        open={!!primOnayDialog}
        onOpenChange={(o) => {
          if (!o && primOnayDialog) {
            // Dış tıklama / ESC → "hayır" (iptal) say
            primOnayDialog.resolve("hayir");
            setPrimOnayDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Geçici Kabul Onayı — Eksik Prim Uyarısı</DialogTitle></DialogHeader>
          {primOnayDialog && (() => {
            const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <div className="space-y-4 py-2">
                <div className="bg-amber-50 border-2 border-amber-300 rounded p-3">
                  <p className="text-sm text-amber-900 leading-relaxed">
                    Asgari işçilik tutarı olan{" "}
                    <span className="font-mono font-bold">
                      {fmt(primOnayDialog.yatmasiGereken)} − {fmt(primOnayDialog.yatan)} − {fmt(primOnayDialog.bordro)} ={" "}
                      <span className="text-red-600">{fmt(primOnayDialog.sonuc)} TL</span>
                    </span>
                    {" "}<strong>yatırılmamıştır</strong>, buna rağmen geçici kabul tarihini onaylıyor musunuz?
                  </p>
                </div>
                <div className="text-[11px] text-gray-500 leading-relaxed border-l-2 border-blue-300 pl-2">
                  <strong>Yatması Gereken</strong>: (sözleşme bedeli + keşif artışı + fiyat farkı) × işçilik oranı / 100<br />
                  <strong>Yatan</strong>: işçilik takibinde girilen yatan prim<br />
                  <strong>Bordro Tahmini</strong>: en son veri girilen aydan sonra ki ayların manuel + atama günleri × günlük ücret
                </div>
                <div className="flex gap-2 justify-end pt-2 border-t flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { primOnayDialog.resolve("hayir"); setPrimOnayDialog(null); }}
                  >
                    Hayır (İptal)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => { primOnayDialog.resolve("evet"); setPrimOnayDialog(null); }}
                  >
                    Evet (Yine de Onayla)
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Kullanıcı Atama Dialogu — yeni iş eklendikten sonra açılır */}
      <Dialog
        open={kullaniciDialogAcik}
        onOpenChange={(o) => {
          // Dialog dışına tıklayarak kapatma — atama yapmadan çık
          if (!o) {
            setKullaniciDialogAcik(false);
            window.location.href = "/dashboard/yonetim/santiyeler";
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Kullanıcı Atama — Yeni İş</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-gray-600">
              Bu işi hangi <strong>şantiye yöneticisi</strong> ve <strong>kısıtlı kullanıcı</strong>lara atamak istiyorsunuz?
              Seçilen kullanıcılar bu işi sayfalarında görüp işlem yapabilir.
              Atama yapmadan da geçebilirsiniz, sonradan kullanıcı düzenleme ekranından atayabilirsiniz.
            </p>

            {kullaniciListesi.length === 0 ? (
              <p className="text-sm text-gray-500 italic text-center py-4">
                Atanacak kullanıcı yok.
              </p>
            ) : (
              <>
                {/* Tümünü Seç */}
                <div className="flex items-center justify-between border-b pb-2 sticky top-0 bg-white z-10">
                  <div className="text-xs font-semibold">
                    Kullanıcılar ({kullaniciListesi.length})
                    {seciliKullaniciIds.size > 0 && (
                      <span className="ml-2 text-blue-600">· {seciliKullaniciIds.size} seçili</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSeciliKullaniciIds(new Set(kullaniciListesi.map((k) => k.id)))}
                    >
                      Tümünü Seç
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSeciliKullaniciIds(new Set())}
                    >
                      Temizle
                    </Button>
                  </div>
                </div>

                {/* Liste — rol bazlı gruplandı */}
                <ul className="space-y-1">
                  {kullaniciListesi
                    .slice()
                    .sort((a, b) => {
                      // Şantiye admin önde, kısıtlı arkada; aynı rol içinde isim sırası
                      if (a.rol !== b.rol) return a.rol === "santiye_admin" ? -1 : 1;
                      return a.ad_soyad.localeCompare(b.ad_soyad, "tr");
                    })
                    .map((k) => {
                      const sec = seciliKullaniciIds.has(k.id);
                      const rolEtiket = k.rol === "santiye_admin" ? "Şantiye Yöneticisi" : "Kısıtlı";
                      const rolRenk = k.rol === "santiye_admin" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700";
                      return (
                        <li
                          key={k.id}
                          onClick={() => {
                            setSeciliKullaniciIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(k.id)) next.delete(k.id);
                              else next.add(k.id);
                              return next;
                            });
                          }}
                          className={`border rounded px-3 py-2 cursor-pointer transition-colors ${sec ? "bg-blue-50 border-blue-300" : "hover:bg-gray-50"}`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={sec}
                              readOnly
                              className="mt-1 w-4 h-4 cursor-pointer accent-blue-600"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-[#1E3A5F] truncate">{k.ad_soyad}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${rolRenk}`}>
                                  {rolEtiket}
                                </span>
                              </div>
                              <div className="text-[10px] text-gray-500 truncate">
                                {k.kullanici_adi}
                                {k.santiye_ids && k.santiye_ids.length > 0 && (
                                  <> · {k.santiye_ids.length} işe atanmış</>
                                )}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-3 border-t sticky bottom-0 bg-white">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setKullaniciDialogAcik(false);
                  window.location.href = "/dashboard/yonetim/santiyeler";
                }}
                disabled={kullaniciAtamaYukleniyor}
              >
                Atama Yapma (Geç)
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={kullaniciAtamasiKaydet}
                disabled={kullaniciAtamaYukleniyor}
              >
                {kullaniciAtamaYukleniyor
                  ? "Kaydediliyor..."
                  : seciliKullaniciIds.size > 0
                  ? `Ata (${seciliKullaniciIds.size})`
                  : "Hiçbirine Atama"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
