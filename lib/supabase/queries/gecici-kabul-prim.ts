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

export type GeciciKabulPrimEksik = {
  evrakId: string;
  konu: string;
  dilekceTarihi: string;
  yazan: string | null;
  santiye_id: string;
  is_adi: string;
  yatmasiGereken: number;
  yatan: number;
  eksik: number;
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

export async function getGeciciKabulPrimEksikleri(): Promise<GeciciKabulPrimEksik[]> {
  try {
    const sb = createClient();

    // Konu eşleşmesi JS'te yapılır: "GEÇİCİ"nin Türkçe büyük/küçük harf dönüşümü
    // veritabanı ilike'ında güvenilir değil. Giden evrak sayısı birkaç yüz, süzmek ucuz.
    const { data: evraklar } = await sb
      .from("giden_evrak")
      .select("id, konu, evrak_tarihi, santiye_id, olusturan_id, santiyeler!left(is_adi, sozlesme_bedeli)")
      .not("santiye_id", "is", null)
      .eq("silindi", false)
      .order("evrak_tarihi", { ascending: true });

    type E = {
      id: string; konu: string | null; evrak_tarihi: string; santiye_id: string; olusturan_id: string | null;
      santiyeler?: { is_adi: string; sozlesme_bedeli: number | null } | null;
    };
    // PostgREST ilişkili tabloyu dizi olarak tipliyor; tek kayıt olduğu için düzleştirilir.
    const dilekceler = ((evraklar ?? []) as unknown as (Omit<E, "santiyeler"> & {
      santiyeler?: { is_adi: string; sozlesme_bedeli: number | null } | { is_adi: string; sozlesme_bedeli: number | null }[] | null;
    })[])
      .map((e) => ({ ...e, santiyeler: Array.isArray(e.santiyeler) ? e.santiyeler[0] ?? null : e.santiyeler ?? null }) as E)
      .filter((e) => geciciKabulKonusuMu(e.konu));
    if (dilekceler.length === 0) return [];

    // Aynı iş için birden fazla yazışma olabilir → EN ERKEN olanı başvuru sayılır.
    const ilkDilekce = new Map<string, E>();
    for (const e of dilekceler) if (!ilkDilekce.has(e.santiye_id)) ilkDilekce.set(e.santiye_id, e);

    const santiyeIdler = [...ilkDilekce.keys()];
    const { data: itData } = await sb
      .from("iscilik_takibi")
      .select("santiye_id, kesif_artisi, fiyat_farki, iscilik_orani, yatan_prim")
      .in("santiye_id", santiyeIdler)
      .eq("silindi", false);

    const toplam = new Map<string, { gereken: number; yatan: number }>();
    for (const r of (itData ?? []) as ItRow[]) {
      const bedel = ilkDilekce.get(r.santiye_id)?.santiyeler?.sozlesme_bedeli ?? 0;
      const gereken = (bedel + (r.kesif_artisi ?? 0) + (r.fiyat_farki ?? 0)) * (r.iscilik_orani ?? 0) / 100;
      const onceki = toplam.get(r.santiye_id) ?? { gereken: 0, yatan: 0 };
      toplam.set(r.santiye_id, { gereken: onceki.gereken + gereken, yatan: onceki.yatan + (r.yatan_prim ?? 0) });
    }

    // Yazan kişinin adı
    const olusturanIdler = [...new Set(dilekceler.map((e) => e.olusturan_id).filter(Boolean))] as string[];
    const adlar = new Map<string, string>();
    if (olusturanIdler.length > 0) {
      const { data: k } = await sb.from("kullanicilar").select("id, ad_soyad, kullanici_adi").in("id", olusturanIdler);
      for (const x of (k ?? []) as { id: string; ad_soyad: string | null; kullanici_adi: string | null }[]) {
        adlar.set(x.id, x.ad_soyad || x.kullanici_adi || "");
      }
    }

    const sonuc: GeciciKabulPrimEksik[] = [];
    for (const [santiyeId, e] of ilkDilekce) {
      const t = toplam.get(santiyeId);
      if (!t || t.gereken <= 0) continue;        // oranı/bedeli girilmemiş iş → hesaplanamaz, uyarma
      const eksik = t.gereken - t.yatan;
      if (eksik < 1) continue;                    // 1 TL altı fark yuvarlamadır
      sonuc.push({
        evrakId: e.id, konu: e.konu ?? "", dilekceTarihi: e.evrak_tarihi,
        yazan: e.olusturan_id ? (adlar.get(e.olusturan_id) ?? null) : null,
        santiye_id: santiyeId, is_adi: e.santiyeler?.is_adi ?? "—",
        yatmasiGereken: t.gereken, yatan: t.yatan, eksik,
      });
    }
    sonuc.sort((a, b) => b.eksik - a.eksik);
    return sonuc;
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
