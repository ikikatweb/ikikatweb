// İcra takibi sorguları — elle girilen icra dosyaları (paylaşımlı).
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit } from "@/lib/supabase/types";

function sb() { return createClient(); }

export async function getIcraKayitlar(): Promise<IcraKayit[]> {
  const { data, error } = await sb()
    .from("icra").select("*")
    .order("sira", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IcraKayit[];
}

export async function insertIcraKayit(row: Partial<IcraKayit>): Promise<IcraKayit> {
  const { data, error } = await sb().from("icra").insert(row).select().single();
  if (error) throw error;
  return data as IcraKayit;
}

export async function updateIcraKayit(id: string, patch: Partial<IcraKayit>): Promise<void> {
  const { error } = await sb().from("icra")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteIcraKayit(id: string): Promise<void> {
  const { error } = await sb().from("icra").delete().eq("id", id);
  if (error) throw error;
}

// BORÇLUNUN BAĞLAMI — dashboard widget'ında satırın solundaki renk şeridi ve şantiye adı için.
//
// icra tablosunda şantiye/firma alanı yok; borçlu kendi personelimizse TC üzerinden bağlanır
// (TC yoksa ad-soyad ile). Oradan AKTİF ataması → şantiye → yüklenici firma → firma rengi.
// Yalnız ekranda görünen borçlular için sorgulanır (genelde 1-5 satır), tüm tabloları çekmez.
export type IcraBorcluBaglam = {
  santiyeAd: string | null;
  firmaKisa: string | null;
  firmaRenk: string | null;
};

const tcNorm = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
const adNorm = (v: string | null | undefined) => String(v ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();

/** Anahtar: TC (11 hane) varsa "tc:<tc>", yoksa "ad:<AD SOYAD>". */
export function icraBorcluAnahtar(tc: string | null | undefined, ad: string | null | undefined): string {
  const t = tcNorm(tc);
  return t.length === 11 ? `tc:${t}` : `ad:${adNorm(ad)}`;
}

export async function getIcraBorcluBaglamlari(
  borclular: { tc: string | null; ad: string | null }[],
): Promise<Map<string, IcraBorcluBaglam>> {
  const sonuc = new Map<string, IcraBorcluBaglam>();
  if (borclular.length === 0) return sonuc;
  try {
    const tcler = [...new Set(borclular.map((b) => tcNorm(b.tc)).filter((t) => t.length === 11))];
    const adlar = [...new Set(borclular.map((b) => adNorm(b.ad)).filter(Boolean))];

    // 1) Personel: TC ya da ad ile. İkisi de boşsa sorgu yok.
    const kosullar: string[] = [];
    if (tcler.length) kosullar.push(`tc_kimlik_no.in.(${tcler.join(",")})`);
    if (adlar.length) kosullar.push(`ad_soyad.in.(${adlar.map((a) => `"${a.replace(/"/g, "")}"`).join(",")})`);
    if (kosullar.length === 0) return sonuc;
    const { data: pers } = await sb().from("personel").select("id, ad_soyad, tc_kimlik_no").or(kosullar.join(","));
    const personeller = (pers ?? []) as { id: string; ad_soyad: string | null; tc_kimlik_no: string | null }[];
    if (personeller.length === 0) return sonuc;

    // 2) AKTİF atama (çıkışı girilmemiş). Birden fazlaysa en son başlayan alınır.
    const { data: at } = await sb()
      .from("personel_atama_gecmisi")
      .select("personel_id, santiye_id, baslangic_tarihi, bitis_tarihi")
      .in("personel_id", personeller.map((p) => p.id))
      .is("bitis_tarihi", null);
    const atamalar = (at ?? []) as { personel_id: string; santiye_id: string; baslangic_tarihi: string }[];
    const sonAtama = new Map<string, string>();   // personel_id → santiye_id
    for (const a of [...atamalar].sort((x, y) => x.baslangic_tarihi.localeCompare(y.baslangic_tarihi))) {
      sonAtama.set(a.personel_id, a.santiye_id);  // sona kalan = en geç başlayan
    }
    if (sonAtama.size === 0) return sonuc;

    // 3) Şantiye + firma
    const { data: sant } = await sb()
      .from("santiyeler").select("id, is_adi, yuklenici_firma_id").in("id", [...new Set(sonAtama.values())]);
    const santiyeler = (sant ?? []) as { id: string; is_adi: string; yuklenici_firma_id: string | null }[];
    const firmaIdler = [...new Set(santiyeler.map((s) => s.yuklenici_firma_id).filter(Boolean))] as string[];
    const { data: fir } = firmaIdler.length
      ? await sb().from("firmalar").select("id, kisa_adi, firma_adi, renk").in("id", firmaIdler)
      : { data: [] };
    const F = new Map(((fir ?? []) as { id: string; kisa_adi: string | null; firma_adi: string | null; renk: string | null }[])
      .map((f) => [f.id, f]));
    const S = new Map(santiyeler.map((s) => [s.id, s]));

    for (const p of personeller) {
      const sId = sonAtama.get(p.id);
      if (!sId) continue;
      const s = S.get(sId);
      const f = s?.yuklenici_firma_id ? F.get(s.yuklenici_firma_id) : null;
      const baglam: IcraBorcluBaglam = {
        santiyeAd: s?.is_adi ?? null,
        firmaKisa: f?.kisa_adi ?? f?.firma_adi ?? null,
        firmaRenk: f?.renk ?? null,
      };
      // Hem TC hem ad anahtarına yaz — icra kaydında hangisi doluysa oradan bulunsun.
      const t = tcNorm(p.tc_kimlik_no);
      if (t.length === 11) sonuc.set(`tc:${t}`, baglam);
      const a = adNorm(p.ad_soyad);
      if (a) sonuc.set(`ad:${a}`, baglam);
    }
    return sonuc;
  } catch {
    return sonuc;   // bağlam bulunamazsa widget renksiz çalışmaya devam eder
  }
}
