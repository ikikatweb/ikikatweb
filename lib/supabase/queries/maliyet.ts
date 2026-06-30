// Maliyet Raporu sorguları — şantiye bazlı yıllık maliyet kalemleri.
// Kalemler:
//  1. Nakit harcama  → kasa_hareketi (tip=gider, odeme_yontemi=nakit)
//  2. K.K. harcama   → kasa_hareketi (tip=gider, odeme_yontemi=kart)
//  3. Personel gideri→ puantaj/atama günü × ücret (brüt ücret varsa o, yoksa yıllık günlük ücret)
//     — bordro/prim sayfalarıyla AYNI model (gunHesaplaAyBazli × personelUcret).
//  4. SGK gideri     → Yüklenici Prim Esas Kazanç (İşçilik "Yüklenici Veri Girişi") × 0,375
//  5. Yakıt gideri   → araçlara verilen toplam lt (arac_yakit) × o ŞANTİYENİN en son alım birim fiyatı
//  6. Makine kira    → kira bedeli girilmiş araç (tip'e bakılmaz); DIŞ GÖREV HARİÇ tüm puantaj günleri × bedel/30 (çalışsın/çalışmasın araç kirada → her gün tam bedel; yalnız dis_gorev hariç)
//  7. Bakım/Onarım   → arac_bakim tutarı (yedek parça+bakım+tamirat), bakım tarihindeki araç puantaj şantiyesine
import { createClient } from "@/lib/supabase/client";
import { gunHesaplaAyBazli } from "./bordro";
import type { AracKiraBedeli, PersonelAtamaGecmisi, PersonelAtamaManuelGun } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// İşveren + işçi toplam SGK prim oranı (prim esas kazanç üzerinden).
export const SGK_ORAN = 0.375;

export type MaliyetSatir = {
  santiyeId: string;
  isAdi: string;
  nakit: number;
  kart: number;
  personel: number;
  sgk: number;
  yakit: number;
  makineKira: number;
  bakim: number;
  toplam: number;
};

export type MaliyetRapor = {
  satirlar: MaliyetSatir[];
};

// ait_oldugu_ay → YYYY*100+MM (format: "MM.YYYY" veya "YYYY-MM")
function ayYilNum(s: string): number {
  if (!s) return 0;
  const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
  if (mm) return parseInt(mm[2], 10) * 100 + parseInt(mm[1], 10);
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return parseInt(iso[1], 10) * 100 + parseInt(iso[2], 10);
  return 0;
}

// Bir kira-bedeli geçmişinden (gecerli_tarih DESC sıralı) verilen tarihte geçerli aylık bedeli bul.
function etkinKiraBedeli(rates: AracKiraBedeli[] | undefined, tarih: string): number {
  if (!rates || rates.length === 0) return 0;
  for (const r of rates) { // DESC: ilk gecerli_tarih <= tarih olan
    if (r.gecerli_tarih <= tarih) return r.aylik_bedel ?? 0;
  }
  return rates[rates.length - 1].aylik_bedel ?? 0; // hepsi sonraysa en eski tarifeyi kullan
}

// Sayfalı tam çekim (Supabase 1000 satır limitini aş)
async function tumSatirlar<T>(
  build: (offset: number, parca: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const PARCA = 1000;
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await build(offset, PARCA);
    if (error) throw error;
    const parca = (data ?? []) as T[];
    out.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 200000) break;
  }
  return out;
}

// bas, bit: "YYYY-MM-DD". Yıl bazlı kullanım için bas=`${yil}-01-01`, bit=`${yil}-12-31` geçilir.
export async function getMaliyetRaporu(bas: string, bitIstenen: string): Promise<MaliyetRapor> {
  const supabase = getSupabase();
  // Bugünü aşma: gelecek tarihli aralıkta (ör. cari yılın kalan ayları) henüz oluşmamış maliyet sayılmaz.
  const now = new Date();
  const bugunStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const bit = bitIstenen > bugunStr ? bugunStr : bitIstenen;
  const basNum = ayYilNum(bas.slice(0, 7)); // YYYYMM
  const bitNum = ayYilNum(bit.slice(0, 7));

  // ── Şantiyeler ──
  const santiyeler = await tumSatirlar<{ id: string; is_adi: string }>((o, p) =>
    supabase.from("santiyeler").select("id, is_adi").range(o, o + p - 1),
  );
  const satirMap = new Map<string, MaliyetSatir>();
  for (const s of santiyeler) {
    satirMap.set(s.id, {
      santiyeId: s.id, isAdi: s.is_adi,
      nakit: 0, kart: 0, personel: 0, sgk: 0, yakit: 0, makineKira: 0, bakim: 0, toplam: 0,
    });
  }
  const sat = (santiyeId: string | null | undefined): MaliyetSatir | null =>
    santiyeId ? satirMap.get(santiyeId) ?? null : null;

  // ── 1+2. Kasa harcamaları (nakit / kart) ──
  const kasa = await tumSatirlar<{ santiye_id: string; tip: string; odeme_yontemi: string; tutar: number }>((o, p) =>
    supabase.from("kasa_hareketi").select("santiye_id, tip, odeme_yontemi, tutar")
      .gte("tarih", bas).lte("tarih", bit).eq("tip", "gider").range(o, o + p - 1),
  );
  for (const h of kasa) {
    const r = sat(h.santiye_id);
    if (!r) continue;
    if (h.odeme_yontemi === "nakit") r.nakit += h.tutar ?? 0;
    else if (h.odeme_yontemi === "kart") r.kart += h.tutar ?? 0;
  }

  // ── 3+4. Personel gideri + SGK ──
  // Model: her ay, her personelin her şantiyedeki puantaj/atama günü × ücret.
  // ücret = brüt ücret (varsa) yoksa o yılın günlük ücreti. Manuel gün girişleri (varsa)
  // doğal hesabın yerine geçer (personel|ay bazında) — prim-hesap.ts ile aynı mantık.
  const atamalar = await tumSatirlar<PersonelAtamaGecmisi>((o, p) =>
    supabase.from("personel_atama_gecmisi").select("*").range(o, o + p - 1),
  );
  const manuelGunler = await tumSatirlar<PersonelAtamaManuelGun>((o, p) =>
    supabase.from("personel_atama_manuel_gun").select("*").range(o, o + p - 1),
  );
  // Maaş kaynağı: Personeller tablosundaki "Maaş" (personel.maas; yoksa brut_ucret). Tek güncel değer.
  const personeller = await tumSatirlar<{ id: string; maas: number | null; brut_ucret: number | null }>((o, p) =>
    supabase.from("personel").select("id, maas, brut_ucret").range(o, o + p - 1),
  );
  const maasMap = new Map<string, number>();
  for (const x of personeller) maasMap.set(x.id, x.maas ?? x.brut_ucret ?? 0);

  // GÜNLÜK kazanç = personele tanımlı aylık maaş ÷ 30. Maaşı TANIMLI OLMAYAN personel
  // hesaba KATILMAZ (0). Personel gideri = bu × puantaj günü.
  const personelUcret = (personelId: string): number => {
    const maas = maasMap.get(personelId) ?? 0;
    return maas > 0 ? maas / 30 : 0;
  };

  const dahilEdilen = new Set<string>(); // personel|ay → manuel ile işlendi, doğal hesapta atla

  // Aralığa clamp'li gün sayımı — kısmi/kenar aylarda kullanılır (tam aylarda gunHesaplaAyBazli).
  const gunFarkiL = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000) + 1);
  const clampGunler = (subStart: string, subEnd: string): Map<string, Map<string, number>> => {
    const res = new Map<string, Map<string, number>>();
    for (const at of atamalar) {
      const aBit = at.bitis_tarihi ?? bugunStr; // aktif atama → bugüne kadar
      if (at.baslangic_tarihi > subEnd || aBit < subStart) continue;
      const cs = at.baslangic_tarihi > subStart ? at.baslangic_tarihi : subStart;
      const ce = aBit < subEnd ? aBit : subEnd;
      const gun = gunFarkiL(cs, ce);
      if (gun <= 0) continue;
      if (!res.has(at.personel_id)) res.set(at.personel_id, new Map());
      const inner = res.get(at.personel_id)!;
      inner.set(at.santiye_id, (inner.get(at.santiye_id) ?? 0) + gun);
    }
    return res;
  };

  // 1) Manuel gün girişleri (aralıktaki aylar)
  for (const m of manuelGunler) {
    const n = ayYilNum(m.ay);
    if (n < basNum || n > bitNum) continue;
    const r = sat(m.santiye_id);
    const ucret = personelUcret(m.personel_id);
    if (r && ucret > 0) r.personel += (m.gun ?? 0) * ucret;
    dahilEdilen.add(`${m.personel_id}|${m.ay}`);
  }

  // 2) Doğal atama hesabı — aralıktaki her ay (tam ay → SGK-30 modeli; kenar/kısmi ay → aralığa clamp)
  {
    let y = Math.floor(basNum / 100);
    let ay = basNum % 100;
    while (y * 100 + ay <= bitNum) {
      const ayStr = `${y}-${String(ay).padStart(2, "0")}`;
      const sonGun = new Date(y, ay, 0).getDate();
      const ayBas = `${ayStr}-01`;
      const ayBit = `${ayStr}-${String(sonGun).padStart(2, "0")}`;
      const subStart = ayBas < bas ? bas : ayBas;
      const subEnd = ayBit > bit ? bit : ayBit;
      const tamAy = subStart === ayBas && subEnd === ayBit;
      const ayHesap = tamAy ? gunHesaplaAyBazli(atamalar, ayStr) : clampGunler(subStart, subEnd);
      for (const [pId, sMap] of ayHesap) {
        if (dahilEdilen.has(`${pId}|${ayStr}`)) continue;
        const ucret = personelUcret(pId);
        if (ucret <= 0) continue;
        for (const [santiyeId, gun] of sMap) {
          if (gun <= 0) continue;
          const r = sat(santiyeId);
          if (r) r.personel += gun * ucret;
        }
      }
      ay += 1;
      if (ay > 12) { ay = 1; y += 1; }
    }
  }
  // SGK = Yüklenici Prim Esas Kazanç (İşçilik Durum Raporu "Yüklenici Veri Girişi", aralıktaki aylar) × 0,375
  const takipler = await tumSatirlar<{ id: string; santiye_id: string }>((o, p) =>
    supabase.from("iscilik_takibi").select("id, santiye_id").range(o, o + p - 1),
  );
  const takibiSantiye = new Map<string, string>();
  for (const t of takipler) takibiSantiye.set(t.id, t.santiye_id);
  const ayliklar = await tumSatirlar<{ iscilik_takibi_id: string; ait_oldugu_ay: string; yuklenici_tutar: number | null }>((o, p) =>
    supabase.from("iscilik_aylik").select("iscilik_takibi_id, ait_oldugu_ay, yuklenici_tutar").range(o, o + p - 1),
  );
  for (const a of ayliklar) {
    const n = ayYilNum(a.ait_oldugu_ay);
    if (n < basNum || n > bitNum) continue;
    const r = sat(takibiSantiye.get(a.iscilik_takibi_id));
    if (r) r.sgk += (a.yuklenici_tutar ?? 0) * SGK_ORAN;
  }

  // ── 5. Yakıt gideri (verilen lt × o ŞANTİYENİN en son alım birim fiyatı) ──
  // Her şantiyenin yakıt fiyatı farklı → her şantiye için en son "Yakıt Al" kaydının birim fiyatı.
  const alimlar = await tumSatirlar<{ santiye_id: string; birim_fiyat: number; tedarikci_firma: string; tarih: string; saat: string }>((o, p) =>
    supabase.from("yakit_alim").select("santiye_id, birim_fiyat, tedarikci_firma, tarih, saat")
      .order("tarih", { ascending: false }).order("saat", { ascending: false }).range(o, o + p - 1),
  );
  const sonFiyatMap = new Map<string, number>(); // santiye → en son geçerli birim fiyat (Düzeltme/0 hariç)
  for (const a of alimlar) { // tarih/saat DESC → her şantiye için İLK rastlanan = en son fiyat
    if ((a.birim_fiyat ?? 0) <= 0 || a.tedarikci_firma === "Düzeltme") continue;
    if (!sonFiyatMap.has(a.santiye_id)) sonFiyatMap.set(a.santiye_id, a.birim_fiyat);
  }
  // Kendi alımı OLMAYAN şantiye → yakıtı virmanla geldiği (GÖNDEREN) şantiyenin en son fiyatıyla hesapla.
  const virmanlar = await tumSatirlar<{ gonderen_santiye_id: string; alan_santiye_id: string; tarih: string; saat: string }>((o, p) =>
    supabase.from("yakit_virman").select("gonderen_santiye_id, alan_santiye_id, tarih, saat")
      .order("tarih", { ascending: false }).order("saat", { ascending: false }).range(o, o + p - 1),
  );
  const sonGonderen = new Map<string, string>(); // alan santiye → en son gönderen santiye
  for (const v of virmanlar) {
    if (!sonGonderen.has(v.alan_santiye_id)) sonGonderen.set(v.alan_santiye_id, v.gonderen_santiye_id);
  }
  const etkinFiyat = (santiyeId: string): number => {
    if (sonFiyatMap.has(santiyeId)) return sonFiyatMap.get(santiyeId)!; // kendi alım fiyatı
    const gonderen = sonGonderen.get(santiyeId);                         // virman kaynağının fiyatı
    if (gonderen && sonFiyatMap.has(gonderen)) return sonFiyatMap.get(gonderen)!;
    return 0;
  };
  const yakitlar = await tumSatirlar<{ santiye_id: string; miktar_lt: number; duzeltme: boolean | null }>((o, p) =>
    supabase.from("arac_yakit").select("santiye_id, miktar_lt, duzeltme")
      .gte("tarih", bas).lte("tarih", bit).range(o, o + p - 1),
  );
  for (const y of yakitlar) {
    if (y.duzeltme === true) continue; // düzeltme kaydı = gerçek dolum değil
    const r = sat(y.santiye_id);
    if (r) r.yakit += (y.miktar_lt ?? 0) * etkinFiyat(y.santiye_id);
  }

  // ── 6. Makine kira (kira bedeli girilmiş araç × puantaj günü, dış görev hariç) ──
  // tip'e BAKILMAZ: öz mal da olsa kira bedeli girilmişse o, şantiyenin makine maliyetidir
  // (firma kendi makinesine de iç kira bedeli atayabilir). Kriter = kira bedeli kaydı VAR.
  const araclar = await tumSatirlar<{ id: string; santiye_id: string | null }>((o, p) =>
    supabase.from("araclar").select("id, santiye_id").range(o, o + p - 1),
  );
  const aracSantiye = new Map<string, string | null>();
  for (const a of araclar) aracSantiye.set(a.id, a.santiye_id);
  // Tüm kira bedeli geçmişi (arac_id → DESC tarife listesi)
  const kiraRows = await tumSatirlar<AracKiraBedeli>((o, p) =>
    supabase.from("arac_kira_bedeli").select("*")
      .order("gecerli_tarih", { ascending: false }).order("created_at", { ascending: false }).range(o, o + p - 1),
  );
  const kiraByArac = new Map<string, AracKiraBedeli[]>();
  for (const k of kiraRows) {
    if (!kiraByArac.has(k.arac_id)) kiraByArac.set(k.arac_id, []);
    kiraByArac.get(k.arac_id)!.push(k);
  }
  const kiraAracIds = [...kiraByArac.keys()];
  if (kiraAracIds.length > 0) {
    // Kira: araç şantiyede KİRADAYKEN her gün ödenir → DIŞ GÖREV HARİÇ tüm puantaj günleri TAM bedel/30.
    //   (calisti, yarim_gun, calismadi, arizali, operator_yok, tatil → hepsi bedel/30; yalnız dis_gorev hariç —
    //    o gün araç dış görevde, kira oraya yazılır.) Çalışıp çalışmadığına bakılmaz; makine orada/kirada.
    const puantajlar = await tumSatirlar<{ arac_id: string; santiye_id: string; tarih: string; durum: string }>((o, p) =>
      supabase.from("arac_puantaj").select("arac_id, santiye_id, tarih, durum").in("arac_id", kiraAracIds)
        .gte("tarih", bas).lte("tarih", bit).neq("durum", "dis_gorev").range(o, o + p - 1),
    );
    for (const pj of puantajlar) {
      const r = sat(pj.santiye_id);
      if (!r) continue;
      const bedel = etkinKiraBedeli(kiraByArac.get(pj.arac_id), pj.tarih);
      r.makineKira += bedel / 30; // dış görev hariç her gün TAM bedel
    }
  }

  // ── 7. Araç bakım / tamirat / yedek parça gideri ──
  // Her bakım kaydı, BAKIM TARİHİNDE aracın puantajda olduğu şantiyeye yansır (yedek parça +
  // bakım + tamirat = tutar; tip ayrımı yok, hepsi toplanır). O gün puantaj yoksa en yakın
  // tarihli puantaj; o da yoksa aracın atalı şantiyesi.
  const bakimlar = await tumSatirlar<{ arac_id: string; bakim_tarihi: string; tutar: number | null }>((o, p) =>
    supabase.from("arac_bakim").select("arac_id, bakim_tarihi, tutar")
      .gte("bakim_tarihi", bas).lte("bakim_tarihi", bit).range(o, o + p - 1),
  );
  if (bakimlar.length > 0) {
    const bakimAracIds = [...new Set(bakimlar.map((b) => b.arac_id))];
    const bkPuantaj = await tumSatirlar<{ arac_id: string; santiye_id: string; tarih: string }>((o, p) =>
      supabase.from("arac_puantaj").select("arac_id, santiye_id, tarih").in("arac_id", bakimAracIds)
        .gte("tarih", bas).lte("tarih", bit).range(o, o + p - 1),
    );
    const puByArac = new Map<string, { tarih: string; santiye_id: string }[]>();
    for (const pj of bkPuantaj) {
      if (!puByArac.has(pj.arac_id)) puByArac.set(pj.arac_id, []);
      puByArac.get(pj.arac_id)!.push({ tarih: pj.tarih, santiye_id: pj.santiye_id });
    }
    const bakimSantiye = (aracId: string, tarih: string): string | null => {
      const arr = puByArac.get(aracId);
      if (arr && arr.length > 0) {
        const tam = arr.find((x) => x.tarih === tarih); // o günkü puantaj
        if (tam) return tam.santiye_id;
        let enYakin = arr[0], enFark = Infinity; // en yakın tarihli puantaj
        const hedef = new Date(tarih).getTime();
        for (const x of arr) {
          const fark = Math.abs(new Date(x.tarih).getTime() - hedef);
          if (fark < enFark) { enFark = fark; enYakin = x; }
        }
        return enYakin.santiye_id;
      }
      return aracSantiye.get(aracId) ?? null; // fallback: aracın atalı şantiyesi
    };
    for (const b of bakimlar) {
      const r = sat(bakimSantiye(b.arac_id, b.bakim_tarihi));
      if (r) r.bakim += b.tutar ?? 0;
    }
  }

  // ── Toplam + sırala (toplamı yüksekten düşüğe; sıfır olanları gizle) ──
  for (const r of satirMap.values()) {
    r.toplam = r.nakit + r.kart + r.personel + r.sgk + r.yakit + r.makineKira + r.bakim;
  }
  const satirlar = Array.from(satirMap.values())
    .filter((r) => r.toplam !== 0)
    .sort((a, b) => b.toplam - a.toplam);

  return { satirlar };
}

// ── "Silenler" (gizli şantiyeler) — PAYLAŞIMLI (DB, /api/maliyet/gizli). Eskiden localStorage'daydı (kişi bazlı);
//    artık bir yöneticinin gizlediği TÜM yöneticilerde gizli. ──
export async function getMaliyetGizliSantiyeler(): Promise<string[]> {
  try {
    const r = await fetch("/api/maliyet/gizli", { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.ids) ? (d.ids as string[]) : [];
  } catch { return []; }
}

export async function setMaliyetGizliSantiye(santiyeId: string, gizli: boolean): Promise<void> {
  await fetch("/api/maliyet/gizli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ santiyeId, gizli }),
  });
}
