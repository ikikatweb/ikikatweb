// TAHMİNİ GÖSTERGE — son GERÇEK okumanın üstüne Arvento'dan biriken mesafe/saat eklenir.
//
// NEDEN: Gösterge yalnız elle girilince güncelleniyor. Yakıt almayan araçta o değer aylarca
// donuyor (60 ADR 790: 17 gün boyunca 105.479 km yazarken araç 1.618 km daha yapmıştı) ve
// "sıradaki bakıma ne kadar kaldı" sorusu yanlış cevaplanıyor.
//
// TABAN = en son GERÇEK okuma; üç kaynaktan hangisi daha yeniyse o:
//   • yakıt kaydındaki gösterge (pompacı/biz giriyoruz)
//   • bakım kaydındaki km/saat
//   • araç puantajındaki gösterge
//
// EKLENEN = taban tarihinden SONRAKİ Arvento günleri:
//   • km aracı      → mesafe_km toplamı
//   • saat makinesi → çalışma saati × makineye özel katsayı (lib/arvento/makine-saat)
//
// ARAÇ KARTI İLERİDEYSE: araclar.guncel_gosterge tarihli okumadan büyük olabiliyor; aradaki
// fark, Arvento'nun o tarihten beri saydığının ZATEN KARTA İŞLENMİŞ kısmıdır. Taban kart
// değeri olur ve eklenecek miktardan kartta bulunan kadarı düşülür — yoksa aynı yol iki kez
// sayılır (60 BP 164'te 1.117 km böyleydi).
//
// SUNUCUDA çalışır: tarayıcıya araç başına birkaç sayı iner, binlerce satır değil.
// Kullananlar: app/api/arac/tahmini-gosterge (arayüz) ve app/api/cron/yaklasan-bildirim.
import type { SupabaseClient } from "@supabase/supabase-js";
import { raporCalismaSn, projeksiyon } from "@/lib/arvento/makine-saat";

export type TahminiGosterge = {
  /** Son gerçek okuma (kart ileriyse kartın değeri). */
  taban: number;
  /** Okumanın tarihi (YYYY-MM-DD). */
  tabanTarih: string;
  /** Okuma nereden geldi. */
  tabanKaynak: "yakit" | "bakim" | "puantaj";
  /** Arvento'dan eklenen (km ya da saat), kartta zaten bulunan düşülmüş hâliyle. */
  eklenen: number;
  /** taban + eklenen (yuvarlanmış). */
  tahmini: number;
  /** Arvento'da kaç günlük kayıt toplandı. */
  gun: number;
};

/** Plaka karşılaştırması: boşluk/tire/büyük-küçük harf farkı aynı araçtır. */
const plakaAnahtar = (p: string | null | undefined) =>
  (p ?? "").toLocaleUpperCase("tr").replace(/[^A-Z0-9]/g, "");

const PARCA = 1000;

/**
 * Araç id → tahmini gösterge. Yalnız TAHMİN ÜRETİLEBİLEN araçlar döner:
 * gerçek okuması olmayan, Arvento cihazı olmayan ya da ilerlemesi 1 birimden az olan
 * araç listede YER ALMAZ — çağıran taraf o zaman gerçek değeri gösterir.
 *
 * Sorgu hatası SESSİZCE yutulmaz: hata fırlatılır, çağıran ne yapacağına karar verir.
 */
export async function tahminiGostergeler(
  sb: SupabaseClient,
): Promise<Record<string, TahminiGosterge>> {
  const { data: aracVeri, error: aracHata } = await sb
    .from("araclar")
    .select("id, plaka, sayac_tipi, guncel_gosterge, saat_katsayi");
  if (aracHata) throw new Error(`Araçlar okunamadı: ${aracHata.message}`);
  const araclar = (aracVeri ?? []) as {
    id: string; plaka: string; sayac_tipi: string | null;
    guncel_gosterge: number | null; saat_katsayi: number | null;
  }[];

  // ── Taban: en son gerçek okuma ───────────────────────────────────────────────────────────
  type Okuma = { deger: number; tarih: string; kaynak: TahminiGosterge["tabanKaynak"] };
  const taban = new Map<string, Okuma>();
  const koy = (aracId: string, o: Okuma) => {
    const m = taban.get(aracId);
    if (!m || o.tarih > m.tarih) taban.set(aracId, o);
  };

  const { data: yakit, error: yakitHata } = await sb
    .from("arac_yakit").select("arac_id, tarih, km_saat").gt("km_saat", 0);
  if (yakitHata) throw new Error(`Yakıt kayıtları okunamadı: ${yakitHata.message}`);
  for (const y of (yakit ?? []) as { arac_id: string; tarih: string; km_saat: number }[]) {
    koy(y.arac_id, { deger: Number(y.km_saat), tarih: y.tarih, kaynak: "yakit" });
  }

  const { data: bakim, error: bakimHata } = await sb
    .from("arac_bakim").select("arac_id, bakim_tarihi, km").gt("km", 0);
  if (bakimHata) throw new Error(`Bakım kayıtları okunamadı: ${bakimHata.message}`);
  for (const b of (bakim ?? []) as { arac_id: string; bakim_tarihi: string; km: number }[]) {
    koy(b.arac_id, { deger: Number(b.km), tarih: b.bakim_tarihi, kaynak: "bakim" });
  }

  const { data: puantaj, error: puantajHata } = await sb
    .from("arac_puantaj").select("arac_id, tarih, gosterge").gt("gosterge", 0);
  if (puantajHata) throw new Error(`Puantaj kayıtları okunamadı: ${puantajHata.message}`);
  for (const p of (puantaj ?? []) as { arac_id: string; tarih: string; gosterge: number }[]) {
    koy(p.arac_id, { deger: Number(p.gosterge), tarih: p.tarih, kaynak: "puantaj" });
  }
  if (taban.size === 0) return {};

  // ── Arvento günleri: en eski tabandan bugüne, plakaya göre gruplanır ─────────────────────
  // SAYFALAMA ŞART: PostgREST bir sorguda en çok 1000 satır döner. Sayfalamasız yazıldığında
  // araçların son günleri hiç gelmiyor, tahmin sessizce eksik çıkıyordu.
  const enEski = [...taban.values()].reduce((e, o) => (o.tarih < e ? o.tarih : e), "9999-12-31");
  type Satir = { plaka: string; rapor_tarihi: string; mesafe_km: number | null }
    & Parameters<typeof raporCalismaSn>[0];
  const plakaGun = new Map<string, Satir[]>();
  for (let offset = 0; ; offset += PARCA) {
    const { data: rapor, error: raporHata } = await sb
      .from("arac_arvento_rapor")
      .select("plaka, rapor_tarihi, mesafe_km, kontak_sn, rolanti_sn, ilk_kontak, son_kontak")
      .gt("rapor_tarihi", enEski)
      .order("rapor_tarihi", { ascending: true })
      .range(offset, offset + PARCA - 1);
    if (raporHata) throw new Error(`Arvento raporları okunamadı: ${raporHata.message}`);
    const satirlar = (rapor ?? []) as Satir[];
    for (const r of satirlar) {
      const k = plakaAnahtar(r.plaka);
      const liste = plakaGun.get(k);
      if (liste) liste.push(r); else plakaGun.set(k, [r]);
    }
    if (satirlar.length < PARCA) break;
    if (offset > 200000) break;                        // emniyet
  }

  const sonuc: Record<string, TahminiGosterge> = {};
  for (const a of araclar) {
    const o = taban.get(a.id);
    if (!o) continue;                                   // hiç gerçek okuma yok → tahmin de yok

    const kart = a.guncel_gosterge;
    const kartIleride = kart != null && kart > o.deger;
    const tabanDeger = kartIleride ? kart : o.deger;
    const kartaIslenmis = kartIleride ? kart - o.deger : 0;

    const gunler = (plakaGun.get(plakaAnahtar(a.plaka)) ?? []).filter((r) => r.rapor_tarihi > o.tarih);
    if (gunler.length === 0) continue;                  // Arvento verisi yok → gerçek değer kalır

    let ham: number;
    if (a.sayac_tipi === "saat") {
      const saat = gunler.reduce((t, r) => t + raporCalismaSn(r), 0) / 3600;
      const ileri = projeksiyon(o.deger, saat, a.saat_katsayi);
      if (ileri == null) continue;
      ham = ileri - o.deger;
    } else {
      ham = gunler.reduce((t, r) => t + Number(r.mesafe_km ?? 0), 0);
    }
    const eklenen = Math.max(0, ham - kartaIslenmis);
    // 1 birimden az ilerleme "tahmini" etiketini hak etmiyor: ekranda aynı sayı görünür,
    // kullanıcı boş yere "bu neden tahmini?" diye düşünür.
    if (!(eklenen >= 1)) continue;

    sonuc[a.id] = {
      taban: tabanDeger,
      tabanTarih: o.tarih,
      tabanKaynak: o.kaynak,
      eklenen: Math.round(eklenen),
      tahmini: Math.round(tabanDeger + eklenen),
      gun: gunler.length,
    };
  }

  return sonuc;
}
