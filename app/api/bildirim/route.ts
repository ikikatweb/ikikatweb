// AĞ KONTROL PANELİNDEN BİLDİRİM — POST /api/bildirim
//
// Ofisteki ağ kontrol paneli (192.168.3.66:8088) bir cihaz ağa girip çıktığında buraya
// yazar; bildirim zil menüsündeki listeye düşer.
//
// KAPI: "Authorization: Bearer <AGKONTROL_TOKEN>". Görev anahtarından (CRON_SECRET) AYRI
// bir anahtar: panel ayrı bir cihaz, onun anahtarı sızarsa cron rotaları açılmasın.
// AGKONTROL_TOKEN ortamda yoksa kapı KAPALI sayılır (yanlışlıkla herkese açılmasın).
//
// KİME: AGKONTROL_ALICI (virgülle ayrılmış kullanıcı adları). Tanımsızsa "mustafa2kat".
// Bütün yöneticilere değil: kimin büroda olduğu bilgisi herkese dağıtılacak bir şey değil.
//
// TEKRAR: gövdedeki "id" bildirim_gecmisi.kaynak_id'ye yazılır. Aynı id ikinci kez
// gelirse satır eklenmez (sql/ag_kontrol_bildirim.sql — tekil dizin), yine 200 döner
// ki panel "gitmedi" sanıp sonsuza kadar denemesin.
//
// PUSH DA GİDER (17.11.2026, kullanıcı kararı): listeye yazılan her YENİ olay alıcının
// telefonuna da düşer. Tekrar gelen id için push ATILMAZ. Alıcı "ag-kontrol" kategorisini
// bildirim ayarından kapattıysa push gitmez, liste kaydı yine yazılır.
// Push düşerse cevapta "pushGiden: 0" görünür — sessizce yutulmaz.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { sendPushToKullanici } from "@/lib/push";

export const dynamic = "force-dynamic";

const KAYNAK_TIP = "ag-kontrol";
const VARSAYILAN_ALICI = "mustafa2kat";

function anahtarGecerli(request: Request): boolean {
  const beklenen = process.env.AGKONTROL_TOKEN;
  if (!beklenen) return false;
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(beklenen);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Olay anını TR yerel tarih/saatine çevirir — liste güne göre süzülüyor. */
function trZaman(an: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(an);
  const al = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const ss = al("hour") === "24" ? "00" : al("hour");
  return { tarih: `${al("year")}-${al("month")}-${al("day")}`, saat: `${ss}:${al("minute")}:${al("second")}` };
}

const metin = (v: unknown, azami: number) => (typeof v === "string" ? v.trim().slice(0, azami) : "");

export async function POST(request: Request) {
  if (!anahtarGecerli(request)) {
    return NextResponse.json({ ok: false, error: "Yetkisiz" }, { status: 401 });
  }

  let govde: Record<string, unknown>;
  try {
    govde = await request.json();
    if (!govde || typeof govde !== "object") throw new Error();
  } catch {
    return NextResponse.json({ ok: false, error: "Gövde geçerli JSON değil" }, { status: 400 });
  }

  const baslik = metin(govde.baslik, 120) || "Ağ Kontrol";
  const mesaj = metin(govde.mesaj, 500);
  const cihaz = metin(govde.cihaz, 120);
  const olay = metin(govde.olay, 20);
  const olayId = metin(govde.id, 200);
  if (!mesaj) return NextResponse.json({ ok: false, error: "\"mesaj\" zorunlu" }, { status: 400 });
  // id'siz olay kabul edilmez: tekrarı ayırt etmenin başka yolu yok.
  if (!olayId) return NextResponse.json({ ok: false, error: "\"id\" zorunlu" }, { status: 400 });
  if (olay && olay !== "cevrimici" && olay !== "cevrimdisi") {
    return NextResponse.json({ ok: false, error: "\"olay\" cevrimici ya da cevrimdisi olmalı" }, { status: 400 });
  }

  // "zaman" olayın gerçek anı; panel geç gönderse de bildirim doğru saate düşsün.
  // Okunamıyorsa şimdi sayılır.
  const zamanHam = metin(govde.zaman, 40);
  const an = zamanHam && !isNaN(Date.parse(zamanHam)) ? new Date(zamanHam) : new Date();
  const { tarih, saat } = trZaman(an);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const adlar = (process.env.AGKONTROL_ALICI || VARSAYILAN_ALICI)
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const { data: alicilar, error: aliciHata } = await supabase
    .from("kullanicilar")
    .select("id, bildirim_ayarlari")
    .in("kullanici_adi", adlar)
    .eq("aktif", true);
  if (aliciHata) return NextResponse.json({ ok: false, error: aliciHata.message }, { status: 500 });
  // Alıcı bulunamadıysa "ok" DENMEZ: bildirim hiç kimseye düşmedi, panel bunu bilsin.
  if (!alicilar || alicilar.length === 0) {
    return NextResponse.json({ ok: false, error: `Alıcı kullanıcı bulunamadı: ${adlar.join(", ")}` }, { status: 500 });
  }

  // Cihaz adı mesajda zaten geçmiyorsa sona eklenir ("Mki Büroda — Mustafa Kürşat İkikat").
  const govdeMetni = cihaz && !mesaj.includes(cihaz) ? `${mesaj} — ${cihaz}` : mesaj;

  let eklenen = 0;
  let pushGiden = 0;
  for (const a of alicilar) {
    const { error } = await supabase.from("bildirim_gecmisi").insert({
      kullanici_id: a.id,
      baslik,
      govde: govdeMetni,
      url: "/dashboard",
      tag: KAYNAK_TIP,
      tarih, saat, okundu: false,
      kaynak_tip: KAYNAK_TIP,
      kaynak_id: olayId,
    });
    if (!error) {
      eklenen++;
      const kapali = ((a.bildirim_ayarlari ?? {}) as Record<string, boolean>)[KAYNAK_TIP] === false;
      if (!kapali) {
        // Etiket olaya özel: iki ayrı cihazın bildirimi telefonda birbirinin üstüne yazmasın.
        pushGiden += await sendPushToKullanici(a.id, {
          title: baslik, body: govdeMetni, url: "/dashboard", tag: `${KAYNAK_TIP}-${olayId}`,
        });
      }
      continue;
    }
    if (error.code === "23505") continue;            // aynı id daha önce yazılmış
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eklenen, tekrar: eklenen === 0, pushGiden });
}
