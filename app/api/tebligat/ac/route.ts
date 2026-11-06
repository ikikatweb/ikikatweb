// TEBLİGATI AÇ — UETS'ten EYP paketini indirir, içindekileri panele çıkarır.
//
// BU İŞLEM GERİ ALINAMAZ. Taahhütname md. 7: indirilen paketler/ekler okunmuş olarak
// işlem görür. Yani bu rota çağrıldığı an tebligat UETS'te AÇILMIŞ sayılır; dokümanın
// kendisi de "download edilen tebligat'ın status değeri güncellenerek artık read olacaktır"
// diyor. O yüzden:
//   · yalnız kullanıcı düğmeye basınca çalışır (robot asla çağırmaz),
//   · KİMİN açtığı kayda geçer (okuyan_id + o anki adı),
//   · indirme başladıysa sonuç ne olursa olsun satır "okundu" işaretlenir — paket
//     kaydedilemese bile tebligat açılmıştır, bunu gizlemek yanlış olur.
//
// SESSİZ HATA YOK: paket inmezse/açılmazsa sebep indirme_hatasi'na yazılır, ekranda
// kırmızı görünür. "Açıldı" deyip boş ekran göstermek, hiç açmamaktan kötüdür.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { hasPermission, type Rol } from "@/lib/permissions";
import type { Izinler } from "@/lib/supabase/types";

const TEMEL = "https://apipp.etebligat.gov.tr/v1";
const KOVA = "yazismalar";

/** Paketin içinden kullanıcıya gösterilecek dosyalar. İmza/üstveri dosyaları paketin
 *  içinde kalır — kullanıcıyı ilgilendiren asıl belge ve ekleridir. */
const BELGE_UZANTI = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf", "txt",
  "udf", "jpg", "jpeg", "png", "gif", "tif", "tiff", "bmp", "html", "htm", "eml", "zip", "rar",
]);

const TURLER: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  txt: "text/plain; charset=utf-8", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  xml: "application/xml", eml: "message/rfc822", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const uzanti = (ad: string) => (ad.includes(".") ? ad.split(".").pop()!.toLowerCase() : "");

/** Storage anahtarı için güvenli ad: Türkçe harfler ve boşluklar yol bozmasın. */
function guvenliAd(ad: string): string {
  const tr: Record<string, string> = { ç:"c", ğ:"g", ı:"i", ö:"o", ş:"s", ü:"u", Ç:"C", Ğ:"G", İ:"I", Ö:"O", Ş:"S", Ü:"U" };
  return ad.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => tr[c] ?? c)
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-120) || "dosya";
}

export async function POST(request: Request) {
  // ───────── kapı ─────────
  const k = await oturum();
  if (!k) return yetkisiz();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const servis = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !servis) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const sb = createClient(url, servis, { auth: { persistSession: false } });

  // İzin: gelen evrakı görebilen açabilir. oturum() izinleri getirmiyor, burada okunuyor.
  const { data: kul } = await sb.from("kullanicilar").select("izinler").eq("id", k.id).single();
  const izinli = hasPermission(k.rol as Rol, (kul?.izinler ?? {}) as Izinler, "yazismalar-gelen-evrak", "goruntule");
  if (!izinli) return NextResponse.json({ error: "Tebligat açma yetkiniz yok." }, { status: 403 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: number };
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  const { data: t, error: okuHata } = await sb
    .from("tebligat").select("id, hesap, uets_id, durum, paket_yolu, ekler, firma_id").eq("id", id).single();
  if (okuHata || !t) return NextResponse.json({ error: "Tebligat bulunamadı." }, { status: 404 });

  // Zaten indirilmişse TEKRAR İNDİRİLMEZ: hem gereksiz sorgu hakkı harcar (standart
  // tarifede günde 12 sorgu), hem de ilk açanın kaydını bozmamak gerekir.
  if (t.paket_yolu) return NextResponse.json({ durum: "zaten-acik", ekler: t.ekler ?? [] });

  // Anahtar firmanın kendi ayarında (Firma Düzenle > UETS E-Tebligat). Tebligat hangi
  // firmaya geldiyse onun anahtarıyla indirilir — başka firmanınkiyle inmez zaten.
  let firmaId = t.firma_id as string | null;
  if (!firmaId) {
    // Eski kayıtlarda firma eşleşmemiş olabilir: hesap kodu kısa addan türüyor.
    const { data: f } = await sb.from("firmalar").select("id").eq("kisa_adi", t.hesap).maybeSingle();
    firmaId = f?.id ?? null;
  }
  if (!firmaId) {
    return NextResponse.json({ error: `"${t.hesap}" hangi firmaya ait belirlenemedi.` }, { status: 500 });
  }
  const { data: ayar } = await sb.from("firma_uets").select("api_key").eq("firma_id", firmaId).maybeSingle();
  const anahtar = ayar?.api_key;
  if (!anahtar) {
    return NextResponse.json(
      { error: `${t.hesap} için UETS anahtarı tanımlı değil. Firma Düzenle > UETS E-Tebligat sekmesinden girin.` },
      { status: 500 });
  }

  // ───────── UETS'ten indir ─────────
  // Bu satır çalıştıktan SONRA tebligat açılmış sayılır. Öncesinde hiçbir şey yazılmaz:
  // indirme başarısızsa tebligat açılmamıştır, kaydı kirletmeyelim.
  let paket: Buffer;
  let etag: string | null = null;
  try {
    const r = await fetch(`${TEMEL}/messages/${encodeURIComponent(t.uets_id)}/_download`, {
      headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" },
    });
    if (!r.ok) {
      let mesaj = (await r.text()).slice(0, 300);
      try { const j = JSON.parse(mesaj); mesaj = `${j.message ?? mesaj}${j.code ? ` (kod ${j.code})` : ""}`; } catch { /* düz metin */ }
      return NextResponse.json({ error: `UETS ${r.status}: ${mesaj}` }, { status: 502 });
    }
    etag = r.headers.get("etag");
    paket = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    return NextResponse.json(
      { error: `UETS'e ulaşılamadı: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  if (paket.length === 0) {
    return NextResponse.json({ error: "UETS boş paket döndü — tebligat alınamadı." }, { status: 502 });
  }

  // ───────── buradan sonra TEBLİGAT AÇILMIŞTIR ─────────
  // Ne olursa olsun satır "okundu" işaretlenecek. Aksi hâlde sistem "açılmadı" derken
  // UETS "okundu" der; süre işlerken yanlış bilgiye bakmış oluruz.
  const kok = `tebligat/${guvenliAd(t.hesap)}/${guvenliAd(t.uets_id)}`;
  const adres = (yol: string) => sb.storage.from(KOVA).getPublicUrl(yol).data.publicUrl;
  const sorunlar: string[] = [];
  let paketYolu: string | null = null;
  const ekler: { ad: string; yol: string; tur: string; boyut: number }[] = [];

  // 1) Ham EYP paketi — imzasıyla birlikte duran asıl delil. Her hâlükârda saklanır.
  {
    const yol = `${kok}/paket.eyp`;
    const { error } = await sb.storage.from(KOVA)
      .upload(yol, paket, { upsert: true, contentType: "application/octet-stream" });
    if (error) sorunlar.push(`EYP paketi kaydedilemedi: ${error.message}`);
    else paketYolu = adres(yol);
  }

  // 2) Paketin içindekiler. EYP bir arşiv dosyasıdır (doküman: "Arşiv dosyasında
  //    '/Imzalar/ImzaCades.imz' dosyası yok"). Açılamazsa paket yine elimizde kalır.
  try {
    const zip = await JSZip.loadAsync(paket);
    const girdiler = Object.values(zip.files).filter((f) => !f.dir);
    const belgeler = girdiler.filter((f) => BELGE_UZANTI.has(uzanti(f.name)));
    if (belgeler.length === 0) {
      sorunlar.push(
        `Pakette gösterilebilir belge bulunamadı. İçindekiler: ${girdiler.map((f) => f.name).join(", ") || "boş"}`);
    }
    for (const f of belgeler) {
      const icerik = Buffer.from(await f.async("uint8array"));
      const ad = f.name.split("/").pop() || f.name;
      const u = uzanti(ad);
      const yol = `${kok}/${guvenliAd(ad)}`;
      const { error } = await sb.storage.from(KOVA)
        .upload(yol, icerik, { upsert: true, contentType: TURLER[u] ?? "application/octet-stream" });
      if (error) { sorunlar.push(`${ad} kaydedilemedi: ${error.message}`); continue; }
      ekler.push({ ad, yol: adres(yol), tur: u, boyut: icerik.length });
    }
  } catch (e) {
    sorunlar.push(`EYP paketi açılamadı: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) Kayıt. durum/okuma_tarihi/okuyan alanlarını yalnız servis anahtarı yazabilir
  //    (bkz. sql/tebligat_okuma.sql — koruma tetikleyicisi).
  const simdi = new Date().toISOString();
  const { error: yazHata } = await sb.from("tebligat").update({
    durum: "read",
    okuma_tarihi: simdi,
    okuyan_id: k.id,
    okuyan_ad: k.ad_soyad,          // o anki ad: kullanıcı sonradan silinse de iz kalsın
    paket_yolu: paketYolu,
    ekler,
    etag: etag ?? undefined,
    indirme_hatasi: sorunlar.length ? sorunlar.join(" · ") : null,
  }).eq("id", id);

  if (yazHata) {
    // Tebligat açıldı ama deftere yazılamadı — EN KÖTÜ HÂL. Kullanıcı bunu görmeli.
    return NextResponse.json({
      error: `Tebligat UETS'te açıldı ancak kaydedilemedi: ${yazHata.message}. `
        + `UETS'te artık "okundu" görünüyor; lütfen bu durumu not alın.`,
    }, { status: 500 });
  }

  return NextResponse.json({
    durum: "acildi",
    okuyan_ad: k.ad_soyad,
    okuma_tarihi: simdi,
    paket_yolu: paketYolu,
    ekler,
    uyari: sorunlar.length ? sorunlar.join(" · ") : null,
  });
}
