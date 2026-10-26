// ŞİFRE YENİLEME / E-POSTA DOĞRULAMA JETONLARI
//
// Jetonun kendisi yalnız maildeki bağlantıda bulunur; veritabanında SHA-256 ÖZETİ durur.
// Veritabanı sızsa bile özetten çalışan bir bağlantı üretilemez.
//
// Kurallar:
//  • 32 bayt rastgele (crypto.randomBytes) — tahmin edilemez.
//  • Tek kullanımlık: kullanıldığında işaretlenir.
//  • Süreli: şifre sıfırlama 60 dk, e-posta doğrulama 24 saat.
//  • Yeni jeton üretilince kişinin aynı tipteki ESKİ jetonları iptal edilir — eski maildeki
//    bağlantı, yenisi istendikten sonra çalışmaya devam etmemeli.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TokenTip = "sifre_sifirlama" | "eposta_dogrulama";

export const SURE_DK: Record<TokenTip, number> = {
  sifre_sifirlama: 60,
  eposta_dogrulama: 24 * 60,
};

export function tokenUret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function tokenOzet(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Jeton kaydı oluşturur, aynı tipteki eski jetonları iptal eder. Düz jetonu döndürür. */
export async function tokenOlustur(
  sb: SupabaseClient,
  kullaniciId: string,
  tip: TokenTip,
  eposta: string,
): Promise<string> {
  await sb.from("kullanici_token")
    .update({ kullanildi_mi: true })
    .eq("kullanici_id", kullaniciId).eq("tip", tip).eq("kullanildi_mi", false);

  const token = tokenUret();
  const sonKullanma = new Date(Date.now() + SURE_DK[tip] * 60000).toISOString();
  const { error } = await sb.from("kullanici_token").insert({
    kullanici_id: kullaniciId, tip, token_ozet: tokenOzet(token), eposta, son_kullanma: sonKullanma,
  });
  if (error) throw new Error(error.message);
  return token;
}

export type TokenKaydi = {
  id: string;
  kullanici_id: string;
  tip: TokenTip;
  eposta: string;
  son_kullanma: string;
  kullanildi_mi: boolean;
};

/**
 * Jetonu doğrular. Geçersiz/süresi geçmiş/kullanılmışsa null.
 * Hata ayrıntısı DÖNDÜRÜLMEZ — "süresi geçmiş" ile "yok" ayrımı saldırgana bilgi verir.
 */
export async function tokenCoz(sb: SupabaseClient, token: string): Promise<TokenKaydi | null> {
  const t = String(token ?? "").trim();
  if (t.length < 20) return null;
  const { data } = await sb.from("kullanici_token")
    .select("id, kullanici_id, tip, eposta, son_kullanma, kullanildi_mi")
    .eq("token_ozet", tokenOzet(t))
    .maybeSingle();
  const k = data as TokenKaydi | null;
  if (!k || k.kullanildi_mi) return null;
  if (new Date(k.son_kullanma).getTime() < Date.now()) return null;
  return k;
}

export async function tokenKullanildi(sb: SupabaseClient, id: string): Promise<void> {
  await sb.from("kullanici_token").update({ kullanildi_mi: true }).eq("id", id);
}

/** Son 1 saatte aynı kullanıcı için kaç istek yapılmış? (kötüye kullanım freni) */
export async function sonSaattekiIstek(sb: SupabaseClient, kullaniciId: string, tip: TokenTip): Promise<number> {
  const birSaatOnce = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("kullanici_token")
    .select("id", { count: "exact", head: true })
    .eq("kullanici_id", kullaniciId).eq("tip", tip).gte("olusturma", birSaatOnce);
  return count ?? 0;
}
