// Firma CRUD sorguları - Supabase üzerinden firma işlemleri
import { createClient } from "@/lib/supabase/client";
import type { FirmaInsert, FirmaUpdate } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getFirmalar() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("firmalar")
    .select("*")
    .order("sira_no", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getFirmaById(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("firmalar")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createFirma(firma: FirmaInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("firmalar")
    .insert(firma)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateFirma(id: string, firma: FirmaUpdate) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("firmalar")
    .update({ ...firma, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteFirma(id: string) {
  const supabase = getSupabase();

  // İlişkili veri kontrolü — herhangi bir tabloda bu firmaya referans varsa silme
  const kontroller: { tablo: string; alan: string; label: string }[] = [
    { tablo: "araclar", alan: "firma_id", label: "araç" },
    { tablo: "santiyeler", alan: "firma_id", label: "şantiye" },
    { tablo: "santiye_ortaklari", alan: "firma_id", label: "şantiye ortaklığı" },
    { tablo: "gelen_evrak", alan: "firma_id", label: "gelen evrak" },
    { tablo: "giden_evrak", alan: "firma_id", label: "giden evrak" },
    { tablo: "banka_yazismalari", alan: "firma_id", label: "banka yazışması" },
  ];

  for (const k of kontroller) {
    const { count, error: cErr } = await supabase
      .from(k.tablo)
      .select("id", { count: "exact", head: true })
      .eq(k.alan, id);
    if (cErr) continue;
    if (count && count > 0) {
      throw new Error(
        `Bu firmaya ait ${count} adet ${k.label} kaydı bulunuyor. Firma silinemez.`
      );
    }
  }

  // Kiralık araç kontrolü — firma adıyla eşleştir
  const { data: firmaData } = await supabase.from("firmalar").select("firma_adi").eq("id", id).single();
  if (firmaData?.firma_adi) {
    const { count: kiraCount } = await supabase
      .from("araclar")
      .select("id", { count: "exact", head: true })
      .eq("kiralama_firmasi", firmaData.firma_adi);
    if (kiraCount && kiraCount > 0) {
      throw new Error(`Bu firmaya ait ${kiraCount} adet kiralık araç kaydı bulunuyor. Firma silinemez.`);
    }
  }

  const { error } = await supabase.from("firmalar").delete().eq("id", id);
  if (error) throw error;
}

export async function updateFirmaSiraNo(id: string, siraNo: number) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("firmalar")
    .update({ sira_no: siraNo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function toggleFirmaDurum(id: string, durum: "aktif" | "pasif") {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("firmalar")
    .update({ durum, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function uploadFirmaFile(
  file: File,
  firmaId: string,
  type: "kase" | "antet"
) {
  const ext = file.name.split(".").pop();
  const filePath = `${firmaId}/${type}.${ext}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "firmalar");
  formData.append("path", filePath);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");

  return data.url;
}
