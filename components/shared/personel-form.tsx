// Personel formu bileşeni - Çalışan ekleme/düzenleme
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPersonel, updatePersonel, getPasifPersonelByTc, setPersonelAktif } from "@/lib/supabase/queries/personel";
import { addPersonelSantiye } from "@/lib/supabase/queries/personel-santiye";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import {
  getPersonelBrutUcretler,
  insertPersonelBrutUcret,
  updatePersonelBrutUcret,
  deletePersonelBrutUcret,
} from "@/lib/supabase/queries/personel-brut-ucret";
import type { Tanimlama, PersonelBrutUcret } from "@/lib/supabase/types";
import { formatKisiAdi, formatBaslik } from "@/lib/utils/isim";
import { useAuth } from "@/hooks";
import { Trash2, Plus } from "lucide-react";
import type { Personel, PersonelInsert } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, X } from "lucide-react";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import toast from "react-hot-toast";

// Telefon formatlama: 0535 535 35 35
function formatTelefon(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

type PersonelFormProps = {
  personel?: Personel;
  // Dialog/inline kullanım için: başarılı kayıt sonrası navigate yerine bu fonksiyon çağrılır
  onSuccess?: () => void;
  onCancel?: () => void;
};

type SantiyeBasic = { id: string; is_adi: string; durum: string };

const selectClass =
  "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50";

export default function PersonelForm({ personel, onSuccess, onCancel }: PersonelFormProps) {
  const isEdit = !!personel;
  const router = useRouter();
  const { isYonetici, isShantiyeAdmin } = useAuth();
  // Brüt ücret sadece admin (yönetici) ve şantiye yöneticisi tarafından görülür/düzenlenir
  const brutUcretYetkili = isYonetici || isShantiyeAdmin;

  const [loading, setLoading] = useState(false);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [meslekler, setMeslekler] = useState<string[]>([]);
  // Maaş için ayrı gösterim state'i (input cursor'unun bozulmaması için)
  const [maasInput, setMaasInput] = useState<string>(
    personel?.maas != null ? formatParaInput(personel.maas.toFixed(2).replace(".", ",")) : ""
  );
  // Brüt ücret geçmişi (kira bedeli mantığında: her değişiklikte yeni satır)
  const [brutUcretGecmisi, setBrutUcretGecmisi] = useState<PersonelBrutUcret[]>([]);
  // Yeni brüt ücret kaydı için input
  const [yeniBrutUcret, setYeniBrutUcret] = useState<string>("");
  const [yeniBrutTarih, setYeniBrutTarih] = useState<string>(new Date().toISOString().slice(0, 10));
  const [brutKaydetYukleniyor, setBrutKaydetYukleniyor] = useState(false);
  // Geçmiş satırı düzenleme
  const [editBrutId, setEditBrutId] = useState<string | null>(null);
  const [editBrutUcret, setEditBrutUcret] = useState<string>("");
  const [editBrutTarih, setEditBrutTarih] = useState<string>("");
  const [gorevler, setGorevler] = useState<string[]>([]);
  // Pasif personel yeniden işe alma: TC ile bulunan pasif personel ID'si
  const [pasifBulunanId, setPasifBulunanId] = useState<string | null>(null);
  const [pasifBilgi, setPasifBilgi] = useState<string>("");

  const [formData, setFormData] = useState<PersonelInsert>({
    tc_kimlik_no: personel?.tc_kimlik_no ?? "",
    ad_soyad: personel?.ad_soyad ?? "",
    meslek: personel?.meslek ?? "",
    gorev: personel?.gorev ?? "",
    santiye_id: personel?.santiye_id ?? null,
    maas: personel?.maas ?? null,
    izin_hakki: personel?.izin_hakki ?? null,
    mesai_ucreti_var: personel?.mesai_ucreti_var ?? false,
    ise_giris_tarihi: personel?.ise_giris_tarihi ?? null,
    ev_telefon: personel?.ev_telefon ?? null,
    cep_telefon: personel?.cep_telefon ?? null,
    durum: personel?.durum ?? "aktif",
    pasif_tarihi: personel?.pasif_tarihi ?? null,
  });

  // Brüt ücret geçmişini yükle (sadece düzenleme modunda + yetkili kullanıcı için)
  async function loadBrutUcretGecmisi() {
    if (!personel?.id || !brutUcretYetkili) return;
    const list = await getPersonelBrutUcretler(personel.id);
    setBrutUcretGecmisi(list);
  }

  useEffect(() => {
    loadBrutUcretGecmisi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personel?.id, brutUcretYetkili]);

  useEffect(() => {
    async function loadData() {
      try {
        const [sData, mData, gData] = await Promise.all([
          getSantiyelerAll(),
          getTanimlamalar("personel_meslek").catch(() => []),
          getTanimlamalar("personel_gorev").catch(() => []),
        ]);
        setSantiyeler((sData as SantiyeBasic[]) ?? []);
        setMeslekler((mData as Tanimlama[]).map((t) => t.deger));
        setGorevler((gData as Tanimlama[]).map((t) => t.deger));
      } catch { /* sessiz */ }
    }
    loadData();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    const numericFields = ["maas", "izin_hakki"];
    setFormData((prev) => ({
      ...prev,
      [name]: numericFields.includes(name)
        ? value ? parseFloat(value.replace(",", ".")) : null
        : value,
    }));
  }

  // TC 11 hane olduğunda pasif personel ara ve form'u doldur
  async function handleTcChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, tc_kimlik_no: value }));

    // Sadece yeni ekleme modunda ve 11 hane olduğunda ara
    if (isEdit || value.length !== 11 || !/^\d{11}$/.test(value)) {
      setPasifBulunanId(null);
      setPasifBilgi("");
      return;
    }

    try {
      const pasif = await getPasifPersonelByTc(value);
      if (pasif) {
        // Tüm verileri doldur, maaş hariç (boş bırak)
        setFormData({
          tc_kimlik_no: pasif.tc_kimlik_no,
          ad_soyad: pasif.ad_soyad,
          meslek: pasif.meslek ?? "",
          gorev: pasif.gorev ?? "",
          santiye_id: pasif.santiye_id,
          maas: null, // maaş boş — kullanıcı dolduracak
          izin_hakki: pasif.izin_hakki,
          mesai_ucreti_var: pasif.mesai_ucreti_var,
          ise_giris_tarihi: new Date().toISOString().slice(0, 10),
          ev_telefon: pasif.ev_telefon ?? null,
          cep_telefon: pasif.cep_telefon ?? null,
          durum: "aktif",
          pasif_tarihi: null,
        });
        setMaasInput(""); // maaş gösterimi de sıfırla
        setPasifBulunanId(pasif.id);
        const tarihStr = pasif.pasif_tarihi
          ? new Date(pasif.pasif_tarihi).toLocaleDateString("tr-TR")
          : "";
        setPasifBilgi(`${pasif.ad_soyad}${tarihStr ? ` — ${tarihStr} tarihinde ayrılmış` : ""}`);
        toast.success(`Pasif personel bulundu: ${pasif.ad_soyad}. Maaşı girip kaydedin.`, { duration: 6000 });
      } else {
        setPasifBulunanId(null);
        setPasifBilgi("");
      }
    } catch {
      setPasifBulunanId(null);
      setPasifBilgi("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.tc_kimlik_no || formData.tc_kimlik_no.length !== 11) {
      toast.error("TC Kimlik Numarası 11 haneli olmalıdır.");
      return;
    }

    if (!/^\d{11}$/.test(formData.tc_kimlik_no)) {
      toast.error("TC Kimlik Numarası sadece rakamlardan oluşmalıdır.");
      return;
    }

    if (!formData.ad_soyad?.trim()) {
      toast.error("Ad Soyad zorunludur.");
      return;
    }

    // Maaş zorunlu (yeni ekleme + pasif yeniden aktif)
    if (!isEdit && (formData.maas == null || formData.maas <= 0)) {
      toast.error("Maaş zorunludur.");
      return;
    }

    // Cep telefonu zorunlu
    if (!formData.cep_telefon || !formData.cep_telefon.trim()) {
      toast.error("Cep telefonu zorunludur.");
      return;
    }

    // Ad soyadı, meslek ve görev için standart format uygula
    const submitData = {
      ...formData,
      ad_soyad: formatKisiAdi(formData.ad_soyad),
      meslek: formData.meslek ? formatBaslik(formData.meslek) : formData.meslek,
      gorev: formData.gorev ? formatBaslik(formData.gorev) : formData.gorev,
    };

    setLoading(true);
    let basarili = false;

    try {
      if (isEdit) {
        await updatePersonel(personel.id, submitData);
        basarili = true;
      } else if (pasifBulunanId) {
        // Pasif personel yeniden işe alım: aktif yap + güncelle (maaş, giriş tarihi vb.)
        await updatePersonel(pasifBulunanId, {
          ...submitData,
          durum: "aktif",
          pasif_tarihi: null,
        });
        basarili = true;
        // Şantiye seçildiyse otomatik atama ekle (varsa zaten silently başarısız olur)
        if (submitData.santiye_id) {
          try {
            await addPersonelSantiye(pasifBulunanId, submitData.santiye_id);
          } catch (atErr) {
            console.warn("Otomatik şantiye ataması başarısız:", atErr);
          }
        }
      } else {
        const yeni = await createPersonel(submitData);
        basarili = true;
        // Şantiye seçildiyse personel_santiye junction'a otomatik atama ekle
        // (puantaj sayfasında listede görünmesi için gerekli)
        if (submitData.santiye_id && yeni?.id) {
          try {
            await addPersonelSantiye(yeni.id, submitData.santiye_id);
          } catch (atErr) {
            console.warn("Otomatik şantiye ataması başarısız:", atErr);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Query seviyesindeki tekillik hatası (TC ya da ad_soyad zaten kayıtlı)
      if (msg.includes("zaten") || msg.includes("duplicate") || msg.includes("unique")) {
        toast.error(msg || "Bu personel zaten kayıtlı.", { duration: 6000 });
      } else if (msg.includes("brut_ucret") || msg.includes("column") && msg.includes("not exist")) {
        toast.error(
          `Veritabanında 'brut_ucret' sütunu yok. Supabase SQL editöründe şunu çalıştırın:\n\n` +
          `ALTER TABLE personel ADD COLUMN IF NOT EXISTS brut_ucret NUMERIC NULL;`,
          { duration: 12000 },
        );
      } else {
        toast.error(`${isEdit ? "Güncelleme" : "Ekleme"} hatası: ${msg}`, { duration: 8000 });
      }
      setLoading(false);
    }

    if (basarili) {
      toast.success(
        isEdit ? "Personel güncellendi."
          : pasifBulunanId ? "Personel tekrar aktif hale getirildi."
          : "Personel eklendi.",
      );
      // Dialog modunda onSuccess callback'i çağır; aksi halde navigate et
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = "/dashboard/yonetim/personel";
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ise_giris_tarihi">İşe Giriş Tarihi</Label>
              <Input id="ise_giris_tarihi" name="ise_giris_tarihi" type="date" value={formData.ise_giris_tarihi ?? ""} onChange={handleChange} disabled={loading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tc_kimlik_no">TC Kimlik No <span className="text-red-500">*</span></Label>
              <Input
                id="tc_kimlik_no"
                name="tc_kimlik_no"
                placeholder="11 haneli TC kimlik no"
                value={formData.tc_kimlik_no}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 11);
                  handleTcChange({ target: { value: val } } as React.ChangeEvent<HTMLInputElement>);
                }}
                maxLength={11}
                disabled={loading}
              />
              {formData.tc_kimlik_no && formData.tc_kimlik_no.length !== 11 && (
                <p className="text-xs text-red-500">{formData.tc_kimlik_no.length}/11 hane</p>
              )}
              {!isEdit && pasifBulunanId && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <div className="font-semibold">Pasif personel bulundu!</div>
                  <div>{pasifBilgi}</div>
                  <div className="text-[10px] text-amber-600 mt-1">Veriler otomatik dolduruldu. Maaşı girip kaydedin — personel tekrar aktif olacak.</div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ad_soyad">Ad Soyad <span className="text-red-500">*</span></Label>
              <Input
                id="ad_soyad"
                name="ad_soyad"
                placeholder="Ahmet Can KILINÇ"
                value={formData.ad_soyad}
                onChange={handleChange}
                onBlur={(e) => setFormData((p) => ({ ...p, ad_soyad: formatKisiAdi(e.target.value) }))}
                disabled={loading}
              />
              <p className="text-[10px] text-gray-400">Ad ve ikinci ad ilk harf büyük, soyad tamamı büyük yazılır (otomatik düzeltilir).</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="meslek">Meslek</Label>
              {meslekler.length > 0 ? (
                <div className="flex gap-1">
                  <select
                    id="meslek"
                    value={formData.meslek ?? ""}
                    onChange={(e) => setFormData((prev) => ({ ...prev, meslek: e.target.value || null }))}
                    disabled={loading}
                    className={selectClass}
                  >
                    <option value="">Meslek seçiniz</option>
                    {meslekler.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      const yeni = prompt("Yeni meslek adı:");
                      if (!yeni?.trim()) return;
                      try {
                        const { createTanimlama } = await import("@/lib/supabase/queries/tanimlamalar");
                        await createTanimlama({ kategori: "personel_meslek", deger: formatBaslik(yeni.trim()), sekme: "genel", sira: meslekler.length + 1, aktif: true });
                        setMeslekler((prev) => [...prev, formatBaslik(yeni.trim())]);
                        setFormData((prev) => ({ ...prev, meslek: formatBaslik(yeni.trim()) }));
                        toast.success("Meslek eklendi.");
                      } catch { toast.error("Meslek eklenemedi."); }
                    }}
                    className="shrink-0 h-9 w-9 rounded-lg border border-input bg-white flex items-center justify-center text-gray-500 hover:text-[#F97316] hover:border-[#F97316]"
                    title="Yeni meslek ekle"
                  >+</button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Input
                    id="meslek"
                    name="meslek"
                    placeholder="Ziraat Mühendisi"
                    value={formData.meslek ?? ""}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, meslek: formatBaslik(e.target.value) }))}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!formData.meslek?.trim()) { toast.error("Önce meslek adı yazın."); return; }
                      try {
                        const { createTanimlama } = await import("@/lib/supabase/queries/tanimlamalar");
                        await createTanimlama({ kategori: "personel_meslek", deger: formatBaslik(formData.meslek.trim()), sekme: "genel", sira: 1, aktif: true });
                        setMeslekler([formatBaslik(formData.meslek.trim())]);
                        toast.success("Meslek tanımlamalara eklendi.");
                      } catch { toast.error("Meslek eklenemedi."); }
                    }}
                    className="shrink-0 h-9 w-9 rounded-lg border border-input bg-white flex items-center justify-center text-gray-500 hover:text-[#F97316] hover:border-[#F97316]"
                    title="Tanımlamalara ekle"
                  >+</button>
                </div>
              )}
              <p className="text-[10px] text-gray-400">Listede yoksa + ile ekleyin.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gorev">Görev</Label>
              {gorevler.length > 0 ? (
                <div className="flex gap-1">
                  <select
                    id="gorev"
                    value={formData.gorev ?? ""}
                    onChange={(e) => setFormData((prev) => ({ ...prev, gorev: e.target.value || null }))}
                    disabled={loading}
                    className={selectClass}
                  >
                    <option value="">Görev seçiniz</option>
                    {gorevler.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      const yeni = prompt("Yeni görev adı:");
                      if (!yeni?.trim()) return;
                      try {
                        const { createTanimlama } = await import("@/lib/supabase/queries/tanimlamalar");
                        await createTanimlama({ kategori: "personel_gorev", deger: formatBaslik(yeni.trim()), sekme: "genel", sira: gorevler.length + 1, aktif: true });
                        setGorevler((prev) => [...prev, formatBaslik(yeni.trim())]);
                        setFormData((prev) => ({ ...prev, gorev: formatBaslik(yeni.trim()) }));
                        toast.success("Görev eklendi.");
                      } catch { toast.error("Görev eklenemedi."); }
                    }}
                    className="shrink-0 h-9 w-9 rounded-lg border border-input bg-white flex items-center justify-center text-gray-500 hover:text-[#F97316] hover:border-[#F97316]"
                    title="Yeni görev ekle"
                  >+</button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Input
                    id="gorev"
                    name="gorev"
                    placeholder="Aşçı"
                    value={formData.gorev ?? ""}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, gorev: formatBaslik(e.target.value) }))}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!formData.gorev?.trim()) { toast.error("Önce görev adı yazın."); return; }
                      try {
                        const { createTanimlama } = await import("@/lib/supabase/queries/tanimlamalar");
                        await createTanimlama({ kategori: "personel_gorev", deger: formatBaslik(formData.gorev.trim()), sekme: "genel", sira: 1, aktif: true });
                        setGorevler([formatBaslik(formData.gorev.trim())]);
                        toast.success("Görev tanımlamalara eklendi.");
                      } catch { toast.error("Görev eklenemedi."); }
                    }}
                    className="shrink-0 h-9 w-9 rounded-lg border border-input bg-white flex items-center justify-center text-gray-500 hover:text-[#F97316] hover:border-[#F97316]"
                    title="Tanımlamalara ekle"
                  >+</button>
                </div>
              )}
              <p className="text-[10px] text-gray-400">Listede yoksa + ile ekleyin.</p>
            </div>

            <div className="space-y-2">
              <Label>Çalıştığı Şantiye</Label>
              <SantiyeSelect santiyeler={santiyeler} value={formData.santiye_id ?? ""} onChange={(v) => setFormData((prev) => ({ ...prev, santiye_id: v || null }))} className={selectClass} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maas">Maaş (₺) {!isEdit && <span className="text-red-500">*</span>}</Label>
              <input id="maas" name="maas" type="text" inputMode="decimal" placeholder="0,00"
                value={maasInput}
                onChange={(e) => {
                  const formatted = formatParaInput(e.target.value);
                  setMaasInput(formatted);
                  const parsed = parseParaInput(formatted);
                  setFormData((p) => ({ ...p, maas: formatted.trim() === "" ? null : parsed }));
                }}
                disabled={loading}
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:opacity-50" />
            </div>

            {/* Brüt Ücret — sadece yönetici / şantiye yöneticisi görür ve düzenler.
                 Geçmiş tutulur: kira bedeli mantığı — her değişiklikte yeni satır,
                 hesaplamada o tarih için geçerli olan satır kullanılır. */}
            {brutUcretYetkili && isEdit && (
              <div className="space-y-2 md:col-span-2 lg:col-span-3 bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1">
                    Brüt Ücret (₺) Geçmişi
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">YÖNETİCİ</span>
                  </Label>
                  {brutUcretGecmisi.length > 0 && (
                    <span className="text-[10px] text-amber-700">
                      Aktif: {brutUcretGecmisi[0].ucret.toLocaleString("tr-TR")} ₺ ({new Date(brutUcretGecmisi[0].gecerli_tarih + "T00:00:00").toLocaleDateString("tr-TR")})
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-amber-700 leading-relaxed">
                  Brüt ücret değişebilir. Her değişiklikte yeni bir kayıt ekleyin — geçerlilik tarihi olarak değişikliğin başladığı tarihi girin.
                  Hesaplama her ay için o ayda geçerli olan ücreti kullanır (önceki tarihlerde eski ücret korunur).
                </p>

                {/* Yeni kayıt ekleme satırı */}
                <div className="flex flex-wrap items-end gap-2 bg-white border border-amber-300 rounded p-2">
                  <div className="flex-1 min-w-[120px]">
                    <Label className="text-[10px] text-gray-500">Yeni Tutar (₺)</Label>
                    <input type="text" inputMode="decimal" placeholder="0,00"
                      value={yeniBrutUcret}
                      onChange={(e) => setYeniBrutUcret(formatParaInput(e.target.value))}
                      className="w-full h-8 border rounded px-2 text-xs" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Label className="text-[10px] text-gray-500">Geçerlilik Başlangıç</Label>
                    <input type="date" value={yeniBrutTarih}
                      onChange={(e) => setYeniBrutTarih(e.target.value)}
                      className="w-full h-8 border rounded px-2 text-xs" />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white h-8"
                    disabled={brutKaydetYukleniyor || !yeniBrutUcret.trim() || !yeniBrutTarih}
                    onClick={async () => {
                      const parsed = parseParaInput(yeniBrutUcret);
                      if (!parsed || parsed <= 0) { toast.error("Geçerli bir tutar girin."); return; }
                      if (!yeniBrutTarih) { toast.error("Geçerlilik tarihi seçin."); return; }
                      setBrutKaydetYukleniyor(true);
                      try {
                        await insertPersonelBrutUcret(personel!.id, parsed, yeniBrutTarih);
                        toast.success("Brüt ücret kaydedildi.");
                        setYeniBrutUcret("");
                        setYeniBrutTarih(new Date().toISOString().slice(0, 10));
                        await loadBrutUcretGecmisi();
                      } catch (err) {
                        // Hata detaylarını topla (Supabase: { message, details, hint, code })
                        // PostgrestError property'leri her zaman enumerable değil; JSON ile yetinmeyelim.
                        const e = err as { message?: string; details?: string; hint?: string; code?: string; status?: number; name?: string };
                        const dumpEntries: Record<string, unknown> = {};
                        try {
                          const props = Object.getOwnPropertyNames(err as object);
                          for (const k of props) {
                            dumpEntries[k] = (err as Record<string, unknown>)[k];
                          }
                        } catch { /* sessiz */ }
                        console.error("Brüt ücret kayıt hatası:", err, dumpEntries, JSON.stringify(dumpEntries));
                        const code = e?.code ?? "";
                        const status = e?.status;
                        const msgText = [e?.message, e?.details, e?.hint].filter(Boolean).join(" — ")
                          || (err instanceof Error ? err.message : "")
                          || (Object.keys(dumpEntries).length > 0 ? JSON.stringify(dumpEntries) : "")
                          || String(err);
                        const tabloYok =
                          code === "42P01" ||
                          /relation .* does not exist/i.test(msgText) ||
                          /personel_brut_ucret/i.test(msgText);
                        const rlsHatasi = code === "42501" || /permission denied|row.level security|RLS/i.test(msgText);
                        if (tabloYok) {
                          toast.error(
                            `Veritabanında 'personel_brut_ucret' tablosu yok. Supabase SQL Editor'da şunu çalıştırın:\n\n` +
                            `CREATE TABLE personel_brut_ucret (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), personel_id UUID NOT NULL REFERENCES personel(id) ON DELETE CASCADE, ucret NUMERIC NOT NULL CHECK (ucret >= 0), gecerli_tarih DATE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), created_by UUID); ALTER TABLE personel_brut_ucret DISABLE ROW LEVEL SECURITY;`,
                            { duration: 18000 },
                          );
                        } else if (rlsHatasi) {
                          toast.error(
                            `RLS engelliyor. Supabase SQL Editor'da şunu çalıştırın:\n\nALTER TABLE personel_brut_ucret DISABLE ROW LEVEL SECURITY;`,
                            { duration: 14000 },
                          );
                        } else {
                          toast.error(
                            `Kayıt hatası${code ? ` (${code})` : ""}${status ? ` [HTTP ${status}]` : ""}: ${msgText || "Boş hata — F12 Console'a bakın"}`,
                            { duration: 12000 },
                          );
                        }
                      } finally {
                        setBrutKaydetYukleniyor(false);
                      }
                    }}
                  >
                    <Plus size={12} className="mr-1" /> Ekle
                  </Button>
                </div>

                {/* Geçmiş satırları */}
                {brutUcretGecmisi.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic text-center py-2">Henüz brüt ücret kaydı yok.</p>
                ) : (
                  <div className="bg-white border border-amber-200 rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100 text-amber-900">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold">Tutar (₺)</th>
                          <th className="px-2 py-1 text-left font-semibold">Geçerlilik</th>
                          <th className="px-2 py-1 text-center w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {brutUcretGecmisi.map((b, i) => (
                          <tr key={b.id} className={`border-t ${i === 0 ? "bg-amber-50 font-semibold" : ""}`}>
                            {editBrutId === b.id ? (
                              <>
                                <td className="px-2 py-1">
                                  <input type="text" inputMode="decimal" value={editBrutUcret}
                                    onChange={(e) => setEditBrutUcret(formatParaInput(e.target.value))}
                                    className="w-full h-7 border rounded px-2 text-xs" />
                                </td>
                                <td className="px-2 py-1">
                                  <input type="date" value={editBrutTarih}
                                    onChange={(e) => setEditBrutTarih(e.target.value)}
                                    className="w-full h-7 border rounded px-2 text-xs" />
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <div className="flex gap-1 justify-center">
                                    <button type="button"
                                      onClick={async () => {
                                        const parsed = parseParaInput(editBrutUcret);
                                        if (!parsed || parsed <= 0 || !editBrutTarih) { toast.error("Geçerli değer girin."); return; }
                                        try {
                                          await updatePersonelBrutUcret(b.id, parsed, editBrutTarih);
                                          toast.success("Güncellendi");
                                          setEditBrutId(null);
                                          await loadBrutUcretGecmisi();
                                        } catch (err) {
                                          toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
                                        }
                                      }}
                                      className="px-2 py-0.5 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700">
                                      OK
                                    </button>
                                    <button type="button" onClick={() => setEditBrutId(null)}
                                      className="px-2 py-0.5 text-[10px] bg-gray-200 rounded hover:bg-gray-300">İptal</button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-2 py-1">
                                  {b.ucret.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺
                                  {i === 0 && <span className="ml-1 text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded font-bold">AKTİF</span>}
                                </td>
                                <td className="px-2 py-1 text-gray-600">
                                  {new Date(b.gecerli_tarih + "T00:00:00").toLocaleDateString("tr-TR")}
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <div className="flex gap-1 justify-center">
                                    <button type="button"
                                      onClick={() => {
                                        setEditBrutId(b.id);
                                        setEditBrutUcret(formatParaInput(b.ucret.toFixed(2).replace(".", ",")));
                                        setEditBrutTarih(b.gecerli_tarih);
                                      }}
                                      className="text-[10px] text-blue-600 hover:underline">Düzenle</button>
                                    <button type="button"
                                      onClick={async () => {
                                        if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return;
                                        try {
                                          await deletePersonelBrutUcret(b.id);
                                          toast.success("Silindi");
                                          await loadBrutUcretGecmisi();
                                        } catch (err) {
                                          toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
                                        }
                                      }}
                                      className="text-red-500 hover:text-red-700"><Trash2 size={11} /></button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {brutUcretYetkili && !isEdit && (
              <div className="md:col-span-2 lg:col-span-3 bg-amber-50 border border-amber-200 rounded p-2 text-[11px] text-amber-700">
                💡 Brüt ücret bilgisi personel kaydedildikten sonra düzenleme ekranında girilebilir.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="izin_hakki">İzin Hakkı (Gün)</Label>
              <Input id="izin_hakki" name="izin_hakki" type="text" inputMode="numeric" placeholder="14" value={formData.izin_hakki ?? ""} onChange={handleChange} disabled={loading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cep_telefon">Cep Telefonu <span className="text-red-500">*</span></Label>
              <Input id="cep_telefon" name="cep_telefon" type="tel" placeholder="0535 535 35 35"
                value={formData.cep_telefon ?? ""}
                onChange={(e) => setFormData((p) => ({ ...p, cep_telefon: formatTelefon(e.target.value) || null }))}
                required
                disabled={loading} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev_telefon">Ev Telefonu</Label>
              <Input id="ev_telefon" name="ev_telefon" type="tel" placeholder="0356 214 35 35"
                value={formData.ev_telefon ?? ""}
                onChange={(e) => setFormData((p) => ({ ...p, ev_telefon: formatTelefon(e.target.value) || null }))}
                disabled={loading} />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Switch
              checked={formData.mesai_ucreti_var}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, mesai_ucreti_var: checked }))}
              disabled={loading}
            />
            <Label>Mesai Ücreti Alsın</Label>
          </div>

          {/* Durum: Aktif / Pasif (işten ayrıldı) — sadece düzenleme modunda */}
          {isEdit && <div className="border-t pt-4 mt-2 space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.durum === "pasif"}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({
                    ...prev,
                    durum: checked ? "pasif" : "aktif",
                    // Pasif'e geçerken bugünü varsayılan olarak ata; aktife dönerken temizle
                    pasif_tarihi: checked
                      ? prev.pasif_tarihi ?? new Date().toISOString().slice(0, 10)
                      : null,
                  }))
                }
                disabled={loading}
              />
              <Label>
                {formData.durum === "pasif" ? (
                  <span className="text-red-600 font-semibold">Pasif (İşten Ayrıldı)</span>
                ) : (
                  <span>Aktif Çalışan</span>
                )}
              </Label>
            </div>
            {formData.durum === "pasif" && (
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="pasif_tarihi">İşten Ayrılma Tarihi</Label>
                <Input
                  id="pasif_tarihi"
                  name="pasif_tarihi"
                  type="date"
                  value={formData.pasif_tarihi ?? ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      pasif_tarihi: e.target.value || null,
                    }))
                  }
                  disabled={loading}
                />
                <p className="text-[10px] text-gray-500">
                  Bu tarihten sonraki günlere puantaj işlenemez. Ayrıldığı aydan sonraki aylarda personel puantaj listesinde görünmez.
                </p>
              </div>
            )}
          </div>}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => onCancel ? onCancel() : router.push("/dashboard/yonetim/personel")}
          disabled={loading}
        >
          <X size={16} className="mr-1" /> İptal
        </Button>
        <Button type="submit" className="bg-[#F97316] hover:bg-[#ea580c] text-white" disabled={loading}>
          <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
