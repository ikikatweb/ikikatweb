// BİLGİLERİM — kullanıcının kendi hesabına baktığı/düzenlediği sayfa.
//
// Buradan DEĞİŞTİRİLEBİLENLER: ad soyad, e-posta adresi, şifre. Üçü de ayrı rotadan
// gider, her biri kendi doğrulamasını yapar (bkz. /api/kullanicilar/me PATCH,
// /api/eposta, /api/kullanicilar/sifre-degistir).
//
// Rol, yetkiler, şantiye ataması ve geriye dönük gün hakları BURADA SADECE GÖRÜNÜR:
// kullanıcının kendi yetkisini genişletememesi için düzenleme yöneticide kalır.
// Kullanıcı adı da yöneticide — giriş kimliği o, kullanıcı kendi başına değiştirirse
// yönetici hangi hesabın kim olduğunu kaybeder.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks";
import { profilAdGuncelle } from "@/lib/supabase/queries/kullanicilar";
import { getSantiyelerBasic } from "@/lib/supabase/queries/santiyeler";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/shared/page-header";
import SifreDegistirDialog from "@/components/shared/sifre-degistir-dialog";
import { User, Mail, MailCheck, KeyRound, ShieldCheck, Building2, Clock } from "lucide-react";
import toast from "react-hot-toast";

const EPOSTA_GECERLI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ROL_ETIKET: Record<string, string> = {
  yonetici: "Yönetici — tüm verilere erişir",
  santiye_admin: "Şantiye Yöneticisi — atandığı şantiyelerin tümünü görür",
  kisitli: "Kısıtlı — atandığı şantiyelerde sadece kendi kayıtlarını görür",
};

function tarihSaat(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Okunur satır — etiket solda, değer sağda. */
function Satir({ etiket, children }: { etiket: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-0.5 border-b border-gray-100 py-2 last:border-0">
      <span className="text-xs text-gray-500">{etiket}</span>
      <span className="text-sm text-right text-[#1E3A5F]">{children}</span>
    </div>
  );
}

export default function BilgilerimPage() {
  const { kullanici, loading, profilYenile } = useAuth();

  // TASLAK MANTIĞI: kutular profili DOĞRUDAN gösterir; kullanıcı yazınca taslak devreye
  // girer. Eskiden boş state + useEffect ile dolduruluyordu, o da sayfa açılırken bir kare
  // boyunca "adınız boş" görüntüsü veriyordu. Kaydedilince taslak null'a döner → tazelenmiş
  // profil görünür.
  const [adTaslak, setAdTaslak] = useState<string | null>(null);
  const [epostaTaslak, setEpostaTaslak] = useState<string | null>(null);
  const ad = adTaslak ?? kullanici?.ad_soyad ?? "";
  const eposta = epostaTaslak ?? kullanici?.eposta ?? "";

  const [adKaydediyor, setAdKaydediyor] = useState(false);
  const [epostaKaydediyor, setEpostaKaydediyor] = useState(false);
  const [sifreAcik, setSifreAcik] = useState(false);
  const [santiyeAdlari, setSantiyeAdlari] = useState<Map<string, string> | null>(null);

  // Atandığı şantiyelerin adları. Liste okunamazsa ad yerine sayı gösterilir (aşağıda).
  useEffect(() => {
    const idler = kullanici?.santiye_ids ?? [];
    if (idler.length === 0) { setSantiyeAdlari(new Map()); return; }
    let iptal = false;
    getSantiyelerBasic()
      .then((liste) => {
        if (iptal) return;
        setSantiyeAdlari(new Map((liste ?? []).map((s) => [s.id as string, s.is_adi as string])));
      })
      .catch(() => { if (!iptal) setSantiyeAdlari(new Map()); });
    return () => { iptal = true; };
  }, [kullanici?.santiye_ids]);

  const adDegisti = !!kullanici && ad.replace(/\s+/g, " ").trim() !== (kullanici.ad_soyad ?? "");
  const epostaDegisti = !!kullanici && eposta.trim() !== (kullanici.eposta ?? "");
  const epostaDogrulandi = !!kullanici?.eposta_dogrulandi && !epostaDegisti;

  const santiyeler = useMemo(() => {
    const idler = kullanici?.santiye_ids ?? [];
    if (idler.length === 0) return [];
    if (!santiyeAdlari) return null;   // henüz yükleniyor
    // Adı bulunamayanlar tamamlanmış/arşiv şantiye olabilir (liste yalnız aktifleri verir).
    return idler.map((id) => santiyeAdlari.get(id) ?? "(arşiv şantiye)");
  }, [kullanici?.santiye_ids, santiyeAdlari]);

  async function adKaydet() {
    const v = ad.replace(/\s+/g, " ").trim();
    if (v.length < 3) { toast.error("Ad soyad en az 3 karakter olmalı."); return; }
    setAdKaydediyor(true);
    try {
      await profilAdGuncelle(v);
      setAdTaslak(null);        // kutu tazelenen profili göstersin
      await profilYenile();     // üst bardaki ad da değişsin
      toast.success("Ad soyad güncellendi.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally { setAdKaydediyor(false); }
  }

  async function epostaKaydet() {
    const v = eposta.trim();
    if (!EPOSTA_GECERLI.test(v)) { toast.error("Geçerli bir e-posta adresi girin."); return; }
    setEpostaKaydediyor(true);
    try {
      const r = await fetch("/api/eposta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eposta: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Kaydedilemedi."); return; }
      setEpostaTaslak(null);
      await profilYenile();
      toast.success(d.mailGitti
        ? "Adres kaydedildi — doğrulama bağlantısı gönderildi."
        : "Adres kaydedildi, ancak doğrulama maili gönderilemedi.");
    } catch { toast.error("Bağlantı hatası."); }
    finally { setEpostaKaydediyor(false); }
  }

  if (loading) {
    return <div className="p-1 text-sm text-gray-500">Bilgiler yükleniyor…</div>;
  }
  if (!kullanici) {
    return <div className="p-1 text-sm text-gray-500">Hesap bilgileriniz okunamadı. Çıkış yapıp yeniden girin.</div>;
  }

  return (
    <div>
      <PageHeader title="Bilgilerim" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ——— Kimlik ——— */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1E3A5F]">
            <User size={16} /> Kimlik
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="ad_soyad" className="text-xs">Ad Soyad</Label>
            <div className="flex gap-2">
              <Input id="ad_soyad" value={ad} onChange={(e) => setAdTaslak(e.target.value)}
                placeholder="Ad Soyad" maxLength={80}
                onKeyDown={(e) => { if (e.key === "Enter" && adDegisti) adKaydet(); }} />
              <Button type="button" variant="outline" className="shrink-0"
                onClick={adKaydet} disabled={!adDegisti || adKaydediyor}>
                {adKaydediyor ? "…" : "Kaydet"}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-400">
              Kayıtlarda &quot;kim girdi / kim yazdı&quot; sütunlarında bu ad görünür.
            </p>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label className="text-xs">Kullanıcı Adı</Label>
            <Input value={kullanici.kullanici_adi} readOnly disabled className="bg-gray-50" />
            <p className="text-[11px] leading-relaxed text-gray-400">
              Giriş yaparken kullandığınız addır; değiştirmek için yöneticinize başvurun.
            </p>
          </div>
        </section>

        {/* ——— E-posta ——— */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1E3A5F]">
            {epostaDogrulandi ? <MailCheck size={16} className="text-emerald-600" /> : <Mail size={16} />}
            E-posta Adresim
            {epostaDogrulandi
              ? <span className="text-[11px] font-normal text-emerald-600">doğrulandı</span>
              : kullanici.eposta ? <span className="text-[11px] font-normal text-amber-600">doğrulanmadı</span> : null}
          </h2>

          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input type="email" value={eposta} onChange={(e) => setEpostaTaslak(e.target.value)}
                placeholder="ornek@firma.com"
                onKeyDown={(e) => { if (e.key === "Enter" && epostaDegisti) epostaKaydet(); }} />
              <Button type="button" variant="outline" className="shrink-0"
                onClick={epostaKaydet} disabled={!epostaDegisti || epostaKaydediyor}>
                {epostaKaydediyor ? "…" : "Kaydet"}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-400">
              Şifrenizi unutursanız yenileme bağlantısı bu adrese gönderilir. Girişte kullanılmaz.
              Adresi her değiştirdiğinizde yeni adrese doğrulama bağlantısı gider; doğrulanmayan
              adres şifre yenileme için güvenilir sayılmaz.
            </p>
          </div>
        </section>

        {/* ——— Şifre ——— */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1E3A5F]">
            <KeyRound size={16} /> Şifre
          </h2>
          <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
            Şifrenizi kimse göremez — yöneticiniz de göremez, yalnızca yenisini atayabilir.
            Değiştirmek için mevcut şifrenizi bilmeniz gerekir.
          </p>
          <Button type="button" variant="outline" onClick={() => setSifreAcik(true)}>
            <KeyRound size={15} className="mr-1.5" /> Şifremi Değiştir
          </Button>
        </section>

        {/* ——— Yetkiler (salt görünür) ——— */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-[#1E3A5F]">
            <ShieldCheck size={16} /> Yetkilerim
          </h2>
          <p className="mb-2 text-[11px] leading-relaxed text-gray-400">
            Bu bölüm bilgi içindir; değiştirilmesi gerekiyorsa yöneticinize başvurun.
          </p>

          <Satir etiket="Rol">{ROL_ETIKET[kullanici.rol] ?? kullanici.rol}</Satir>
          <Satir etiket="Durum">
            {kullanici.aktif
              ? <span className="text-emerald-600">Aktif</span>
              : <span className="text-red-600">Pasif</span>}
          </Satir>
          <Satir etiket={<span className="flex items-center gap-1"><Building2 size={12} /> Şantiyelerim</span>}>
            {kullanici.rol === "yonetici"
              ? "Tüm şantiyeler"
              : santiyeler === null
                ? "…"
                : santiyeler.length === 0
                  ? "Atanmamış"
                  : santiyeler.join(", ")}
          </Satir>
          <Satir etiket="Son giriş">
            <span className="flex items-center justify-end gap-1 tabular-nums">
              <Clock size={12} className="text-gray-400" /> {tarihSaat(kullanici.son_giris)}
            </span>
          </Satir>
          <Satir etiket="Hesap oluşturma">
            <span className="tabular-nums">{tarihSaat(kullanici.created_at)}</span>
          </Satir>
        </section>
      </div>

      <SifreDegistirDialog open={sifreAcik} onOpenChange={setSifreAcik} />
    </div>
  );
}
