// Firma formu bileşeni - İki sekmeli: Firma Bilgileri + SMTP Mail Ayarları
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFirma,
  updateFirma,
  deleteFirma,
  uploadFirmaFile,
  deleteFirmaFile,
} from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import type { Firma, FirmaInsert } from "@/lib/supabase/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import KayitGecmisi from "@/components/shared/kayit-gecmisi";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, X, Upload, Trash2 } from "lucide-react";
import RenkSecici from "@/components/shared/renk-secici";
import toast from "react-hot-toast";
import { griKopyaUret, renkliMi } from "@/lib/utils/gri-antet";
import { antetGecmisineEkle } from "@/lib/supabase/queries/antet-gecmisi";
import { firmaLogolariOnbellegiDusur } from "@/lib/supabase/queries/firma-logolari";
import { logoDuzenle } from "@/lib/utils/logo-duzenle";
import { dosyaUrl } from "@/lib/utils/dosya-url";

type FirmaFormProps = {
  firma?: Firma;
  // onSuccess/onCancel verilirse: kayıt/iptal sonrası yönlendirme YAPILMAZ, callback çağrılır
  // (dialog/pencere içinde kullanım için). Verilmezse eski davranış: firmalar sayfasına gider.
  onSuccess?: () => void;
  onCancel?: () => void;
};

export default function FirmaForm({ firma, onSuccess, onCancel }: FirmaFormProps) {
  const isEdit = !!firma;
  const router = useRouter();
  const { hasPermission } = useAuth();
  const ySil = hasPermission("yonetim-firmalar", "sil");

  const [loading, setLoading] = useState(false);
  const [kaseFile, setKaseFile] = useState<File | null>(null);
  const [antetFile, setAntetFile] = useState<File | null>(null);
  // LOGO: kenar çubuğunda ve giriş ekranında dönen görsel. Antetten AYRI —
  // antet uzun bir şerit, o kutuda okunamayacak kadar küçülüyor.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Mevcut yüklü dosya URL'leri — silindiğinde UI bunları null'a çeker
  const [mevcutKaseUrl, setMevcutKaseUrl] = useState<string | null>(firma?.kase_url ?? null);
  const [mevcutAntetUrl, setMevcutAntetUrl] = useState<string | null>(firma?.antet_url ?? null);
  const [mevcutLogoUrl, setMevcutLogoUrl] = useState<string | null>(firma?.logo_url ?? null);

  async function handleDosyaSil(tip: "kase" | "antet" | "logo") {
    if (!firma?.id) return;
    const tipAd = tip === "kase" ? "kaşeyi" : tip === "logo" ? "logoyu" : "anteti";
    if (!confirm(`Mevcut ${tipAd} silmek istediğinize emin misiniz?`)) return;
    try {
      setLoading(true);
      await deleteFirmaFile(firma.id, tip);
      if (tip === "kase") setMevcutKaseUrl(null);
      else if (tip === "logo") { setMevcutLogoUrl(null); firmaLogolariOnbellegiDusur(); }
      else setMevcutAntetUrl(null);
      // KRİTİK: formData içindeki ESKİ URL'i de NULL yap — yoksa kullanıcı
      // formu kaydedince updateFirma eski URL'i geri yazar.
      setFormData((p) => ({
        ...p,
        ...(tip === "kase" ? { kase_url: null } : tip === "logo" ? { logo_url: null } : { antet_url: null }),
      }));
      toast.success(`${tip === "kase" ? "Kaşe" : tip === "logo" ? "Logo" : "Antet"} silindi.`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      toast.error(`Silme başarısız: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // Firmayı kalıcı sil — deleteFirma önce bağlı veri (araç, şantiye, evrak vb.) var mı kontrol eder;
  // varsa anlaşılır bir hata fırlatır ve silmez.
  async function handleSil() {
    if (!firma?.id) return;
    if (!confirm(`"${firma.firma_adi}" firmasını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return;
    setLoading(true);
    try {
      await deleteFirma(firma.id);
      toast.success("Firma silindi.");
      if (onSuccess) { onSuccess(); return; }
      window.location.href = "/dashboard/yonetim/firmalar";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/violates foreign key|referenced|constraint/i.test(msg)) {
        toast.error("Bu firmaya bağlı kayıtlar (araç, şantiye, evrak vb.) bulunuyor. Firma silinemez.");
      } else {
        toast.error(msg);
      }
      setLoading(false);
    }
  }

  const [formData, setFormData] = useState<FirmaInsert>({
    durum: firma?.durum ?? "aktif",
    firma_adi: firma?.firma_adi ?? "",
    kisa_adi: firma?.kisa_adi ?? "",
    vergi_no: firma?.vergi_no ?? "",
    adres: firma?.adres ?? "",
    yetkililer: firma?.yetkililer ?? [],
    renk: firma?.renk ?? "#1E3A5F",
    kase_url: firma?.kase_url ?? null,
    antet_url: firma?.antet_url ?? null,
    smtp_host: firma?.smtp_host ?? "",
    smtp_port: firma?.smtp_port ?? null,
    smtp_user: firma?.smtp_user ?? "",
    smtp_password: firma?.smtp_password ?? "",
    smtp_sender_name: firma?.smtp_sender_name ?? "",
    smtp_sender_email: firma?.smtp_sender_email ?? "",
    bizim_firma: firma?.bizim_firma ?? false,
  });

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "smtp_port" ? (value ? parseInt(value) : null) : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.firma_adi.trim()) {
      toast.error("Firma adı zorunludur.");
      return;
    }

    // Firma adı title case, kısa adı BÜYÜK harf
    const submitData = {
      ...formData,
      // Adı boş bırakılmış satırlar kaydedilmez.
      yetkililer: (formData.yetkililer ?? []).filter((y) => y.ad?.trim()).map((y) => ({
        ad: y.ad.trim(), gorev: y.gorev?.trim() || null,
      })),
      firma_adi: formatBaslik(formData.firma_adi),
      kisa_adi: formData.kisa_adi ? formatBuyukHarf(formData.kisa_adi) : formData.kisa_adi,
    };

    setLoading(true);

    try {
      let savedFirma: Firma;

      if (isEdit) {
        savedFirma = await updateFirma(firma.id, submitData);
        toast.success("Firma başarıyla güncellendi.");
      } else {
        savedFirma = await createFirma(submitData);
        toast.success("Firma başarıyla eklendi.");
      }

      // Dosya yüklemeleri
      if (kaseFile) {
        const kaseUrl = await uploadFirmaFile(kaseFile, savedFirma.id, "kase");
        await updateFirma(savedFirma.id, { kase_url: kaseUrl });
        setMevcutKaseUrl(kaseUrl);
      }
      if (logoFile) {
        // BOYUTLANDIRMA + BEYAZ ZEMİN TEMİZLİĞİ yükleme sırasında yapılır: kullanıcı
        // hangi boyutta verirse versin hepsi aynı tuvale ve aynı görsel ağırlığa gelir.
        // Düzenlenemezse YÜKLEME YAPILMAZ — ham logo kenar çubuğunda dev ya da beyaz
        // kutu olarak durur, kimse fark etmez (bkz. AGENTS.md "Sessiz hata yok").
        let hazirLogo: File;
        try {
          const sonuc = await logoDuzenle(logoFile);
          hazirLogo = sonuc.dosya;
          toast.success(`Logo düzenlendi: ${sonuc.ozet}`, { duration: 6000 });
        } catch (e) {
          console.error("[Logo] düzenlenemedi:", e);
          toast.error("Logo düzenlenemedi — YÜKLENMEDİ. Dosyayı PNG/JPG olarak kaydedip tekrar deneyin.", { duration: 9000 });
          setLoading(false);
          return;
        }
        // Logo da üzerine yazmaz: adres değişsin ki tarayıcı önbelleği eskisini göstermesin.
        const logoDamga = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
        const logoUrl = await uploadFirmaFile(hazirLogo, savedFirma.id, "logo", logoDamga);
        try {
          await updateFirma(savedFirma.id, { logo_url: logoUrl });
          setMevcutLogoUrl(logoUrl);
          firmaLogolariOnbellegiDusur();
        } catch (e) {
          // Kolon yoksa migrasyon çalıştırılmamıştır — SESSİZ GEÇME, söyle.
          const msg = e instanceof Error ? e.message : String(e);
          if (/logo_url|column|schema cache/i.test(msg)) {
            toast.error("Logo yüklendi ama kaydedilemedi: veritabanında 'logo_url' kolonu yok. sql/firmalar_logo.sql dosyasını Supabase'de çalıştırıp logoyu tekrar yükleyin.", { duration: 12000 });
          } else throw e;
        }
      }
      if (antetFile) {
        // ANTET İKİ DOSYA: yüklenen RENKLİ asıl mailde, tarayıcıda üretilen GRİ kopya
        // yazışma evraklarında kullanılır (bkz. sql/firmalar_antet_renkli.sql).
        // Gri kopya üretilemezse yükleme YAPILMAZ: sessizce geçilse yazışmalar renkli
        // antetle basılır ve kimse fark etmez (bkz. AGENTS.md "Sessiz hata yok").
        let griFile: File;
        try {
          griFile = await griKopyaUret(antetFile);
        } catch (e) {
          console.error("[Antet] gri kopya üretilemedi:", e);
          toast.error("Antetin siyah-beyaz kopyası üretilemedi — antet YÜKLENMEDİ. Dosyayı PNG/JPG olarak kaydedip tekrar deneyin.", { duration: 9000 });
          setLoading(false);
          return;
        }
        // ÜZERİNE YAZMA YOK: her antet kendi adresine gider, eski sürüm storage'da kalır —
        // o antetle yazılmış geçmiş yazışmalar eski antetini göstermeye devam etsin.
        const damga = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
        const renkliUrl = await uploadFirmaFile(antetFile, savedFirma.id, "antet-renkli", damga);
        const griUrl = await uploadFirmaFile(griFile, savedFirma.id, "antet", damga);
        try {
          await updateFirma(savedFirma.id, { antet_url: griUrl, antet_renkli_url: renkliUrl });
        } catch (e) {
          // antet_renkli_url kolonu yoksa migrasyon çalıştırılmamıştır. Gri antet yine de
          // kaydedilir (yazışmalar doğru basar), ama mail renkli gidemez — SÖYLENİR.
          const msg = e instanceof Error ? e.message : String(e);
          if (/antet_renkli_url|column|schema cache/i.test(msg)) {
            await updateFirma(savedFirma.id, { antet_url: griUrl });
            toast.error("Antet kaydedildi ama mailde RENKLİ gidemeyecek: veritabanında 'antet_renkli_url' kolonu yok. sql/firmalar_antet_renkli.sql dosyasını Supabase'de çalıştırın, sonra anteti tekrar yükleyin.", { duration: 12000 });
          } else throw e;
        }
        setMevcutAntetUrl(griUrl);
        // GEÇMİŞE İŞLE: bu antet bugünden itibaren geçerli. Yazılamazsa mutlaka SÖYLENİR —
        // sessiz geçilse geçmiş yazışmalar da yeni anteti göstermeye başlardı.
        try {
          await antetGecmisineEkle(savedFirma.id, griUrl, renkliUrl, new Date().toISOString().slice(0, 10));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[Antet] geçmişe yazılamadı:", e);
          toast.error(
            /firma_antet_gecmisi|does not exist|schema cache/i.test(msg)
              ? "Antet yüklendi ama GEÇMİŞE işlenemedi: 'firma_antet_gecmisi' tablosu yok. sql/firma_antet_gecmisi.sql dosyasını Supabase'de çalıştırın — yoksa eski yazışmalar da bu yeni anteti gösterir."
              : `Antet yüklendi ama geçmişe işlenemedi (${msg}) — eski yazışmalar da bu yeni anteti gösterecek.`,
            { duration: 12000 },
          );
        }
        if (!(await renkliMi(antetFile))) {
          toast("Yüklenen antet zaten siyah-beyaz — mail de siyah-beyaz gidecek.", { icon: "⚠️", duration: 8000 });
        }
      }

      // Dialog içinde açıldıysa (onSuccess varsa) yönlendirme yapma, callback çağır.
      if (onSuccess) { onSuccess(); return; }
      router.push("/dashboard/yonetim/firmalar");
      router.refresh();
    } catch {
      toast.error(
        isEdit
          ? "Firma güncellenirken bir hata oluştu."
          : "Firma eklenirken bir hata oluştu."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-0 w-full overflow-x-clip">
      <Tabs defaultValue="bilgiler" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="bilgiler">Firma Bilgileri</TabsTrigger>
          <TabsTrigger value="smtp">SMTP Mail Ayarları</TabsTrigger>
          {/* Yeni firma eklerken geçmiş olmaz — kayıt henüz yok. */}
          {isEdit && <TabsTrigger value="gecmis">Geçmiş</TabsTrigger>}
        </TabsList>

        {/* Sekme 1: Firma Bilgileri */}
        <TabsContent value="bilgiler">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firma_adi">
                    Firma Adı <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="firma_adi"
                    name="firma_adi"
                    placeholder="Kad-Tem Müh. Müt. İnş."
                    value={formData.firma_adi}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, firma_adi: formatBaslik(e.target.value) }))}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="kisa_adi">Kısa Adı</Label>
                  <Input
                    id="kisa_adi"
                    name="kisa_adi"
                    placeholder="KAD-TEM"
                    value={formData.kisa_adi ?? ""}
                    onChange={handleChange}
                    onBlur={(e) => setFormData((p) => ({ ...p, kisa_adi: formatBuyukHarf(e.target.value) }))}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vergi_no">Vergi Numarası</Label>
                <Input
                  id="vergi_no"
                  name="vergi_no"
                  placeholder="Vergi numarasını girin"
                  value={formData.vergi_no ?? ""}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adres">Adres</Label>
                <Textarea
                  id="adres"
                  name="adres"
                  placeholder="Firma adresini girin"
                  value={formData.adres ?? ""}
                  onChange={handleChange}
                  disabled={loading}
                  rows={3}
                />
              </div>

              {/* FİRMA YETKİLİLERİ — sigortalanamayan kişiler (firma sahibi vb.) burada tutulur.
                  Şantiyenin teknik personel rolü atanırken bu listeden seçilir; personel
                  kaydı ve ataması gerekmez. */}
              <div className="space-y-2">
                <Label>Firma Yetkilileri</Label>
                <div className="space-y-2">
                  {(formData.yetkililer ?? []).map((y, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input
                        placeholder="Ad Soyad"
                        value={y.ad}
                        disabled={loading}
                        onChange={(e) => setFormData((p) => {
                          const liste = [...(p.yetkililer ?? [])];
                          liste[i] = { ...liste[i], ad: e.target.value };
                          return { ...p, yetkililer: liste };
                        })}
                        onBlur={(e) => setFormData((p) => {
                          const liste = [...(p.yetkililer ?? [])];
                          liste[i] = { ...liste[i], ad: formatBaslik(e.target.value) };
                          return { ...p, yetkililer: liste };
                        })}
                      />
                      <Input
                        placeholder="Görevi (isteğe bağlı)"
                        value={y.gorev ?? ""}
                        disabled={loading}
                        onChange={(e) => setFormData((p) => {
                          const liste = [...(p.yetkililer ?? [])];
                          liste[i] = { ...liste[i], gorev: e.target.value };
                          return { ...p, yetkililer: liste };
                        })}
                      />
                      <button type="button" disabled={loading}
                        onClick={() => setFormData((p) => ({
                          ...p, yetkililer: (p.yetkililer ?? []).filter((_, j) => j !== i),
                        }))}
                        className="h-9 w-9 flex-shrink-0 rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" disabled={loading}
                    onClick={() => setFormData((p) => ({ ...p, yetkililer: [...(p.yetkililer ?? []), { ad: "", gorev: "" }] }))}
                    className="h-9 px-3 rounded-md border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50">
                    + Yetkili ekle
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Sigortalanamayan yetkililer (firma sahibi vb.) buraya eklenir. Şantiyenin teknik
                  personel rolü atanırken bu listeden seçilebilir; personel kaydı gerekmez.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Firma Rengi</Label>
                <RenkSecici
                  value={formData.renk ?? null}
                  onChange={(hex) => setFormData((p) => ({ ...p, renk: hex }))}
                  disabled={loading}
                  allowClear
                />
                <p className="text-[10px] text-gray-400">Paletten bir renk seçin. Bu renk firma verilerinde göstergelerde kullanılır.</p>
              </div>

              {/* Bizim Firma flag — ihale katılımcı listesinde "kendi firma" işaretlemesi */}
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <input
                  type="checkbox"
                  id="bizim_firma"
                  checked={formData.bizim_firma ?? false}
                  onChange={(e) => setFormData((p) => ({ ...p, bizim_firma: e.target.checked }))}
                  disabled={loading}
                  className="mt-0.5 w-4 h-4 accent-emerald-600"
                />
                <div className="flex-1">
                  <Label htmlFor="bizim_firma" className="text-sm cursor-pointer">
                    Bizim Firma
                  </Label>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    İhale katılımcı listesinde rakipler arasında bu firma &quot;kendi firmamız&quot; olarak vurgulanır.
                    Sadece kendi firmalarınızı işaretleyin.
                  </p>
                </div>
              </div>

              {/* Dosya Yüklemeleri */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <Label>Kaşe</Label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm">
                      <Upload size={16} />
                      {kaseFile ? kaseFile.name : "Kaşe Yükle"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          setKaseFile(e.target.files?.[0] ?? null)
                        }
                        disabled={loading}
                      />
                    </label>
                    {mevcutKaseUrl && !kaseFile && (
                      <>
                        <a
                          href={dosyaUrl(mevcutKaseUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-600 underline hover:text-green-700"
                        >
                          Mevcut dosya yüklü (göster)
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDosyaSil("kase")}
                          disabled={loading}
                          title="Kaşeyi sil"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Antet</Label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm">
                      <Upload size={16} />
                      {antetFile ? antetFile.name : "Antet Yükle"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          setAntetFile(e.target.files?.[0] ?? null)
                        }
                        disabled={loading}
                      />
                    </label>
                    {mevcutAntetUrl && !antetFile && (
                      <>
                        <a
                          href={dosyaUrl(mevcutAntetUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-600 underline hover:text-green-700"
                        >
                          Mevcut dosya yüklü (göster)
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDosyaSil("antet")}
                          disabled={loading}
                          title="Anteti sil"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* LOGO — kenar çubuğunda ve giriş ekranında sırayla dönen görsel.
                    Antetten ayrı bir dosya: antet uzun bir şerit, o kutuda okunmuyor. */}
                <div className="space-y-2">
                  <Label>Logo</Label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm">
                      <Upload size={16} />
                      {logoFile ? logoFile.name : "Logo Yükle"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                        disabled={loading}
                      />
                    </label>
                    {mevcutLogoUrl && !logoFile && (
                      <>
                        <a
                          href={mevcutLogoUrl.startsWith("/") ? mevcutLogoUrl : dosyaUrl(mevcutLogoUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-600 underline hover:text-green-700"
                        >
                          Mevcut dosya yüklü (göster)
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDosyaSil("logo")}
                          disabled={loading}
                          title="Logoyu sil"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Kenar çubuğunda ve giriş ekranında sırayla döner. Logosu yüklenmeyen firma dönmez.
                    <strong>Boyutla uğraşmayın</strong>: hangi ölçüde yüklerseniz yükleyin 700×300 tuvale
                    ortalanır, diğer logolarla aynı büyüklüğe getirilir; beyaz zemin varsa silinir.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sekme 2: SMTP Mail Ayarları */}
        <TabsContent value="smtp">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp_host">SMTP Host</Label>
                  <Input
                    id="smtp_host"
                    name="smtp_host"
                    placeholder="smtp.example.com"
                    value={formData.smtp_host ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp_port">SMTP Port</Label>
                  <Input
                    id="smtp_port"
                    name="smtp_port"
                    type="text" inputMode="numeric"
                    placeholder="587"
                    value={formData.smtp_port ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp_user">Kullanıcı (User)</Label>
                  <Input
                    id="smtp_user"
                    name="smtp_user"
                    placeholder="mail@example.com"
                    value={formData.smtp_user ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp_password">Şifre</Label>
                  <Input
                    id="smtp_password"
                    name="smtp_password"
                    type="password"
                    placeholder="SMTP şifresini girin"
                    value={formData.smtp_password ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp_sender_name">Gönderen Firma</Label>
                  <Input
                    id="smtp_sender_name"
                    name="smtp_sender_name"
                    placeholder="Firma adı"
                    value={formData.smtp_sender_name ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp_sender_email">Gönderen Mail Adresi</Label>
                  <Input
                    id="smtp_sender_email"
                    name="smtp_sender_email"
                    type="email"
                    placeholder="info@example.com"
                    value={formData.smtp_sender_email ?? ""}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isEdit && (
          <TabsContent value="gecmis">
            <Card>
              <CardContent className="pt-6">
                <KayitGecmisi tablo="firmalar" kayitId={firma?.id} olusturma={firma?.created_at} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Alt butonlar — sticky: uzun firma adı/içerikte pencere kaydırılırken Kaydet/İptal her zaman görünür.
          Sil solda (sadece düzenleme + yetki), İptal/Kaydet sağda. */}
      <div className="sticky bottom-0 z-20 mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 border-t bg-white py-3">
        {isEdit && ySil && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:mr-auto border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleSil}
            disabled={loading}
          >
            <Trash2 size={16} className="mr-1" />
            Sil
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => onCancel ? onCancel() : router.push("/dashboard/yonetim/firmalar")}
          disabled={loading}
        >
          <X size={16} className="mr-1" />
          İptal
        </Button>
        <Button
          type="submit"
          className="w-full sm:w-auto bg-[#F97316] hover:bg-[#ea580c] text-white"
          disabled={loading}
        >
          <Save size={16} className="mr-1" />
          {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
