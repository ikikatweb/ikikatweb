// Firma formu bileşeni - İki sekmeli: Firma Bilgileri + SMTP Mail Ayarları
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFirma,
  updateFirma,
  uploadFirmaFile,
} from "@/lib/supabase/queries/firmalar";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import type { Firma, FirmaInsert } from "@/lib/supabase/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, X, Upload } from "lucide-react";
import RenkSecici from "@/components/shared/renk-secici";
import toast from "react-hot-toast";

type FirmaFormProps = {
  firma?: Firma;
};

export default function FirmaForm({ firma }: FirmaFormProps) {
  const isEdit = !!firma;
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [kaseFile, setKaseFile] = useState<File | null>(null);
  const [antetFile, setAntetFile] = useState<File | null>(null);

  const [formData, setFormData] = useState<FirmaInsert>({
    durum: firma?.durum ?? "aktif",
    firma_adi: firma?.firma_adi ?? "",
    kisa_adi: firma?.kisa_adi ?? "",
    vergi_no: firma?.vergi_no ?? "",
    adres: firma?.adres ?? "",
    renk: firma?.renk ?? "#1E3A5F",
    kase_url: firma?.kase_url ?? null,
    antet_url: firma?.antet_url ?? null,
    smtp_host: firma?.smtp_host ?? "",
    smtp_port: firma?.smtp_port ?? null,
    smtp_user: firma?.smtp_user ?? "",
    smtp_password: firma?.smtp_password ?? "",
    smtp_sender_name: firma?.smtp_sender_name ?? "",
    smtp_sender_email: firma?.smtp_sender_email ?? "",
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
      }
      if (antetFile) {
        const antetUrl = await uploadFirmaFile(
          antetFile,
          savedFirma.id,
          "antet"
        );
        await updateFirma(savedFirma.id, { antet_url: antetUrl });
      }

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
    <form onSubmit={handleSubmit}>
      <Tabs defaultValue="bilgiler" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="bilgiler">Firma Bilgileri</TabsTrigger>
          <TabsTrigger value="smtp">SMTP Mail Ayarları</TabsTrigger>
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
                    {firma?.kase_url && !kaseFile && (
                      <span className="text-xs text-green-600">
                        Mevcut dosya yüklü
                      </span>
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
                    {firma?.antet_url && !antetFile && (
                      <span className="text-xs text-green-600">
                        Mevcut dosya yüklü
                      </span>
                    )}
                  </div>
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
      </Tabs>

      {/* Alt butonlar */}
      <div className="flex items-center justify-end gap-3 mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/yonetim/firmalar")}
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
