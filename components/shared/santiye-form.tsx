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
import { formatBaslik } from "@/lib/utils/isim";
import type { Santiye, SantiyeInsert, Firma, Tanimlama } from "@/lib/supabase/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, X, Upload, Plus, Trash2 } from "lucide-react";
import { getDegerler, getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import toast from "react-hot-toast";

type SantiyeFormProps = { santiye?: Santiye };

type OrtakRow = { firma_id: string; oran: number; is_pilot: boolean };

// IS_GRUPLARI artık tanımlamalardan çekilecek

const selectClass =
  "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50";

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

export default function SantiyeForm({ santiye }: SantiyeFormProps) {
  const isEdit = !!santiye;
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
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

  // Sözleşme bedeli ayrı tutulur (formatlı gösterim)
  const [sozlesmeBedeliStr, setSozlesmeBedeliStr] = useState(
    formatParaInput(santiye?.sozlesme_bedeli ?? null)
  );

  const [geciciKabulFile, setGeciciKabulFile] = useState<File | null>(null);
  const [kesinKabulFile, setKesinKabulFile] = useState<File | null>(null);
  const [isDeneyimFile, setIsDeneyimFile] = useState<File | null>(null);

  const [formData, setFormData] = useState<SantiyeInsert>({
    durum: santiye?.durum ?? "aktif",
    is_adi: santiye?.is_adi ?? "",
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.is_adi?.trim()) { toast.error("İşin adı zorunludur."); return; }

    setLoading(true);
    let basarili = false;

    try {
      const submitData: SantiyeInsert = {
        ...formData,
        is_adi: formatBaslik(formData.is_adi),
        sozlesme_bedeli: parseParaInput(sozlesmeBedeliStr),
        depo_kapasitesi: depoVar ? formData.depo_kapasitesi : null,
      };

      let savedId: string;
      if (isEdit) {
        await updateSantiye(santiye.id, submitData);
        savedId = santiye.id;
      } else {
        const created = await createSantiye(submitData);
        savedId = created.id;
      }

      // Ortakları kaydet
      if (formData.is_ortak_girisim && ortaklar.length > 0) {
        await saveOrtaklar(savedId, ortaklar.filter((o) => o.firma_id));
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
        await saveSantiyeIsGruplari(savedId, gecerliDagilim);
      } catch { /* tablo yoksa sessiz atla */ }

      // Dosya yüklemeleri
      if (geciciKabulFile) {
        const url = await uploadSantiyeFile(geciciKabulFile, savedId, "gecici_kabul");
        await updateSantiye(savedId, { gecici_kabul_url: url });
      }
      if (kesinKabulFile) {
        const url = await uploadSantiyeFile(kesinKabulFile, savedId, "kesin_kabul");
        await updateSantiye(savedId, { kesin_kabul_url: url });
      }
      if (isDeneyimFile) {
        const url = await uploadSantiyeFile(isDeneyimFile, savedId, "is_deneyim");
        await updateSantiye(savedId, { is_deneyim_url: url });
      }

      basarili = true;
    } catch {
      toast.error(isEdit ? "İş güncellenirken hata oluştu." : "İş eklenirken hata oluştu.");
      setLoading(false);
    }

    if (basarili) {
      toast.success(isEdit ? "İş başarıyla güncellendi." : "İş başarıyla eklendi.");
      window.location.href = "/dashboard/yonetim/santiyeler";
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Tabs defaultValue="genel" className="w-full">
        <TabsList className="mb-4 flex-wrap">
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
                    value={formData.is_adi}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, is_adi: formatBaslik(e.target.value) }))}
                    disabled={loading}
                  />
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
                  <div className="relative">
                    <Input
                      id="sozlesme_bedeli"
                      placeholder="0,00"
                      value={sozlesmeBedeliStr}
                      onChange={(e) => setSozlesmeBedeliStr(e.target.value)}
                      onBlur={() => {
                        const val = parseParaInput(sozlesmeBedeliStr);
                        setSozlesmeBedeliStr(val != null ? formatParaInput(val) : "");
                      }}
                      disabled={loading}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₺</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sozlesme_tarihi">Sözleşme Tarihi</Label>
                  <Input id="sozlesme_tarihi" name="sozlesme_tarihi" type="date" value={formData.sozlesme_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="isyeri_teslim_tarihi">İş Yeri Teslim Tarihi</Label>
                  <Input id="isyeri_teslim_tarihi" name="isyeri_teslim_tarihi" type="date" value={formData.isyeri_teslim_tarihi ?? ""} onChange={handleChange} disabled={loading} />
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
                  <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                    <Upload size={16} />
                    {geciciKabulFile ? geciciKabulFile.name : "PDF Yükle"}
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setGeciciKabulFile(e.target.files?.[0] ?? null)} disabled={loading} />
                  </label>
                  {santiye?.gecici_kabul_url && !geciciKabulFile && <span className="text-xs text-green-600">Mevcut dosya yüklü</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="kesin_kabul_tarihi">Kesin Kabul Tarihi</Label>
                  <Input id="kesin_kabul_tarihi" name="kesin_kabul_tarihi" type="date" value={formData.kesin_kabul_tarihi ?? ""} onChange={handleChange} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label>Kesin Kabul Belgesi (PDF)</Label>
                  <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                    <Upload size={16} />
                    {kesinKabulFile ? kesinKabulFile.name : "PDF Yükle"}
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setKesinKabulFile(e.target.files?.[0] ?? null)} disabled={loading} />
                  </label>
                  {santiye?.kesin_kabul_url && !kesinKabulFile && <span className="text-xs text-green-600">Mevcut dosya yüklü</span>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>İş Deneyim Belgesi (PDF)</Label>
                <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
                  <Upload size={16} />
                  {isDeneyimFile ? isDeneyimFile.name : "PDF Yükle"}
                  <input type="file" accept=".pdf" className="hidden" onChange={(e) => setIsDeneyimFile(e.target.files?.[0] ?? null)} disabled={loading} />
                </label>
                {santiye?.is_deneyim_url && !isDeneyimFile && <span className="text-xs text-green-600">Mevcut dosya yüklü</span>}
              </div>

              {/* İş Grubu Dağılımı — 3 kademeli seçim */}
              {isGrupAnaList.length > 0 && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-lg border mt-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-[#1E3A5F]">İş Grubu Dağılımı</Label>
                    <Button type="button" size="sm" variant="outline" onClick={() => setIsGrupDagilimi((prev) => [...prev, { ana: "", alt: "", detay: "", tutar: "" }])} disabled={loading}>
                      <Plus size={14} className="mr-1" /> İş Grubu Ekle
                    </Button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Sözleşme fiyatlarıyla gerçekleşen tutarın iş gruplarına dağılımını girin. Toplamları gerçekleşen tutara eşit olmalıdır.
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
                              disabled={loading}
                              className={selectClass + " text-xs"}
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
                                disabled={loading || !d.ana}
                                className={selectClass + " text-xs"}
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
                                disabled={loading || !d.alt || filtreliDetay.length === 0}
                                className={selectClass + " text-xs"}
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
                            onClick={() => setIsGrupDagilimi((prev) => prev.filter((_, j) => j !== i))} disabled={loading}>
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
                            disabled={loading}
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

      <div className="flex items-center justify-end gap-3 mt-6">
        <Button type="button" variant="outline" onClick={() => router.push("/dashboard/yonetim/santiyeler")} disabled={loading}>
          <X size={16} className="mr-1" /> İptal
        </Button>
        <Button type="submit" className="bg-[#F97316] hover:bg-[#ea580c] text-white" disabled={loading}>
          <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
