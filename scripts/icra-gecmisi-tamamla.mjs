// GEÇMİŞİ TAMAMLA — paketi daha önce inmiş icra tebligatlarının belgelerini okur ve
// defterleri doldurur.
//
// NİYE GEREKLİ: belge okuyucu 09.11.2026'da eklendi. Ondan önce açılmış tebligatların
// belgeleri kutuda duruyor ama hiçbir deftere işlenmemişti — kutuda dört ödeme emri
// çıktı, dördü de hiç açılmamıştı ve biri 252.199,22 TL idi. Bundan sonra gelenler
// uets-ac-isle.mjs içinde kendiliğinden işleniyor; bu betik yalnız geçmişi kapatıyor.
//
// UETS'E DOKUNMAZ. Yalnız Storage'daki inmiş paketleri okur; kota harcamaz, hiçbir
// tebligatı AÇMAZ. Bildirim de göndermez — toplu çalıştırmada onlarca bildirim
// yağdırmak yerine sonuç burada, ekrana yazılır.
//
// Çalıştırma:
//   node scripts/icra-gecmisi-tamamla.mjs           → işle
//   node scripts/icra-gecmisi-tamamla.mjs --kuru    → ne bulduğunu söyle, yazma
//
// NOT: --kuru yalnız BU betiğin raporunu sınırlar; icraDefteriniDoldur çağrılmaz.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { icraDefteriniDoldur } from "./uets-ac-isle.mjs";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const KURU = process.argv.includes("--kuru");

// TÜRKÇE "İ" TUZAĞI: /icra dairesi/i kalıbı "İcra Dairesi" metnini BULMAZ ("İ"
// küçültülünce noktalı "i̇" oluyor). Türkçe locale ile küçültülüp aranıyor.
const icraYazisiMi = (konu) => String(konu ?? "").toLocaleLowerCase("tr").includes("icra dairesi");

async function main() {
  const { data, error } = await sb.from("tebligat")
    .select("id, hesap, uets_id, konu, gonderen_ad, firma_id, paket_yolu, ekler, ulasma_tarihi")
    .not("paket_yolu", "is", null)
    .order("ulasma_tarihi", { ascending: false });
  if (error) throw new Error(`tebligatlar okunamadı: ${error.message}`);

  const icralar = (data ?? []).filter((t) => icraYazisiMi(t.konu) && (t.ekler ?? []).length > 0);
  console.log(`İnmiş paketi olan icra tebligatı: ${icralar.length}`);
  if (KURU) {
    for (const t of icralar) console.log(`  · #${t.id} ${t.konu}`);
    console.log("--kuru: belge okunmadı, defterlere yazılmadı.");
    return;
  }

  const notlar = [];
  const hatalar = [];
  for (const t of icralar) {
    console.log(`\n▶ ${t.konu}`);
    try {
      const not = await icraDefteriniDoldur(t, t.ekler ?? []);
      if (not) notlar.push(`${t.konu}\n   ${not}`);
    } catch (e) {
      // SESSİZ GEÇİLMEZ: okunamayan belge defteri eksik bırakır, bu duyulmalı.
      const m = e?.message ?? String(e);
      console.log(`  HATA: ${m}`);
      hatalar.push(`${t.konu}: ${m}`);
    }
  }

  console.log("\n══════ ÖZET ══════");
  if (notlar.length) {
    console.log(`Dikkat isteyen ${notlar.length} belge:`);
    for (const n of notlar) console.log(` · ${n}`);
  } else {
    console.log("Dikkat isteyen belge çıkmadı.");
  }
  if (hatalar.length) {
    console.log(`\n${hatalar.length} belge OKUNAMADI — defterler bu kadarıyla eksik:`);
    for (const h of hatalar) console.log(` · ${h}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("HATA:", e?.message ?? e); process.exitCode = 1; });
