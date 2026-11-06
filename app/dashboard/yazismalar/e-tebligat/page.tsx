// E-TEBLİGAT — UETS'ten gelen resmî tebligatlar.
//
// Bu ekranın bir işi var: SÜRENİN NE ZAMAN DOLDUĞUNU göstermek. Tebligatın geldiğini
// göstermek yetmez; e-tebligatta kritik olan "ne zamana kadar cevap verilmeli".
//
// 7201 sayılı Tebligat Kanunu 7/a: tebligat, adrese ulaştığı tarihi izleyen BEŞİNCİ
// GÜNÜN SONUNDA yapılmış sayılır — açılsa da açılmasa da. O yüzden liste "kalan gün"e
// göre renkleniyor ve süresi yaklaşanlar en üstte.
//
// AÇMA İŞİ BURADA YAPILMAZ: UETS'te tebligatı indirmek onu açmak demektir
// (taahhütname md. 7). Robot indirmiyor; açma kararı insanın ve UETS'in kendi
// arayüzünden yapılıyor. Burada "UETS'te aç" bağlantısı var.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useOturumFiltresi } from "@/hooks";
import { getTebligatlar, kalanGun, type Tebligat } from "@/lib/supabase/queries/tebligat";
import { Scale, ExternalLink, AlertTriangle } from "lucide-react";

const UETS_GIRIS = "https://ptt.etebligat.gov.tr/login";

const gun = (t: string | null) =>
  t ? new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

const DURUM: Record<string, { ad: string; sinif: string }> = {
  delivered: { ad: "Açılmadı", sinif: "bg-amber-100 text-amber-800" },
  read: { ad: "Açıldı", sinif: "bg-gray-100 text-gray-700" },
  // 5 gün açılmayan tebligatı UETS otomatik okundu sayıyor — kanunun kuralının aynısı.
  readtimeout: { ad: "Süre doldu", sinif: "bg-red-100 text-red-800" },
};

/** Kalan güne göre satır vurgusu. Renk süs değil: hangisine bugün bakılacağını söyler. */
function aciliyet(t: Tebligat) {
  if (t.durum !== "delivered") return { satir: "", rozet: "text-gray-500", metin: "" };
  const k = kalanGun(t.teblig_tarihi);
  if (k < 0) return { satir: "bg-red-50", rozet: "text-red-700 font-semibold", metin: `${-k} gün geçti` };
  if (k === 0) return { satir: "bg-red-50", rozet: "text-red-700 font-semibold", metin: "BUGÜN son gün" };
  if (k <= 2) return { satir: "bg-amber-50", rozet: "text-amber-700 font-semibold", metin: `${k} gün kaldı` };
  return { satir: "", rozet: "text-gray-600", metin: `${k} gün kaldı` };
}

export default function ETebligatPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("yazismalar-gelen-evrak", "goruntule");

  const [satirlar, setSatirlar] = useState<Tebligat[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useOturumFiltresi<"acilmamis" | "hepsi">("e-tebligat:suzgec", "acilmamis");

  useEffect(() => {
    if (!gor) return;
    let iptal = false;
    (async () => {
      try {
        const d = await getTebligatlar();
        if (!iptal) { setSatirlar(d); setHata(null); }
      } catch (e) {
        // Hata SESSİZ GEÇMEZ: boş tablo "tebligat yok" diye okunur, oysa sorgu patlamıştır.
        if (!iptal) setHata(e instanceof Error ? e.message : String(e));
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    })();
    return () => { iptal = true; };
  }, [gor]);

  const liste = useMemo(() => {
    const l = suzgec === "acilmamis" ? satirlar.filter((t) => t.durum === "delivered") : satirlar;
    // Süresi yaklaşan/geçen en üstte: en acil olan ilk sırada olsun.
    return [...l].sort((a, b) => {
      if (a.durum === "delivered" && b.durum === "delivered") return a.teblig_tarihi.localeCompare(b.teblig_tarihi);
      if (a.durum === "delivered") return -1;
      if (b.durum === "delivered") return 1;
      return b.ulasma_tarihi.localeCompare(a.ulasma_tarihi);
    });
  }, [satirlar, suzgec]);

  const acilmamis = satirlar.filter((t) => t.durum === "delivered").length;
  const suresiGecen = satirlar.filter((t) => t.durum === "delivered" && kalanGun(t.teblig_tarihi) < 0).length;

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-[#1E3A5F]">
          <Scale size={20} /> E-Tebligat
        </h1>
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
          {([["acilmamis", `Açılmamış${acilmamis ? ` (${acilmamis})` : ""}`], ["hepsi", "Hepsi"]] as const).map(([id, et]) => (
            <button key={id} type="button" onClick={() => setSuzgec(id)}
              className={`px-3.5 h-9 rounded-md text-sm font-medium transition-colors ${
                suzgec === id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
              {et}
            </button>
          ))}
        </div>
        <a href={UETS_GIRIS} target="_blank" rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 h-9 text-sm hover:bg-gray-50">
          UETS'te aç <ExternalLink size={14} />
        </a>
      </div>

      {suresiGecen > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>{suresiGecen} tebligatın süresi geçti.</b> Elektronik tebligat, adrese ulaştığı
            tarihi izleyen beşinci günün sonunda tebliğ edilmiş sayılır (7201 s. K. 7/a) —
            açılmamış olması süreyi durdurmaz.
          </span>
        </div>
      )}

      {hata && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Tebligatlar alınamadı: {hata}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Hesap</th>
              <th className="px-3 py-2 font-medium">Gönderen</th>
              <th className="px-3 py-2 font-medium">Konu</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Ulaşma</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Tebliğ sayılacağı gün</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Kalan</th>
              <th className="px-3 py-2 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {liste.map((t) => {
              const a = aciliyet(t);
              const d = DURUM[t.durum] ?? { ad: t.durum, sinif: "bg-gray-100 text-gray-700" };
              return (
                <tr key={t.id} className={a.satir}>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{t.hesap}</td>
                  <td className="px-3 py-2">{t.gonderen_ad ?? t.gonderen_adres ?? "—"}</td>
                  <td className="px-3 py-2">{t.konu ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{gun(t.ulasma_tarihi)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums font-medium">{gun(t.teblig_tarihi + "T00:00:00")}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${a.rozet}`}>{a.metin || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${d.sinif}`}>{d.ad}</span>
                    {t.indirme_hatasi && (
                      <span className="ml-2 text-xs text-red-700" title={t.indirme_hatasi}>· ek inmedi</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!yukleniyor && liste.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                {suzgec === "acilmamis" ? "Açılmamış tebligat yok." : "Henüz tebligat yok."}
              </td></tr>
            )}
            {yukleniyor && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Yükleniyor…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Tebligatlar UETS&apos;ten iki saatte bir otomatik çekilir. <b>Açma işlemi otomatik
        yapılmaz</b> — UETS&apos;te tebligatı indirmek onu açmak sayıldığı için, açma kararı
        size bırakılmıştır. Açmak için &quot;UETS&apos;te aç&quot; bağlantısını kullanın.
      </p>
    </div>
  );
}
