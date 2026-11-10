// İCRA YAZISINI MUHASEBEYE MAİLLE GÖNDER — İKİ DEFTER İÇİN.
//
//   kaynak="icra"   → üçüncü şahıs haciz dosyası (public.icra)
//   kaynak="sirket" → şirkete açılan takip / ödeme emri (public.icra_sirket_takip)
//
// NİYE: cevabın altlığını muhasebe hazırlıyor. Üçüncü şahıs haczinde "borçluya
// borcumuz var mı, ne kadar", ödeme emrinde "bu borç ödenmiş mi" sorusunu muhasebe
// cevaplıyor ve CEVAP ŞEKLİNİ (yazışma / havale / avukat) belirleyen de o cevap.
// O yüzden mail, dosya panele girilir girilmez gider — cevap şekli seçilmeden önce.
//
// ══ EK İNMEDEN MAİL GİTMEZ ══
// AGENTS.md: "Bir ek, belge ya da görsel indirilemiyorsa işlemi sessizce
// tamamlama." Muhasebe, icra yazısını görmeden borç durumunu çıkaramaz ve altlık
// hazırlayamaz. Belge yoksa/inemezse mail HİÇ GÖNDERİLMEZ, sebep kullanıcıya
// döner ve dosya "muhasebeye gönderilmedi" durumunda kalır.
//
// ══ ALICI: TANIMLAMALAR > muhasebe_email ══
// Bordro ve geçici kabul mailleriyle AYNI adres listesi. Adres tanımlı değilse
// mail gönderilmiyor; "kime gittiğini" uydurmak yerine sebep söyleniyor.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { icraTebligatBelgesi } from "@/lib/api/icra-tebligat-belge";
import { antetEki } from "@/lib/api/antet-eki";
import { sistemTasiyici } from "@/lib/mail/smtp";

export const runtime = "nodejs";

const VARSAYILAN_CEVAP_SURESI = 7;
const gunTR = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");
const paraTR = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  // Kullanıcı ayrıca mailin İMZASI olur: muhasebe kime cevap yazacağını bilsin.
  const kullanici = await oturum();
  if (!kullanici) return yetkisiz();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const sb = createClient(url, anahtar, { auth: { persistSession: false } });

  try {
    const { icraId, kaynak, not, otomatik } = (await request.json()) as
      { icraId?: string; kaynak?: "icra" | "sirket"; not?: string; otomatik?: boolean };
    const sirket = kaynak === "sirket";
    const tablo = sirket ? "icra_sirket_takip" : "icra";
    if (!icraId) return NextResponse.json({ error: "icraId zorunlu" }, { status: 400 });

    const { data: kayit, error: kErr } = await sb.from(tablo).select("*").eq("id", icraId).single();
    if (kErr || !kayit) {
      return NextResponse.json({ error: sirket ? "Takip kaydı bulunamadı" : "İcra kaydı bulunamadı" }, { status: 404 });
    }

    // ── OTOMATİK GÖNDERİMDE İKİNCİ MAİL YOK ──
    // Gönderimi ana ekran kendiliğinden başlatıyor; aynı dosyayı aynı anda iki
    // kullanıcının ekranı tetikleyebilir ya da sayfa yenilenebilir. Kayıtta
    // gönderim izi varsa mail TEKRAR GÖNDERİLMEZ. Elle "Tekrar gönder" bu
    // kapıdan geçmez (otomatik gelmez) — orada tekrar göndermek istenen şeydir.
    if (otomatik && kayit.muhasebe_mail_at) {
      return NextResponse.json({
        gonderildi: false, zatenGonderildi: true,
        alicilar: String(kayit.muhasebe_mail_alici ?? "").split(",").map((x: string) => x.trim()).filter(Boolean),
        ek: kayit.muhasebe_mail_ek ?? "", gonderen: kayit.muhasebe_mail_gonderen ?? "",
        gonderildiAt: kayit.muhasebe_mail_at, kayitHatasi: null, antetInemedi: false,
      });
    }

    // ── ALICILAR ──
    // Tanımlamalar > muhasebe_email (bordro mailleriyle aynı liste). Tek tanımın
    // içinde virgülle birden fazla adres olabiliyor; hepsi ayrıştırılır.
    const { data: tanimlar } = await sb.from("tanimlamalar")
      .select("deger").eq("kategori", "muhasebe_email").eq("aktif", true).order("sira");
    const alicilar = [...new Set(((tanimlar ?? []) as { deger: string | null }[])
      .flatMap((t) => String(t.deger ?? "").split(/[,;]/))
      .map((e) => e.trim()).filter((e) => e.includes("@")))];
    if (alicilar.length === 0) {
      return NextResponse.json({
        error: "Muhasebe e-posta adresi tanımlı değil — mail GÖNDERİLMEDİ. "
          + "Yönetim → Tanımlamalar → muhasebe_email altına adres ekleyin.",
      }, { status: 400 });
    }

    // ── TEBLİGAT BELGESİ (EK İNMEDEN MAİL YOK) ──
    const ek = await icraTebligatBelgesi(sb, kayit, sirket,
      "Muhasebe, yazıyı görmeden borç durumunu çıkaramaz ve hesap ekstresini hazırlayamaz.");
    if (ek.hata) return NextResponse.json({ error: ek.hata.mesaj }, { status: ek.hata.kod });

    // ── GÖNDEREN FİRMA ──
    // Dosya hangi firmamıza aitse mail o firmadan ve o firmanın antetiyle gider.
    const firmaAdi = (sirket ? kayit.borclu_firma : kayit.ucuncu_sahis) as string | null;
    const { data: firma } = firmaAdi
      ? await sb.from("firmalar").select("firma_adi, smtp_user, antet_url, antet_renkli_url")
          .eq("firma_adi", firmaAdi).maybeSingle()
      : { data: null };
    const { tasiyici, gonderen } = await sistemTasiyici(sb, firma?.smtp_user || undefined);
    // Antet mailde RENKLİ gider; antet_url gri sürümdür (çıktılar için).
    const antet = await antetEki(firma?.antet_renkli_url || firma?.antet_url);

    // ── SON CEVAP / İTİRAZ GÜNÜ ──
    // MUHASEBEYE BU TARİH KIRMIZI GİDER: cevabı bekleyen bir süre var ve süre
    // muhasebe beklerken de işliyor. Tarihi yazmayan bir "bilgi için" maili
    // aciliyeti gizler.
    const sure = sirket
      ? (kayit.itiraz_suresi_gun as number | null)
      : (kayit.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI);
    const belgedenMi = sirket ? true : kayit.cevap_suresi_gun != null;
    const sonGun = kayit.teblig_tarihi && sure != null ? gunEkle(kayit.teblig_tarihi, sure) : null;
    const sonGunEtiket = sirket ? "Son itiraz günü" : "Son cevap günü";

    // ── KİM GÖNDERDİ? ──
    // OTOMATİK GÖNDERİMDE KİŞİ ADI YAZILMAZ: maili başlatan insan değil, panelin
    // kendisi — dosya cevap bekleyenlere düşünce gidiyor. O an ekranı açık olan
    // kullanıcının adını "gönderen" diye yazmak, yapmadığı bir işi ona mal eder
    // (10.11.2026: deneme mailinde "Ahmet Can KILINÇ" göründü, oysa kimse
    // göndermemişti). Kullanıcı kimliği yine kayda giriyor (gonderen_id) — hangi
    // oturumdan tetiklendiği izlenebilsin diye; ekranda görünen ad "Sistem".
    const gonderenAd = otomatik ? "Sistem (otomatik)" : kullanici.ad_soyad;
    // MAİLİN ALTINDA DA AYNI: otomatik mail bir kişi tarafından yazılmış gibi
    // imzalanmamalı. Muhasebe cevabı zaten bu kutuya dönüyor.
    const imza = otomatik ? (firma?.firma_adi ?? "İkikat") : kullanici.ad_soyad;

    // ── TEBLİGAT BİLGİSİ SATIRI ──
    // Çerçeveli ve zebra şeritli: bu blok BİZİM yazımız değil, belgeden gelen
    // bilgi. Aşağıdaki talep bloğuyla aynı görünseydi (10.11.2026'da öyleydi)
    // okuyan "hangisi tebligattan geliyor, benden ne isteniyor" diye ayırmak
    // için iki kere okumak zorunda kalıyordu.
    const satir = (etiket: string, deger: string, stil = "", tek = false) =>
      `<tr style="background:${tek ? "#ffffff" : "#f8fafc"}">`
      + `<td style="padding:7px 12px;color:#64748b;font-size:12px;white-space:nowrap;`
      + `border-bottom:1px solid #e2e8f0;width:40%">${etiket}</td>`
      + `<td style="padding:7px 12px;font-size:13px;border-bottom:1px solid #e2e8f0;${stil}">${deger}</td></tr>`;

    // Zebra için sıra sayacı — satırlar koşullu üretildiğinden elle sayılıyor.
    let n = 0;
    const sat = (etiket: string, deger: string, stil = "") => satir(etiket, deger, stil, (n++) % 2 === 1);

    // İSTENEN ŞEY AÇIK YAZILIR: muhasebenin ne döneceği maddelenmezse cevap
    // eksik geliyor ve dosya beklemede kalıyor.
    //
    // CEVAP ŞEKLİ MAİLDE SORULMUYOR (10.11.2026): "yazışma / havale / avukat"
    // maddesi kaldırıldı — muhasebe borç durumunu bildiriyor, şekli panelde
    // seçiliyor. ALTLIK = HESAP EKSTRESİ: "altlık" tek başına ne istendiğini
    // söylemiyordu; istenen şey cari hesap ekstresi.
    const md = "font-size:14px;color:#334155;margin:0 0 8px;line-height:1.5";
    const istek = sirket
      ? `<li style="${md}">Takip konusu borcun <strong>ödenip ödenmediği</strong>, ödendiyse ödeme tarihi ve tutarı</li>
         <li style="${md}">Ödenmemişse <strong>ödenecek mi, itiraz mı edilecek</strong> — avukata iletilmesi gerekiyorsa belirtiniz</li>
         <li style="${md}">Cevap/itiraz yazısına altlık olarak <strong>hesap ekstresi</strong></li>`
      : `<li style="${md}">Borçluya <strong>borcumuzun olup olmadığı</strong>, varsa tutarı</li>
         <li style="${md}">Cevap yazısına altlık olarak <strong>hesap ekstresi</strong></li>`;

    /** Tebligat bilgileri tablosunun başlık şeridi — bu blok BİZİM yazımız değil. */
    const baslikSerit = (metin: string) =>
      `<div style="background:#64748b;color:#ffffff;font-size:11px;font-weight:700;`
      + `letter-spacing:.8px;padding:7px 12px;border-radius:6px 6px 0 0">${metin}</div>`;

    // ══ MAİLİN İKİ YARISI ══
    //   1) TEBLİGAT BİLGİLERİ — belgeden gelen veri: çerçeveli, şeritli tablo
    //   2) TALEBİMİZ — bizim cümlemiz: çerçevesiz düz metin, bir punto büyük
    // Ayrım biçimden geliyor: kutulu olan belgeden, düz metin olan bizden.
    const html = `${antet.html}
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;color:#1E3A5F">
  <p style="font-size:15px;margin:0 0 12px">Sayın Muhasebe,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 20px;line-height:1.5">
    ${sirket
      ? "Şirketimize aşağıdaki ödeme emri tebliğ edilmiştir. Ödeme emrinin aslı ektedir."
      : "Tarafımıza aşağıdaki icra yazısı tebliğ edilmiştir. Tebligat yazısı ektedir."}
  </p>

  <!-- ① TEBLİGATTAN GELEN BİLGİLER (bilgi mahiyetinde) -->
  <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:24px">
    ${baslikSerit(sirket ? "ÖDEME EMRİ BİLGİLERİ" : "TEBLİGAT BİLGİLERİ")}
    <table style="border-collapse:collapse;width:100%">
      ${sat("Dosya esas no", kacar(kayit.dosya_esas_no), "font-weight:700")}
      ${sirket
        ? sat("İcra dairesi", kacar(kayit.icra_dairesi ?? "—"))
          + sat("Borçlu firma", kacar(kayit.borclu_firma ?? "—"))
        : sat("Üçüncü şahıs", kacar(kayit.ucuncu_sahis ?? "—"))
          + sat("Borçlu", kacar(kayit.borclu_adi ?? "—"))
          + sat("Borçlu TC / Vergi no", kacar(kayit.borclu_tc_no ?? "—"))}
      ${sat("Alacaklı", kacar(kayit.alacakli_adi ?? "—"))}
      ${sat("Tebliğ tarihi", gunTR(kayit.teblig_tarihi))}
      ${sat(sirket ? "Takip tutarı" : "Borç miktarı",
        `${paraTR(Number((sirket ? kayit.takip_tutari : kayit.borc_miktari) || 0))} TL`,
        "color:#dc2626;font-weight:700")}
      ${sat(sonGunEtiket,
        sonGun
          ? `${gunTR(sonGun)}${belgedenMi ? "" : " <span style=\"font-size:11px;font-weight:400;color:#64748b\">(belgede süre yazmıyor, 7 gün varsayıldı)</span>"}`
          : (sure == null ? "belgede süre yazmıyor" : "hesaplanamadı (tebliğ tarihi yok)"),
        "color:#dc2626;font-weight:700")}
    </table>
  </div>

  <!-- ② BİZİM TALEBİMİZ — ÇERÇEVESİZ, DÜZ METİN.
       Kutu içindeyken bu da "belgeden gelen bir blok" gibi duruyordu; oysa
       bizim yazımız. Çerçeve yalnız tebligat bilgilerinde kaldı: kutulu olan
       veri, düz metin olan bizim cümlemiz. Yazı bir punto büyük (14px) —
       asıl okunması gereken kısım burası. -->
  <p style="font-size:14px;margin:0 0 10px;color:#1E3A5F;line-height:1.5">
    Aşağıdaki hususların tarafımıza bildirilmesini rica ederiz:
  </p>
  <ul style="margin:0 0 14px;padding-left:20px">${istek}</ul>
  <p style="font-size:14px;color:#b91c1c;margin:0 0 20px;line-height:1.5">
    ${sonGun
      ? `Cevabın icra dairesine <strong>${gunTR(sonGun)}</strong> tarihine kadar verilmesi gerektiğinden, `
        + `bildiriminizi bu tarihten önce iletmenizi rica ederiz.`
      : "Süre işlemekte olduğundan bildiriminizi en kısa sürede iletmenizi rica ederiz."}
  </p>

  ${(not ?? "").trim() ? `<div style="border-left:3px solid #94a3b8;background:#f8fafc;padding:10px 12px;margin-bottom:20px">
    <div style="font-size:11px;color:#64748b;margin-bottom:3px">Not</div>
    <div style="font-size:13px;white-space:pre-wrap">${kacar((not ?? "").trim())}</div>
  </div>` : ""}

  <p style="font-size:15px;margin:0">
    İyi çalışmalar,<br>
    <strong>${kacar(imza)}</strong>
  </p>
</div>`;

    await tasiyici.sendMail({
      from: `"${firma?.firma_adi ?? "İkikat"}" <${gonderen}>`,
      to: alicilar.join(", "),
      subject: `${sirket ? "Ödeme emri" : "İcra yazısı"} ${kayit.dosya_esas_no} — borç durumu ve hesap ekstresi`
        + (sonGun ? ` · ${sonGunEtiket.toLocaleLowerCase("tr")} ${gunTR(sonGun)}` : ""),
      html,
      attachments: [
        ...(antet.ek ? [antet.ek] : []),
        { filename: ek.belge.ad, content: ek.icerik },
      ],
    });

    // Mail GİTTİKTEN SONRA yazılır: gitmediyse dosya "gönderilmedi" kalmalı.
    const simdi = new Date().toISOString();
    const { error: gErr } = await sb.from(tablo).update({
      muhasebe_mail_at: simdi,
      muhasebe_mail_ek: ek.belge.ad,
      // ADRESİN ANLIK KOPYASI: tanımlar sonradan değişse de "bu dosya kime
      // gitmişti" sorusu cevaplanabilsin.
      muhasebe_mail_alici: alicilar.join(", "),
      muhasebe_mail_gonderen: gonderenAd,
      muhasebe_mail_gonderen_id: kullanici.id,
      muhasebe_mail_sayisi: (kayit.muhasebe_mail_sayisi ?? 0) + 1,
      updated_at: simdi,
    }).eq("id", icraId);

    const { error: logErr } = await sb.from("icra_muhasebe_mail_log").insert({
      ...(sirket ? { sirket_takip_id: icraId } : { icra_id: icraId }),
      alici: alicilar.join(", "),
      gonderen_id: kullanici.id, gonderen_ad: gonderenAd,
      ek_ad: ek.belge.ad,
    });

    return NextResponse.json({
      gonderildi: true,
      alicilar,
      ek: ek.belge.ad,
      gonderen: gonderenAd,
      gonderildiAt: simdi,
      // SESSİZ GEÇİLMEZ: mail gitti ama kayıt/günlük yazılamadıysa kullanıcı
      // bilmeli, yoksa dosya gönderilmemiş görünür ve ikinci kez gönderilir.
      kayitHatasi: gErr ? gErr.message : (logErr ? `gönderim günlüğü yazılamadı: ${logErr.message}` : null),
      antetInemedi: antet.inemedi,
    });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error("[icra/muhasebeye-gonder]", mesaj);
    return NextResponse.json({ error: `Mail gönderilemedi: ${mesaj}` }, { status: 500 });
  }
}
