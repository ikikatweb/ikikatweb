// Tek bir şantiye için prim hesabı (geçici kabul kontrolü için kullanılır):
//   yatması gereken − yatan − bordro tahmini = sonuç
// Sonuç POZİTİF ise eksik prim var → geçici kabul tarihi atanmamalı.
import { createClient } from "@/lib/supabase/client";
import { gunHesaplaAyBazli } from "./bordro";
import { brutUcretForAy, aylikBrutTutar } from "./personel-brut-ucret";
import type {
  PersonelAtamaGecmisi,
  PersonelAtamaManuelGun,
  PersonelBrutUcret,
} from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export type SantiyePrimHesap = {
  yatmasiGereken: number;
  yatan: number;
  bordroTahmini: number;
  sonuc: number; // = yatmasiGereken - yatan - bordroTahmini
};

// "MM.YYYY" veya "YYYY-MM" → karşılaştırılabilir sayı (YYYYMM)
function ayYilNum(s: string): number {
  if (!s) return 0;
  const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
  if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
  return 0;
}

export async function getSantiyePrimHesabi(santiyeId: string): Promise<SantiyePrimHesap> {
  const supabase = getSupabase();

  // 1) Şantiye bilgisi (sözleşme bedeli)
  const { data: santiye } = await supabase
    .from("santiyeler")
    .select("sozlesme_bedeli")
    .eq("id", santiyeId)
    .single();
  const bedel = santiye?.sozlesme_bedeli ?? 0;

  // 2) İşçilik takibi kayıtları (aynı şantiyenin birden fazla kaydı olabilir)
  const { data: iscilik } = await supabase
    .from("iscilik_takibi")
    .select("id, kesif_artisi, fiyat_farki, iscilik_orani, yatan_prim")
    .eq("santiye_id", santiyeId)
    .or("silindi.is.null,silindi.eq.false");

  let yatmasiGereken = 0;
  let yatan = 0;
  const takibiIds: string[] = [];
  for (const r of (iscilik ?? []) as { id: string; kesif_artisi: number | null; fiyat_farki: number | null; iscilik_orani: number | null; yatan_prim: number | null }[]) {
    const kesif = r.kesif_artisi ?? 0;
    const ff = r.fiyat_farki ?? 0;
    const oran = r.iscilik_orani ?? 0;
    const yatacak = (bedel + kesif + ff) * oran / 100;
    yatmasiGereken += yatacak;
    yatan += r.yatan_prim ?? 0;
    takibiIds.push(r.id);
  }

  // 3) Son ait_oldugu_ay (her takibi için max ay) — bordro tahmini bu aydan sonrası için
  let sonAyNum = 0;
  if (takibiIds.length > 0) {
    const { data: ayliklar } = await supabase
      .from("iscilik_aylik")
      .select("iscilik_takibi_id, ait_oldugu_ay")
      .in("iscilik_takibi_id", takibiIds);
    for (const ay of (ayliklar ?? []) as { ait_oldugu_ay: string }[]) {
      const n = ayYilNum(ay.ait_oldugu_ay);
      if (n > sonAyNum) sonAyNum = n;
    }
  }

  // 4) Bordro tahmini hesabı: sonAy'dan sonra olan aylar için manuel + doğal atama × ücret
  let bordroTahmini = 0;
  // Atamalar
  const { data: atamalarRaw } = await supabase
    .from("personel_atama_gecmisi")
    .select("*")
    .eq("santiye_id", santiyeId);
  const atamalar = (atamalarRaw ?? []) as PersonelAtamaGecmisi[];

  // Manuel günler (sadece bu şantiyeye ait)
  const { data: manuelRaw } = await supabase
    .from("personel_atama_manuel_gun")
    .select("*")
    .eq("santiye_id", santiyeId);
  const manuelGunler = (manuelRaw ?? []) as PersonelAtamaManuelGun[];

  // Günlük ücret + brüt ücret tarihçesi
  const [ucretlerRes, brutRes] = await Promise.all([
    supabase.from("bordro_gunluk_ucret").select("*"),
    supabase.from("personel_brut_ucret").select("*"),
  ]);
  const gunlukUcretler = (ucretlerRes.data ?? []) as { yil: number; ucret: number }[];
  // brutRes hata verirse (tablo yok) sessizce boş dön
  const brutGecmis = (brutRes.error ? [] : (brutRes.data ?? [])) as PersonelBrutUcret[];

  const personelUcret = (personelId: string, ayStr: string, yil: number): number => {
    const brut = brutUcretForAy(brutGecmis, personelId, ayStr);
    if (brut > 0) return brut;
    return gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0;
  };

  const dahilEdilen = new Set<string>();

  // 1) Manuel girişler
  for (const m of manuelGunler) {
    const mAyNum = ayYilNum(m.ay);
    if (sonAyNum > 0 && mAyNum <= sonAyNum) continue;
    const yil = parseInt(m.ay.split("-")[0], 10);
    const ucret = personelUcret(m.personel_id, m.ay, yil);
    if (ucret > 0) {
      bordroTahmini += aylikBrutTutar(brutGecmis, m.personel_id, m.ay, m.gun, gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0, atamalar, santiyeId);
      dahilEdilen.add(`${m.personel_id}|${m.ay}`);
    }
  }

  // 2) Doğal hesap — sonAy'dan bu aya kadar her ay
  if (atamalar.length > 0) {
    const bugun = new Date();
    const buYilAy = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}`;
    const buYilAyNum = ayYilNum(buYilAy);
    if (buYilAyNum > sonAyNum) {
      const baslangic = sonAyNum > 0 ? sonAyNum + 1 : (() => {
        let enErken = Infinity;
        for (const a of atamalar) {
          const aNum = ayYilNum(a.baslangic_tarihi.slice(0, 7));
          if (aNum < enErken) enErken = aNum;
        }
        return enErken === Infinity ? buYilAyNum : enErken;
      })();
      let yil = Math.floor(baslangic / 100);
      let ay = baslangic % 100;
      if (ay === 0) { yil -= 1; ay = 12; }
      while (yil * 100 + ay <= buYilAyNum) {
        const ayStr = `${yil}-${String(ay).padStart(2, "0")}`;
        const ayHesap = gunHesaplaAyBazli(atamalar, ayStr);
        for (const [pId, sMap] of ayHesap) {
          const gun = sMap.get(santiyeId) ?? 0;
          if (gun <= 0) continue;
          if (dahilEdilen.has(`${pId}|${ayStr}`)) continue;
          const ucret = personelUcret(pId, ayStr, yil);
          if (ucret > 0) bordroTahmini += aylikBrutTutar(brutGecmis, pId, ayStr, gun, gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0, atamalar, santiyeId);
        }
        ay += 1;
        if (ay > 12) { ay = 1; yil += 1; }
      }
    }
  }

  const sonuc = yatmasiGereken - yatan - bordroTahmini;
  return { yatmasiGereken, yatan, bordroTahmini, sonuc };
}
