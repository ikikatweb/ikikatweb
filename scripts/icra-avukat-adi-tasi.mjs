// AVUKAT ADI YANLIŞ SÜTUNDA — ADI KENDİ SÜTUNUNA TAŞIR.
//
// NİYE: avukat listesi kurulmadan önce işlenen dosyalarda avukatın adı
// "evrak no" alanına yazılmış. Tabloda Evrak No sütununda insan adı görünüyor;
// üstelik avukat kipinde evrak no diye bir alan yok (cevap, mailin kendisidir).
//
// NE YAPAR: cevap şekli avukat olan, evrak_no'su dolu ve avukat_adi'si boş
// kayıtlarda  evrak_no -> avukat_adi  taşır, evrak_no'yu boşaltır.
//
// NE YAPMAZ: avukat_id BAĞLAMAZ. O alan "panelden mail gönderildi" demektir;
// bu dosyalarda gönderim kaydı (avukat_mail_at) yok, uydurulmaz.
//
// Kuru çalıştırma:  node scripts/icra-avukat-adi-tasi.mjs --kuru
import fs from "node:fs";

const kuru = process.argv.includes("--kuru");
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const u = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !key) { console.error("HATA: .env.local okunamadı (SUPABASE adresleri yok)."); process.exit(1); }
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

const liste = await (await fetch(
  `${u}/rest/v1/icra?select=id,dosya_esas_no,cevap_sekli,evrak_no,avukat_adi,avukat_id,avukat_mail_at`
  + `&cevap_sekli=ilike.*vukat*&evrak_no=not.is.null&avukat_adi=is.null`, { headers: h })).json();

if (!Array.isArray(liste)) { console.error("HATA:", JSON.stringify(liste)); process.exit(1); }
if (liste.length === 0) { console.log("Taşınacak kayıt yok."); process.exit(0); }

console.log(`${liste.length} kayıt bulundu${kuru ? " (KURU ÇALIŞTIRMA — yazılmayacak)" : ""}:`);
for (const k of liste) {
  const ad = (k.evrak_no ?? "").trim();
  if (!ad) { console.log(` · ${k.dosya_esas_no}: evrak no boş, atlandı`); continue; }
  if (kuru) { console.log(` · ${k.dosya_esas_no}: "${ad}" -> avukat_adi, evrak_no boşalacak`); continue; }
  const r = await fetch(`${u}/rest/v1/icra?id=eq.${k.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ avukat_adi: ad, evrak_no: null }),
  });
  const c = await r.json();
  if (!r.ok) { console.error(` · ${k.dosya_esas_no}: HATA ${r.status} ${JSON.stringify(c)}`); continue; }
  console.log(` · ${k.dosya_esas_no}: avukat_adi="${c[0].avukat_adi}", evrak_no=${c[0].evrak_no}`);
}
