// Personel CRUD sorguları - Çalışan yönetimi işlemleri
import { createClient } from "@/lib/supabase/client";
import type { Personel, PersonelInsert, PersonelUpdate } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// TC kimlik no + ad_soyad tekilliğini kontrol et.
// haricPersonelId verilirse (düzenleme modunda) o personel hariç tutulur.
// Aynı TC varsa reddedilir. TC farklıysa ama aynı ad_soyad varsa da uyarır.
async function checkPersonelTekillik(
  fields: { tc_kimlik_no?: string | null; ad_soyad?: string | null },
  haricPersonelId?: string
) {
  const supabase = getSupabase();

  if (fields.tc_kimlik_no && fields.tc_kimlik_no.trim()) {
    let q = supabase
      .from("personel")
      .select("id, ad_soyad")
      .eq("tc_kimlik_no", fields.tc_kimlik_no.trim())
      .limit(1);
    if (haricPersonelId) q = q.neq("id", haricPersonelId);
    const { data, error } = await q;
    if (error) throw error;
    if (data && data.length > 0) {
      throw new Error(
        `Bu TC Kimlik No ("${fields.tc_kimlik_no.trim()}") zaten "${data[0].ad_soyad}" adıyla kayıtlı. Aynı personel sistemde yalnızca bir kez bulunabilir.`
      );
    }
  }

  if (fields.ad_soyad && fields.ad_soyad.trim()) {
    let q = supabase
      .from("personel")
      .select("id, tc_kimlik_no, ad_soyad")
      .eq("ad_soyad", fields.ad_soyad.trim())
      .limit(1);
    if (haricPersonelId) q = q.neq("id", haricPersonelId);
    const { data, error } = await q;
    if (error) throw error;
    if (data && data.length > 0) {
      throw new Error(
        `Bu isimde ("${fields.ad_soyad.trim()}") bir personel zaten kayıtlı (TC: ${data[0].tc_kimlik_no}). Aynı personel sistemde yalnızca bir kez bulunabilir.`
      );
    }
  }
}

export async function getPersoneller() {
  const supabase = getSupabase();
  // personel_santiye tablosu da santiyeler'e FK bağlı olduğundan ambiguity oluşuyor.
  // Join'i santiye_id kolonu üzerinden açıkça belirt.
  const { data, error } = await supabase
    .from("personel")
    .select("*, santiyeler!personel_santiye_id_fkey(is_adi)")
    .order("ad_soyad", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getPersonelById(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel")
    .select("*, santiyeler!personel_santiye_id_fkey(is_adi)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// TC ile pasif personel ara (yeniden işe alma — tüm alanları döndür)
export async function getPasifPersonelByTc(tcKimlikNo: string): Promise<Personel | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel")
    .select("*")
    .eq("tc_kimlik_no", tcKimlikNo.trim())
    .eq("durum", "pasif")
    .limit(1);
  if (error) throw error;
  return (data && data.length > 0) ? data[0] : null;
}

export async function createPersonel(personel: PersonelInsert) {
  const supabase = getSupabase();
  await checkPersonelTekillik({
    tc_kimlik_no: personel.tc_kimlik_no,
    ad_soyad: personel.ad_soyad,
  });
  const { data, error } = await supabase
    .from("personel")
    .insert(personel)
    .select()
    .single();

  if (error) throw error;

  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    bildirimGonder({
      baslik: `👤 Yeni Personel`,
      govde: `${personel.ad_soyad}${personel.gorev ? " · " + personel.gorev : ""}`,
      url: "/dashboard/yonetim/personel",
      tag: "personel",
    });
  } catch { /* sessiz */ }

  return data;
}

export async function updatePersonel(id: string, personel: PersonelUpdate) {
  const supabase = getSupabase();
  await checkPersonelTekillik(
    {
      tc_kimlik_no: personel.tc_kimlik_no,
      ad_soyad: personel.ad_soyad,
    },
    id
  );
  const { data, error } = await supabase
    .from("personel")
    .update({ ...personel, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    bildirimGonder({
      baslik: `👤 Personel Güncellendi`,
      govde: `${data.ad_soyad}${data.gorev ? " · " + data.gorev : ""}`,
      url: "/dashboard/yonetim/personel",
      tag: "personel",
    });
  } catch { /* sessiz */ }

  return data;
}

export async function deletePersonel(id: string) {
  const supabase = getSupabase();
  // İlişkili veri kontrolü
  const kontroller = [
    { tablo: "personel_puantaj", alan: "personel_id", label: "puantaj kaydı" },
    { tablo: "kasa_hareketi", alan: "personel_id", label: "kasa hareketi" },
    { tablo: "personel_santiye", alan: "personel_id", label: "şantiye ataması" },
  ];
  for (const k of kontroller) {
    const { count, error: cErr } = await supabase
      .from(k.tablo)
      .select("id", { count: "exact", head: true })
      .eq(k.alan, id);
    if (cErr) continue; // tablo yoksa atla
    if (count && count > 0) {
      throw new Error(`Bu personele ait ${count} adet ${k.label} bulunuyor. Personel silinemez, sadece çıkış verilebilir.`);
    }
  }
  const { error } = await supabase.from("personel").delete().eq("id", id);
  if (error) throw error;
}

// Personeli pasife al (işten ayrıldı). Belirli bir tarih ile birlikte kaydedilir.
export async function setPersonelPasif(id: string, pasifTarihi: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel")
    .update({
      durum: "pasif",
      pasif_tarihi: pasifTarihi,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

// Personeli tekrar aktife al
export async function setPersonelAktif(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel")
    .update({
      durum: "aktif",
      pasif_tarihi: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
