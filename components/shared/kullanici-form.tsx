// Kullanıcı ekleme/düzenleme formu - Rol, şantiye ataması, izin matrisi, şablon desteği
"use client";

import { useState, useEffect } from "react";
import {
  createKullanici,
  updateKullanici,
  getSablonlar,
  saveSablon,
  deleteSablon,
  type IzinSablonu,
} from "@/lib/supabase/queries/kullanicilar";
import { getSantiyeler } from "@/lib/supabase/queries/santiyeler";
import { getGrupluModuller } from "@/lib/permissions";
import { formatKisiAdi } from "@/lib/utils/isim";
import type { Kullanici, Izinler, ModulIzinleri, SantiyeWithRelations } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, X, BookmarkPlus, Trash2, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

type KullaniciFormProps = {
  kullanici?: Kullanici;
  onSuccess: () => void;
  onCancel: () => void;
};

const selectClass =
  "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const grupluModuller = getGrupluModuller();

const DASHBOARD_WIDGETS = [
  { key: "yiufe", label: "Yi-ÜFE Endeksler" },
  { key: "kasa_ozet", label: "Kasa Defteri — Personel Özeti" },
  { key: "sigorta_muayene", label: "Yaklaşan Sigorta & Muayene" },
  { key: "yaklasan_bakim", label: "Yaklaşan Araç Bakımları" },
  { key: "depo_yakit", label: "Depo Yakıt Durumu" },
  { key: "son_yakit", label: "Son Yakıt Alımları" },
  { key: "eksik_evrak", label: "Eksik Evrak Numaraları" },
  { key: "santiye_defteri", label: "Şantiye Günlük Defteri" },
];

export default function KullaniciForm({ kullanici, onSuccess, onCancel }: KullaniciFormProps) {
  const isEdit = !!kullanici;
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [adSoyad, setAdSoyad] = useState(kullanici?.ad_soyad ?? "");
  const [kullaniciAdi, setKullaniciAdi] = useState(kullanici?.kullanici_adi ?? "");
  const [sifre, setSifre] = useState(isEdit ? (kullanici?.sifre_gorunur ?? "") : "");
  const [rol, setRol] = useState<"yonetici" | "santiye_admin" | "kisitli">(kullanici?.rol ?? "kisitli");
  const [izinler, setIzinler] = useState<Izinler>(kullanici?.izinler ?? {});
  const [seciliSantiyeler, setSeciliSantiyeler] = useState<string[]>(kullanici?.santiye_ids ?? []);
  const [geriyeDonusGun, setGeriyeDonusGun] = useState<string>(
    kullanici?.geriye_donus_gun != null ? String(kullanici.geriye_donus_gun) : "",
  );
  // Modül bazlı 2 sınır (işlem + görüntüleme). Default 2.
  const initGun = (v: number | null | undefined) => v != null ? String(v) : "2";
  const [puantajIslemGun, setPuantajIslemGun] = useState<string>(initGun(kullanici?.puantaj_islem_gun));
  const [puantajGoruntulemeGun, setPuantajGoruntulemeGun] = useState<string>(initGun(kullanici?.puantaj_goruntuleme_gun));
  const [yakitIslemGun, setYakitIslemGun] = useState<string>(initGun(kullanici?.yakit_islem_gun));
  const [yakitGoruntulemeGun, setYakitGoruntulemeGun] = useState<string>(initGun(kullanici?.yakit_goruntuleme_gun));
  const [kasaIslemGun, setKasaIslemGun] = useState<string>(initGun(kullanici?.kasa_islem_gun));
  const [kasaGoruntulemeGun, setKasaGoruntulemeGun] = useState<string>(initGun(kullanici?.kasa_goruntuleme_gun));
  const [santiyeIslemGun, setSantiyeIslemGun] = useState<string>(initGun(kullanici?.santiye_defteri_islem_gun));
  const [santiyeGoruntulemeGun, setSantiyeGoruntulemeGun] = useState<string>(initGun(kullanici?.santiye_defteri_goruntuleme_gun));
  const [dashboardWidgets, setDashboardWidgets] = useState<string[]>(kullanici?.dashboard_widgets ?? []);

  // Şantiye ve şablon listeleri
  const [santiyeler, setSantiyeler] = useState<SantiyeWithRelations[]>([]);
  const [sablonlar, setSablonlar] = useState<IzinSablonu[]>([]);
  const [sablonAdi, setSablonAdi] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await getSantiyeler();
        setSantiyeler((data as SantiyeWithRelations[]) ?? []);
      } catch { /* sessiz */ }
      setSablonlar(getSablonlar());
    }
    load();
  }, []);

  function getIzin(key: string, aksiyon: keyof ModulIzinleri): boolean {
    return izinler[key]?.[aksiyon] === true;
  }

  function setIzin(key: string, aksiyon: keyof ModulIzinleri, value: boolean) {
    setIzinler((prev) => {
      const mevcut = prev[key] ?? {};
      const yeni = { ...mevcut, [aksiyon]: value };
      if (aksiyon === "goruntule" && !value) {
        yeni.ekle = false; yeni.duzenle = false; yeni.sil = false;
      }
      if (aksiyon !== "goruntule" && value) {
        yeni.goruntule = true;
      }
      return { ...prev, [key]: yeni };
    });
  }

  function handleSablonUygula(sablon: IzinSablonu) {
    setIzinler(sablon.izinler);
    toast.success(`"${sablon.ad}" şablonu uygulandı.`);
  }

  function handleSablonKaydet() {
    if (!sablonAdi.trim()) { toast.error("Şablon adı girin."); return; }
    const yeniSablon: IzinSablonu = {
      id: crypto.randomUUID(),
      ad: sablonAdi.trim(),
      izinler: { ...izinler },
    };
    saveSablon(yeniSablon);
    setSablonlar(getSablonlar());
    setSablonAdi("");
    toast.success("Şablon kaydedildi.");
  }

  function handleSablonSil(id: string) {
    deleteSablon(id);
    setSablonlar(getSablonlar());
    toast.success("Şablon silindi.");
  }

  function toggleSantiye(id: string) {
    setSeciliSantiyeler((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!adSoyad.trim()) { toast.error("Ad Soyad zorunludur."); return; }
    if (!isEdit && !kullaniciAdi.trim()) { toast.error("Kullanıcı adı zorunludur."); return; }
    if (!isEdit && !sifre.trim()) { toast.error("Şifre zorunludur."); return; }
    if (sifre.trim() && sifre.length < 6) { toast.error("Şifre en az 6 karakter olmalıdır."); return; }

    // Ad soyadı standart formata çevir: "ahmet can kılınç" -> "Ahmet Can KILINÇ"
    const formatliAdSoyad = formatKisiAdi(adSoyad);
    setAdSoyad(formatliAdSoyad);

    const parseGun = (s: string): number => {
      if (!s.trim()) return 2;
      const n = parseInt(s.replace(",", "."), 10);
      return isNaN(n) ? 2 : Math.max(0, n);
    };
    const limitler = {
      puantaj_islem_gun: parseGun(puantajIslemGun),
      puantaj_goruntuleme_gun: parseGun(puantajGoruntulemeGun),
      yakit_islem_gun: parseGun(yakitIslemGun),
      yakit_goruntuleme_gun: parseGun(yakitGoruntulemeGun),
      kasa_islem_gun: parseGun(kasaIslemGun),
      kasa_goruntuleme_gun: parseGun(kasaGoruntulemeGun),
      santiye_defteri_islem_gun: parseGun(santiyeIslemGun),
      santiye_defteri_goruntuleme_gun: parseGun(santiyeGoruntulemeGun),
    };
    const bosLimitler = {
      puantaj_islem_gun: null,
      puantaj_goruntuleme_gun: null,
      yakit_islem_gun: null,
      yakit_goruntuleme_gun: null,
      kasa_islem_gun: null,
      kasa_goruntuleme_gun: null,
      santiye_defteri_islem_gun: null,
      santiye_defteri_goruntuleme_gun: null,
    };

    setLoading(true);
    try {
      // Şantiye ataması, izin matrisi, limit, dashboard widget:
      // hem kısıtlı hem şantiye admini için kullanılır
      // (yönetici hepsine sahip — bu alanlar boş bırakılır)
      const santiyeKullanir = rol === "kisitli" || rol === "santiye_admin";
      const izinKullanir = rol === "kisitli" || rol === "santiye_admin";
      if (isEdit) {
        await updateKullanici(kullanici.id, {
          ad_soyad: formatliAdSoyad,
          rol,
          izinler: izinKullanir ? izinler : {},
          santiye_ids: santiyeKullanir ? seciliSantiyeler : [],
          geriye_donus_gun: izinKullanir ? limitler.puantaj_islem_gun : null, // legacy
          ...(izinKullanir ? limitler : bosLimitler),
          dashboard_widgets: izinKullanir && dashboardWidgets.length > 0 ? dashboardWidgets : null,
          ...(sifre.trim() ? { sifre } : {}),
        });
        toast.success("Kullanıcı güncellendi.");
      } else {
        await createKullanici({
          ad_soyad: formatliAdSoyad,
          kullanici_adi: kullaniciAdi.trim().toLowerCase(),
          sifre,
          rol,
          izinler: izinKullanir ? izinler : {},
          santiye_ids: santiyeKullanir ? seciliSantiyeler : [],
          geriye_donus_gun: izinKullanir ? limitler.puantaj_islem_gun : null,
          ...(izinKullanir ? limitler : bosLimitler),
          dashboard_widgets: izinKullanir && dashboardWidgets.length > 0 ? dashboardWidgets : null,
        });
        toast.success("Kullanıcı oluşturuldu.");
      }
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  const aktifSantiyeler = santiyeler.filter((s) =>
    s.durum === "aktif" && !s.gecici_kabul_tarihi && !s.kesin_kabul_tarihi && !s.tasfiye_tarihi && !s.devir_tarihi
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Temel bilgiler */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ad_soyad">Ad Soyad <span className="text-red-500">*</span></Label>
          <Input
            id="ad_soyad"
            value={adSoyad}
            onChange={(e) => setAdSoyad(e.target.value)}
            onBlur={(e) => setAdSoyad(formatKisiAdi(e.target.value))}
            disabled={loading}
            placeholder="Ahmet Can KILINÇ"
          />
          <p className="text-[10px] text-gray-400">Soyad otomatik olarak BÜYÜK harfe çevrilir.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kullanici_adi">Kullanıcı Adı <span className="text-red-500">*</span></Label>
          <Input id="kullanici_adi" value={kullaniciAdi} onChange={(e) => setKullaniciAdi(e.target.value)} disabled={loading || isEdit} placeholder="kullanici_adi" />
          {isEdit && <p className="text-xs text-gray-400">Kullanıcı adı değiştirilemez</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="sifre">{isEdit ? "Şifre" : "Şifre *"}</Label>
          <div className="relative">
            <Input id="sifre" type={showPassword ? "text" : "password"} value={sifre} onChange={(e) => setSifre(e.target.value)} disabled={loading} placeholder="••••••" className="pr-10" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {isEdit && <p className="text-xs text-gray-400">Boş bırakılırsa mevcut şifre korunur</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Kullanıcı Tipi</Label>
        <select
          value={rol}
          onChange={(e) => setRol(e.target.value as "yonetici" | "santiye_admin" | "kisitli")}
          disabled={loading}
          className={selectClass + " max-w-xs"}
        >
          <option value="yonetici">Yönetici (tam yetki)</option>
          <option value="santiye_admin">Şantiye Yöneticisi (atandığı şantiyelerin tümünü görür)</option>
          <option value="kisitli">Kısıtlı Kullanıcı (sadece kendi kayıtları)</option>
        </select>
        {rol === "santiye_admin" && (
          <p className="text-xs text-blue-600">
            <strong>Şantiye Yöneticisi:</strong> Aşağıda verdiğiniz yetki alanlarında atanan şantiyelerdeki{" "}
            <strong>tüm kullanıcıların</strong> verilerine erişir (yazışmalar, defter, kasa vb).
            Yetki vermediğiniz modüllere erişemez.
          </p>
        )}
        {rol === "kisitli" && (
          <p className="text-xs text-gray-500">
            <strong>Kısıtlı Kullanıcı:</strong> Aşağıda verdiğiniz yetki alanlarında atanan şantiyelerde{" "}
            <strong>sadece kendi kayıtlarını</strong> görür/yazar.
          </p>
        )}
      </div>

      {/* Şantiye ataması — kısıtlı VE şantiye admini için ortak */}
      {(rol === "kisitli" || rol === "santiye_admin") && (
        <>
          {/* Şantiye ataması */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[#1E3A5F]">Şantiye Ataması</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Kullanıcının erişebileceği şantiyeleri seçin. Seçim yapılmazsa tüm şantiyelere erişebilir.</p>
                </div>
                {aktifSantiyeler.length > 0 && (
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => {
                      if (seciliSantiyeler.length === aktifSantiyeler.length) {
                        setSeciliSantiyeler([]);
                      } else {
                        setSeciliSantiyeler(aktifSantiyeler.map((s) => s.id));
                      }
                    }}>
                    {seciliSantiyeler.length === aktifSantiyeler.length ? "Temizle" : "Hepsini Seç"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {aktifSantiyeler.map((s) => (
                  <label key={s.id} className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${seciliSantiyeler.includes(s.id) ? "bg-blue-50 border-[#1E3A5F]" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={seciliSantiyeler.includes(s.id)} onChange={() => toggleSantiye(s.id)} className="w-4 h-4 accent-[#F97316]" />
                    <span className="text-sm">{s.is_adi}</span>
                  </label>
                ))}
                {aktifSantiyeler.length === 0 && <p className="text-sm text-gray-400">Henüz aktif şantiye yok.</p>}
              </div>
            </CardContent>
          </Card>

          {/* Dashboard Widget Seçimi */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-[#1E3A5F]">Dashboard Görünümü</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Kullanıcının ana ekranda göreceği tabloları seçin. Seçim yapılmazsa hepsi gösterilir.</p>
                </div>
                {DASHBOARD_WIDGETS.length > 0 && (
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => {
                      if (dashboardWidgets.length === DASHBOARD_WIDGETS.length) {
                        setDashboardWidgets([]);
                      } else {
                        setDashboardWidgets(DASHBOARD_WIDGETS.map((w) => w.key));
                      }
                    }}>
                    {dashboardWidgets.length === DASHBOARD_WIDGETS.length ? "Temizle" : "Hepsini Seç"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {DASHBOARD_WIDGETS.map((w) => (
                  <label key={w.key} className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${dashboardWidgets.includes(w.key) ? "bg-blue-50 border-[#1E3A5F]" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={dashboardWidgets.includes(w.key)}
                      onChange={() => setDashboardWidgets((prev) => prev.includes(w.key) ? prev.filter((k) => k !== w.key) : [...prev, w.key])}
                      className="w-4 h-4 accent-[#F97316]" />
                    <span className="text-sm">{w.label}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Modül Bazlı Geriye Dönük Sınırlar */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="font-semibold text-[#1E3A5F] mb-2">Geriye Dönük İşlem Sınırları</h3>
              <p className="text-xs text-gray-400 mb-3">
                Her modül için iki ayrı sınır: <strong>İşlem</strong> = kaç gün öncesine kadar kayıt oluşturabilir/düzenleyebilir,
                <strong> Görüntüleme</strong> = kaç gün öncesine kadar kayıtları görebilir. Varsayılan: 2 gün.
              </p>
              {(() => {
                const modulList = [
                  { label: "Puantaj", islem: puantajIslemGun, setIslem: setPuantajIslemGun, goruntuleme: puantajGoruntulemeGun, setGoruntuleme: setPuantajGoruntulemeGun },
                  { label: "Yakıt", islem: yakitIslemGun, setIslem: setYakitIslemGun, goruntuleme: yakitGoruntulemeGun, setGoruntuleme: setYakitGoruntulemeGun },
                  { label: "Kasa Defteri", islem: kasaIslemGun, setIslem: setKasaIslemGun, goruntuleme: kasaGoruntulemeGun, setGoruntuleme: setKasaGoruntulemeGun },
                  { label: "Şantiye Defteri", islem: santiyeIslemGun, setIslem: setSantiyeIslemGun, goruntuleme: santiyeGoruntulemeGun, setGoruntuleme: setSantiyeGoruntulemeGun },
                ];
                return (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[10px] font-semibold text-gray-500 pb-1 border-b">
                      <span>Modül</span>
                      <span className="text-center w-24">İşlem (gün)</span>
                      <span className="text-center w-24">Görüntüleme (gün)</span>
                    </div>
                    {modulList.map((m) => (
                      <div key={m.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                        <span className="text-sm font-medium">{m.label}</span>
                        <Input
                          type="text" inputMode="numeric"
                          value={m.islem}
                          onChange={(e) => m.setIslem(e.target.value)}
                          placeholder="2"
                          disabled={loading}
                          className="w-24 text-center"
                        />
                        <Input
                          type="text" inputMode="numeric"
                          value={m.goruntuleme}
                          onChange={(e) => m.setGoruntuleme(e.target.value)}
                          placeholder="2"
                          disabled={loading}
                          className="w-24 text-center"
                        />
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p className="text-[10px] text-gray-400 mt-3">
                Örn: Puantaj İşlem=2 ise kullanıcı bugün + 1 gün öncesini düzenleyebilir.
                Puantaj Görüntüleme=30 ise 30 gün öncesine kadar puantajları listede görebilir.
              </p>
            </CardContent>
          </Card>

          {/* Şablon seçimi */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="font-semibold text-[#1E3A5F] mb-3">İzin Şablonları</h3>
              {sablonlar.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3">
                  {sablonlar.map((s) => (
                    <div key={s.id} className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => handleSablonUygula(s)}>
                        {s.ad}
                      </Button>
                      <button type="button" onClick={() => handleSablonSil(s.id)} className="text-red-400 hover:text-red-600 p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">Henüz şablon kayıtlı değil. Aşağıdaki izinleri ayarlayıp şablon olarak kaydedin.</p>
              )}
              <div className="flex items-center gap-2">
                <Input value={sablonAdi} onChange={(e) => setSablonAdi(e.target.value)} placeholder="Şablon adı (örn: Şantiye Şefi)" className="max-w-xs" />
                <Button type="button" variant="outline" size="sm" onClick={handleSablonKaydet}>
                  <BookmarkPlus size={14} className="mr-1" /> Mevcut İzinleri Kaydet
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* İzin Matrisi */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="font-semibold text-[#1E3A5F] mb-3">Yetki Ayarları</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium">Modül</th>
                      <th className="text-center py-2 px-3 font-medium">Görüntüle</th>
                      <th className="text-center py-2 px-3 font-medium">Ekle</th>
                      <th className="text-center py-2 px-3 font-medium">Düzenle</th>
                      <th className="text-center py-2 px-3 font-medium">Sil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(grupluModuller).map(([grup, moduller]) => (
                      <Fragment key={grup}>
                        <tr>
                          <td colSpan={5} className="pt-4 pb-1 font-semibold text-xs uppercase text-gray-500 tracking-wider">{grup}</td>
                        </tr>
                        {moduller.map((m) => (
                          <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2.5 pr-4">{m.label}</td>
                            {(["goruntule", "ekle", "duzenle", "sil"] as const).map((aksiyon) => (
                              <td key={aksiyon} className="text-center py-2.5 px-3">
                                <input type="checkbox" checked={getIzin(m.key, aksiyon)} onChange={(e) => setIzin(m.key, aksiyon, e.target.checked)} disabled={loading} className="w-4 h-4 accent-[#F97316]" />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          <X size={16} className="mr-1" /> İptal
        </Button>
        <Button type="submit" className="bg-[#F97316] hover:bg-[#ea580c] text-white" disabled={loading}>
          <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}

// Fragment import
import { Fragment } from "react";
