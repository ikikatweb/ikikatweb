// Arvento raporunu (Excel buffer / indirme linki) ayrıştırıp veritabanına yazar.
// Yalnızca sunucu tarafında kullanılır (service role) — API route + cron çağırır.
import { createClient } from "@supabase/supabase-js";
import { parseArventoBuffer } from "@/lib/arvento/parse";

function trBugun(): string {
  // Türkiye saatine göre YYYY-MM-DD
  const now = new Date();
  const tr = new Date(now.getTime() + (3 * 60 - now.getTimezoneOffset()) * 60000);
  return tr.toISOString().slice(0, 10);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase yapılandırması eksik");
  return createClient(url, key);
}

export type IngestSonuc = { tarih: string; sayi: number };

export async function ingestArventoBuffer(buf: ArrayBuffer | Buffer): Promise<IngestSonuc> {
  const parsed = parseArventoBuffer(buf);
  if (parsed.araclar.length === 0) {
    throw new Error("Excel'de 'Araç Çalışma Raporu' verisi bulunamadı (sayfa/başlık eşleşmedi).");
  }
  const tarih = parsed.raporTarihi ?? trBugun();
  const supabase = serviceClient();

  // Aynı güne ait eski kayıtları temizle (yeniden içe aktarımda mükerrer olmasın)
  await supabase.from("arac_arvento_rapor").delete().eq("rapor_tarihi", tarih);

  // Aynı plaka raporda birden çok kez geçebilir → (tarih, plaka) benzersizlik kısıtını
  // ihlal etmemek için plakaya göre tekilleştir. En aktif kaydı (mesafe + hareket) tut.
  const aktiflik = (a: typeof parsed.araclar[number]) => (a.mesafe_km ?? 0) + (a.hareket_sn ?? 0) / 1000;
  const tekilMap = new Map<string, typeof parsed.araclar[number]>();
  for (const a of parsed.araclar) {
    const k = a.plaka.trim().toLocaleUpperCase("tr");
    const mevcut = tekilMap.get(k);
    if (!mevcut || aktiflik(a) > aktiflik(mevcut)) tekilMap.set(k, a);
  }
  const tekilAraclar = Array.from(tekilMap.values());

  const satirlar = tekilAraclar.map((a) => ({
    rapor_tarihi: tarih,
    plaka: a.plaka,
    surucu: a.surucu,
    cihaz_no: a.cihaz_no,
    mesafe_km: a.mesafe_km,
    kontak_sn: a.kontak_sn,
    rolanti_sn: a.rolanti_sn,
    hareket_sn: a.hareket_sn,
    maks_hiz: a.maks_hiz,
    marka: a.marka,
    model: a.model,
  }));

  const { error } = await supabase.from("arac_arvento_rapor").insert(satirlar);
  if (error) throw new Error(`Kayıt hatası: ${error.message}`);

  return { tarih, sayi: satirlar.length };
}

// Linkten indirip içe aktar (cron + manuel link için)
export async function ingestArventoUrl(url: string): Promise<IngestSonuc> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Excel indirilemedi (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return ingestArventoBuffer(buf);
}
