// GEÇİCİ KABUL DİLEKÇESİ VERİLMİŞ AMA SGK PRİMİ TAMAMLANMAMIŞ İŞLER
//
// Konusunda "geçici kabul" geçen giden evrak, işin geçici kabul başvurusudur. Kabul süreci
// başlamışken primin eksik kalması sorun; ana ekran bunları sarı uyarıyla listeler.
//
// Veri evrakın KENDİSİNDEN türetilir — şantiyeye ayrıca kopyalanmaz. Tarih, yazan kişi ve
// dilekçe metni zaten giden_evrak'ta duruyor.
//
// Prim hesabı Bordro Takibi'ndeki TAHMİNSİZ karşılığıyla aynı:
//   yatması gereken = (sözleşme bedeli + keşif artışı + fiyat farkı) × işçilik oranı / 100
// Tahmini fiyat farkı BİLEREK dışarıda: o bir öngörü, yatırılması gereken bir yükümlülük
// değil — eksik prim uyarısı öngörüye dayanmamalı.

import { createClient } from "@/lib/supabase/client";
import { geciciKabulKonusuMu } from "@/lib/gecici-kabul-dilekce";

export type GeciciKabulDilekce = {
  evrakId: string;
  konu: string;
  dilekceTarihi: string;
  yazan: string | null;
  santiye_id: string;
};

type ItRow = {
  santiye_id: string;
  kesif_artisi: number | null;
  fiyat_farki: number | null;
  iscilik_orani: number | null;
  yatan_prim: number | null;
};

/** Tek şantiyenin prim durumu — dilekçe kaydedilmeden önceki uyarı için. */
export async function getSantiyePrimDurumu(
  santiyeId: string,
): Promise<{ gereken: number; yatan: number; eksik: number } | null> {
  if (!santiyeId) return null;
  try {
    const sb = createClient();
    const { data: s } = await sb
      .from("santiyeler").select("sozlesme_bedeli").eq("id", santiyeId).maybeSingle();
    const bedel = (s as { sozlesme_bedeli?: number | null } | null)?.sozlesme_bedeli ?? 0;
    const { data: itData } = await sb
      .from("iscilik_takibi")
      .select("kesif_artisi, fiyat_farki, iscilik_orani, yatan_prim")
      .eq("santiye_id", santiyeId).eq("silindi", false);
    let gereken = 0, yatan = 0;
    for (const r of (itData ?? []) as Omit<ItRow, "santiye_id">[]) {
      gereken += (bedel + (r.kesif_artisi ?? 0) + (r.fiyat_farki ?? 0)) * (r.iscilik_orani ?? 0) / 100;
      yatan += r.yatan_prim ?? 0;
    }
    if (gereken <= 0) return null;   // oran/bedel girilmemiş → hesaplanamaz, uyarma
    return { gereken, yatan, eksik: gereken - yatan };
  } catch {
    return null;                     // hesaplanamadıysa kaydı engelleme
  }
}

/**
 * Konusunda "geçici kabul" geçen giden evraklar — iş başına EN ERKEN olanı.
 * Prim hesabı BURADA YAPILMAZ: ana ekrandaki Bordro Özeti zaten hesaplıyor (tahmini
 * fiyat farkı dâhil, tahmini bordro düşülmüş "Kalan"). Aynı hesabı ikinci kez yazmak
 * iki ekranın farklı rakam göstermesi riskini doğururdu; uyarı o satırları kullanır.
 */
export async function getGeciciKabulDilekceleri(): Promise<GeciciKabulDilekce[]> {
  try {
    const sb = createClient();
    // Konu eşleşmesi JS tarafında: "GEÇİCİ"nin Türkçe büyük/küçük harf dönüşümü
    // veritabanı ilike'ında güvenilir değil. Giden evrak sayısı birkaç yüz, süzmek ucuz.
    const { data: evraklar } = await sb
      .from("giden_evrak")
      .select("id, konu, evrak_tarihi, santiye_id, olusturan_id")
      .not("santiye_id", "is", null)
      .eq("silindi", false)
      .order("evrak_tarihi", { ascending: true });

    type E = { id: string; konu: string | null; evrak_tarihi: string; santiye_id: string; olusturan_id: string | null };
    const dilekceler = ((evraklar ?? []) as E[]).filter((e) => geciciKabulKonusuMu(e.konu));
    if (dilekceler.length === 0) return [];

    // Aynı iş için birden fazla yazışma olabilir → EN ERKEN olanı başvuru sayılır.
    const ilk = new Map<string, E>();
    for (const e of dilekceler) if (!ilk.has(e.santiye_id)) ilk.set(e.santiye_id, e);

    const idler = [...new Set([...ilk.values()].map((e) => e.olusturan_id).filter(Boolean))] as string[];
    const adlar = new Map<string, string>();
    if (idler.length > 0) {
      const { data: k } = await sb.from("kullanicilar").select("id, ad_soyad, kullanici_adi").in("id", idler);
      for (const x of (k ?? []) as { id: string; ad_soyad: string | null; kullanici_adi: string | null }[]) {
        adlar.set(x.id, x.ad_soyad || x.kullanici_adi || "");
      }
    }

    return [...ilk.values()].map((e) => ({
      evrakId: e.id, konu: e.konu ?? "", dilekceTarihi: e.evrak_tarihi, santiye_id: e.santiye_id,
      yazan: e.olusturan_id ? (adlar.get(e.olusturan_id) ?? null) : null,
    }));
  } catch {
    return [];
  }
}

/** Uyarıdan tıklanınca dilekçe metnini getirir — sayfa değişmeden pencerede okunur. */
export async function getDilekceMetni(evrakId: string): Promise<{ konu: string; metin: string | null; tarih: string } | null> {
  try {
    const sb = createClient();
    const { data } = await sb
      .from("giden_evrak").select("konu, metin, evrak_tarihi").eq("id", evrakId).maybeSingle();
    if (!data) return null;
    const d = data as { konu: string | null; metin: string | null; evrak_tarihi: string };
    return { konu: d.konu ?? "", metin: d.metin, tarih: d.evrak_tarihi };
  } catch {
    return null;
  }
}
