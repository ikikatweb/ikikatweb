// Arvento raporunu (Excel buffer / indirme linki) ayrıştırıp veritabanına yazar.
// Yalnızca sunucu tarafında kullanılır (service role) — API route + cron çağırır.
//
// İki rapor tipi vardır ve genelde AYRI dosya olarak gelir:
//   1) "Araç Çalışma Raporu" — günlük km/süre (her dosya tek gün)
//   2) "Genel Rapor"         — damper indirme olayları (çok günlü olabilir)
// ingestArventoBuffer her iki tipi de otomatik algılar. Kayıtlar (rapor_tarihi, plaka)
// üzerinden UPSERT edilir → çalışma ve damper verisi hangi sırada gelirse gelsin birleşir.
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { parseArventoBuffer, parseGenelRaporBuffer, parseMesafeBilgisiBuffer } from "@/lib/arvento/parse";

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
  guzergahGunler?: { tarih: string; sayi: number }[]; // güzergah (rota) güncellenen plaka/gün
};

export async function ingestArventoBuffer(buf: ArrayBuffer | Buffer): Promise<IngestSonuc> {
  const supabase = serviceClient();
  const sonuc: IngestSonuc = { calismaGunler: [], damperGunler: [], guzergahGunler: [] };

  // ---- 0) Mesafe Bilgisi (Güzergah / Rota) ----
  const guzergahlar = parseMesafeBilgisiBuffer(buf);
  if (guzergahlar.length > 0) {
    const satirlar = guzergahlar.map((g) => ({
      rapor_tarihi: g.tarih,
      plaka: g.plaka,
      arac_sinifi: g.aracSinifi,
      marka: g.marka,
      model: g.model,
      toplam_mesafe: g.toplamMesafe,
      nokta_sayisi: g.noktalar.length,
      noktalar: g.noktalar,
    }));
    const { error } = await supabase
      .from("arac_arvento_guzergah")
      .upsert(satirlar, { onConflict: "rapor_tarihi,plaka" });
    if (error) throw new Error(`Güzergah kaydı hatası: ${error.message}`);
    const gunMap = new Map<string, number>();
    for (const g of guzergahlar) gunMap.set(g.tarih, (gunMap.get(g.tarih) ?? 0) + 1);
    sonuc.guzergahGunler = Array.from(gunMap.entries()).map(([tarih, sayi]) => ({ tarih, sayi }));
    // Mesafe Bilgisi dosyasında çalışma/damper sayfası olmaz → erken dön
    return sonuc;
  }

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

  // ---- 2) Genel Rapor / Damper Alarmı (damper indirme, çok günlü; bazıları KOORDİNATLI) ----
  let genel = parseGenelRaporBuffer(buf);
  if (genel.length > 0) {
    // KOORDİNAT KORUMASI: koordinatsız bir kayıt, daha önce kaydedilmiş KOORDİNATLI kaydı ezmesin.
    const tarihler = [...new Set(genel.map((g) => g.tarih))];
    const koordluKayit = new Set<string>();
    if (tarihler.length > 0) {
      const { data: mevcut } = await supabase
        .from("arac_arvento_rapor")
        .select("rapor_tarihi, plaka, damper_olaylar")
        .in("rapor_tarihi", tarihler);
      for (const m of (mevcut ?? []) as { rapor_tarihi: string; plaka: string; damper_olaylar: { lat?: number | null; lng?: number | null }[] | null }[]) {
        const ol = Array.isArray(m.damper_olaylar) ? m.damper_olaylar : [];
        if (ol.some((o) => o?.lat != null && o?.lng != null)) koordluKayit.add(`${m.rapor_tarihi}|${m.plaka}`);
      }
    }
    genel = genel.filter((g) => {
      const yeniKoordlu = g.olaylar.some((o) => o.lat != null && o.lng != null);
      return yeniKoordlu || !koordluKayit.has(`${g.tarih}|${g.plaka}`);
    });
  }
  if (genel.length > 0) {
    const satirlar = genel.map((g) => ({
      rapor_tarihi: g.tarih,
      plaka: g.plaka,
      damper_sayisi: g.damper,
      damper_olaylar: g.olaylar,
      ...(g.surucu ? { surucu: g.surucu } : {}), // şoför (varsa) Genel Rapor'dan
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

  if (sonuc.calismaGunler.length === 0 && sonuc.damperGunler.length === 0 && (sonuc.guzergahGunler?.length ?? 0) === 0) {
    // Mesafe Bilgisi sayfası var ama koordinat yoksa: ÖZET formatı yüklenmiş demektir.
    const wbCheck = XLSX.read(buf, { type: "buffer" });
    const mesafeSayfasiVar = wbCheck.SheetNames.some((n) => n.toLowerCase().includes("mesafe"));
    if (mesafeSayfasiVar) {
      throw new Error(
        "Bu Mesafe Bilgisi raporu ÖZET formatında (koordinat yok). Rota/Reglaj için " +
        "Arvento'dan raporu 'Detaylı: Seçili' seçeneğiyle dışa aktarın — detaylı raporda Enlem/Boylam sütunları bulunur.",
      );
    }
    throw new Error("Dosyada 'Araç Çalışma Raporu', 'Genel Rapor' veya 'Mesafe Bilgisi' verisi bulunamadı.");
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
