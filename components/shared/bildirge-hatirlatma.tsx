"use client";

// Dashboard uyarısı: muhasebeye işe giriş / işten çıkış maili gönderildi ama SGK bildirgesi
// (cevap PDF'i) henüz gelmedi → "bugün gönderilip cevabı gelmeyen" talepleri gösterir.
// Kayıtlar app/api/bordro-mail-bulk açar; scripts/personel-bildirge-sync cevabı yakalayınca kapatır
// → uyarı otomatik kalkar. Sekmeye dönünce (focus) yeniden kontrol edilir.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { getBekleyenBildirgeler, bildirgeTarihiniKabulEt, bildirgeSiciliniOnayla, bildirgeyiIptalEt, type PersonelIslemTakip } from "@/lib/supabase/queries/personel-islem-takip";
import { kayitGorunur } from "@/lib/utils/santiye-filtre";

// TR bugünün YYYY-MM-DD değeri
function trBugun(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
}
// YYYY-MM-DD → DD.MM.YYYY
function ymdToTr(s: string | null): string {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (s ?? "");
}
function gunFarki(fromYmd: string, todayYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00").getTime();
  const b = new Date(todayYmd + "T00:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export default function BildirgeHatirlatma() {
  const { hasPermission, isYonetici, kullanici } = useAuth();
  const yetkili = hasPermission("bordro-takibi", "ekle") || hasPermission("bordro-takibi", "duzenle");
  const [kayitlar, setKayitlar] = useState<PersonelIslemTakip[]>([]);
  const [dozeltiliyor, setDozeltiliyor] = useState<string | null>(null);
  const [kapatiliyor, setKapatiliyor] = useState<string | null>(null); // sicil onayı (yine de kapat) devam ediyor
  const [adim2, setAdim2] = useState<Set<string>>(new Set());          // "sicil yok" 2. adım (sicili gir mi?) açık kayıtlar
  const [kaldirOnay, setKaldirOnay] = useState<string | null>(null);   // admin "Kaldır" için onay bekleyen kayıt
  const [kaldiriliyor, setKaldiriliyor] = useState<string | null>(null);
  const [acik, setAcik] = useState(false); // fazla isimde: varsayılan 2 göster, ok tuşuyla açılır

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    let iptal = false;
    const kontrol = async () => {
      const veri = await getBekleyenBildirgeler();
      // Kısıtlı/şantiye admini: sadece yetkili olduğu şantiyelerdeki bildirgeler (kişinin çözülen şantiyesine göre).
      if (!iptal) setKayitlar(veri.filter((k) => kayitGorunur(k.santiye_id, kullanici)));
    };
    void kontrol();
    const onFocus = () => void kontrol(); // cevap gelip kapanınca dönünce gizlensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili, kullanici]);

  // "Düzelt" — bildirgedeki resmi tarihi kaydımıza uygula ve talebi kapat (muhasebe geç işlediğinde)
  const dozelt = async (k: PersonelIslemTakip) => {
    if (!k.bildirge_tarihi) return;
    setDozeltiliyor(k.id);
    const res = await bildirgeTarihiniKabulEt(k.id);
    setDozeltiliyor(null);
    if (res.ok) {
      setKayitlar((prev) => prev.filter((x) => x.id !== k.id));
      const bordroNot = res.atamaGuncellendi > 0 ? " (bordro da düzeltildi)" : " (bordroda eşleşen kayıt bulunamadı)";
      toast.success(`${k.personel_ad}: tarih ${ymdToTr(k.bildirge_tarihi)} olarak düzeltildi${bordroNot}.`, { duration: toastSuresi() });
    } else {
      toast.error("Düzeltilemedi.", { duration: toastSuresi() });
    }
  };

  // "Yine de kapat" / "Sicili gir ve kapat" — sicil uyarısını onayla. yazSicil=true ise bildirgedeki
  // sicil, kaydın şantiyesinin işçilik takibine yazılır (boş sicil durumunda).
  const onayla = async (k: PersonelIslemTakip, yazSicil: boolean) => {
    setKapatiliyor(k.id);
    const res = await bildirgeSiciliniOnayla(k.id, yazSicil);
    setKapatiliyor(null);
    if (res.ok) {
      // Kardeş kayıtlar (aynı şantiye) da kapanmış olabilir → tüm listeyi TAZELE (yalnız bu kaydı değil).
      const veri = await getBekleyenBildirgeler();
      setKayitlar(veri);
      const kardes = res.kardesKapatildi > 0 ? ` (aynı şantiyeden ${res.kardesKapatildi} kayıt daha kapandı)` : "";
      toast.success(
        (res.sicilYazildi
          ? `${k.personel_ad}: sicil işçilik takibine yazıldı ve kayıt kapatıldı.`
          : `${k.personel_ad}: kayıt kapatıldı.`) + kardes,
        { duration: toastSuresi() },
      );
    } else {
      toast.error("Kapatılamadı.", { duration: toastSuresi() });
    }
  };

  // "Kaldır" butonu YALNIZ aynı gün hem giriş HEM çıkış yapılmış kişilerde çıkar (Abdurrahman gibi: aynı gün
  // içinde giriş yapılıp geri çıkılmış → muhasebe işlem yapmaz, bildirge gelmez). Eşleştirme: aynı kişi
  // (TC; yoksa ad) + aynı islem_tarihi + hem giriş hem çıkış kaydı bekliyorsa, o kişinin İKİ kaydı da uygun.
  const kaldirUygun = useMemo(() => {
    const tcNorm = (s: string | null) => (s ?? "").replace(/\D/g, "");
    const kisiGunKey = (r: PersonelIslemTakip) => {
      const t = tcNorm(r.personel_tc);
      const kisi = t.length === 11 ? `tc:${t}` : `ad:${(r.personel_ad ?? "").trim().toLocaleLowerCase("tr")}`;
      return `${kisi}|${r.islem_tarihi ?? ""}`;
    };
    const grup = new Map<string, PersonelIslemTakip[]>();
    for (const k of kayitlar) {
      if (!k.islem_tarihi) continue;
      const g = kisiGunKey(k);
      const arr = grup.get(g) ?? []; arr.push(k); grup.set(g, arr);
    }
    const set = new Set<string>();
    for (const arr of grup.values()) {
      if (arr.some((x) => x.tip === "giris") && arr.some((x) => x.tip === "cikis")) {
        for (const x of arr) set.add(x.id);
      }
    }
    return set;
  }, [kayitlar]);

  // ADMIN — "Kaldır": muhasebe işlem yapmayacak/bildirge gelmeyecek işlemi beklemeden çıkar (durum='iptal').
  const iptalEt = async (k: PersonelIslemTakip) => {
    setKaldiriliyor(k.id);
    const ok = await bildirgeyiIptalEt(k.id);
    setKaldiriliyor(null);
    setKaldirOnay(null);
    if (ok) {
      setKayitlar((prev) => prev.filter((x) => x.id !== k.id));
      toast.success(`${k.personel_ad} (${k.tip === "giris" ? "giriş" : "çıkış"}): beklemeden kaldırıldı.`, { duration: toastSuresi() });
    } else {
      toast.error("Kaldırılamadı.", { duration: toastSuresi() });
    }
  };

  if (!yetkili || kayitlar.length === 0) return null;

  const bugun = trBugun();
  const gecikmis = kayitlar.filter((k) => gunFarki(k.gonderim_tarihi, bugun) >= 1).length;
  const uyusmazlikSayi = kayitlar.filter((k) => k.uyusmazlik).length;

  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-red-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} işlem için bildirge bekleniyor
          </div>
          <div className="text-xs text-red-700">
            Muhasebeye giriş/çıkış maili gönderildi, işe giriş/çıkış bildirgesi (cevap) henüz gelmedi.
            {gecikmis > 0 && <span className="font-semibold"> {gecikmis} tanesi gün aşımında.</span>}
            {uyusmazlikSayi > 0 && <span className="font-semibold text-red-800"> {uyusmazlikSayi} tanesinde gelen bildirge kayıtla uyuşmuyor.</span>}
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {(acik ? kayitlar : kayitlar.slice(0, 2)).map((k) => {
          const fark = gunFarki(k.gonderim_tarihi, bugun);
          const gecikme = fark >= 1 ? ` — ${fark} gün gecikti` : " — bugün bekliyor";
          return (
            <li key={k.id}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* SIRA: şantiye adı (ilk 30) · sicil no · giriş/çıkış · isim · bekleme durumu */}
                <span className="font-semibold text-gray-800">{k.santiye_ad ? k.santiye_ad.slice(0, 30) : "—"}</span>
                {k.santiye_sicil
                  ? <span className="text-[11px] text-gray-500 font-mono" title="İşçilik takibindeki işyeri sicil no">{k.santiye_sicil}</span>
                  : <span className="text-[11px] text-amber-600" title="İşçilik takibinde sicil numarası girilmemiş">sicil yok</span>}
                <span className="text-gray-300">·</span>
                <span className={k.tip === "giris" ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
                  {k.tip === "giris" ? "İşe giriş" : "İşten çıkış"}
                </span>
                <span className="text-red-900">{k.personel_ad}</span>
                <span className={fark >= 1 ? "text-red-600 text-xs font-semibold" : "text-red-500 text-xs"}>{gecikme}</span>
                {/* ADMIN + aynı gün giriş-çıkış → "Kaldır": muhasebe işlem yapmayacak/bildirge gelmeyecek işlemi çıkar (2 adımlı onay). */}
                {isYonetici && kaldirUygun.has(k.id) && (
                  kaldirOnay === k.id ? (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <span className="text-[11px] text-gray-600">Kaldırılsın mı?</span>
                      <button type="button" onClick={() => iptalEt(k)} disabled={kaldiriliyor === k.id}
                        className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50">Evet</button>
                      <button type="button" onClick={() => setKaldirOnay(null)} disabled={kaldiriliyor === k.id}
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100">Vazgeç</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setKaldirOnay(k.id)} title="Bu işlemi beklemeden kaldır (muhasebe işlem yapmayacak / bildirge gelmeyecek)"
                      className="ml-1 inline-flex items-center gap-0.5 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                      <X size={11} /> Kaldır
                    </button>
                  )
                )}
              </div>
              {k.uyusmazlik && (
                <div className="mt-0.5 flex items-start gap-2 rounded-md bg-amber-100 border border-amber-300 px-2 py-1 text-xs text-amber-900">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
                  <span className="flex-1">{k.uyusmazlik}</span>
                  {/* TARİH uyuşmazlığı → bildirgedeki tarihe "düzelt" (eski davranış). */}
                  {(k.uyusmazlik_tip === "tarih" || (!k.uyusmazlik_tip && k.bildirge_tarihi)) && k.bildirge_tarihi && (
                    <button
                      type="button"
                      onClick={() => dozelt(k)}
                      disabled={dozeltiliyor === k.id}
                      title={`Kaydınızı ${ymdToTr(k.islem_tarihi)} → ${ymdToTr(k.bildirge_tarihi)} olarak düzeltip kapat`}
                      className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      <Check size={12} /> {ymdToTr(k.bildirge_tarihi)} olarak düzelt
                    </button>
                  )}
                  {/* SİCİL FARKLI → tek onay: yine de kapat. */}
                  {k.uyusmazlik_tip === "sicil_farkli" && (
                    <button
                      type="button"
                      onClick={() => onayla(k, false)}
                      disabled={kapatiliyor === k.id}
                      className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      <Check size={12} /> Yine de kapat
                    </button>
                  )}
                  {/* SİCİL YOK → 2 aşama: (1) Devam et → (2) sicili işçilik takibine gireyim mi? */}
                  {k.uyusmazlik_tip === "sicil_yok" && (
                    <div className="shrink-0 flex flex-wrap gap-1">
                      {!adim2.has(k.id) ? (
                        <button
                          type="button"
                          onClick={() => setAdim2((s) => new Set(s).add(k.id))}
                          disabled={kapatiliyor === k.id}
                          className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          Devam et
                        </button>
                      ) : k.cevap_sicil ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onayla(k, true)}
                            disabled={kapatiliyor === k.id}
                            title={`İşçilik takibine "${k.cevap_sicil}" yazılıp kayıt kapatılır`}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Check size={12} /> Sicili gir ve kapat
                          </button>
                          <button
                            type="button"
                            onClick={() => onayla(k, false)}
                            disabled={kapatiliyor === k.id}
                            className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            Sicilsiz kapat
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onayla(k, false)}
                          disabled={kapatiliyor === k.id}
                          className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          <Check size={12} /> Yine de kapat
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {kayitlar.length > 2 && (
        <button
          type="button"
          onClick={() => setAcik((v) => !v)}
          className="mt-1 ml-9 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          {acik
            ? <><ChevronUp size={14} /> Gizle</>
            : <><ChevronDown size={14} /> {kayitlar.length - 2} işlem daha göster</>}
        </button>
      )}
    </div>
  );
}
