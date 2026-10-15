// Araç göstergesi KALİBRASYONU — gerçek okumalardan Arvento farkını hesaplar.
//
// Arvento cihazın kendi saydığı değeri verir; aracın gösterge sayacını bilmez.
// Bu yüzden araç başına sabit bir fark tutulur:  gerçek = Arvento + fark
//
// Kullanım: araçlar STOP hâldeyken gösterge değerlerini okuyun (o sırada Arvento da
// ilerlemediği için fark birebir tutar), bir metin dosyasına yazın ve bu script'i
// çalıştırın. Her satırda önce plaka, sonra değer gelir; aradaki "=" ya da "-" şart değil,
// sondaki birim (km/sa/saat) yazılabilir. Boş satır ve # ile başlayan satır yok sayılır.
// Ondalık/binlik ayraçları serbest (452.146 · 452146 · 452.146,0 hepsi olur).
//
//   60 ACE 788 = 452146
//   60 bp 842 177700 km
//   60-00-10-0011 - 21055 sa     # ekskavatör: motor saati
//   34-00-15-13879 15192,6 sa
//
// Çalıştırma:
//   npx tsx scripts/arvento-gosterge-kalibre.ts okumalar.txt          → ne yapılacağını göster
//   npx tsx scripts/arvento-gosterge-kalibre.ts okumalar.txt --uygula → farkları kaydet
//
// --uygula verilmeden HİÇBİR ŞEY yazılmaz.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { kontakSaati, katsayiHesapla, eskiModeldenOncekiOkuma } from "@/lib/arvento/makine-saat";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");
for (const dosya of [".env.local", ".env"]) {
  const p = path.join(kok, dosya);
  if (!fs.existsSync(p)) continue;
  for (const satir of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const i = satir.indexOf("=");
    if (i < 0 || satir.trim().startsWith("#")) continue;
    const k = satir.slice(0, i).trim();
    const v = satir.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("tr-TR"));

// "452.146,5" / "452146" / "452 146" → 452146.5
function sayiCoz(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  // Son ayraç ondalıksa onu koru, binlik ayraçlarını at
  const sonVirgul = t.lastIndexOf(",");
  const sonNokta = t.lastIndexOf(".");
  let temiz = t;
  if (sonVirgul > sonNokta) temiz = t.replace(/\./g, "").replace(",", ".");
  else if (sonNokta > -1 && t.length - sonNokta - 1 !== 3) temiz = t.replace(/,/g, "");
  else temiz = t.replace(/[.,]/g, "");
  const v = parseFloat(temiz);
  return Number.isFinite(v) ? v : null;
}

// Plakaları karşılaştırırken boşluk/tire farkları sorun olmasın
const plakaAnahtar = (s: string) => s.toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9]/g, "");

async function main() {
  const dosya = process.argv[2];
  const uygula = process.argv.includes("--uygula");
  if (!dosya || !fs.existsSync(dosya)) {
    console.error("Kullanım: npx tsx scripts/arvento-gosterge-kalibre.ts <okumalar.txt> [--uygula]");
    process.exit(1);
  }

  // 1) Okumaları oku
  const okumalar = new Map<string, { plaka: string; deger: number }>();
  const hatali: string[] = [];
  for (const satir of fs.readFileSync(dosya, "utf8").split(/\r?\n/)) {
    let s = satir.split("#")[0].trim();
    if (!s) continue;
    // Sondaki birim yazısı atılır: "177700 km", "21055 sa", "15192,6 saat"
    s = s.replace(/\s*(km|sa|saat|h)\s*$/i, "").trim();
    // Son SAYI değerdir, öncesi plakadır. Böylece hem "60 ACE 788 = 452146" hem de
    // kullanıcının doğal yazımı ("60 bp 842 177700", "60-00-10-0011 - 21055") okunur.
    const parcalar = s.split(/[\s=]+/).filter((x) => x && x !== "-");
    if (parcalar.length < 2) { hatali.push(satir); continue; }
    const deger = sayiCoz(parcalar[parcalar.length - 1]);
    const plaka = parcalar.slice(0, -1).join(" ").trim();
    if (!plaka || deger == null) { hatali.push(satir); continue; }
    okumalar.set(plakaAnahtar(plaka), { plaka, deger });
  }
  if (hatali.length) {
    console.log(`Okunamayan ${hatali.length} satır (yok sayıldı):`);
    for (const h of hatali) console.log("   " + h);
    console.log("");
  }
  if (okumalar.size === 0) { console.error("Geçerli okuma yok."); process.exit(1); }

  // 2) Arvento anlık + node→plaka
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da Supabase anahtarları yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { cekAnlikDurum } = await import("@/lib/arvento/anlik");
  const { araclar: anlik } = await cekAnlikDurum();
  const { data: cihazlar } = await sb.from("arvento_cihaz").select("node, plaka");
  const nodePlaka = new Map(((cihazlar ?? []) as { node: string; plaka: string | null }[])
    .map((c) => [c.node, c.plaka]));

  const arvento = new Map<string, { deger: number; son: string | null }>();
  for (const a of anlik) {
    const p = nodePlaka.get(String(a.node));
    if (p && a.odometre != null) arvento.set(plakaAnahtar(p), { deger: a.odometre, son: a.tarih });
  }

  // 3) Araç kartları
  const { data: kartlar } = await sb.from("araclar").select("id, plaka, marka, model, cinsi, sayac_tipi, guncel_gosterge, arvento_fark, arvento_fark_tarihi, son_okuma_deger, son_okuma_tarihi, saat_katsayi");
  type K = { id: string; plaka: string; marka: string | null; model: string | null; cinsi: string | null; sayac_tipi: string | null; guncel_gosterge: number | null; arvento_fark: number | null; arvento_fark_tarihi: string | null; son_okuma_deger: number | null; son_okuma_tarihi: string | null; saat_katsayi: number | null };
  const kartByPlaka = new Map(((kartlar ?? []) as K[]).map((k) => [plakaAnahtar(k.plaka), k]));

  // 4) Hesapla — KAMYON ve İŞ MAKİNESİ farklı modellerle
  //
  // Kamyon (sayac_tipi='km'):  gerçek = Arvento + sabit fark.  Ölçüldü, sapma 23 günde 12–50 km.
  // İş makinesi (='saat'):     Arvento SAAT VERMİYOR — anlık `odometre` alanı kilometre.
  //   (34-00-15-13879: cihazın tüm ömründe odometre 123,6 iken yalnız son 24 günün günlük
  //    raporlarında 143,5 saat kontak var; saat olsaydı imkânsız.)
  //   Bu yüzden makinede sabit fark anlamsız; model:
  //     gösterge = son okuma + (okumadan beri kontak saati) × katsayı
  type Kamyon = { id: string; plaka: string; okuma: number; arv: number; fark: number;
    eski: number | null; kayitliFark: number | null; kalibreTarih: string | null };
  type Makine = { id: string; plaka: string; okuma: number; oncekiOkuma: number | null;
    oncekiTarih: string | null; kontak: number; gun: number;
    eskiKatsayi: number | null; yeniKatsayi: number | null };
  const kamyonlar: Kamyon[] = [];
  const arventosuz: { id: string; plaka: string; okuma: number; eski: number | null }[] = [];
  const makineler: Makine[] = [];
  const atlanan: string[] = [];

  // Aracı adlandırma biçimi serbest. Üç aşamalı çözüm:
  //   1) plaka birebir
  //   2) plaka sonu  ("5563" → 34-00-24-5563)
  //   3) marka/model/cinsi  ("amman asc 110 silindir" → 34-00-11-6911,
  //                          "140g greyder" → 06-00-10-1096)
  // Her aşamada YALNIZ tek aday kabul edilir; birden fazlaysa yanlış araca yazmamak için atlanır.
  const kartMetni = (k: K) =>
    plakaAnahtar([k.plaka, k.marka, k.model, k.cinsi].filter(Boolean).join(" "));
  function kartBul(anahtar: string, ham: string): { kart: K | undefined; hata?: string } {
    const tam = kartByPlaka.get(anahtar);
    if (tam) return { kart: tam };

    if (anahtar.length >= 3) {
      const sonEk = [...kartByPlaka.entries()].filter(([k]) => k.endsWith(anahtar));
      if (sonEk.length === 1) return { kart: sonEk[0][1] };
      if (sonEk.length > 1) return { kart: undefined, hata: `birden fazla araca uyuyor (${sonEk.map(([, k]) => k.plaka).join(", ")})` };
    }

    // Marka/model: girilen her kelime aracın metninde geçmeli.
    const kelimeler = ham.split(/\s+/).map((x) => plakaAnahtar(x)).filter((x) => x.length >= 2);
    if (kelimeler.length === 0) return { kart: undefined };
    const adaylar = [...kartByPlaka.values()].filter((k) => {
      const metin = kartMetni(k);
      return kelimeler.every((w) => metin.includes(w));
    });
    if (adaylar.length === 1) return { kart: adaylar[0] };
    if (adaylar.length > 1) return { kart: undefined, hata: `birden fazla araca uyuyor (${adaylar.map((k) => k.plaka).join(", ")})` };
    return { kart: undefined };
  }

  for (const [anahtar, o] of okumalar) {
    const bulgu = kartBul(anahtar, o.plaka);
    const kart = bulgu.kart;
    if (!kart) { atlanan.push(`${o.plaka}: ${bulgu.hata ?? "araç kartı bulunamadı"}`); continue; }

    if (kart.sayac_tipi === "saat") {
      const oncekiTarih = kart.son_okuma_tarihi ?? kart.arvento_fark_tarihi;
      let kontak = 0, gun = 0, mesafe = 0;
      if (oncekiTarih) {
        const r = await kontakSaati(sb, kart.plaka, oncekiTarih.slice(0, 10));
        kontak = r.saat; gun = r.gun; mesafe = r.mesafeKm;
      }
      // Önceki okuma: yeni modelde doğrudan saklı. İlk geçişte eski km-tabanlı kayıttan
      // geri hesaplanır — guncel_gosterge KULLANILMAZ, arada elle güncellenmiş olabiliyor.
      const oncekiOkuma = kart.son_okuma_deger
        ?? eskiModeldenOncekiOkuma(kart.arvento_fark, arvento.get(plakaAnahtar(kart.plaka))?.deger ?? null, mesafe);
      makineler.push({
        id: kart.id, plaka: kart.plaka, okuma: o.deger,
        oncekiOkuma, oncekiTarih, kontak, gun,
        eskiKatsayi: kart.saat_katsayi,
        yeniKatsayi: katsayiHesapla(oncekiOkuma, o.deger, kontak),
      });
      continue;
    }

    const arv = arvento.get(plakaAnahtar(kart.plaka));
    if (!arv) {
      // Arvento cihazı olmayan araç: fark hesaplanamaz ama OKUMA yine de kaydedilmeli,
      // yoksa sayaç bilgisi hiç güncellenmiyor.
      arventosuz.push({ id: kart.id, plaka: kart.plaka, okuma: o.deger, eski: kart.guncel_gosterge });
      continue;
    }
    kamyonlar.push({
      id: kart.id, plaka: kart.plaka, okuma: o.deger, arv: arv.deger,
      fark: o.deger - arv.deger, eski: kart.guncel_gosterge,
      kayitliFark: kart.arvento_fark, kalibreTarih: kart.arvento_fark_tarihi,
    });
  }
  kamyonlar.sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  makineler.sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));

  const isaretli = (v: number) => (v > 0 ? "+" : "") + Math.round(v).toLocaleString("tr-TR");

  if (kamyonlar.length) {
    console.log(`KAMYON / ARAÇ (km) — gerçek = Arvento + fark`);
    console.log(`PLAKA             OKUMANIZ      ARVENTO      YENİ FARK   KAYITLI FARK      SAPMA  SON KALİBRASYON`);
    console.log("-".repeat(101));
    for (const y of kamyonlar) {
      const sapma = y.kayitliFark == null ? null : y.fark - y.kayitliFark;
      console.log(
        `${y.plaka.padEnd(15)} ${n(y.okuma).padStart(11)}  ${n(y.arv).padStart(11)}  ` +
        `${isaretli(y.fark).padStart(11)}  ${(y.kayitliFark == null ? "—" : isaretli(y.kayitliFark)).padStart(12)}  ` +
        `${(sapma == null ? "yeni" : isaretli(sapma)).padStart(9)}  ${(y.kalibreTarih ?? "—").slice(0, 10)}`,
      );
    }
    console.log("-".repeat(101));
    const sapanlar = kamyonlar.filter((y) => y.kayitliFark != null && Math.abs(y.fark - y.kayitliFark) >= 1);
    console.log(`${kamyonlar.length} araç — ${kamyonlar.filter((y) => y.kayitliFark == null).length} ilk kalibrasyon, ${sapanlar.length} araçta sapma var.
`);
  }

  if (makineler.length) {
    console.log(`İŞ MAKİNESİ (saat) — gösterge = son okuma + kontak saati × katsayı`);
    console.log(`PLAKA             OKUMANIZ  ÖNCEKİ OKUMA  İLERLEME   KONTAK sa  GÜN  ESKİ KAT.  YENİ KAT.`);
    console.log("-".repeat(97));
    for (const m of makineler) {
      const ilerleme = m.oncekiOkuma == null ? null : m.okuma - m.oncekiOkuma;
      console.log(
        `${m.plaka.padEnd(15)} ${n(m.okuma).padStart(10)}  ${(m.oncekiOkuma == null ? "—" : n(m.oncekiOkuma)).padStart(12)}  ` +
        `${(ilerleme == null ? "—" : isaretli(ilerleme)).padStart(8)}  ${m.kontak.toFixed(1).padStart(10)}  ${String(m.gun).padStart(3)}  ` +
        `${(m.eskiKatsayi == null ? "—" : m.eskiKatsayi.toFixed(3)).padStart(9)}  ${(m.yeniKatsayi != null ? m.yeniKatsayi.toFixed(3) : m.oncekiOkuma == null ? "ilk okuma" : "değişmez").padStart(9)}`,
      );
    }
    console.log("-".repeat(97));
    const k = makineler.filter((m) => m.yeniKatsayi != null).length;
    console.log(`${makineler.length} makine — ${k} tanesinde katsayı güncellenecek.`);
    console.log(`"ilk okuma": daha önce kalibre edilmemiş → ölçülecek dönem yok, katsayı BİR SONRAKİ okumada çıkar.`);
    console.log(`"değişmez":  dönem çok kısa / çalışma az / oran makul aralık dışı → eski katsayı korunur.
`);
  }

  if (arventosuz.length) {
    console.log(`ARVENTO CİHAZI YOK — yalnız okuma kaydedilir (${arventosuz.length})`);
    for (const a of arventosuz.sort((x, y) => x.plaka.localeCompare(y.plaka, "tr"))) {
      console.log(`  ${a.plaka.padEnd(15)} ${n(a.okuma).padStart(11)}   (önceki: ${a.eski == null ? "—" : n(a.eski)})`);
    }
    console.log("");
  }

  if (atlanan.length) {
    console.log(`Atlananlar (${atlanan.length}):`);
    for (const a of atlanan) console.log("   " + a);
  }

  if (!uygula) {
    console.log(`
Hiçbir şey yazılmadı. Kaydetmek için komutun sonuna --uygula ekleyin.`);
    return;
  }

  const simdi = new Date().toISOString();
  let ok = 0;
  for (const y of kamyonlar) {
    const { error } = await sb.from("araclar").update({
      arvento_fark: y.fark,
      arvento_fark_tarihi: simdi,
      guncel_gosterge: y.okuma,
      arvento_gosterge: y.okuma,
      son_okuma_deger: y.okuma,
      son_okuma_tarihi: simdi,
      updated_at: simdi,
    }).eq("id", y.id);
    if (error) console.error(`  HATA ${y.plaka}: ${error.message}`);
    else ok++;
  }
  for (const m of makineler) {
    // Katsayı yalnız güvenilir hesaplandıysa yazılır; aksi hâlde eskisi korunur.
    const yama: Record<string, unknown> = {
      guncel_gosterge: m.okuma,
      son_okuma_deger: m.okuma,
      son_okuma_tarihi: simdi,
      updated_at: simdi,
    };
    if (m.yeniKatsayi != null) yama.saat_katsayi = m.yeniKatsayi;
    const { error } = await sb.from("araclar").update(yama).eq("id", m.id);
    if (error) console.error(`  HATA ${m.plaka}: ${error.message}`);
    else ok++;
  }
  for (const a of arventosuz) {
    const { error } = await sb.from("araclar").update({
      guncel_gosterge: a.okuma, son_okuma_deger: a.okuma, son_okuma_tarihi: simdi, updated_at: simdi,
    }).eq("id", a.id);
    if (error) console.error(`  HATA ${a.plaka}: ${error.message}`);
    else ok++;
  }
  console.log(`
${ok} aracın okuması kaydedildi.`);
  if (kamyonlar.length) console.log(`Kamyonlarda: gösterge = Arvento + fark.`);
  if (makineler.length) console.log(`Makinelerde: gösterge her gece (cron) son okuma + kontak saati × katsayı ile yürütülür.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
