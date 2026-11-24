// TAHMİNİ GÖSTERGE — son GERÇEK okumanın üstüne Arvento'dan biriken mesafe/saat eklenir.
//
// NEDEN: Araç Bakım → Araç Listesi'ndeki "Mevcut Km/Saat" sütunu yalnız elle girilen değeri
// gösteriyordu. Yakıt almayan araçlarda (ör. 60 ADR 790) o değer son bakımda girilen rakamda
// donup kalıyor; 17 gün boyunca 105.479 km yazarken araç Arvento'ya göre 1.552 km daha yapmıştı.
// Sonuç: "sıradaki bakıma ne kadar kaldı" sorusu yanlış cevaplanıyordu.
//
// TABAN = en son GERÇEK okuma. Kaynak sırası tarihe göre: yakıt kaydındaki gösterge
// (pompacı/biz giriyoruz) ya da bakım kaydındaki km. Hangisi daha yeniyse o.
// Araç kartındaki guncel_gosterge daha YÜKSEKSE taban olarak o alınır (biri elle güncellemiş
// olabilir) ama tarih yine son kayıt tarihidir — mükerrer ekleme olmasın diye.
//
// EKLENEN = taban tarihinden SONRAKİ Arvento günleri:
//   • km aracı   → mesafe_km toplamı
//   • saat makinesi → çalışma saati × makineye özel katsayı (lib/arvento/makine-saat)
//
// Hesap SUNUCUDA yapılır: tarayıcıya araç başına birkaç sayı iner, binlerce satır değil.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { raporCalismaSn, projeksiyon } from "@/lib/arvento/makine-saat";

export const dynamic = "force-dynamic";

export type TahminiGosterge = {
  /** Son gerçek okuma. */
  taban: number;
  /** Okumanın tarihi (YYYY-MM-DD). */
  tabanTarih: string;
  /** Okuma nereden geldi. */
  tabanKaynak: "yakit" | "bakim";
  /** Arvento'dan eklenen (km ya da saat). */
  eklenen: number;
  /** taban + eklenen (yuvarlanmış). */
  tahmini: number;
  /** Arvento'da kaç günlük kayıt toplandı. */
  gun: number;
};

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function girisliMi(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  return !!user;
}

/** Plaka karşılaştırması: boşluk/tire/büyük-küçük harf farkı aynı araçtır. */
const plakaAnahtar = (p: string | null | undefined) =>
  (p ?? "").toLocaleUpperCase("tr").replace(/[^A-Z0-9]/g, "");

export async function GET() {
  if (!(await girisliMi())) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
  const sb = service();

  const { data: aracVeri, error: aracHata } = await sb
    .from("araclar")
    .select("id, plaka, sayac_tipi, guncel_gosterge, saat_katsayi");
  if (aracHata) return NextResponse.json({ error: aracHata.message }, { status: 502 });
  const araclar = (aracVeri ?? []) as {
    id: string; plaka: string; sayac_tipi: string | null;
    guncel_gosterge: number | null; saat_katsayi: number | null;
  }[];

  // ── Taban: en son gerçek okuma (yakıt ya da bakım) ─────────────────────────────────────
  type Okuma = { deger: number; tarih: string; kaynak: "yakit" | "bakim" };
  const taban = new Map<string, Okuma>();
  const dahaYeni = (o: Okuma, m?: Okuma) => !m || o.tarih > m.tarih;

  const { data: yakit, error: yakitHata } = await sb
    .from("arac_yakit").select("arac_id, tarih, km_saat").gt("km_saat", 0);
  if (yakitHata) return NextResponse.json({ error: yakitHata.message }, { status: 502 });
  for (const y of (yakit ?? []) as { arac_id: string; tarih: string; km_saat: number }[]) {
    const o: Okuma = { deger: Number(y.km_saat), tarih: y.tarih, kaynak: "yakit" };
    if (dahaYeni(o, taban.get(y.arac_id))) taban.set(y.arac_id, o);
  }

  const { data: bakim, error: bakimHata } = await sb
    .from("arac_bakim").select("arac_id, bakim_tarihi, km").gt("km", 0);
  if (bakimHata) return NextResponse.json({ error: bakimHata.message }, { status: 502 });
  for (const b of (bakim ?? []) as { arac_id: string; bakim_tarihi: string; km: number }[]) {
    const o: Okuma = { deger: Number(b.km), tarih: b.bakim_tarihi, kaynak: "bakim" };
    if (dahaYeni(o, taban.get(b.arac_id))) taban.set(b.arac_id, o);
  }
  if (taban.size === 0) return NextResponse.json({});

  // ── Arvento: en eski tabandan bugüne tek sorgu, plakaya göre gruplanır ─────────────────
  const enEski = [...taban.values()].reduce((e, o) => (o.tarih < e ? o.tarih : e), "9999-12-31");
  type Satir = { plaka: string; rapor_tarihi: string; mesafe_km: number | null } & Parameters<typeof raporCalismaSn>[0];
  const plakaGun = new Map<string, Satir[]>();
  // SAYFALAMA ŞART: PostgREST bir sorguda en çok 1000 satır döner. Sayfalamasız yazıldığında
  // araçların son günleri hiç gelmiyor, tahmin de sessizce eksik çıkıyordu (ör. 60 ADR 790'ın
  // 17 günü hiç görünmedi, araç "tahmin yok" sayıldı).
  const PARCA = 1000;
  for (let offset = 0; ; offset += PARCA) {
    const { data: rapor, error: raporHata } = await sb
      .from("arac_arvento_rapor")
      .select("plaka, rapor_tarihi, mesafe_km, kontak_sn, rolanti_sn, ilk_kontak, son_kontak")
      .gt("rapor_tarihi", enEski)
      .order("rapor_tarihi", { ascending: true })
      .range(offset, offset + PARCA - 1);
    if (raporHata) return NextResponse.json({ error: raporHata.message }, { status: 502 });
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
    // Araç kartındaki değer daha yüksekse onu taban al (biri elle girmiş olabilir).
    const tabanDeger = a.guncel_gosterge != null && a.guncel_gosterge > o.deger ? a.guncel_gosterge : o.deger;
    const gunler = (plakaGun.get(plakaAnahtar(a.plaka)) ?? []).filter((r) => r.rapor_tarihi > o.tarih);
    if (gunler.length === 0) continue;                  // Arvento verisi yok → sütunda gerçek değer kalır

    const saatMi = a.sayac_tipi === "saat";
    let eklenen: number;
    if (saatMi) {
      const saat = gunler.reduce((t, r) => t + raporCalismaSn(r), 0) / 3600;
      const ileri = projeksiyon(tabanDeger, saat, a.saat_katsayi);
      if (ileri == null) continue;
      eklenen = ileri - tabanDeger;
    } else {
      eklenen = gunler.reduce((t, r) => t + Number(r.mesafe_km ?? 0), 0);
    }
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

  return NextResponse.json(sonuc);
}
