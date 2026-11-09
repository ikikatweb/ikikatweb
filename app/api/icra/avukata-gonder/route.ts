// İCRA DOSYASINI AVUKATA MAİLLE GÖNDER.
//
// Cevap şekli "Avukat Aracılığı" seçilip kaydedilince çağrılır. Mail içinde cevap
// penceresinde görünen dosya bilgileri, SON CEVAP GÜNÜ (kırmızı) ve varsa kullanıcı
// notu bulunur; ekinde tebligat belgesinin aslı gider.
//
// ══ EK İNMEDEN MAİL GİTMEZ ══
// AGENTS.md: "Bir ek, belge ya da görsel indirilemiyorsa işlemi sessizce tamamlama."
// 27.10.2026'da kasko teklif maili ruhsat eki olmadan gitti, hata yutulduğu için
// kimse fark etmedi ve acente teklif veremedi. Burada aynı tuzak var: avukat,
// icra yazısını görmeden cevap yazamaz. Belge bulunamaz ya da inemezse mail HİÇ
// GÖNDERİLMEZ ve sebep kullanıcıya döner.
//
// ══ CEVAP TARİHİ MAİL GİDİNCE YAZILIR ══
// Avukat kipinde "icraya cevap tarihi" ayrıca sorulmuyor: cevap, mailin gittiği
// gün verilmiş sayılıyor. Mail gitmezse cevap_tarihi BOŞ KALIR ve dosya "Cevap
// Bekleyen" listesinde durmaya devam eder. Gitmemiş bir cevabı cevaplanmış
// göstermek, süre kaçırtan türden bir yanlış olurdu.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { storageIndir } from "@/lib/api/storage-indir";
import { antetEki } from "@/lib/api/antet-eki";
import { sistemTasiyici } from "@/lib/mail/smtp";

export const runtime = "nodejs";

const VARSAYILAN_CEVAP_SURESI = 7;
const gunTR = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");
const paraTR = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Yerel alanlardan "yyyy-mm-dd" — toISOString UTC'ye kaydırıp günü bir geri alıyor. */
const isoYerel = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const gunEkle = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoYerel(d);
};
const kacar = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

type Ek = { ad: string; yol: string; tur?: string | null };

export async function POST(request: Request) {
  // GÜVENLİK: /api middleware kapsamı dışında — kapı burada (lib/api/guvenlik).
  // Kullanıcı ayrıca mailin İMZASI olur: avukat kime cevap yazacağını bilsin.
  const kullanici = await oturum();
  if (!kullanici) return yetkisiz();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const sb = createClient(url, anahtar, { auth: { persistSession: false } });

  try {
    const { icraId, avukatId, not } = (await request.json()) as
      { icraId?: string; avukatId?: string; not?: string };
    if (!icraId || !avukatId) {
      return NextResponse.json({ error: "icraId ve avukatId zorunlu" }, { status: 400 });
    }

    const { data: kayit, error: kErr } = await sb.from("icra").select("*").eq("id", icraId).single();
    if (kErr || !kayit) return NextResponse.json({ error: "İcra kaydı bulunamadı" }, { status: 404 });

    const { data: avukat, error: aErr } = await sb.from("avukatlar").select("*").eq("id", avukatId).single();
    if (aErr || !avukat) return NextResponse.json({ error: "Avukat bulunamadı" }, { status: 404 });
    if (!avukat.email) {
      return NextResponse.json({
        error: `${avukat.ad_soyad} için e-posta adresi kayıtlı değil — mail gönderilemez. `
          + `İcra Dosyaları → Tanımlamalar'dan ekleyin.`,
      }, { status: 400 });
    }

    // ── TEBLİGAT BELGESİNİ BUL ──
    // icra kaydında tebligat bağlantısı yok; eşleştirme dosya esas numarası üzerinden.
    // Konu biçimi: "<Daire> [2024/57908] [<Daire>-<barkod>-0-2024/57908]" — numara
    // köşeli parantez içinde geçiyor, benzersiz sayılabilir.
    if (!kayit.dosya_esas_no) {
      return NextResponse.json({ error: "Kayıtta dosya esas no yok — tebligat belgesi eşleştirilemedi." }, { status: 400 });
    }
    const { data: tebligatlar } = await sb.from("tebligat")
      .select("id, konu, ekler, paket_yolu, ulasma_tarihi, indirme_hatasi")
      .ilike("konu", `%${kayit.dosya_esas_no}%`)
      .order("ulasma_tarihi", { ascending: false });

    // "ustyazi" PTT'nin zarf kapağı; asıl yazı o değil. Belgesi olan EN YENİ tebligat alınır.
    let belge: Ek | null = null;
    for (const t of tebligatlar ?? []) {
      const ekler = (t.ekler ?? []) as Ek[];
      const yazi = ekler.find((e) => !/ustyazi/i.test(e.ad) && /pdf/i.test(e.tur ?? e.ad))
        ?? ekler.find((e) => /pdf/i.test(e.tur ?? e.ad));
      if (yazi) { belge = yazi; break; }
    }
    if (!belge) {
      return NextResponse.json({
        error: `${kayit.dosya_esas_no} için tebligat belgesi panelde yok — mail GÖNDERİLMEDİ. `
          + `Tebligatlar ekranından "Belgeleri getir" ile indirip tekrar deneyin.`,
      }, { status: 400 });
    }

    // KOVALAR ÖZEL: düz fetch 400 döner, service role ile inilir (lib/api/storage-indir).
    const icerik = await storageIndir(belge.yol);
    if (!icerik) {
      return NextResponse.json({
        error: `Tebligat belgesi (${belge.ad}) indirilemedi — mail GÖNDERİLMEDİ. `
          + `Avukat yazıyı görmeden cevap yazamaz; eksik ekle göndermek işe yaramaz.`,
      }, { status: 502 });
    }

    // ── GÖNDEREN FİRMA ──
    // Üçüncü şahıs hangi firmamızsa mail o firmadan ve o firmanın anteti ile gider.
    const { data: firma } = kayit.ucuncu_sahis
      ? await sb.from("firmalar").select("firma_adi, smtp_user, antet_url, antet_renkli_url")
          .eq("firma_adi", kayit.ucuncu_sahis).maybeSingle()
      : { data: null };
    const { tasiyici, gonderen } = await sistemTasiyici(sb, firma?.smtp_user || undefined);
    // ANTET MAİLDE RENKLİ: antet_url GRİ sürümdür (yazışma çıktıları için), renkli
    // aslı antet_renkli_url'de durur — bkz. sql/firmalar_antet_renkli.sql. Yalnız
    // antet_url verilince mail gri antetle gidiyordu. Eski kayıtlarda renkli alan
    // boş olabilir; o zaman griye düşülür, davranış eskisi gibi kalır.
    const antet = await antetEki(firma?.antet_renkli_url || firma?.antet_url);

    // ── SON CEVAP GÜNÜ ──
    const sure = kayit.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI;
    const belgedenMi = kayit.cevap_suresi_gun != null;
    const sonGun = kayit.teblig_tarihi ? gunEkle(kayit.teblig_tarihi, sure) : null;

    const satir = (etiket: string, deger: string, stil = "") =>
      `<tr><td style="padding:4px 10px 4px 0;color:#64748b;font-size:13px;white-space:nowrap">${etiket}</td>`
      + `<td style="padding:4px 0;font-size:13px;${stil}">${deger}</td></tr>`;

    // DİPNOT YOK: "Ek: <dosya adı>" ve "bu mail ... panelinden otomatik
    // gönderilmiştir" satırları kaldırıldı — eki mail programı zaten gösteriyor,
    // firmayı da antet söylüyor. Yorum ŞABLONUN DIŞINDA: içine yazılan her şey
    // mailin gövdesine metin olarak basılır, burası JSX değil.
    const html = `${antet.html}
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;color:#1E3A5F">
  <p style="font-size:14px;margin:0 0 10px">Merhaba ${kacar(avukat.ad_soyad)};</p>
  <p style="font-size:13px;color:#475569;margin:0 0 14px">
    Aşağıdaki icra dosyasına cevap verilmesi gerekmektedir. Tebligat yazısı ektedir.
  </p>
  <table style="border-collapse:collapse;margin-bottom:14px">
    ${satir("Dosya esas no", kacar(kayit.dosya_esas_no), "font-weight:600")}
    ${satir("Üçüncü şahıs", kacar(kayit.ucuncu_sahis ?? "—"))}
    ${satir("Borçlu", kacar(kayit.borclu_adi ?? "—"))}
    ${satir("Alacaklı", kacar(kayit.alacakli_adi ?? "—"))}
    ${satir("Tebliğ tarihi", gunTR(kayit.teblig_tarihi))}
    ${satir("Son cevap günü",
      sonGun
        ? `${gunTR(sonGun)}${belgedenMi ? "" : " <span style=\"font-size:11px;font-weight:400\">(belgede süre yazmıyor, 7 gün varsayıldı)</span>"}`
        : "hesaplanamadı (tebliğ tarihi yok)",
      "color:#dc2626;font-weight:700")}
    ${satir("Borç miktarı", `${paraTR(Number(kayit.borc_miktari || 0))} TL`, "color:#dc2626")}
  </table>
  ${(not ?? "").trim() ? `<div style="border-left:3px solid #1E3A5F;background:#f8fafc;padding:10px 12px;margin-bottom:14px">
    <div style="font-size:11px;color:#64748b;margin-bottom:3px">Not</div>
    <div style="font-size:13px;white-space:pre-wrap">${kacar((not ?? "").trim())}</div>
  </div>` : ""}
  <p style="font-size:14px;margin:18px 0 0">
    İyi çalışmalar,<br>
    <strong>${kacar(kullanici.ad_soyad)}</strong>
  </p>
</div>`;

    await tasiyici.sendMail({
      from: `"${firma?.firma_adi ?? "İkikat"}" <${gonderen}>`,
      to: avukat.email,
      subject: `İcra dosyası ${kayit.dosya_esas_no}`
        + (sonGun ? ` — son cevap günü ${gunTR(sonGun)}` : ""),
      html,
      attachments: [
        ...(antet.ek ? [antet.ek] : []),
        { filename: belge.ad, content: icerik },
      ],
    });

    // Mail GİTTİKTEN SONRA yazılır: gitmediyse dosya cevapsız kalmalı.
    const bugun = isoYerel(new Date());
    const { error: gErr } = await sb.from("icra").update({
      cevap_tarihi: bugun,
      avukat_mail_at: new Date().toISOString(),
      avukat_mail_ek: belge.ad,
      updated_at: new Date().toISOString(),
    }).eq("id", icraId);

    return NextResponse.json({
      gonderildi: true,
      alici: avukat.email,
      ek: belge.ad,
      cevap_tarihi: bugun,
      // SESSİZ GEÇİLMEZ: mail gitti ama kayıt güncellenemediyse kullanıcı bilmeli,
      // yoksa dosya cevapsız görünür ve ikinci kez gönderilir.
      kayitHatasi: gErr ? gErr.message : null,
      antetInemedi: antet.inemedi,
    });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error("[icra/avukata-gonder]", mesaj);
    return NextResponse.json({ error: `Mail gönderilemedi: ${mesaj}` }, { status: 500 });
  }
}
