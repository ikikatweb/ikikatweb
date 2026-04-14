// Araç Puantaj sorguları
// Bir araç bir tarihte sadece 1 şantiyede puantajlanabilir (UNIQUE arac_id+tarih)
import { createClient } from "@/lib/supabase/client";
import type { AracPuantaj, AracPuantajDurum } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Tarih aralığı için şantiyenin puantaj kayıtlarını getir (özet rapor için)
// baslangic ve bitis YYYY-MM-DD formatında (bitis dahil değil)
export async function getAracPuantajByRange(
  santiyeId: string,
  baslangic: string,
  bitis: string
): Promise<AracPuantaj[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_puantaj")
    .select("*")
    .eq("santiye_id", santiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (error) throw error;
  return (data ?? []) as AracPuantaj[];
}

// Bir ay için belirli şantiyenin puantaj kayıtlarını getir
// Her kayda created_by'ın çözülmüş ad_soyad'ı (created_by_ad) eklenir
export async function getAracPuantajByAySantiye(
  santiyeId: string,
  yil: number,
  ay: number
): Promise<AracPuantaj[]> {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("arac_puantaj")
    .select("*")
    .eq("santiye_id", santiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (error) throw error;
  const rows = (data ?? []) as AracPuantaj[];
  if (rows.length === 0) return rows;

  // created_by id'lerinden kullanıcı ad_soyad'larını topluca çek
  const userIds = [...new Set(rows.map((p) => p.created_by).filter(Boolean) as string[])];
  if (userIds.length > 0) {
    const { data: kullanicilar } = await supabase
      .from("kullanicilar")
      .select("id, ad_soyad")
      .in("id", userIds);
    const map = new Map<string, string>();
    (kullanicilar ?? []).forEach((k) => map.set(k.id, k.ad_soyad));
    return rows.map((p) => ({
      ...p,
      created_by_ad: p.created_by ? map.get(p.created_by) ?? null : null,
    }));
  }
  return rows.map((p) => ({ ...p, created_by_ad: null }));
}

// Bir ay için belirli şantiyenin puantaj kayıtlarını + araç bilgilerini getir
// (export ve toplam hesabı için)
export async function getAracPuantajByAyWithRelations(
  santiyeId: string,
  yil: number,
  ay: number
) {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("arac_puantaj")
    .select("*, araclar(plaka, marka, model, tip)")
    .eq("santiye_id", santiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (error) throw error;
  return data ?? [];
}

// Belirtilen ay içinde, BAŞKA şantiyelerdeki TÜM araç puantajlarını getir.
// `aracIds` boş bırakılırsa tüm araçların çakışmaları getirilir (filtresiz).
// Bu, race condition / stale state'e karşı sağlam bir yöntemdir - UI'da gösterilen
// araç listesine bakılmaksızın tüm çakışmalar yüklenir.
export async function getDigerSantiyeCakismalari(
  aracIds: string[] | null,
  yil: number,
  ay: number,
  haricSantiyeId: string
): Promise<{ arac_id: string; tarih: string; santiye_id: string; santiye_adi: string }[]> {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  let query = supabase
    .from("arac_puantaj")
    .select("arac_id, tarih, santiye_id, santiyeler(is_adi)")
    .neq("santiye_id", haricSantiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  // Araç listesi verilmişse filtrele, değilse tümünü getir
  if (aracIds && aracIds.length > 0) {
    query = query.in("arac_id", aracIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r) => {
    const s = r as unknown as {
      arac_id: string;
      tarih: string;
      santiye_id: string;
      santiyeler?: { is_adi: string } | null;
    };
    return {
      arac_id: s.arac_id,
      tarih: s.tarih,
      santiye_id: s.santiye_id,
      santiye_adi: s.santiyeler?.is_adi ?? "?",
    };
  });
}

// Belirli bir aracın belirli tarihteki TÜM puantaj kayıtlarını (multi-row safe) getir
// DB'de UNIQUE constraint olmasa bile doğru çalışır - çakışma varsa hepsini listeler.
export async function getAracPuantajKayitlari(
  aracId: string,
  tarih: string
): Promise<{ id: string; santiye_id: string; santiye_adi: string }[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_puantaj")
    .select("id, santiye_id, santiyeler(is_adi)")
    .eq("arac_id", aracId)
    .eq("tarih", tarih);

  if (error) throw error;
  return (data ?? []).map((r) => {
    const s = r as unknown as {
      id: string;
      santiye_id: string;
      santiyeler?: { is_adi: string } | null;
    };
    return {
      id: s.id,
      santiye_id: s.santiye_id,
      santiye_adi: s.santiyeler?.is_adi ?? "?",
    };
  });
}

// Eski isim - geriye dönük uyumluluk için tek-satır wrapper
// Birden fazla kayıt varsa ilkini döner (kritik guard'lar getAracPuantajKayitlari kullanıyor)
export async function getAracPuantajCakisma(aracId: string, tarih: string) {
  const kayitlar = await getAracPuantajKayitlari(aracId, tarih);
  if (kayitlar.length === 0) return null;
  return { id: kayitlar[0].id, santiye_id: kayitlar[0].santiye_id, santiyeler: { is_adi: kayitlar[0].santiye_adi } };
}

// Puantaj ekle veya güncelle.
// Aynı araç + aynı tarih için başka şantiyede kayıt VARSA hata fırlatır (reddedilir).
// Aynı şantiyede kayıt varsa onu günceller.
// DB UNIQUE constraint yoksa bile bu kod seviyesinde tekillik sağlanır.
export async function upsertAracPuantaj(
  aracId: string,
  santiyeId: string,
  tarih: string,
  durum: AracPuantajDurum,
  aciklama?: string | null,
  kullaniciId?: string | null
) {
  const supabase = getSupabase();

  // Önce aynı araç + tarih için mevcut tüm kayıtları kontrol et
  const mevcut = await getAracPuantajKayitlari(aracId, tarih);

  // Başka şantiyelerde kayıt varsa REDDET
  const baskaSantiyeler = mevcut.filter((k) => k.santiye_id !== santiyeId);
  if (baskaSantiyeler.length > 0) {
    const isim = baskaSantiyeler.map((k) => k.santiye_adi).join(", ");
    throw new Error(
      `Bu araç ${tarih} tarihinde "${isim}" şantiyesinde puantajlı. Aynı araç aynı gün sadece 1 şantiyede olabilir.`
    );
  }

  // Bu şantiyede kayıt varsa güncelle
  const buSantiyedeki = mevcut.find((k) => k.santiye_id === santiyeId);
  if (buSantiyedeki) {
    const { error } = await supabase
      .from("arac_puantaj")
      .update({
        durum,
        aciklama: aciklama ?? null,
        created_by: kullaniciId ?? null,
      })
      .eq("id", buSantiyedeki.id);
    if (error) throw error;
    return;
  }

  // Hiç kayıt yok -> yeni insert
  const { error } = await supabase
    .from("arac_puantaj")
    .insert({
      arac_id: aracId,
      santiye_id: santiyeId,
      tarih,
      durum,
      aciklama: aciklama ?? null,
      created_by: kullaniciId ?? null,
    });
  if (error) throw error;
}

// Puantajı sil (toggle off)
export async function deleteAracPuantaj(aracId: string, tarih: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_puantaj")
    .delete()
    .eq("arac_id", aracId)
    .eq("tarih", tarih);
  if (error) throw error;
}

// Bir ay içinde bir aracın TÜM şantiyelerdeki toplam çalıştığı gün sayısı
// (genel toplam göstergesi için)
export async function getAracToplamGun(aracId: string, yil: number, ay: number): Promise<number> {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  const { count, error } = await supabase
    .from("arac_puantaj")
    .select("id", { count: "exact", head: true })
    .eq("arac_id", aracId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (error) throw error;
  return count ?? 0;
}
