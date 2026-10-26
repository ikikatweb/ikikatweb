// SMTP GÖNDERİCİ — firmalar tablosundaki hesaplardan mail atar.
//
// Mevcut mail rotaları (bordro, teklif, kabul) transporter'ı kendi içlerinde kuruyor;
// sistem maili (şifre yenileme, adres doğrulama) belirli bir firmaya değil KULLANICIYA
// gittiği için gönderen hesap kullanıcı kararıyla sabitlendi: muhasebe@kadtem.com.tr.

import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Sistem maillerinin gideceği hesap (kullanıcı kararı, 26.10.2026). */
export const SISTEM_SMTP_KULLANICI = "muhasebe@kadtem.com.tr";

type SmtpSatiri = {
  smtp_host: string | null; smtp_port: number | null;
  smtp_user: string | null; smtp_password: string | null;
  smtp_sender_email: string | null; firma_adi: string | null;
};

/**
 * Verilen SMTP kullanıcısına ait firmadan taşıyıcı kurar.
 * Aynı hesap birden çok firmada tanımlı olabilir (KAT/KAD) — ilki yeterli.
 */
export async function sistemTasiyici(sb: SupabaseClient, smtpKullanici = SISTEM_SMTP_KULLANICI) {
  const { data } = await sb
    .from("firmalar")
    .select("smtp_host, smtp_port, smtp_user, smtp_password, smtp_sender_email, firma_adi")
    .eq("smtp_user", smtpKullanici)
    .not("smtp_password", "is", null)
    .limit(1)
    .maybeSingle();
  const f = data as SmtpSatiri | null;
  if (!f?.smtp_host || !f.smtp_user || !f.smtp_password) {
    throw new Error(`SMTP ayarı bulunamadı: ${smtpKullanici}`);
  }
  const port = Number(f.smtp_port) || 587;
  const tasiyici = nodemailer.createTransport({
    host: f.smtp_host,
    port,
    secure: port === 465,
    auth: { user: f.smtp_user, pass: f.smtp_password },
    tls: { rejectUnauthorized: false },   // paylaşımlı hosting sertifikası alan adıyla eşleşmiyor
  });
  return { tasiyici, gonderen: f.smtp_sender_email || f.smtp_user };
}

/** Basit HTML gövde — kurumsal görünüm, tek düğme. */
export function mailGovde(baslik: string, metin: string, dugmeMetni: string, dugmeUrl: string, alt: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1E3A5F">
  <h2 style="color:#1E3A5F;font-size:18px;margin:0 0 12px">${baslik}</h2>
  <p style="font-size:14px;line-height:1.6;color:#334155">${metin}</p>
  <p style="margin:24px 0">
    <a href="${dugmeUrl}" style="background:#F97316;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block">${dugmeMetni}</a>
  </p>
  <p style="font-size:12px;color:#64748b;line-height:1.5">${alt}</p>
  <p style="font-size:11px;color:#94a3b8;margin-top:18px">Bağlantı çalışmazsa tarayıcınıza yapıştırın:<br>${dugmeUrl}</p>
</div>`;
}
