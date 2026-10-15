// GEÇİCİ KABUL DİLEKÇESİ VERİLMİŞ AMA SGK PRİMİ TAMAMLANMAMIŞ İŞLER
//
// Konusunda "geçici kabul" geçen giden evrak, işin geçici kabul başvurusudur. Kabul süreci
// başlamışken primin eksik kalması sorun; ana ekran bunları sarı uyarıyla listeler.
//
// Veri evrakın KENDİSİNDEN türetilir — şantiyeye ayrıca kopyalanmaz. Tarih, yazan kişi ve
// dilekçe metni zaten giden_evrak'ta duruyor.
//
// Prim hesabı BURADA YAPILMAZ: lib/bordro/prim-durumu.ts ana ekrandaki "Kalan" sütununun
// birebir aynısını üretiyor ve hem bu uyarı hem giden evrak formu oradan besleniyor.

import { createClient } from "@/lib/supabase/client";
import { geciciKabulDilekcesiMi } from "@/lib/gecici-kabul-dilekce";

export type GeciciKabulDilekce = {
  evrakId: string;
  konu: string;
  dilekceTarihi: string;
  yazan: string | null;
  santiye_id: string;
};

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
      .select("id, konu, metin, evrak_tarihi, santiye_id, olusturan_id")
      .not("santiye_id", "is", null)
      .eq("silindi", false)
      .order("evrak_tarihi", { ascending: true });

    type E = { id: string; konu: string | null; metin: string | null; evrak_tarihi: string; santiye_id: string; olusturan_id: string | null };
    // Konuda yazmıyorsa METNE de bakılır — kullanıcı konuya "Hakediş" yazıp gövdede
    // "geçici kabulün yapılması"nı isteyebiliyor.
    const dilekceler = ((evraklar ?? []) as E[]).filter((e) => geciciKabulDilekcesiMi(e.konu, e.metin));
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

/** Uyarıdan tıklanınca dilekçenin KENDİSİ açılır — yazdırma önizlemesinin aynısı.
 *  Düz metin dönmek yetmiyordu: gövde HTML olduğu için pencerede "Geç<i>c</i> kabul" gibi
 *  ham etiketler görünüyordu. Antetli sayfayı basan bileşenin beklediği alanların hepsi
 *  (firma, sayı no, muhatap, ilgi, ekler, kaşe) burada getirilir. */
export type DilekceOnizleme = {
  id: string;
  evrak_sayi_no: string;
  konu: string;
  metin: string | null;
  muhatap: string | null;
  evrak_tarihi: string;
  tarih_gosterim: string | null;
  ilgi_listesi: string[];
  ekler: string[];
  kase_dahil: boolean;
  firmalar: { firma_adi: string; kisa_adi: string | null; adres: string | null; antet_url: string | null; kase_url: string | null } | null;
};

export async function getDilekceOnizleme(evrakId: string): Promise<DilekceOnizleme | null> {
  try {
    const sb = createClient();
    const { data } = await sb
      .from("giden_evrak")
      .select("id, evrak_sayi_no, konu, metin, muhatap, evrak_tarihi, tarih_gosterim, ilgi_listesi, ekler, kase_dahil, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url)")
      .eq("id", evrakId)
      .maybeSingle();
    if (!data) return null;
    const d = data as unknown as DilekceOnizleme & { firmalar: DilekceOnizleme["firmalar"] | DilekceOnizleme["firmalar"][] };
    return {
      ...d,
      konu: d.konu ?? "",
      evrak_sayi_no: d.evrak_sayi_no ?? "",
      ilgi_listesi: d.ilgi_listesi ?? [],
      ekler: d.ekler ?? [],
      kase_dahil: d.kase_dahil ?? false,
      // PostgREST !left birleşimi tek kayıtta bile dizi dönebiliyor.
      firmalar: Array.isArray(d.firmalar) ? (d.firmalar[0] ?? null) : d.firmalar,
    };
  } catch {
    return null;
  }
}
