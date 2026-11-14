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

// toLowerCase — toLocaleLowerCase("tr") DEĞİL: Türkçe kuralda "I" → "ı" olur, "KETSIS Mail
// Cek" slug'ı "kets-s-ma-l-cek" çıkıyordu ve aşağıdaki insanca ad hiç bulunmuyordu.
const slug = gorev.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gorev";
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


/**
 * GÖREVİN İNSANCA ADI — bildirimde "UETS Tebligat Cek" değil "E-tebligat çekme"
 * yazsın. Telefonda beliren uyarıyı okuyan kişi görev zamanlayıcıdaki teknik adı
 * değil, işin kendisini tanıyor.
 */
const GOREV_ADLARI = {
  "uets-tebligat-cek": "E-tebligat çekme",
  "uets-acma-istekleri": "E-tebligat açma",
  "uets-anahtar-dene": "UETS anahtar denemesi",
  "personel-bildirge-sync": "SGK bildirge takibi",
  "ketsis-mail-cek": "KETSİS bildirim okuma",
  "sigorta-teklif-mail": "Sigorta teklif okuma",
  "arvento-mail-sync": "Arvento rapor maili",
  "icra-muhasebe-cevap": "Muhasebe cevabı tarama",
};

/**
 * SEBEBİ SINIFLA — ham hata satırı telefonda okunmuyordu:
 *   "HATA: 2 firma çekilemedi · IKI: UETS 503: Sistem bakımı yapılmaktadır.
 *    Lütfen daha sonra tekrar deneyiz. (kod 999) · https://api.etebligat.gov.tr/…"
 * Okuyan kişinin iki şeyi bilmesi yeter: NE OLDU ve BİR ŞEY YAPMALI MI.
 *
 * Dönen `gecici: true` ise arıza karşı taraftan ve kendiliğinden düzelir;
 * uyarının başlığı da ona göre yumuşuyor — her bildirim "alarm" olursa
 * gerçekten ilgilenilmesi gereken uyarı da aynı torbada kaybolur.
 */
function sebepSinifla(ham) {
  const t = (ham || "").toLocaleLowerCase("tr");
  // MAİL SUNUCUSU KAPIYI AÇMIYOR. 14.11.2026'da bildirim "Can not re-use ImapFlow
  // instance · Sunucu makinesinde log'a bakılmalı" diye gitti; okuyan hiçbir şey
  // anlamadı. Oysa söylenecek şey basit: hangi kutu okunamıyor ve kime sorulacak.
  // 503 kalıbından ÖNCE durmalı — hata satırındaki IP/port rakamları ona takılmasın.
  if (/econnrefused|re-use imapflow/.test(t)) {
    const kutu = (ham.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0];
    return {
      gecici: false,
      nedir: `${kutu ? kutu + " kutusu" : "Posta kutusu"} okunamıyor: mail sunucusu bağlantıyı kabul etmiyor`,
      islem: "Bu kutuya gelen mailler şu an siteye alınmıyor (kaybolmaz, düzelince okunur). Mail Outlook'ta da açılmıyorsa hosting firması aranmalı.",
    };
  }
  if (/503|bak[ıi]m|maintenance|kod 999/.test(t)) {
    return { gecici: true, nedir: "Karşı sistem (PTT) bakımda", islem: "Bakım bitince kendiliğinden düzelir, yapılacak bir şey yok." };
  }
  if (/401|403|unauthorized|forbidden|yetkisiz|ge[çc]ersiz anahtar|invalid.*(token|key)/.test(t)) {
    return { gecici: false, nedir: "Yetki/anahtar geçersiz", islem: "İLGİLENİLMELİ: anahtar ya da şifre yenilenmeli." };
  }
  if (/econnreset|etimedout|enotfound|getaddrinfo|socket|upstream connect|connection failure|disconnect|timeout|zaman a[şs][ıi]m/.test(t)) {
    return { gecici: true, nedir: "Bağlantı koptu", islem: "Bir sonraki turda yeniden denenecek." };
  }
  if (/uv_handle_closing|assertion failed/.test(t)) {
    return { gecici: true, nedir: "Program kapanırken çöktü", islem: "İş yapılmış olabilir; tekrarlarsa bakılmalı." };
  }
  if (/<\/?(div|html|body)|error-footer|<!doctype/.test(t)) {
    return { gecici: true, nedir: "Sunucudan hata sayfası döndü", islem: "Karşı taraf geçici olarak cevap veremiyor." };
  }
  if (/cannot find module|module not found|is not a function|undefined/.test(t)) {
    return { gecici: false, nedir: "Programda hata", islem: "İLGİLENİLMELİ: görev her turda ölüyor olabilir." };
  }
  return { gecici: false, nedir: "", islem: "Sunucu makinesinde log'a bakılmalı." };
}

/** Ham satırı okunur hâle getir: adres, etiket ve tekrarlayan önekler atılır. */
function sebepSadelestir(ham) {
  return (ham || "")
    .replace(/https?:\/\/\S+/g, "")              // adresler telefonda yer kaplıyor
    .replace(/<[^>]*>/g, " ")                    // html parçaları
    .replace(/^\s*(hata|error)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
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
  // ── BİLDİRİM METNİ ──
  // Başlık: ne yapamadı. Gövde: NEDEN ve BİR ŞEY YAPMALI MI + saat.
  // Ham hata satırı telefonda okunmuyordu; sebep sınıflanıyor, adresler atılıyor.
  // Ayrıntı log'da duruyor (gorev-hatalari.log) — bildirim özet, log kayıt.
  const ad = GOREV_ADLARI[slug] ?? gorev;
  const { gecici, nedir, islem } = sebepSinifla(sebep);
  const sade = sebepSadelestir(sebep);
  const saat = new Date().toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const n = await pushGonder(sb, env, {
    // GEÇİCİ ARIZA ALARM DEĞİL: her bildirim "⚠" olursa gerçekten ilgilenilmesi
    // gereken uyarı da aynı torbada kaybolur.
    baslik: gecici ? `⏳ ${ad} şu an yapılamıyor` : `⚠ ${ad} durdu`,
    govde: [nedir || sade, islem, saat].filter(Boolean).join(" · "),
    url: "/dashboard",
    etiket: `gorev-hata-${slug}`,
  });
  console.log(`  bildirim → ${n} cihaz`);
  if (n > 0) fs.writeFileSync(isaretDosya, new Date().toISOString(), "utf8");
}

// Bildirici de çökerse sessiz kalmasın; ama çökmesi görevin çıkış kodunu değiştirmesin.
main().catch((e) => { console.error("bildirici hatası:", e?.message ?? e); });
