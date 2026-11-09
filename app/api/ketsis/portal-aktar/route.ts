// KETSİS PORTAL AKTARIMI — Dijital Vergi Dairesi'nde çalışan yer iminin yazdığı kapı.
//
// NİYE AYRI BİR KAPI: bu isteği tarayıcı, panelin kendi sayfasından değil
// dijital.gib.gov.tr sayfasından atıyor. Oturum çerezimiz oraya gitmez; bu yüzden
// kimlik, kullanıcıya özel ANAHTAR ile doğrulanıyor (bkz. sql/ketsis_portal.sql).
// Anahtar kullanıcı şifresi değildir, yalnız bu işe yarar, tek tıkla iptal edilir ve
// veritabanında yalnız sha256 özeti durur.
//
// CORS: yalnız https://dijital.gib.gov.tr'ye açık. Başka hiçbir site bu kapıya
// tarayıcıdan ulaşamaz. (Sunucudan ulaşılabilir ama anahtarsız hiçbir şey yapamaz.)
//
// NE YAZILIR: yalnız LİSTE bilgisi — belge no, kurum, tarihler. Belge İNDİRİLMEZ;
// yer imi de indirmiyor. İndirmek tebligatı açmak demek olurdu, o karar insanın.
//
// SESSİZ BAŞARI YOK: kaç kayıt geldi, kaçı yeni, kaçı atlandı ve NİYE atlandı —
// hepsi cevapta dönüyor ve yer imi bunu ekranda gösteriyor. "Aktarıldı" deyip hiçbir
// şey yazmamak, en tehlikeli sonuç olurdu.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const KAYNAK = "https://dijital.gib.gov.tr";

const basliklar = {
  "Access-Control-Allow-Origin": KAYNAK,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

const yanit = (govde: unknown, durum = 200) =>
  NextResponse.json(govde, { status: durum, headers: basliklar });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: basliklar });
}

function servis(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return null;
  return createClient(url, anahtar, { auth: { persistSession: false } });
}

/** GİB'in "27/10/2026 15:19:06" ya da ISO biçimini YYYY-MM-DD'ye çevirir. */
function tarih(ham: string | null | undefined): string | null {
  if (!ham) return null;
  const tr = ham.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (tr) return `${tr[3]}-${tr[2]}-${tr[1]}`;
  const iso = ham.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

type PortalKayit = {
  tebligId?: string; belgeNo?: string; kurumAciklama?: string; altKurum?: string;
  belgeTuruAciklama?: string; kayitZamani?: string; tebligZamani?: string;
  mukellefOkumaZamani?: string; gerceklesenOtomatikOkunmaZamani?: string;
};

export async function POST(request: Request) {
  const sb = servis();
  if (!sb) return yanit({ error: "Supabase yapılandırması eksik" }, 500);

  const g = (await request.json().catch(() => ({}))) as {
    anahtar?: string; vkn?: string; kayitlar?: PortalKayit[];
  };

  // ───────── kimlik ─────────
  if (!g.anahtar) return yanit({ error: "Anahtar yok. Yer imini panelden yeniden üretin." }, 401);
  const ozet = createHash("sha256").update(g.anahtar).digest("hex");
  const { data: sahip, error: anahtarHata } = await sb
    .from("ketsis_portal_anahtar").select("kullanici_id").eq("anahtar_ozet", ozet).maybeSingle();
  // Hata YUTULMAZ: "anahtar yanlış" ile "veritabanı patladı" aynı şey değil.
  if (anahtarHata) return yanit({ error: `Anahtar doğrulanamadı: ${anahtarHata.message}` }, 500);
  if (!sahip) return yanit({ error: "Anahtar tanınmadı. Panelden yeni yer imi üretin." }, 401);

  const { data: kul } = await sb.from("kullanicilar")
    .select("ad_soyad").eq("id", sahip.kullanici_id).maybeSingle();

  const kayitlar = Array.isArray(g.kayitlar) ? g.kayitlar : [];
  const durumYaz = async (sonuc: string) => {
    await sb.from("ketsis_portal_anahtar")
      .update({ son_kullanim: new Date().toISOString(), son_sonuc: sonuc.slice(0, 500) })
      .eq("kullanici_id", sahip.kullanici_id);
  };

  if (kayitlar.length === 0) {
    await durumYaz("0 kayıt geldi");
    return yanit({ ok: true, gelen: 0, yeni: 0, atlanan: [], mesaj: "Portaldan hiç kayıt gelmedi." });
  }

  // ───────── firma: VKN'den, TAHMİNLE DEĞİL ─────────
  // VKN eşleşmiyorsa firma BOŞ bırakılır ve ekranda "belirsiz" görünür. Yanlış firmaya
  // bağlanmış bir tebligat, bağlanmamış olandan çok daha zararlı.
  let firmaId: string | null = null;
  const vkn = (g.vkn ?? "").replace(/\D/g, "");
  if (vkn) {
    const { data: f } = await sb.from("firmalar").select("id").eq("vergi_no", vkn).maybeSingle();
    firmaId = f?.id ?? null;
  }

  // ───────── satırlar ─────────
  const satirlar = [];
  const atlanan: string[] = [];
  for (const k of kayitlar) {
    const ulasma = tarih(k.kayitZamani);
    if (!k.tebligId || !ulasma) {
      // SESSİZ ATLAMA YOK: hangi kaydın niye girmediği söylenir.
      atlanan.push(`${k.belgeNo ?? "belge no yok"} — ${!k.tebligId ? "kimlik yok" : "ulaşma tarihi okunamadı"}`);
      continue;
    }
    const kurum = [k.kurumAciklama, k.altKurum].filter(Boolean).join(" · ") || null;
    satirlar.push({
      firma_id: firmaId,
      kaynak: "portal",
      portal_teblig_id: k.tebligId,
      belge_no: k.belgeNo ?? null,
      kurum,
      vergi_dairesi: kurum,             // ekrandaki "Vergi dairesi" sütunu bunu gösteriyor
      belge_turu: k.belgeTuruAciklama ?? null,
      konu: k.belgeTuruAciklama ?? null,
      ulasma_tarihi: ulasma,
      portal_teblig_tarihi: tarih(k.tebligZamani),
      portal_okuma_at: k.mukellefOkumaZamani
        ? new Date(tarih(k.mukellefOkumaZamani) + "T00:00:00").toISOString() : null,
      // PORTALDA AÇILMIŞSA burada da açılmış sayılır — "kim açtı" bilgisi portalda yok,
      // o yüzden okuyan adı yazılmıyor; uydurulmuyor da.
      okundu_at: k.mukellefOkumaZamani
        ? new Date(tarih(k.mukellefOkumaZamani) + "T00:00:00").toISOString() : null,
      kaydeden_id: sahip.kullanici_id,
      kaydeden_ad: kul?.ad_soyad ?? null,
    });
  }

  const { data: oncekiler } = await sb.from("ketsis_tebligat")
    .select("portal_teblig_id").in("portal_teblig_id", satirlar.map((s) => s.portal_teblig_id));
  const bilinen = new Set((oncekiler ?? []).map((r) => r.portal_teblig_id));
  const yeniSayi = satirlar.filter((s) => !bilinen.has(s.portal_teblig_id)).length;

  const { error } = await sb.from("ketsis_tebligat")
    .upsert(satirlar, { onConflict: "portal_teblig_id" });
  if (error) {
    await durumYaz(`HATA: ${error.message}`);
    return yanit({ error: `Deftere yazılamadı: ${error.message}` }, 500);
  }

  // Bu aktarım aynı zamanda bir "baktım" kaydıdır: kişi portala girip listeyi görmüştür.
  await sb.from("ketsis_kontrol").insert({
    kullanici_id: sahip.kullanici_id, kullanici_ad: kul?.ad_soyad ?? null,
    bulgu: satirlar.length > 0 ? "tebligat_var" : "temiz",
    notlar: `Portal aktarımı: ${satirlar.length} kayıt (${yeniSayi} yeni)`,
  });

  const ozetMetin = `${satirlar.length} kayıt · ${yeniSayi} yeni`
    + (atlanan.length ? ` · ${atlanan.length} atlandı` : "")
    + (firmaId ? "" : " · firma eşleşmedi");
  await durumYaz(ozetMetin);

  return yanit({
    ok: true,
    gelen: kayitlar.length,
    yazilan: satirlar.length,
    yeni: yeniSayi,
    atlanan,
    firmaEslesti: !!firmaId,
    mesaj: ozetMetin,
  });
}
