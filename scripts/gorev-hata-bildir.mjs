// ZAMANLANMIŞ GÖREV ÇÖKTÜĞÜNDE HABER VER.
//
// 05.11.2026: 60 ADR 790'ın trafik poliçesi maille geldi ama sisteme girmedi. Sebep
// sigorta okuyucusunun kendisi değildi — node_modules'den pdfjs'in isteğe bağlı eşi
// (@napi-rs/canvas) düşmüştü ve script HER çalışmada ilk satırda ölüyordu. Görev
// Zamanlayıcı yine "0 = başarılı" diyordu (.bat'in çıkış kodu node'un değil), .bat hiçbir
// yere log yazmıyordu. Yani script 5 saat boyunca ölü durdu ve bunu gören olmadı.
//
// Bu dosya o boşluğu kapatır: .bat node'u çağırır, çıkış kodu sıfır değilse BURAYA düşer
// ve yöneticilere telefon bildirimi gider. "Sessiz hata yok" kuralının görev tarafı.
//
// Kullanım (.bat içinden):
//   node scripts\gorev-hata-bildir.mjs "Sigorta Teklif Mail" %KOD% "logs\sigorta-teklif-mail.log"
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { pushGonder } from "./push-gonder.mjs";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [gorev = "(bilinmeyen görev)", kodHam = "?", logYol = ""] = process.argv.slice(2);

// Aynı arıza dakikalarca sürer; görevler 2 dakikada bir dönüyor. Her çalışmada bildirim
// göndermek telefonu günde 700 kez titretir → aynı görev için en çok 6 saatte bir.
const ARALIK_SAAT = 6;

const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const slug = gorev.toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gorev";
const isaretDosya = path.join(kok, "logs", `.hata-bildirim-${slug}`);

/** Log'un sonundan hata satırını çıkar — bildirimde sebep görünsün. */
function sebepBul() {
  if (!logYol) return "";
  try {
    const tam = path.isAbsolute(logYol) ? logYol : path.join(kok, logYol);
    const metin = fs.readFileSync(tam, "utf8").slice(-4000);
    const satirlar = metin.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const hata = [...satirlar].reverse().find((s) => /error|hata|cannot|exception|fail/i.test(s));
    return (hata ?? satirlar[satirlar.length - 1] ?? "").slice(0, 180);
  } catch { return ""; }
}

async function main() {
  fs.mkdirSync(path.join(kok, "logs"), { recursive: true });
  const sebep = sebepBul();
  // Bildirim kısılsa bile arıza KAYDA geçsin: log dosyası kalıcı iz.
  const satir = `${new Date().toLocaleString("tr-TR")} · ${gorev} çıkış kodu ${kodHam}${sebep ? " · " + sebep : ""}\n`;
  fs.appendFileSync(path.join(kok, "logs", "gorev-hatalari.log"), satir, "utf8");
  process.stdout.write(satir);

  let sonBildirim = 0;
  try { sonBildirim = Date.parse(fs.readFileSync(isaretDosya, "utf8").trim()) || 0; } catch { /* ilk hata */ }
  if (Date.now() - sonBildirim < ARALIK_SAAT * 3600000) {
    console.log(`  bildirim kısıldı — bu görev için son ${ARALIK_SAAT} saat içinde zaten gönderildi`);
    return;
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("  Supabase yapılandırması yok — bildirim gönderilemedi"); return; }
  const sb = createClient(url, key);
  const n = await pushGonder(sb, env, {
    baslik: `⚠ ${gorev} çalışmıyor`,
    govde: sebep || `Görev ${kodHam} çıkış koduyla durdu. Sunucu makinesinde log'a bakılmalı.`,
    url: "/dashboard",
    etiket: `gorev-hata-${slug}`,
  });
  console.log(`  bildirim → ${n} cihaz`);
  if (n > 0) fs.writeFileSync(isaretDosya, new Date().toISOString(), "utf8");
}

// Bildirici de çökerse sessiz kalmasın; ama çökmesi görevin çıkış kodunu değiştirmesin.
main().catch((e) => { console.error("bildirici hatası:", e?.message ?? e); });
