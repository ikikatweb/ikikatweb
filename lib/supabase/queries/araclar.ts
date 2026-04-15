// Araç CRUD sorguları - Supabase üzerinden araç işlemleri
import { createClient } from "@/lib/supabase/client";
import type { AracInsert, AracUpdate } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Plaka / şase no / motor no tekilliğini kontrol et.
// haricAracId verilirse (düzenleme modunda) o araç hariç tutulur.
// Çakışma varsa açıklayıcı bir Error fırlatır.
async function checkAracTekillik(
  fields: { plaka?: string | null; sase_no?: string | null; motor_no?: string | null },
  haricAracId?: string
) {
  const supabase = getSupabase();
  const checks: { alan: string; label: string; deger: string }[] = [];
  if (fields.plaka && fields.plaka.trim()) {
    checks.push({ alan: "plaka", label: "Plaka", deger: fields.plaka.trim() });
  }
  if (fields.sase_no && fields.sase_no.trim()) {
    checks.push({ alan: "sase_no", label: "Şase No", deger: fields.sase_no.trim() });
  }
  if (fields.motor_no && fields.motor_no.trim()) {
    checks.push({ alan: "motor_no", label: "Motor No", deger: fields.motor_no.trim() });
  }

  for (const c of checks) {
    let query = supabase.from("araclar").select("id, plaka").eq(c.alan, c.deger).limit(1);
    if (haricAracId) query = query.neq("id", haricAracId);
    const { data, error } = await query;
    if (error) throw error;
    if (data && data.length > 0) {
      throw new Error(
        `Bu ${c.label} ("${c.deger}") zaten "${data[0].plaka}" plakalı araçta kayıtlı. Aynı ${c.label} iki farklı araçta olamaz.`
      );
    }
  }
}

export async function getAraclar() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("araclar")
    .select("*, firmalar!left(firma_adi), santiyeler!left(is_adi)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getAracById(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("araclar")
    .select("*, firmalar!left(firma_adi), santiyeler!left(is_adi)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createArac(arac: AracInsert) {
  const supabase = getSupabase();
  await checkAracTekillik({
    plaka: arac.plaka,
    sase_no: arac.sase_no,
    motor_no: arac.motor_no,
  });
  const { data, error } = await supabase
    .from("araclar")
    .insert(arac)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateArac(id: string, arac: AracUpdate) {
  const supabase = getSupabase();
  // Sadece gönderilen alanlar için kontrol yap
  await checkAracTekillik(
    {
      plaka: arac.plaka,
      sase_no: arac.sase_no,
      motor_no: arac.motor_no,
    },
    id
  );
  const { data, error } = await supabase
    .from("araclar")
    .update({ ...arac, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteArac(id: string) {
  const supabase = getSupabase();
  // İlişkili veri kontrolü
  const kontroller = [
    { tablo: "arac_yakit", alan: "arac_id", label: "yakıt kaydı" },
    { tablo: "arac_puantaj", alan: "arac_id", label: "puantaj kaydı" },
    { tablo: "arac_police", alan: "arac_id", label: "poliçe kaydı" },
    { tablo: "arac_kira_bedeli", alan: "arac_id", label: "kira bedeli kaydı" },
  ];
  for (const k of kontroller) {
    const { count, error: cErr } = await supabase
      .from(k.tablo)
      .select("id", { count: "exact", head: true })
      .eq(k.alan, id);
    if (cErr) continue;
    if (count && count > 0) {
      throw new Error(`Bu araca ait ${count} adet ${k.label} bulunuyor. Araç silinemez, sadece pasife alınabilir.`);
    }
  }
  const { error } = await supabase.from("araclar").delete().eq("id", id);
  if (error) throw error;
}

export async function toggleAracDurum(id: string, durum: "aktif" | "pasif" | "trafikten_cekildi") {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("araclar")
    .update({ durum, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// --- Araç Poliçe CRUD ---

export async function getAracPoliceler(aracId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_police")
    .select("*")
    .eq("arac_id", aracId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTumPoliceler() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_police")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertAracPolice(police: {
  arac_id: string;
  police_tipi: "kasko" | "trafik";
  tutar: number | null;
  sigorta_firmasi: string | null;
  acente: string | null;
  islem_tarihi: string | null;
  baslangic_tarihi: string | null;
  bitis_tarihi: string | null;
  police_no: string | null;
  police_url: string | null;
  created_by: string | null;
}) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_police")
    .insert(police)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAracPolice(id: string, updates: Partial<{
  police_tipi: "kasko" | "trafik";
  tutar: number | null;
  sigorta_firmasi: string | null;
  acente: string | null;
  islem_tarihi: string | null;
  baslangic_tarihi: string | null;
  bitis_tarihi: string | null;
  police_no: string | null;
  police_url: string | null;
}>) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_police")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAracPolice(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("arac_police").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadPolice(file: File, policeId: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "pdf";
  const filePath = `police/${policeId}/police.${ext}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "araclar");
  formData.append("path", filePath);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");
  return data.url;
}

export async function uploadRuhsat(file: File, aracId: string) {
  const ext = file.name.split(".").pop();
  const filePath = `${aracId}/ruhsat.${ext}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "araclar");
  formData.append("path", filePath);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");

  return data.url;
}

// --- Teklif Gönderim Kayıtları ---

export async function getTeklifGonderimler() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("teklif_gonderim")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertTeklifGonderim(gonderim: {
  arac_id: string;
  police_tipi: "kasko" | "trafik";
  acente_adlari: string;
  acente_emailleri: string;
}) {
  const supabase = getSupabase();
  const { error } = await supabase.from("teklif_gonderim").insert(gonderim);
  if (error) throw error;
}
