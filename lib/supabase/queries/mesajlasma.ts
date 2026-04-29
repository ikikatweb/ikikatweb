// Mesajlaşma sorguları — kullanıcı arası 1-1 ve grup konuşmaları
import { createClient } from "@/lib/supabase/client";
import type { MesajKonusma, MesajUye, Mesaj } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Geçerli kullanıcının üye olduğu tüm konuşmaları getir (en son mesaj zamanına göre)
// Ayrıca her konuşma için: üye listesi, son mesaj, okunmamış sayısı
export type KonusmaOzet = MesajKonusma & {
  uyeler: { kullanici_id: string; ad_soyad: string }[];
  sonMesaj: { icerik: string | null; gonderen_ad: string | null; created_at: string } | null;
  okunmamisSayisi: number;
};

export async function getKonusmalar(
  currentKullaniciId: string,
  tumunuGor = false,
): Promise<KonusmaOzet[]> {
  const supabase = getSupabase();
  // Kullanıcının kendi üyeliklerini çek (okunmamış sayısını hesaplamak için her durumda lazım)
  const { data: uyelikler } = await supabase
    .from("mesaj_uye")
    .select("konusma_id, son_okunan_mesaj_id, son_okunma_zamani")
    .eq("kullanici_id", currentKullaniciId);
  const kendiUyelikleri = uyelikler ?? [];

  // tumunuGor=true (yönetici/şantiye yöneticisi): tüm konuşmaları çek
  // tumunuGor=false: sadece kullanıcının üye olduğu konuşmaları çek
  let konusmaQuery = supabase
    .from("mesaj_konusma")
    .select("*")
    .order("son_mesaj_zamani", { ascending: false, nullsFirst: false });
  if (!tumunuGor) {
    if (kendiUyelikleri.length === 0) return [];
    konusmaQuery = konusmaQuery.in("id", kendiUyelikleri.map((u) => u.konusma_id));
  }
  const { data: konusmalar } = await konusmaQuery;
  if (!konusmalar || konusmalar.length === 0) return [];
  const konusmaIds = konusmalar.map((k) => k.id);

  // Tüm üyeleri tek seferde çek
  const { data: tumUyeler } = await supabase
    .from("mesaj_uye")
    .select("konusma_id, kullanici_id")
    .in("konusma_id", konusmaIds);

  // Kullanıcı adlarını çek (RLS bypass için API kullan)
  const adMap = new Map<string, string>();
  try {
    const res = await fetch("/api/kullanicilar/adlar");
    if (res.ok) {
      const adlar = (await res.json()) as { id: string; ad_soyad: string }[];
      for (const a of adlar) adMap.set(a.id, a.ad_soyad);
    }
  } catch { /* sessiz */ }

  // Son mesajları çek
  const { data: sonMesajlar } = await supabase
    .from("mesaj")
    .select("id, konusma_id, gonderen_id, icerik, created_at")
    .in("konusma_id", konusmaIds)
    .eq("silindi", false)
    .order("created_at", { ascending: false });

  const sonMesajMap = new Map<string, { icerik: string | null; gonderen_ad: string | null; created_at: string }>();
  for (const m of sonMesajlar ?? []) {
    if (!sonMesajMap.has(m.konusma_id)) {
      sonMesajMap.set(m.konusma_id, {
        icerik: m.icerik,
        gonderen_ad: adMap.get(m.gonderen_id) ?? "—",
        created_at: m.created_at,
      });
    }
  }

  // Okunmamış sayıları hesapla — sadece kullanıcının ÜYE olduğu konuşmalarda
  // (admin tüm konuşmaları görse bile, üye olmadığı yerlerin "okunmamış"ı kendi sayısına yazılmaz)
  const okunmamisMap = new Map<string, number>();
  const uyelikMap = new Map<string, string | null>();
  for (const u of kendiUyelikleri) uyelikMap.set(u.konusma_id, u.son_okunma_zamani);
  for (const m of sonMesajlar ?? []) {
    if (m.gonderen_id === currentKullaniciId) continue; // kendi mesajları okunmamış sayılmaz
    if (!uyelikMap.has(m.konusma_id)) continue; // üye değilse atla (admin gözlemci modu)
    const sonOkundu = uyelikMap.get(m.konusma_id);
    if (!sonOkundu || m.created_at > sonOkundu) {
      okunmamisMap.set(m.konusma_id, (okunmamisMap.get(m.konusma_id) ?? 0) + 1);
    }
  }

  // Üyeleri konuşmaya göre grupla
  const uyeMap = new Map<string, { kullanici_id: string; ad_soyad: string }[]>();
  for (const u of (tumUyeler ?? []) as { konusma_id: string; kullanici_id: string }[]) {
    if (!uyeMap.has(u.konusma_id)) uyeMap.set(u.konusma_id, []);
    uyeMap.get(u.konusma_id)!.push({
      kullanici_id: u.kullanici_id,
      ad_soyad: adMap.get(u.kullanici_id) ?? "—",
    });
  }

  return konusmalar.map((k) => ({
    ...(k as MesajKonusma),
    uyeler: uyeMap.get(k.id) ?? [],
    sonMesaj: sonMesajMap.get(k.id) ?? null,
    okunmamisSayisi: okunmamisMap.get(k.id) ?? 0,
  }));
}

// Toplam okunmamış mesaj sayısı (badge için)
export async function getOkunmamisToplam(currentKullaniciId: string): Promise<number> {
  const k = await getKonusmalar(currentKullaniciId);
  return k.reduce((s, x) => s + x.okunmamisSayisi, 0);
}

// Bir konuşmadaki tüm mesajları getir (sırayla)
export async function getMesajlar(konusmaId: string): Promise<Mesaj[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("mesaj")
    .select("*")
    .eq("konusma_id", konusmaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Mesaj[];
}

// Yeni konuşma başlat (1-1 veya grup)
// uyeIds → konuşmaya dahil edilecek diğer kullanıcı id'leri (currentKullaniciId hariç)
export async function konusmaBaslat(
  currentKullaniciId: string,
  uyeIds: string[],
  baslik?: string,
): Promise<MesajKonusma> {
  const supabase = getSupabase();
  const tip = uyeIds.length > 1 ? "grup" : "tekil";

  // 1-1 için mevcut konuşma var mı kontrol et
  if (tip === "tekil" && uyeIds.length === 1) {
    const oturum = await mevcut1to1Bul(currentKullaniciId, uyeIds[0]);
    if (oturum) return oturum;
  }

  const { data: konusma, error } = await supabase
    .from("mesaj_konusma")
    .insert({
      tip,
      baslik: baslik?.trim() || null,
      olusturan_id: currentKullaniciId,
    })
    .select()
    .single();
  if (error) throw error;

  const tumUyeler = [currentKullaniciId, ...uyeIds];
  const uyeRows = tumUyeler.map((kid) => ({
    konusma_id: konusma.id,
    kullanici_id: kid,
  }));
  await supabase.from("mesaj_uye").insert(uyeRows);
  return konusma as MesajKonusma;
}

async function mevcut1to1Bul(a: string, b: string): Promise<MesajKonusma | null> {
  const supabase = getSupabase();
  // a ve b'nin ortak olduğu, tip="tekil" konuşma var mı?
  const { data: aUyelikler } = await supabase
    .from("mesaj_uye")
    .select("konusma_id")
    .eq("kullanici_id", a);
  if (!aUyelikler || aUyelikler.length === 0) return null;
  const aIds = aUyelikler.map((u) => u.konusma_id);
  const { data: ortak } = await supabase
    .from("mesaj_uye")
    .select("konusma_id")
    .eq("kullanici_id", b)
    .in("konusma_id", aIds);
  if (!ortak || ortak.length === 0) return null;
  const ortakIds = ortak.map((u) => u.konusma_id);
  const { data: tekilK } = await supabase
    .from("mesaj_konusma")
    .select("*")
    .in("id", ortakIds)
    .eq("tip", "tekil")
    .limit(1);
  return (tekilK?.[0] as MesajKonusma) ?? null;
}

// Mesaj gönder (text veya dosya)
export async function mesajGonder(input: {
  konusma_id: string;
  gonderen_id: string;
  icerik?: string | null;
  dosya_url?: string | null;
  dosya_adi?: string | null;
  dosya_tipi?: string | null;
}): Promise<Mesaj> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("mesaj")
    .insert({
      konusma_id: input.konusma_id,
      gonderen_id: input.gonderen_id,
      icerik: input.icerik?.trim() || null,
      dosya_url: input.dosya_url ?? null,
      dosya_adi: input.dosya_adi ?? null,
      dosya_tipi: input.dosya_tipi ?? null,
      silindi: false,
    })
    .select()
    .single();
  if (error) throw error;
  // Konuşmanın son_mesaj_zamani'ni güncelle
  await supabase
    .from("mesaj_konusma")
    .update({ son_mesaj_zamani: new Date().toISOString() })
    .eq("id", input.konusma_id);

  // Bildirim gönder — konuşmadaki diğer üyeler + tüm admin/şantiye yöneticileri
  // (admin/şantiye yöneticisi konuşmanın üyesi olmasa bile haber alsın)
  try {
    const [{ data: digerUyeler }, { data: adminler }] = await Promise.all([
      supabase
        .from("mesaj_uye")
        .select("kullanici_id")
        .eq("konusma_id", input.konusma_id)
        .neq("kullanici_id", input.gonderen_id),
      supabase
        .from("kullanicilar")
        .select("id")
        .in("rol", ["yonetici", "santiye_admin"])
        .eq("aktif", true)
        .neq("id", input.gonderen_id),
    ]);
    // İki listeyi birleştir + tekrarları temizle
    const idSet = new Set<string>();
    for (const u of digerUyeler ?? []) idSet.add(u.kullanici_id);
    for (const a of adminler ?? []) idSet.add(a.id);
    const targetIds = Array.from(idSet);
    if (targetIds.length > 0) {
      const govde = input.icerik?.trim()
        ? input.icerik.trim()
        : input.dosya_adi
          ? `📎 ${input.dosya_adi}`
          : "Yeni mesaj";
      await fetch("/api/push/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baslik: "Yeni Mesaj",
          govde,
          url: `/dashboard/mesajlasma?konusma=${input.konusma_id}`,
          tag: "mesaj",
          target_user_ids: targetIds,
        }),
      });
    }
  } catch { /* sessiz — bildirim başarısız olsa da mesaj kaydedildi */ }

  return data as Mesaj;
}

// Mesajı okundu işaretle (kullanıcının bu konuşmadaki okunma zamanını güncelle)
export async function mesajOku(konusmaId: string, kullaniciId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("mesaj_uye")
    .update({ son_okunma_zamani: new Date().toISOString() })
    .eq("konusma_id", konusmaId)
    .eq("kullanici_id", kullaniciId);
}

// Mesajı sil (sadece admin/şantiye admini veya sahibi)
export async function mesajSil(mesajId: string, silenId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("mesaj")
    .update({
      silindi: true,
      silinme_zamani: new Date().toISOString(),
      silen_id: silenId,
    })
    .eq("id", mesajId);
  if (error) throw error;
}

// Konuşmayı + tüm mesajları sil (admin yedekledikten sonra)
export async function konusmaSil(konusmaId: string): Promise<void> {
  const supabase = getSupabase();
  // Önce mesajları, sonra üyeleri, sonra konuşmayı sil
  await supabase.from("mesaj").delete().eq("konusma_id", konusmaId);
  await supabase.from("mesaj_uye").delete().eq("konusma_id", konusmaId);
  await supabase.from("mesaj_konusma").delete().eq("id", konusmaId);
}

// Konuşmayı yedekle — JSON formatında tüm mesajları (ve dosya URL'lerini) döner
export async function konusmaYedekle(konusmaId: string) {
  const supabase = getSupabase();
  const { data: konusma } = await supabase
    .from("mesaj_konusma")
    .select("*")
    .eq("id", konusmaId)
    .single();
  const { data: uyeler } = await supabase
    .from("mesaj_uye")
    .select("kullanici_id")
    .eq("konusma_id", konusmaId);
  const { data: mesajlar } = await supabase
    .from("mesaj")
    .select("*")
    .eq("konusma_id", konusmaId)
    .order("created_at", { ascending: true });
  return { konusma, uyeler, mesajlar };
}
