// Personel işe giriş / işten çıkış BİLDİRGE takibi — dashboard okuma sorguları.
// Kayıtlar app/api/bordro-mail-bulk tarafından açılır, scripts/personel-bildirge-sync tarafından kapatılır.
import { createClient } from "@/lib/supabase/client";
import { sicilEslesir } from "@/lib/personel/sicil";

export type PersonelIslemTakip = {
  id: string;
  personel_ad: string;
  personel_tc: string | null;
  tip: "giris" | "cikis";
  islem_tarihi: string | null;
  gonderim_tarihi: string; // YYYY-MM-DD
  durum: "bekliyor" | "tamamlandi" | "iptal";
  uyusmazlik: string | null;      // gelen bildirge kayıtla tutmuyorsa açıklama (ör. tarih farkı / sicil)
  uyusmazlik_tip: "tarih" | "sicil_yok" | "sicil_farkli" | null; // uyarı türü → hangi buton gösterilecek
  bildirge_tarihi: string | null; // tarih uyuşmazlığında: bildirgedeki resmi giriş/çıkış tarihi (YYYY-MM-DD)
  cevap_sicil: string | null;     // bildirgeden okunan işyeri sicil no ("sicili gir ve kapat" için)
  sicil_santiye_id: string | null; // boş sicilin yazılacağı şantiye (iscilik_takibi hedefi)
  created_by_ad: string | null;
  created_at: string;
  // Dashboard gösterimi için TC→personel→atama→şantiye ile ÇÖZÜLEN alanlar (DB'de tutulmaz):
  santiye_id?: string | null;      // kişinin bu işleme ait şantiye id'si (kısıtlı kullanıcı görünürlük filtresi için)
  santiye_ad?: string | null;      // kişinin bu işleme ait şantiyesi (is_adi)
  santiye_sicil?: string | null;   // o şantiyenin iscilik_takibi.sicil_no'su
};

// Cevabı bekleyen (bildirgesi gelmemiş) talepler — en eskiden yeniye (en geciken üstte).
// Her kayıt için kişinin ŞANTİYESİ ve o şantiyenin SİCİL numarası TOPLU (batch) çözülür:
// TC → personel → personel_atama_gecmisi (giriş=baslangic, çıkış=bitis == islem_tarihi; yoksa en güncel)
// → santiyeler.is_adi + iscilik_takibi.sicil_no. 4 toplu sorgu (kayıt sayısından bağımsız).
export async function getBekleyenBildirgeler(): Promise<PersonelIslemTakip[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("personel_islem_takip")
    .select("id, personel_ad, personel_tc, tip, islem_tarihi, gonderim_tarihi, durum, uyusmazlik, uyusmazlik_tip, bildirge_tarihi, cevap_sicil, sicil_santiye_id, created_by_ad, created_at")
    .eq("durum", "bekliyor")
    .order("gonderim_tarihi", { ascending: true });
  if (error) return []; // tablo yoksa / RLS → sessiz (dashboard kartı gizlenir)
  const kayitlar = (data ?? []) as PersonelIslemTakip[];
  if (kayitlar.length === 0) return kayitlar;

  try {
    const tcNorm = (s: string | null) => (s ?? "").replace(/\D/g, "");
    const tcler = [...new Set(kayitlar.map((k) => tcNorm(k.personel_tc)).filter((t) => t.length === 11))];
    if (tcler.length === 0) return kayitlar;

    // 1) TC → personel id
    const { data: personeller } = await supabase.from("personel").select("id, tc_kimlik_no").in("tc_kimlik_no", tcler);
    const tcToPid = new Map<string, string>();
    for (const p of (personeller ?? []) as { id: string; tc_kimlik_no: string }[]) tcToPid.set(tcNorm(p.tc_kimlik_no), p.id);
    const pidler = [...new Set([...tcToPid.values()])];
    if (pidler.length === 0) return kayitlar;

    // 2) Atamalar (personel → şantiye + tarih)
    const { data: atamalar } = await supabase
      .from("personel_atama_gecmisi").select("personel_id, santiye_id, baslangic_tarihi, bitis_tarihi").in("personel_id", pidler);
    const atamaByPid = new Map<string, { santiye_id: string; baslangic_tarihi: string; bitis_tarihi: string | null }[]>();
    for (const a of (atamalar ?? []) as { personel_id: string; santiye_id: string; baslangic_tarihi: string; bitis_tarihi: string | null }[]) {
      const arr = atamaByPid.get(a.personel_id) ?? []; arr.push(a); atamaByPid.set(a.personel_id, arr);
    }
    // Kayıt → şantiye seç: tip'e göre tarih eşleşen atama; yoksa en güncel (baslangic'e göre).
    const kayitSantiye = (k: PersonelIslemTakip): string | null => {
      const pid = tcToPid.get(tcNorm(k.personel_tc)); if (!pid) return null;
      const list = atamaByPid.get(pid) ?? []; if (list.length === 0) return null;
      const alan = k.tip === "cikis" ? "bitis_tarihi" : "baslangic_tarihi";
      const tam = k.islem_tarihi ? list.find((a) => (a as unknown as Record<string, string | null>)[alan] === k.islem_tarihi) : null;
      if (tam) return tam.santiye_id;
      return [...list].sort((a, b) => (b.baslangic_tarihi ?? "").localeCompare(a.baslangic_tarihi ?? ""))[0]?.santiye_id ?? null;
    };
    const santiyeIds = [...new Set(kayitlar.map(kayitSantiye).filter((x): x is string => !!x))];
    if (santiyeIds.length === 0) return kayitlar;

    // 3) Şantiye adları + 4) işçilik takibi sicilleri (toplu)
    const [{ data: santiyeler }, { data: iscilikler }] = await Promise.all([
      supabase.from("santiyeler").select("id, is_adi").in("id", santiyeIds),
      supabase.from("iscilik_takibi").select("santiye_id, sicil_no").in("santiye_id", santiyeIds),
    ]);
    const adById = new Map<string, string | null>();
    for (const s of (santiyeler ?? []) as { id: string; is_adi: string | null }[]) adById.set(s.id, s.is_adi);
    const sicilBySid = new Map<string, string | null>();
    for (const it of (iscilikler ?? []) as { santiye_id: string; sicil_no: string | null }[]) sicilBySid.set(it.santiye_id, it.sicil_no);

    for (const k of kayitlar) {
      const sid = kayitSantiye(k);
      k.santiye_id = sid ?? null;
      k.santiye_ad = sid ? (adById.get(sid) ?? null) : null;
      k.santiye_sicil = sid ? (sicilBySid.get(sid) ?? null) : null;
    }
  } catch { /* zenginleştirme opsiyonel — hata olsa da temel liste döner */ }

  // ── ÖZ-İYİLEŞTİRME: sicil uyarılı (sicil_yok/sicil_farkli) bir kaydın şantiyesine sicil ARTIK girilmiş ve
  // bildirge siciliyle EŞLEŞİYORSA o kaydı otomatik kapat. Böylece bir kişide "Sicili gir ve kapat" deyince
  // (ya da işçilik takibinden elle girilince), aynı şantiyenin DİĞER bekleyen kayıtları tekrar sormaz —
  // sayfa yenilenince kendiliğinden düşer. Yalnız çözülecek kayıt varsa yazma yapar.
  try {
    const sicilKayit = kayitlar.filter((k) =>
      (k.uyusmazlik_tip === "sicil_yok" || k.uyusmazlik_tip === "sicil_farkli") && k.sicil_santiye_id && k.cevap_sicil);
    if (sicilKayit.length > 0) {
      const sids = [...new Set(sicilKayit.map((k) => k.sicil_santiye_id as string))];
      const { data: itData } = await supabase.from("iscilik_takibi").select("santiye_id, sicil_no").in("santiye_id", sids);
      const guncelSicil = new Map<string, string | null>();
      for (const it of (itData ?? []) as { santiye_id: string; sicil_no: string | null }[]) guncelSicil.set(it.santiye_id, it.sicil_no);
      const cozulen = sicilKayit
        .filter((k) => { const gs = guncelSicil.get(k.sicil_santiye_id as string); return gs && sicilEslesir(gs, k.cevap_sicil); })
        .map((k) => k.id);
      if (cozulen.length > 0) {
        await supabase.from("personel_islem_takip")
          .update({ durum: "tamamlandi", uyusmazlik: null, uyusmazlik_tip: null, cevap_tarihi: new Date().toISOString() })
          .in("id", cozulen).eq("durum", "bekliyor");
        const cozSet = new Set(cozulen);
        return kayitlar.filter((k) => !cozSet.has(k.id));
      }
    }
  } catch { /* öz-iyileştirme opsiyonel */ }

  return kayitlar;
}

// "Düzelt" — gelen bildirgedeki resmi tarihi kabul et: HEM bordroyu (personel_atama_gecmisi tarihi)
// HEM takip kaydını düzeltir. Sunucu route'u TC→personel→atama eşlemesini yapıp güvenilir günceller.
export async function bildirgeTarihiniKabulEt(id: string): Promise<{ ok: boolean; atamaGuncellendi: number }> {
  try {
    const r = await fetch("/api/personel-bildirge/duzelt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j?.ok === true, atamaGuncellendi: j?.atamaGuncellendi ?? 0 };
  } catch {
    return { ok: false, atamaGuncellendi: 0 };
  }
}

// ADMIN — bekleyen bir işlemi "kaldır" (iptal): aynı gün giriş+çıkış gibi durumlarda muhasebe işlem yapmaz,
// bildirge hiç gelmez → kayıt durum='iptal' yapılır (silinmez, denetim için kalır). Sync bir daha dokunmaz.
export async function bildirgeyiIptalEt(id: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("personel_islem_takip")
    .update({ durum: "iptal", cevap_tarihi: new Date().toISOString(), uyusmazlik: null, uyusmazlik_tip: null })
    .eq("id", id).eq("durum", "bekliyor");
  return !error;
}

// Sicil uyarısını "yine de kapat" ile onayla. yazSicil=true ise (yalnız sicil_yok durumunda anlamlı)
// bildirgedeki sicil, kaydın şantiyesinin iscilik_takibi.sicil_no'suna yazılır. Route service-role ile
// hem işçilik takibini doldurur hem takip kaydını tamamlandı yapar.
export async function bildirgeSiciliniOnayla(id: string, yazSicil: boolean): Promise<{ ok: boolean; sicilYazildi: boolean; kardesKapatildi: number }> {
  try {
    const r = await fetch("/api/personel-bildirge/onayla", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, yazSicil }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j?.ok === true, sicilYazildi: j?.sicilYazildi === true, kardesKapatildi: j?.kardesKapatildi ?? 0 };
  } catch {
    return { ok: false, sicilYazildi: false, kardesKapatildi: 0 };
  }
}
