"use client";

// KAYIT GEÇMİŞİ — bir kaydın kim tarafından, ne zaman, neyinin değiştirildiği.
//
// Neden var: ortaklık oranı iki işte %200 girilmişti ve kimin yazdığını bulmanın yolu
// yoktu. Günlüğü veritabanındaki tetikleyici dolduruyor (sql/kayit_gecmisi.sql); bu
// bileşen yalnız okur. Her tablo için kullanılabilir:
//   <KayitGecmisi tablo="santiyeler" kayitId={id} />
import { useCallback, useEffect, useState } from "react";
import { History, User, Cpu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { alanAdi, degerGoster } from "@/lib/kayit-gecmisi-alanlar";

type Satir = {
  id: number;
  islem: "ekleme" | "degisiklik" | "silme";
  alan: string | null;
  eski_deger: string | null;
  yeni_deger: string | null;
  kullanici_ad: string | null;
  kaynak: string;
  tarih: string;
};

const ISLEM_ETIKET: Record<string, string> = {
  ekleme: "oluşturdu",
  degisiklik: "değiştirdi",
  silme: "sildi",
};

export default function KayitGecmisi({
  tablo,
  kayitId,
  olusturma,
  limit = 300,
}: {
  tablo: string;
  kayitId: string | number | null | undefined;
  /** Kaydın created_at değeri — günlükten ÖNCE açılmış kayıtlarda tarih yine gösterilsin. */
  olusturma?: string | null;
  limit?: number;
}) {
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [durum, setDurum] = useState<"yukleniyor" | "hazir" | "yok">("yukleniyor");
  const [sistemDe, setSistemDe] = useState(false);

  const yukle = useCallback(async () => {
    if (!kayitId) { setDurum("hazir"); return; }
    const sb = createClient();
    const { data, error } = await sb
      .from("kayit_gecmisi")
      .select("id, islem, alan, eski_deger, yeni_deger, kullanici_ad, kaynak, tarih")
      .eq("tablo", tablo)
      .eq("kayit_id", String(kayitId))
      .order("tarih", { ascending: false })
      .limit(limit);
    // Tablo/tetikleyici henüz kurulmadıysa sessiz geç — ekran bozulmasın.
    if (error) { setDurum("yok"); return; }
    setSatirlar((data ?? []) as Satir[]);
    setDurum("hazir");
  }, [tablo, kayitId, limit]);

  useEffect(() => { void yukle(); }, [yukle]);

  if (durum === "yukleniyor") return <p className="text-sm text-gray-400">Geçmiş yükleniyor…</p>;
  if (durum === "yok") return <p className="text-sm text-gray-400">Kayıt geçmişi henüz kurulmamış.</p>;

  // Sistem satırları (senkron, mail okuyucu) varsayılan olarak gizli: kullanıcı
  // değişikliği aranırken onların arasında kaybolmasın.
  // 'ekleme' satırı yukarıda ayrıca gösteriliyor, listede tekrar edilmez.
  const degisiklikler = satirlar.filter((s) => s.islem !== "ekleme");
  const kullaniciSatirlari = degisiklikler.filter((s) => s.kaynak !== "sistem");
  const gorunen = sistemDe ? degisiklikler : kullaniciSatirlari;
  const sistemSayisi = degisiklikler.length - kullaniciSatirlari.length;

  // KAYDI İLK GİREN. Tetikleyici INSERT'te 'ekleme' satırı yazıyor, yani günlük
  // kurulduktan SONRA açılan kayıtlarda bu bilgi var. Daha eski kayıtlarda yok — o bilgi
  // hiçbir yerde tutulmamıştı, sonradan üretilemez; tarih bari created_at'ten gösterilir.
  const acilis = satirlar.find((s) => s.islem === "ekleme");

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        {acilis ? (
          <>
            <span className="text-sky-700">Kaydı giren:</span>{" "}
            <span className="font-semibold">
              {acilis.kaynak === "sistem" ? "Sistem" : acilis.kullanici_ad ?? "Bilinmiyor"}
            </span>
            <span className="text-sky-700">
              {" "}· {new Date(acilis.tarih).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </>
        ) : (
          <>
            <span className="text-sky-700">Kaydı giren:</span>{" "}
            <span className="font-medium">bilinmiyor</span>
            <span className="text-sky-700">
              {olusturma
                ? ` — kayıt ${new Date(olusturma).toLocaleDateString("tr-TR")} tarihinde, geçmiş tutulmaya başlamadan önce açılmış.`
                : " — kayıt, geçmiş tutulmaya başlamadan önce açılmış."}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1E3A5F]">
          <History size={16} /> Değişiklikler
        </div>
        {sistemSayisi > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={sistemDe} onChange={(e) => setSistemDe(e.target.checked)} />
            Otomatik değişiklikleri de göster ({sistemSayisi})
          </label>
        )}
      </div>

      {gorunen.length === 0 ? (
        <p className="text-sm text-gray-400">
          {degisiklikler.length === 0
            ? "Bu kayıt açıldığından beri değiştirilmemiş."
            : "Kullanıcı değişikliği yok — yalnız otomatik güncellemeler var."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-white text-sm">
          {gorunen.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2">
              <span className="whitespace-nowrap text-xs text-gray-500">
                {new Date(s.tarih).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-[#1E3A5F]">
                {s.kaynak === "sistem" ? (
                  <><Cpu size={12} className="text-gray-400" /> Sistem</>
                ) : (
                  <><User size={12} className="text-gray-400" /> {s.kullanici_ad ?? "Bilinmiyor"}</>
                )}
              </span>
              {s.islem === "degisiklik" && s.alan ? (
                <span className="flex flex-wrap items-baseline gap-1">
                  <span className="text-gray-600">{alanAdi(tablo, s.alan)}</span>
                  <span className="rounded bg-red-50 px-1.5 text-red-700 line-through decoration-red-300">
                    {degerGoster(s.alan, s.eski_deger)}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="rounded bg-emerald-50 px-1.5 font-medium text-emerald-800">
                    {degerGoster(s.alan, s.yeni_deger)}
                  </span>
                </span>
              ) : (
                <span className="text-gray-600">kaydı {ISLEM_ETIKET[s.islem] ?? s.islem}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
