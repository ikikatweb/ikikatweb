// Arvento raporunu (Excel buffer / indirme linki) ayrıştırıp veritabanına yazar.
// Yalnızca sunucu tarafında kullanılır (service role) — API route + cron çağırır.
//
// İki rapor tipi vardır ve genelde AYRI dosya olarak gelir:
//   1) "Araç Çalışma Raporu" — günlük km/süre (her dosya tek gün)
//   2) "Genel Rapor"         — damper indirme olayları (çok günlü olabilir)
// ingestArventoBuffer her iki tipi de otomatik algılar. Kayıtlar (rapor_tarihi, plaka)
// üzerinden UPSERT edilir → çalışma ve damper verisi hangi sırada gelirse gelsin birleşir.
import { createClient } from "@supabase/supabase-js";
import { parseArventoBuffer, parseGenelRaporBuffer } from "@/lib/arvento/parse";

function trBugun(): string {
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

export type IngestSonuc = {
  calismaGunler: { tarih: string; sayi: number }[]; // işlenen çalışma raporları
  damperGunler: { tarih: string; sayi: number }[];   // damper güncellenen günler
};

export async function ingestArventoBuffer(buf: ArrayBuffer | Buffer): Promise<IngestSonuc> {
  const supabase = serviceClient();
  const sonuc: IngestSonuc = { calismaGunler: [], damperGunler: [] };

  // ---- 1) Araç Çalışma Raporu (km/süre) ----
  const work = parseArventoBuffer(buf);
  if (work.araclar.length > 0) {
    const tarih = work.raporTarihi ?? trBugun();
    // Aynı plaka birden çok kez geçebilir → en aktif kaydı tut (in-batch çakışmayı önle)
    const aktiflik = (a: typeof work.araclar[number]) => (a.mesafe_km ?? 0) + (a.hareket_sn ?? 0) / 1000;
    const tekil = new Map<string, typeof work.araclar[number]>();
    for (const a of work.araclar) {
      const k = a.plaka.trim().toLocaleUpperCase("tr");
      const m = tekil.get(k);
      if (!m || aktiflik(a) > aktiflik(m)) tekil.set(k, a);
    }
    // damper_sayisi'ne DOKUNMA (ayrı genel rapordan gelir) → upsert'te bu kolonu yazmıyoruz
    const satirlar = Array.from(tekil.values()).map((a) => ({
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
    const { error } = await supabase
      .from("arac_arvento_rapor")
      .upsert(satirlar, { onConflict: "rapor_tarihi,plaka" });
    if (error) throw new Error(`Çalışma raporu kaydı hatası: ${error.message}`);
    sonuc.calismaGunler.push({ tarih, sayi: satirlar.length });
  }

  // ---- 2) Genel Rapor (damper indirme, çok günlü) ----
  const genel = parseGenelRaporBuffer(buf);
  if (genel.length > 0) {
    const satirlar = genel.map((g) => ({
      rapor_tarihi: g.tarih,
      plaka: g.plaka,
      damper_sayisi: g.damper,
      damper_olaylar: g.olaylar,
    }));
    const { error } = await supabase
      .from("arac_arvento_rapor")
      .upsert(satirlar, { onConflict: "rapor_tarihi,plaka" });
    if (error) throw new Error(`Genel rapor (damper) kaydı hatası: ${error.message}`);
    // Gün bazında özet
    const gunMap = new Map<string, number>();
    for (const g of genel) gunMap.set(g.tarih, (gunMap.get(g.tarih) ?? 0) + 1);
    for (const [tarih, sayi] of gunMap) sonuc.damperGunler.push({ tarih, sayi });
  }

  if (sonuc.calismaGunler.length === 0 && sonuc.damperGunler.length === 0) {
    throw new Error("Dosyada 'Araç Çalışma Raporu' veya 'Genel Rapor' verisi bulunamadı.");
  }
  return sonuc;
}

// Linkten indirip içe aktar (cron + manuel link için)
export async function ingestArventoUrl(url: string): Promise<IngestSonuc> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Excel indirilemedi (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return ingestArventoBuffer(buf);
}
