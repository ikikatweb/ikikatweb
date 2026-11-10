// HATAYI OKUNUR METNE ÇEVİR — "[object Object]" yazmasın.
//
// NİYE: `e instanceof Error ? e.message : String(e)` kalıbı yaygın ama Supabase
// hatalarında çalışmıyor: PostgrestError düz bir NESNE ({ message, details, hint,
// code }), Error'dan türemiyor. String(e) ona "[object Object]" diyor ve ekranda
// kullanıcıya bu çıkıyor — hatanın tek ipucu olan mesaj kayboluyor.
// 10.11.2026'da ana sayfadaki "Vergi dairesi tebligat durumu okunamadı ([object
// Object])" uyarısında yaşandı: sebep hiç öğrenilemedi.
//
// Burada nesnenin message/details/hint/code alanları sırayla denenir; hiçbiri
// yoksa JSON'a çevrilir. Amaç her zaman AYNI: ekrana bakan insan "ne olmuş"
// sorusuna cevap bulsun.

/** Herhangi bir yakalanmış değerden okunabilir bir mesaj çıkar. */
export function hataMetni(e: unknown): string {
  if (e == null) return "bilinmeyen hata";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || e.name || "bilinmeyen hata";

  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parcalar: string[] = [];
    for (const alan of ["message", "details", "hint"]) {
      const v = o[alan];
      if (typeof v === "string" && v.trim()) parcalar.push(v.trim());
    }
    const kod = typeof o.code === "string" && o.code.trim() ? ` [${o.code.trim()}]` : "";
    if (parcalar.length > 0) return parcalar.join(" · ") + kod;
    try {
      const j = JSON.stringify(e);
      if (j && j !== "{}") return j.slice(0, 300);
    } catch { /* döngüsel nesne */ }
  }
  return String(e);
}
