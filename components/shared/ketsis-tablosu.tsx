"use client";

// VERGİ DAİRESİ TEBLİGATI (GİB · KETSİS) — E-Tebligat ekranının ikinci bölümü.
//
// NEDEN BURADA, PTT TABLOSUNUN ALTINDA: ikisi de "resmî tebligat" ama AYRI sistem.
// Vergi dairesi tebligatı UETS'te değil, GİB'in KETSİS'inde durur ve alıcı tarafı için
// API'si yok — belgeyi program indiremez (gerekçe: sql/ketsis_bildirim.sql). Burada
// gördüğünüz satırlar tebligat değil, GİB'in bilgilendirme MAİLİ: "gel bak" uyarısı.
//
// İKİ ŞEY BİRLİKTE DURUYOR, ÇÜNKÜ MAİL GARANTİ DEĞİL:
//   · Bildirim listesi → mail geldiyse.
//   · Son kontrol satırı → mail GELMESE DE haftada bir bakılmalı. Bilgilendirme maili
//     hukuken tebligatın parçası değil; gelmemesi süreyi durdurmaz (VUK 107/A).
// Bu yüzden liste boşken de ekran "temiz" demez, "bakıldı mı?" diye sorar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, ExternalLink, AlertTriangle, Check, X, Loader2, ShieldQuestion } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { useAuth, tebligatDegisti } from "@/hooks";
import {
  getKetsisBildirimler, getSonKetsisKontrol, getKetsisTarayici, kontrolYasiGun,
  GIB_GIRIS, KONTROL_ARALIGI_GUN,
  type KetsisBildirim, type KetsisKontrol, type KetsisTarayiciDurum,
} from "@/lib/supabase/queries/ketsis";

const NOTR = "#9ca3af";

const gunSaat = (t: string | null) =>
  t ? new Date(t).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).replace(" ", " saat ") : "—";

/** Tarayıcı kaç saattir sessiz? Görev sessizce ölebiliyor; tek belirti bu damga. */
const saatFarki = (t: string | null) =>
  t ? Math.floor((Date.now() - new Date(t).getTime()) / 3600000) : null;
const TARAYICI_TOLERANS_SAAT = 6;   // yarım saatte bir dönüyor; 6 saat sessizlik arızadır

export default function KetsisTablosu() {
  const { hasPermission, isYonetici } = useAuth();
  const gor = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");
  // İşaretlemek gönderen öğretir / satırı listeden düşürür → "düzenle" yetkisi.
  const isaretleyebilir = isYonetici || hasPermission("yazismalar-e-tebligat", "duzenle");

  const [satirlar, setSatirlar] = useState<KetsisBildirim[]>([]);
  const [sonKontrol, setSonKontrol] = useState<KetsisKontrol | null>(null);
  const [tarayici, setTarayici] = useState<KetsisTarayiciDurum[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hepsi, setHepsi] = useState(false);
  const [islemde, setIslemde] = useState<number | "kontrol" | null>(null);

  const yukle = useCallback(async () => {
    try {
      const [b, k, t] = await Promise.all([
        getKetsisBildirimler(), getSonKetsisKontrol(), getKetsisTarayici(),
      ]);
      setSatirlar(b); setSonKontrol(k); setTarayici(t); setHata(null);
    } catch (e) {
      // Hata YUTULMAZ: boş tablo "tebligat yok" diye okunur, oysa sorgu patlamıştır.
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!gor) return;
    void (async () => { await yukle(); })();
  }, [gor, yukle]);

  const liste = useMemo(
    () => hepsi ? satirlar : satirlar.filter((s) => s.durum === "yeni"),
    [satirlar, hepsi],
  );
  const bekleyen = satirlar.filter((s) => s.durum === "yeni");
  const kesinBekleyen = bekleyen.filter((s) => s.guven === "kesin").length;

  const yas = kontrolYasiGun(sonKontrol?.kontrol_at);
  const kontrolGerekli = yas === null || yas >= KONTROL_ARALIGI_GUN;

  // Tarayıcı sessizliği: en son çalışan kutuya bakılır (biri çalışıyorsa görev ayakta).
  const enSonTarama = tarayici
    .map((t) => t.son_calisma).filter((x): x is string => !!x)
    .sort().at(-1) ?? null;
  const taramaSaat = saatFarki(enSonTarama);
  const tarayiciSessiz = tarayici.length === 0 || taramaSaat === null || taramaSaat > TARAYICI_TOLERANS_SAAT;
  const tarayiciHata = tarayici.map((t) => t.son_hata).filter(Boolean)[0] ?? null;

  async function gonder(govde: Record<string, unknown>, anahtar: number | "kontrol") {
    setIslemde(anahtar);
    try {
      const r = await fetch("/api/ketsis/kontrol", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(govde),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      // Yarım kalan işlem sessiz geçilmez: rota uyarı döndürdüyse kullanıcı görsün.
      if (j.uyari) toast.error(j.uyari, { duration: 14000 });
      else toast.success("Kaydedildi.", { duration: toastSuresi() });
      await yukle();
      tebligatDegisti();   // menü rozeti de düşsün
    } catch (e) {
      toast.error(`Kaydedilemedi: ${e instanceof Error ? e.message : e}`, { duration: 14000 });
    } finally {
      setIslemde(null);
    }
  }

  if (!gor) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#1E3A5F]">
          <Landmark size={18} /> Vergi dairesi tebligatı
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600"
            title="Kurumsal Elektronik Tebligat Sistemi — GİB işletir, PTT UETS'ten ayrıdır">
            GİB · KETSİS
          </span>
        </h2>
        {bekleyen.length > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            kesinBekleyen ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
            {bekleyen.length} bildirim bekliyor
          </span>
        )}
        <button type="button" onClick={() => setHepsi((h) => !h)}
          className="rounded-lg border border-gray-300 px-2.5 h-8 text-xs hover:bg-gray-50">
          {hepsi ? "Yalnız bekleyenler" : "Hepsini göster"}
        </button>
        <a href={GIB_GIRIS} target="_blank" rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 h-9 text-sm hover:bg-gray-50">
          Dijital Vergi Dairesi <ExternalLink size={14} />
        </a>
      </div>

      {/* SON KONTROL — mail gelmese de bakılmalı. Liste boşken bile görünür. */}
      <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        kontrolGerekli ? "border-amber-300 bg-amber-50 text-amber-900" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
        {kontrolGerekli && <AlertTriangle size={15} className="shrink-0 text-amber-600" />}
        <span>
          {yas === null
            ? <b>Dijital Vergi Dairesi hiç kontrol edilmedi.</b>
            : <>Son kontrol: <b>{gunSaat(sonKontrol!.kontrol_at)}</b>
                {sonKontrol?.kullanici_ad && <> · {sonKontrol.kullanici_ad}</>}
                {yas > 0 && <> ({yas} gün önce)</>}</>}
          {kontrolGerekli && " Bilgilendirme maili gelmese de tebligat gelmiş olabilir."}
        </span>
        <button type="button" disabled={islemde === "kontrol"}
          onClick={() => gonder({ islem: "kontrol-kaydi", bulgu: "temiz" }, "kontrol")}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
          {islemde === "kontrol" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Kontrol ettim
        </button>
      </div>

      {/* TARAYICI SESSİZ Mİ? Görev çökerse mail hiç okunmaz ve bu bölüm boş kalır —
          boşluk "tebligat yok" diye okunmasın. */}
      {tarayiciSessiz && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Mail tarayıcısı sessiz.</b>{" "}
            {tarayici.length === 0
              ? "Hiç çalışmamış (ofisteki zamanlanmış görev kurulu mu?)."
              : `En son ${gunSaat(enSonTarama)} — ${taramaSaat} saat önce.`}{" "}
            Bu bölümün boş olması &quot;tebligat yok&quot; anlamına gelmez; Dijital Vergi
            Dairesi&apos;ni elle kontrol edin.
          </span>
        </div>
      )}
      {tarayiciHata && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Son taramada hata: {tarayiciHata}
        </div>
      )}
      {hata && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          GİB bildirimleri alınamadı: {hata}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Firma</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Mail tarihi</th>
              <th className="px-3 py-2 font-medium">Gönderen</th>
              <th className="px-3 py-2 font-medium">Konu / özet</th>
              <th className="px-3 py-2 font-medium">Güven</th>
              <th className="px-3 py-2 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {liste.map((s) => (
              <tr key={s.id} className={s.durum === "yeni" && s.guven === "kesin" ? "bg-red-50" : s.durum === "yeni" ? "bg-amber-50" : ""}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5" title={s.firmalar?.firma_adi ?? s.kutu}>
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                      style={{ backgroundColor: s.firmalar?.renk ?? NOTR }} />
                    <span className="font-medium">
                      {s.firmalar?.kisa_adi || s.firmalar?.firma_adi || "firma belirsiz"}
                    </span>
                  </span>
                  {s.vkn && <div className="mt-0.5 text-[11px] text-gray-500">VKN {s.vkn}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {gunSaat(s.mail_tarihi)}
                  {/* INBOX DIŞINDAKİ KLASÖR BİR BULGUDUR: Junk'a düşmüş ya da silinmiş
                      bir tebligat bildirimi hiç görülmemiş olabilir. */}
                  {s.klasor && s.klasor !== "INBOX" && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700"
                      title="Mail gelen kutusunda değil, bu klasörde bulundu">
                      {s.klasor}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div>{s.gonderen ?? "—"}</div>
                  {s.gonderen_adres && (
                    <div className="text-[11px] text-gray-500">{s.gonderen_adres}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* BELGE NO önce: Dijital Vergi Dairesi'nde tebligatlar bu numarayla
                      listeleniyor, kullanıcı hangi satıra bakacağını bilsin. */}
                  {s.belge_no && (
                    <div className="font-mono text-xs font-semibold text-[#1E3A5F]">
                      belge {s.belge_no}
                    </div>
                  )}
                  <div className="font-medium">{s.konu ?? "—"}</div>
                  {s.ozet && (
                    <div className="mt-0.5 max-w-[32rem] truncate text-[11px] text-gray-500" title={s.ozet}>
                      {s.ozet}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {s.guven === "kesin" ? (
                    <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs text-red-800"
                      title="Gönderen resmî alandan ya da daha önce onaylanmış bir adresten">
                      kesin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                      title="Gönderen tanıdık değil, konu vergi tebligatına benziyor — doğrulanmalı">
                      <ShieldQuestion size={11} /> aday
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {s.durum === "yeni" ? (
                    isaretleyebilir ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" disabled={islemde === s.id}
                          onClick={() => gonder({ islem: "bildirim-kontrol", id: s.id }, s.id)}
                          title="Dijital Vergi Dairesi'ne girip baktım — bu gerçekten vergi tebligatıydı"
                          className="inline-flex items-center gap-1 rounded bg-[#1E3A5F] px-2 py-1 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
                          {islemde === s.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Baktım
                        </button>
                        <button type="button" disabled={islemde === s.id}
                          onClick={() => gonder({ islem: "bildirim-ilgisiz", id: s.id }, s.id)}
                          title="Bu mail vergi tebligatı değil — listeden düşsün"
                          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60">
                          <X size={11} /> İlgisiz
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-700">bakılmadı</span>
                    )
                  ) : s.durum === "kontrol_edildi" ? (
                    <div className="text-[11px] text-gray-600">
                      {s.kontrol_eden_ad ?? "?"} tarafından {gunSaat(s.kontrol_at)}&apos;de bakıldı
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">ilgisiz</span>
                  )}
                </td>
              </tr>
            ))}
            {!yukleniyor && liste.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                {hepsi ? "Hiç GİB bildirimi yakalanmadı." : "Bekleyen GİB bildirimi yok."}
                <div className="mt-1 text-xs text-gray-400">
                  Bu, tebligat olmadığı anlamına gelmez — bilgilendirme maili gelmeyebilir.
                </div>
              </td></tr>
            )}
            {yukleniyor && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Yükleniyor…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Vergi dairesi tebligatları <b>UETS&apos;te değil</b>, GİB&apos;in KETSİS&apos;inde durur ve
        alıcı tarafı için yayınlanmış bir API yoktur: belge yalnız <b>Dijital Vergi
        Dairesi</b> ekranından görülebilir. Panel, GİB&apos;in bilgilendirme mailini muhasebe
        posta kutularından okuyup buraya düşürür. <b>Bu bir uyarıdır, garanti değildir</b> —
        bilgilendirme maili hukuken tebligatın parçası değil, gelmemesi süreyi durdurmaz
        (VUK 107/A: adrese ulaştığı tarihi izleyen beşinci günün sonunda tebliğ edilmiş
        sayılır). Bu yüzden haftada bir elle kontrol istenir.
      </p>
    </div>
  );
}
