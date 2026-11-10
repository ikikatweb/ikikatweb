// İCRA DOSYASINI AVUKATA MAİLLE GÖNDER — İKİ DEFTER İÇİN.
//
//   kaynak="icra"   → üçüncü şahıs haciz dosyası (public.icra)
//   kaynak="sirket" → şirkete açılan takip / ödeme emri (public.icra_sirket_takip)
//
// NİYE TEK SERVİS: gönderim kuralları (ek inmeden mail yok, antet, hitap, gönderim
// izi, günlük) iki defterde de aynı. Ayrı iki servis yazılsaydı biri düzelir öbürü
// geride kalırdı. Değişen yalnız hangi tablodan okunduğu, ekin nereden geldiği ve
// maildeki satırlar.
//
// Cevap şekli "Avukat Aracılığı" (ödeme emrinde "Avukatta") seçilip kaydedilince çağrılır. Mail içinde cevap
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
import { icraTebligatBelgesi } from "@/lib/api/icra-tebligat-belge";
import { storageIndir } from "@/lib/api/storage-indir";
import { antetEki } from "@/lib/api/antet-eki";
import { sistemTasiyici } from "@/lib/mail/smtp";
import { avukatAdiGoster, formatBaslik } from "@/lib/utils/isim";

/**
 * MAİLDEKİ HİTAP — "Sayın Av. Ali Veli".
 *
 * KULLANICININ YAZDIĞI BİÇİM KORUNUR: listeye "Cemre İKİKAT" diye soyadı büyük
 * harfle girilmişse mailde de öyle çıkar; o bilinçli bir yazım. Yalnız TAMAMEN
 * küçük harfle girilmiş adlar ("deneme") düzeltilir — resmî bir yazıda küçük
 * harfle hitap etmek kusur olur.
 */
function hitapAdi(ad: string | null | undefined): string {
  const t = (ad ?? "").trim();
  const duzeltilmis = t && t === t.toLocaleLowerCase("tr") ? formatBaslik(t) : t;
  return avukatAdiGoster(duzeltilmis);
}

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
    const { icraId, kaynak, avukatId, not } = (await request.json()) as
      { icraId?: string; kaynak?: "icra" | "sirket"; avukatId?: string; not?: string };
    const sirket = kaynak === "sirket";
    const tablo = sirket ? "icra_sirket_takip" : "icra";
    if (!icraId || !avukatId) {
      return NextResponse.json({ error: "icraId ve avukatId zorunlu" }, { status: 400 });
    }

    const { data: kayit, error: kErr } = await sb.from(tablo).select("*").eq("id", icraId).single();
    if (kErr || !kayit) {
      return NextResponse.json({ error: sirket ? "Takip kaydı bulunamadı" : "İcra kaydı bulunamadı" }, { status: 404 });
    }

    const { data: avukat, error: aErr } = await sb.from("avukatlar").select("*").eq("id", avukatId).single();
    if (aErr || !avukat) return NextResponse.json({ error: "Avukat bulunamadı" }, { status: 404 });
    if (!avukat.email) {
      return NextResponse.json({
        error: `${avukat.ad_soyad} için e-posta adresi kayıtlı değil — mail gönderilemez. `
          + `İcra Dosyaları → Tanımlamalar'dan ekleyin.`,
      }, { status: 400 });
    }

    // ── TEBLİGAT BELGESİNİ BUL VE İNDİR ──
    // ORTAK YARDIMCI (lib/api/icra-tebligat-belge): aynı iş muhasebe servisinde de
    // geçiyor ve kural ikisinde de aynı — EK İNMEDEN MAİL GİTMEZ. İki kopya
    // tutulsaydı biri düzeltilir öbürü geride kalırdı.
    const ekSonuc = await icraTebligatBelgesi(sb, kayit, sirket,
      "Avukat yazıyı görmeden cevap yazamaz; eksik ekle göndermek işe yaramaz.");
    if (ekSonuc.hata) return NextResponse.json({ error: ekSonuc.hata.mesaj }, { status: ekSonuc.hata.kod });
    const belge = ekSonuc.belge;
    const icerik = ekSonuc.icerik;

    // ── ELLE EKLENEN DOSYALAR ──
    // Avukata yalnız tebligat yazısı gidiyordu; oysa çoğu zaman muhasebeden
    // gelen hesap ekstresi, sözleşme ya da yazışma da gitmeli. Dosyalar kayıtta
    // duruyor (avukat_ek_dosyalar), böylece tekrar gönderimde de aynı ekler
    // gidiyor ve "neyi göndermiştik" sorusu cevaplanabiliyor.
    //
    // EKSİK EKLE MAİL GİTMEZ (AGENTS.md): kullanıcı dosyayı bilerek ekledi;
    // inemiyorsa maili eksik göndermek, gönderdiğini sanmasına yol açar.
    const elleEkler = (kayit.avukat_ek_dosyalar ?? []) as { ad: string; yol: string }[];
    const ekDosyalar: { filename: string; content: Buffer }[] = [];
    for (const e of elleEkler) {
      const d = await storageIndir(e.yol);
      if (!d) {
        return NextResponse.json({
          error: `Eklediğiniz dosya (${e.ad}) indirilemedi — mail GÖNDERİLMEDİ. `
            + `Dosyayı penceredeki listeden çıkarıp tekrar yükleyin.`,
        }, { status: 502 });
      }
      ekDosyalar.push({ filename: e.ad, content: d });
    }

    // ── GÖNDEREN FİRMA ──
    // Üçüncü şahıs hangi firmamızsa mail o firmadan ve o firmanın anteti ile gider.
    // ŞİRKET DEFTERİNDE BORÇLU BİZİZ: mail o firmadan ve o firmanın antetiyle gider.
    const firmaAdi = (sirket ? kayit.borclu_firma : kayit.ucuncu_sahis) as string | null;
    const { data: firma } = firmaAdi
      ? await sb.from("firmalar").select("firma_adi, smtp_user, antet_url, antet_renkli_url")
          .eq("firma_adi", firmaAdi).maybeSingle()
      : { data: null };
    const { tasiyici, gonderen } = await sistemTasiyici(sb, firma?.smtp_user || undefined);
    // ANTET MAİLDE RENKLİ: antet_url GRİ sürümdür (yazışma çıktıları için), renkli
    // aslı antet_renkli_url'de durur — bkz. sql/firmalar_antet_renkli.sql. Yalnız
    // antet_url verilince mail gri antetle gidiyordu. Eski kayıtlarda renkli alan
    // boş olabilir; o zaman griye düşülür, davranış eskisi gibi kalır.
    const antet = await antetEki(firma?.antet_renkli_url || firma?.antet_url);

    // ── SON CEVAP / İTİRAZ GÜNÜ ──
    // ŞİRKET DEFTERİNDE VARSAYILAN SÜRE YOK: üçüncü şahıs yazılarının 18'inde süre
    // 7 gün yazıyor, o yüzden orada varsayıma düşülüyor. Ödeme emirlerinde süre
    // belgeden belgeye değişiyor; yazmıyorsa gün UYDURULMAZ, ekranda da öyle.
    const sure = sirket
      ? (kayit.itiraz_suresi_gun as number | null)
      : (kayit.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI);
    const belgedenMi = sirket ? true : kayit.cevap_suresi_gun != null;
    const sonGun = kayit.teblig_tarihi && sure != null ? gunEkle(kayit.teblig_tarihi, sure) : null;
    const sonGunEtiket = sirket ? "Son itiraz günü" : "Son cevap günü";

    const satir = (etiket: string, deger: string, stil = "") =>
      `<tr><td style="padding:4px 10px 4px 0;color:#64748b;font-size:13px;white-space:nowrap">${etiket}</td>`
      + `<td style="padding:4px 0;font-size:13px;${stil}">${deger}</td></tr>`;

    // DİPNOT YOK: "Ek: <dosya adı>" ve "bu mail ... panelinden otomatik
    // gönderilmiştir" satırları kaldırıldı — eki mail programı zaten gösteriyor,
    // firmayı da antet söylüyor. Yorum ŞABLONUN DIŞINDA: içine yazılan her şey
    // mailin gövdesine metin olarak basılır, burası JSX değil.
    const html = `${antet.html}
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;color:#1E3A5F">
  <!-- HİTAP: resmî yazışma usulü. Unvan zaten yazılmışsa tekrarlanmaz. -->
  <p style="font-size:14px;margin:0 0 10px">Sayın ${kacar(hitapAdi(avukat.ad_soyad))},</p>
  <p style="font-size:13px;color:#475569;margin:0 0 14px">
    ${sirket
      ? "Şirketimize aşağıdaki ödeme emri tebliğ edilmiştir. Ödeme emrinin aslı ektedir."
      : "Aşağıdaki icra dosyasına cevap verilmesi gerekmektedir. Tebligat yazısı ektedir."}
  </p>
  <table style="border-collapse:collapse;margin-bottom:14px">
    ${satir("Dosya esas no", kacar(kayit.dosya_esas_no), "font-weight:600")}
    ${sirket
      ? satir("İcra dairesi", kacar(kayit.icra_dairesi ?? "—"))
        + satir("Borçlu firma", kacar(kayit.borclu_firma ?? "—"))
      : satir("Üçüncü şahıs", kacar(kayit.ucuncu_sahis ?? "—"))
        + satir("Borçlu", kacar(kayit.borclu_adi ?? "—"))}
    ${satir("Alacaklı", kacar(kayit.alacakli_adi ?? "—"))}
    ${satir("Tebliğ tarihi", gunTR(kayit.teblig_tarihi))}
    ${satir(sonGunEtiket,
      sonGun
        ? `${gunTR(sonGun)}${belgedenMi ? "" : " <span style=\"font-size:11px;font-weight:400\">(belgede süre yazmıyor, 7 gün varsayıldı)</span>"}`
        : (sure == null ? "belgede süre yazmıyor" : "hesaplanamadı (tebliğ tarihi yok)"),
      "color:#dc2626;font-weight:700")}
    ${satir(sirket ? "Takip tutarı" : "Borç miktarı",
      `${paraTR(Number((sirket ? kayit.takip_tutari : kayit.borc_miktari) || 0))} TL`, "color:#dc2626")}
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
      subject: `${sirket ? "Ödeme emri" : "İcra dosyası"} ${kayit.dosya_esas_no}`
        + (sonGun ? ` — ${sonGunEtiket.toLocaleLowerCase("tr")} ${gunTR(sonGun)}` : ""),
      html,
      attachments: [
        ...(antet.ek ? [antet.ek] : []),
        { filename: belge.ad, content: icerik },
        ...ekDosyalar,
      ],
    });

    // Mail GİTTİKTEN SONRA yazılır: gitmediyse dosya cevapsız kalmalı.
    //
    // CEVAP TARİHİ EZİLMEZ: tekrar gönderimde dosyanın cevap tarihi İLK gönderimin
    // günüdür — icraya cevap o gün verilmiştir. Yeniden gönderme bir hatırlatmadır,
    // yeni bir cevap değil; tarihi güncellemek süreyi olduğundan geç gösterirdi.
    const bugun = isoYerel(new Date());
    const simdi = new Date().toISOString();
    const { error: gErr } = await sb.from(tablo).update({
      // ŞİRKET DEFTERİNDE CEVAP TARİHİ YOK: "cevap verildi" ölçüsü orada durum
      // alanı (avukatta/ödendi/kapandı). Olmayan sütuna yazmaya çalışmak isteği
      // tümden düşürürdü.
      ...(sirket || kayit.cevap_tarihi ? {} : { cevap_tarihi: bugun }),
      avukat_mail_at: simdi,
      // ADIN ANLIK KOPYASI: avukat listeden silinse ya da adı değişse de
      // "bu dosya kime gitmişti" sorusu cevaplanabilsin. Tabloda da bu
      // sütun gösteriliyor; id'den ada her seferinde çevirmek gerekmiyor.
      avukat_adi: avukat.ad_soyad,
      // EKİN ADI: tebligat yazısı + elle eklenenler. Ekranda "ek: …" diye
      // görünüyor; yalnız tebligat yazılsaydı eklenen dosyaların izi kalmazdı.
      avukat_mail_ek: [belge.ad, ...elleEkler.map((e) => e.ad)].join(", "),
      avukat_mail_gonderen: kullanici.ad_soyad,
      avukat_mail_gonderen_id: kullanici.id,
      avukat_mail_sayisi: (kayit.avukat_mail_sayisi ?? 0) + 1,
      updated_at: simdi,
    }).eq("id", icraId);

    // GÜNLÜK: her gönderim ayrı satır. Satırdaki özet SON gönderimi gösteriyor;
    // "kaç kere, kim gönderdi" sorusunun tam cevabı burada.
    const { error: logErr } = await sb.from("icra_avukat_mail_log").insert({
      ...(sirket ? { sirket_takip_id: icraId } : { icra_id: icraId }),
      avukat_id: avukatId, avukat_adi: avukat.ad_soyad,
      avukat_email: avukat.email, gonderen_id: kullanici.id, gonderen_ad: kullanici.ad_soyad,
      ek_ad: [belge.ad, ...elleEkler.map((e) => e.ad)].join(", "),
    });

    return NextResponse.json({
      gonderildi: true,
      alici: avukat.email,
      ek: [belge.ad, ...elleEkler.map((e) => e.ad)].join(", "),
      cevap_tarihi: sirket ? null : (kayit.cevap_tarihi ?? bugun),
      gonderen: kullanici.ad_soyad,
      gonderildiAt: simdi,
      // SESSİZ GEÇİLMEZ: mail gitti ama kayıt/günlük yazılamadıysa kullanıcı bilmeli,
      // yoksa dosya cevapsız görünür ve ikinci kez gönderilir.
      kayitHatasi: gErr ? gErr.message : (logErr ? `gönderim günlüğü yazılamadı: ${logErr.message}` : null),
      antetInemedi: antet.inemedi,
    });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error("[icra/avukata-gonder]", mesaj);
    return NextResponse.json({ error: `Mail gönderilemedi: ${mesaj}` }, { status: 500 });
  }
}
