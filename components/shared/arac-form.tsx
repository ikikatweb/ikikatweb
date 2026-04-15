// Araç formu bileşeni - Özmal ve kiralık araç ekleme/düzenleme
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createArac,
  updateArac,
  uploadRuhsat,
} from "@/lib/supabase/queries/araclar";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { getAraclar } from "@/lib/supabase/queries/araclar";
import { getSantiyeler } from "@/lib/supabase/queries/santiyeler";
import type { Arac, AracInsert, Firma, Santiye } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, X, Upload, Download, FileCheck } from "lucide-react";
import { getDegerler, getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import type { Tanimlama } from "@/lib/supabase/types";
import { formatBaslik, formatPlaka } from "@/lib/utils/isim";
import toast from "react-hot-toast";

type AracFormProps = {
  arac?: Arac;
  tip: "ozmal" | "kiralik";
  // Eğer verilirse: kayıt başarılı olunca yönlendirme yapmaz, callback çağırır
  onSuccess?: () => void;
  onCancel?: () => void;
};

const selectClass =
  "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50";

// Türkçe duyarlı case-insensitive arama için normalize fonksiyonu
// "İkikat" == "ikikat" == "IKIKAT" eşleşir
function normalizeArama(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/i̇/g, "i") // combining karakteri temizle
    .trim();
}

export default function AracForm({ arac, tip, onSuccess, onCancel }: AracFormProps) {
  const isEdit = !!arac;
  const formTip = arac?.tip ?? tip;
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [kiralamaFirmalari, setKiralamaFirmalari] = useState<string[]>([]);
  const [santiyeler, setSantiyeler] = useState<Santiye[]>([]);
  const [ruhsatFile, setRuhsatFile] = useState<File | null>(null);
  const [aracCinsleri, setAracCinsleri] = useState<string[]>([]);
  // arac_cinsi tanımlamaları: deger → kisa_ad (km/saat) map'i
  const [cinsSayacMap, setCinsSayacMap] = useState<Map<string, string>>(new Map());
  const [hgsBankalari, setHgsBankalari] = useState<string[]>([]);
  const [yakitTipleri, setYakitTipleri] = useState<string[]>([]);

  // Kiralama firması autocomplete state'leri
  const [kiralamaOneriAcik, setKiralamaOneriAcik] = useState(false);
  const [kiralamaSeciliIndex, setKiralamaSeciliIndex] = useState(-1);

  const [formData, setFormData] = useState<AracInsert>({
    tip: formTip,
    durum: arac?.durum ?? "aktif",
    plaka: arac?.plaka ?? "",
    marka: arac?.marka ?? "",
    model: arac?.model ?? "",
    cinsi: arac?.cinsi ?? "",
    yili: arac?.yili ?? null,
    sayac_tipi: arac?.sayac_tipi ?? "km",
    guncel_gosterge: arac?.guncel_gosterge ?? null,
    santiye_id: arac?.santiye_id ?? null,
    firma_id: arac?.firma_id ?? null,
    hgs_saglayici: arac?.hgs_saglayici ?? null,
    motor_no: arac?.motor_no ?? "",
    sase_no: arac?.sase_no ?? "",
    yakit_tipi: arac?.yakit_tipi ?? null,
    son_muayene_tarihi: arac?.son_muayene_tarihi ?? null,
    trafik_sigorta_bitis: arac?.trafik_sigorta_bitis ?? null,
    kasko_bitis: arac?.kasko_bitis ?? null,
    muayene_bitis: arac?.muayene_bitis ?? null,
    tasit_karti_bitis: arac?.tasit_karti_bitis ?? null,
    ruhsat_url: arac?.ruhsat_url ?? null,
    kiralama_firmasi: arac?.kiralama_firmasi ?? "",
    kiralik_iletisim: arac?.kiralik_iletisim ?? "",
  });

  useEffect(() => {
    async function loadDropdowns() {
      try {
        const [firmaData, santiyeData, cinsler, cinsTanimData, hgsler, yakitlar, aracData] = await Promise.all([
          getFirmalar(),
          getSantiyeler(),
          getDegerler("arac_cinsi"),
          getTanimlamalar("arac_cinsi").catch(() => []),
          getDegerler("hgs_saglayici"),
          getDegerler("yakit_tipi"),
          getAraclar().catch(() => []),
        ]);
        setFirmalar(firmaData ?? []);
        // Mevcut araçlardan benzersiz kiralama firma isimlerini çek
        const kiraSet = new Set<string>();
        for (const a of (aracData ?? []) as { kiralama_firmasi?: string | null }[]) {
          if (a.kiralama_firmasi?.trim()) kiraSet.add(a.kiralama_firmasi.trim());
        }
        setKiralamaFirmalari(Array.from(kiraSet).sort((a, b) => a.localeCompare(b, "tr")));
        setSantiyeler(santiyeData ?? []);
        setAracCinsleri(cinsler);
        // cins → sayaç tipi map'i (kisa_ad'dan)
        const sMap = new Map<string, string>();
        for (const t of (cinsTanimData as Tanimlama[])) {
          if (t.kisa_ad) sMap.set(t.deger, t.kisa_ad);
        }
        setCinsSayacMap(sMap);
        setHgsBankalari(hgsler);
        setYakitTipleri(yakitlar);
      } catch { /* sessiz */ }
    }
    loadDropdowns();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "yili" || name === "guncel_gosterge"
          ? value ? parseInt(value) : null
          : value || null,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.plaka?.trim()) {
      toast.error("Plaka zorunludur.");
      return;
    }
    if (formData.yakit_tipi?.toUpperCase() === "LPG") {
      toast.error("LPG tek başına yakıt tipi olamaz. Benzin+LPG olarak seçiniz.");
      return;
    }

    setLoading(true);

    let basarili = false;

    try {
      // Önce ruhsat dosyasını yükle (varsa)
      let ruhsatUrl = formData.ruhsat_url;
      if (ruhsatFile) {
        try {
          const uploadId = isEdit ? arac.id : crypto.randomUUID();
          ruhsatUrl = await uploadRuhsat(ruhsatFile, uploadId);
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          console.error("RUHSAT YÜKLEME HATASI:", msg);
          toast.error(`Ruhsat yükleme hatası: ${msg}`, { duration: 10000 });
        }
      }

      // Format uygula: plaka BÜYÜK, marka/model/kiralama_firmasi title case
      const submitData = {
        ...formData,
        ruhsat_url: ruhsatUrl,
        plaka: formatPlaka(formData.plaka),
        marka: formData.marka ? formatBaslik(formData.marka) : formData.marka,
        model: formData.model ? formatBaslik(formData.model) : formData.model,
        kiralama_firmasi: formData.kiralama_firmasi ? formatBaslik(formData.kiralama_firmasi) : formData.kiralama_firmasi,
      };

      if (isEdit) {
        await updateArac(arac.id, submitData);
      } else {
        await createArac(submitData);
      }

      basarili = true;
    } catch (saveErr) {
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error("ARAÇ KAYDETME HATASI:", msg);
      toast.error(
        isEdit
          ? `Araç güncellenirken hata: ${msg}`
          : `Araç eklenirken hata: ${msg}`
      );
      setLoading(false);
    }

    if (basarili) {
      toast.success(isEdit ? "Araç başarıyla güncellendi." : "Araç başarıyla eklendi.");
      if (onSuccess) {
        onSuccess();
        setLoading(false);
      } else {
        window.location.href = "/dashboard/yonetim/araclar";
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plaka">
                Plaka <span className="text-red-500">*</span>
              </Label>
              <Input
                id="plaka"
                name="plaka"
                placeholder="60 ADR 790"
                value={formData.plaka}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    plaka: e.target.value.toLocaleUpperCase("tr-TR"),
                  }))
                }
                onBlur={(e) => setFormData((p) => ({ ...p, plaka: formatPlaka(e.target.value) }))}
                disabled={loading}
                style={{ textTransform: "uppercase" }}
              />
            </div>

            {formTip === "kiralik" && (
              <>
                <div className="space-y-2 relative">
                  <Label htmlFor="kiralama_firmasi">Kiralama Firması</Label>
                  <Input
                    id="kiralama_firmasi"
                    name="kiralama_firmasi"
                    placeholder="Firma adını yazın... (örn: ikikat, kad)"
                    value={formData.kiralama_firmasi ?? ""}
                    onChange={(e) => {
                      handleChange(e);
                      setKiralamaOneriAcik(true);
                      setKiralamaSeciliIndex(-1);
                    }}
                    onFocus={() => setKiralamaOneriAcik(true)}
                    onBlur={(e) => {
                      // Dropdown tıklamasına fırsat ver
                      setTimeout(() => setKiralamaOneriAcik(false), 150);
                      setFormData((p) => ({ ...p, kiralama_firmasi: formatBaslik(e.target.value) }));
                    }}
                    onKeyDown={(e) => {
                      const q = normalizeArama(formData.kiralama_firmasi ?? "");
                      if (!q) return;
                      const firmaOneriler2 = firmalar.filter((f) =>
                        normalizeArama(f.firma_adi).includes(q) || (f.kisa_adi && normalizeArama(f.kisa_adi).includes(q))
                      ).map((f) => f.firma_adi);
                      const firmaAdlari2 = new Set(firmaOneriler2);
                      const kiraOneriler2 = kiralamaFirmalari.filter((k) => normalizeArama(k).includes(q) && !firmaAdlari2.has(k));
                      const tumOneriler2 = [...firmaOneriler2, ...kiraOneriler2].slice(0, 8);
                      if (tumOneriler2.length === 0) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setKiralamaSeciliIndex((i) => Math.min(i + 1, tumOneriler2.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setKiralamaSeciliIndex((i) => Math.max(i - 1, 0));
                      } else if (e.key === "Enter" && kiralamaSeciliIndex >= 0) {
                        e.preventDefault();
                        const secili = tumOneriler2[kiralamaSeciliIndex];
                        setFormData((p) => ({ ...p, kiralama_firmasi: secili }));
                        setKiralamaOneriAcik(false);
                        setKiralamaSeciliIndex(-1);
                      } else if (e.key === "Escape") {
                        setKiralamaOneriAcik(false);
                      }
                    }}
                    disabled={loading}
                    autoComplete="off"
                  />
                  {/* Autocomplete öneri dropdown'u */}
                  {kiralamaOneriAcik && (formData.kiralama_firmasi ?? "").trim().length >= 1 && (() => {
                    const q = normalizeArama(formData.kiralama_firmasi ?? "");
                    // Firmalar tablosundan
                    const firmaOneriler = firmalar.filter((f) =>
                      normalizeArama(f.firma_adi).includes(q) || (f.kisa_adi && normalizeArama(f.kisa_adi).includes(q))
                    ).map((f) => f.firma_adi);
                    // Mevcut kiralama firmalarından (firmalar tablosunda olmayanlar)
                    const firmaAdlari = new Set(firmaOneriler);
                    const kiraOneriler = kiralamaFirmalari.filter((k) => normalizeArama(k).includes(q) && !firmaAdlari.has(k));
                    const tumOneriler = [...firmaOneriler, ...kiraOneriler].slice(0, 8);

                    if (tumOneriler.length === 0) return null;
                    if (tumOneriler.length === 1 && normalizeArama(tumOneriler[0]) === q) return null;

                    return (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase font-semibold border-b bg-gray-50">
                          Firmalar
                        </div>
                        {tumOneriler.map((ad, idx) => {
                          const aktifMi = idx === kiralamaSeciliIndex;
                          return (
                            <button
                              key={ad}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setFormData((p) => ({ ...p, kiralama_firmasi: ad }));
                                setKiralamaOneriAcik(false);
                                setKiralamaSeciliIndex(-1);
                              }}
                              onMouseEnter={() => setKiralamaSeciliIndex(idx)}
                              className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors ${
                                aktifMi ? "bg-blue-50" : "hover:bg-gray-50"
                              }`}
                            >
                              <div className="font-medium text-gray-800">{ad}</div>
                            </button>
                          );
                        })}
                        <div className="px-3 py-1.5 text-[9px] text-gray-400 bg-gray-50 border-t">
                          ↑↓ ile gez, Enter ile seç, ya da yeni firma adı yazmaya devam edin
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kiralik_iletisim">İletişim Numarası</Label>
                  <Input
                    id="kiralik_iletisim"
                    name="kiralik_iletisim"
                    placeholder="0(5xx) xxx xx xx"
                    value={formData.kiralik_iletisim ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {formTip === "ozmal" && (
              <div className="space-y-2">
                <Label htmlFor="firma_id">Firma</Label>
                <select
                  id="firma_id"
                  name="firma_id"
                  value={formData.firma_id ?? ""}
                  onChange={handleChange}
                  disabled={loading}
                  className={selectClass}
                >
                  <option value="">Seçiniz</option>
                  {firmalar.map((f) => (
                    <option key={f.id} value={f.id}>{f.firma_adi}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="marka">Marka</Label>
              <Input
                id="marka"
                name="marka"
                placeholder="Ford"
                value={formData.marka ?? ""}
                onChange={handleChange}
                onBlur={(e) => setFormData((p) => ({ ...p, marka: formatBaslik(e.target.value) }))}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                name="model"
                placeholder="Transit"
                value={formData.model ?? ""}
                onChange={handleChange}
                onBlur={(e) => setFormData((p) => ({ ...p, model: formatBaslik(e.target.value) }))}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cinsi">Cinsi</Label>
              <select
                id="cinsi"
                name="cinsi"
                value={formData.cinsi ?? ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  const sayac = (val ? (cinsSayacMap.get(val) ?? "km") : formData.sayac_tipi) as "km" | "saat" | null;
                  setFormData((prev) => ({ ...prev, cinsi: val, sayac_tipi: sayac }));
                }}
                disabled={loading}
                className={selectClass}
              >
                <option value="">Seçiniz</option>
                {aracCinsleri.map((c) => (
                  <option key={c} value={c}>{c} ({cinsSayacMap.get(c) ?? "km"})</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="yili">Model Yılı</Label>
              <select
                id="yili"
                name="yili"
                value={formData.yili ?? ""}
                onChange={handleChange}
                disabled={loading}
                className={selectClass}
              >
                <option value="">Seçiniz</option>
                {Array.from({ length: new Date().getFullYear() - 1989 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Sayaç tipi araç cinsinden otomatik belirlenir — gizli alan */}
            <input type="hidden" name="sayac_tipi" value={formData.sayac_tipi ?? "km"} />

            <div className="space-y-2">
              <Label htmlFor="guncel_gosterge">Güncel Gösterge</Label>
              <Input
                id="guncel_gosterge"
                name="guncel_gosterge"
                type="text" inputMode="numeric"
                placeholder="0"
                value={formData.guncel_gosterge ?? ""}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="santiye_id">Çalıştığı Şantiye</Label>
              <select
                id="santiye_id"
                name="santiye_id"
                value={formData.santiye_id ?? ""}
                onChange={handleChange}
                disabled={loading}
                className={selectClass}
              >
                <option value="">Seçiniz</option>
                {santiyeler.map((s) => (
                  <option key={s.id} value={s.id}>{s.is_adi}</option>
                ))}
              </select>
            </div>
          </div>

          {formTip === "ozmal" && (
            <>
              <hr className="my-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="hgs_saglayici">HGS Sağlayıcı</Label>
                  <select
                    id="hgs_saglayici"
                    name="hgs_saglayici"
                    value={formData.hgs_saglayici ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                    className={selectClass}
                  >
                    <option value="">Yok / Seçiniz</option>
                    {hgsBankalari.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="motor_no">Motor No</Label>
                  <Input
                    id="motor_no"
                    name="motor_no"
                    placeholder="Motor numarası"
                    value={formData.motor_no ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sase_no">Şase No</Label>
                  <Input
                    id="sase_no"
                    name="sase_no"
                    placeholder="Şase numarası"
                    value={formData.sase_no ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="yakit_tipi">Yakıt Tipi</Label>
                  <select
                    id="yakit_tipi"
                    name="yakit_tipi"
                    value={formData.yakit_tipi ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                    className={selectClass}
                  >
                    <option value="">Seçiniz</option>
                    {yakitTipleri.filter((y) => y.toUpperCase() !== "LPG").map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="son_muayene_tarihi">Son Muayene Tarihi</Label>
                  <Input
                    id="son_muayene_tarihi"
                    name="son_muayene_tarihi"
                    type="date"
                    value={formData.son_muayene_tarihi ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        son_muayene_tarihi: e.target.value || null,
                      }))
                    }
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Ruhsat Fotokopisi (PDF)</Label>
                  {arac?.ruhsat_url && !ruhsatFile ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-md">
                        <FileCheck size={16} className="text-green-600" />
                        <span className="text-sm text-green-700 font-medium">Ruhsat yüklü</span>
                      </div>
                      <a
                        href={arac.ruhsat_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#1E3A5F] text-white rounded-md hover:bg-[#2a4f7a] transition-colors text-sm"
                      >
                        <Download size={14} />
                        İndir
                      </a>
                      <label className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50 transition-colors text-sm text-gray-600">
                        <Upload size={14} />
                        Değiştir
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(e) => setRuhsatFile(e.target.files?.[0] ?? null)}
                          disabled={loading}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm">
                        <Upload size={16} />
                        {ruhsatFile ? ruhsatFile.name : "PDF Yükle"}
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(e) => setRuhsatFile(e.target.files?.[0] ?? null)}
                          disabled={loading}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel ? onCancel() : router.push("/dashboard/yonetim/araclar"); }}
          disabled={loading}
        >
          <X size={16} className="mr-1" />
          İptal
        </Button>
        <Button
          type="submit"
          className="bg-[#F97316] hover:bg-[#ea580c] text-white"
          disabled={loading}
        >
          <Save size={16} className="mr-1" />
          {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
