// SGK PRİM DENGESİ — ana ekran uyarısının veri katmanı.
//
// Her AKTİF iş için: bitimine kadar prim dolacak mı, dolmayacak mı, yoksa çoktan doldu mu?
// Hesabın kendisi lib/bordro/prim-dengesi.ts'de (saf); burada yalnız veri toplanır.
//
// "Yatması gereken" ana ekrandaki Bordro Özeti ile AYNI tabanda: tahmini fiyat farkı dâhil,
// tahmini bordro düşülmüş. İki ekranın farklı rakam göstermemesi için.

import { createClient } from "@/lib/supabase/client";
import { getTeknikPersonelKayitlari } from "@/lib/supabase/queries/personel-teknik";
import { tahminiBordroHesapla, ayYilNum, yerelBugun } from "@/lib/bordro/tahmini-bordro";
import { brutUcretForAy } from "@/lib/supabase/queries/personel-brut-ucret";
import { primDengesi, type Denge } from "@/lib/bordro/prim-dengesi";
import { isBitimHesapla } from "@/lib/bordro/is-bitim";

export type PrimDengeSatiri = Denge & {
  santiyeId: string;
  santiyeAd: string;
  bitimTarihi: string;
  aktifKisi: number;
  teknikKisi: number;
  gunlukUretim: number;
};

export async function getPrimDengeleri(): Promise<PrimDengeSatiri[]> {
  try {
    const sb = createClient();
    const [sant, takibi, atama, ucret, brut, ayliklar, manuel, teknik] = await Promise.all([
      sb.from("santiyeler").select("id, is_adi, sozlesme_bedeli, sozlesme_fiyatlariyla_gerceklesen, is_bitim_tarihi, sure_uzatimli_tarih, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, calisilmayan_bas, calisilmayan_bit, netsim_son_hakedis_kesif, netsim_son_hakedis_fark, isyeri_teslim_tarihi, is_suresi"),
      sb.from("iscilik_takibi").select("id, santiye_id, kesif_artisi, fiyat_farki, iscilik_orani, yatan_prim, baslangic_tarihi, sure_text").eq("silindi", false),
      sb.from("personel_atama_gecmisi").select("personel_id, santiye_id, baslangic_tarihi, bitis_tarihi"),
      sb.from("bordro_gunluk_ucret").select("yil, ucret"),
      sb.from("personel_brut_ucret").select("*"),
      sb.from("iscilik_aylik").select("iscilik_takibi_id, ait_oldugu_ay"),
      sb.from("personel_atama_manuel_gun").select("santiye_id, personel_id, ay, gun"),
      // personel_teknik AYRI çekilmez: teknik atama uyarısı da aynı listeyi istiyor → ortak
      // okuyucudan gelir, sorgu bir kez gider (bkz. lib/supabase/istek-paylas).
      getTeknikPersonelKayitlari(),
    ]);

    type S = {
      id: string; is_adi: string; sozlesme_bedeli: number | null; sozlesme_fiyatlariyla_gerceklesen: number | null;
      is_bitim_tarihi: string | null; sure_uzatimli_tarih: string | null;
      gecici_kabul_tarihi: string | null; kesin_kabul_tarihi: string | null;
      tasfiye_tarihi: string | null; devir_tarihi: string | null;
      calisilmayan_bas: string | null; calisilmayan_bit: string | null;
      isyeri_teslim_tarihi: string | null; is_suresi: number | null;
      netsim_son_hakedis_kesif: number | null; netsim_son_hakedis_fark: number | null;
    };
    const santiyeler = (sant.data ?? []) as S[];
    const S = new Map(santiyeler.map((s) => [s.id, s]));

    const bugun = yerelBugun();
    const [by, bm] = bugun.split("-").map(Number);
    const buYilAyNum = by * 100 + bm;
    const buAyStr = `${by}-${String(bm).padStart(2, "0")}`;

    const gunlukYil = new Map(((ucret.data ?? []) as { yil: number; ucret: number }[]).map((u) => [u.yil, u.ucret]));
    const brutler = (brut.data ?? []) as Parameters<typeof brutUcretForAy>[0];
    const ucretFor = (personelId: string, ayStr: string, yil: number) => {
      const b = brutUcretForAy(brutler, personelId, ayStr);
      return b > 0 ? b : (gunlukYil.get(yil) ?? 0);
    };

    // iscilik_takibi_id → işlenmiş son ay (tahmini bordro bu ayın sonrasını sayar)
    const sonAy = new Map<string, string>();
    for (const a of (ayliklar.data ?? []) as { iscilik_takibi_id: string; ait_oldugu_ay: string }[]) {
      const m = sonAy.get(a.iscilik_takibi_id);
      if (!m || ayYilNum(a.ait_oldugu_ay) > ayYilNum(m)) sonAy.set(a.iscilik_takibi_id, a.ait_oldugu_ay);
    }

    const atamalar = (atama.data ?? []) as { personel_id: string; santiye_id: string; baslangic_tarihi: string; bitis_tarihi: string | null }[];
    const aktifKisiler = new Map<string, string[]>();
    for (const a of atamalar) {
      if (a.bitis_tarihi) continue;
      const l = aktifKisiler.get(a.santiye_id) ?? [];
      l.push(a.personel_id);
      aktifKisiler.set(a.santiye_id, l);
    }
    // TEKNİK TABAN: sözleşme şartı gereği kalması gereken kişiler. Bordroda ataması olan
    // teknik personel sayılır — dış atama (firma yetkilisi) zaten sigortalı değil, onu
    // çıkarmak diye bir şey yok.
    const teknikKisiSayisi = new Map<string, number>();
    for (const t of teknik) {
      if (!t.is_teknik || !t.teknik_isim?.trim()) continue;
      if (!(aktifKisiler.get(t.santiye_id) ?? []).includes(t.personel_id)) continue;  // çıkmışsa sayma
      teknikKisiSayisi.set(t.santiye_id, (teknikKisiSayisi.get(t.santiye_id) ?? 0) + 1);
    }

    // Şantiye bazında: yatması gereken (tahmini FF dâhil), yatan, işlenmiş son ay
    type Toplam = { gereken: number; yatan: number; sonAyNum: number; baslangic: string | null; sureText: string | null };
    const toplam = new Map<string, Toplam>();
    for (const r of (takibi.data ?? []) as { id: string; santiye_id: string; kesif_artisi: number | null; fiyat_farki: number | null; iscilik_orani: number | null; yatan_prim: number | null; baslangic_tarihi: string | null; sure_text: string | null }[]) {
      const s = S.get(r.santiye_id);
      if (!s) continue;
      if (s.gecici_kabul_tarihi || s.kesin_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi) continue;  // biten iş
      const bedel = s.sozlesme_bedeli ?? 0, kesif = r.kesif_artisi ?? 0, ff = r.fiyat_farki ?? 0, oran = r.iscilik_orani ?? 0;
      const shK = s.netsim_son_hakedis_kesif ?? 0, shF = s.netsim_son_hakedis_fark ?? 0;
      const kalanKesif = bedel + kesif - (s.sozlesme_fiyatlariyla_gerceklesen ?? 0);
      const tahminiFF = shK > 0 && shF > 0 && kalanKesif > 0 ? kalanKesif * (shF / shK) : 0;
      const t = toplam.get(r.santiye_id) ?? { gereken: 0, yatan: 0, sonAyNum: 0, baslangic: null as string | null, sureText: null as string | null };
      t.baslangic ??= r.baslangic_tarihi;
      t.sureText ??= r.sure_text;
      t.gereken += (bedel + kesif + ff + tahminiFF) * oran / 100;
      t.yatan += r.yatan_prim ?? 0;
      const sa = sonAy.get(r.id);
      const n = sa ? ayYilNum(sa) : 0;
      if (n > t.sonAyNum) t.sonAyNum = n;
      toplam.set(r.santiye_id, t);
    }

    const manuelGunler = (manuel.data ?? []) as { santiye_id: string; personel_id: string; ay: string; gun: number }[];
    const sonuc: PrimDengeSatiri[] = [];
    for (const [sid, t] of toplam) {
      const s = S.get(sid)!;
      // BİTİM TARİHİ — Bordro Takibi kartıyla AYNI sıra (lib/bordro/is-bitim.ts):
      // şantiye kaydına girilen tarih esas, türetme yalnız o boşken. Eskiden burada
      // yalnız şantiye alanlarına bakılıyordu; kart türetmeyi öne aldığı için iki
      // ekran aynı iş için farklı tarih gösteriyordu.
      const bitim = isBitimHesapla({
        sureUzatimliTarih: s.sure_uzatimli_tarih,
        isBitimTarihi: s.is_bitim_tarihi,
        baslangicTarihi: t.baslangic,
        sureText: t.sureText,
        isyeriTeslimTarihi: s.isyeri_teslim_tarihi,
        isSuresi: s.is_suresi,
      });
      // BİTMİŞ İŞLER DE LİSTELENİR. Eskiden bitim tarihi geçmiş işler tamamen
      // düşüyordu — oysa en kritik oldukları an orası: Kampüs Altyapı'da iş 10.09'da
      // bitmiş, 0 sigortalı kalmış ve 28.890 ₺ prim eksik; o prim artık çalışmayla
      // dolmayacak. Bitimi olmayan iş hesaplanamaz, o atlanır.
      if (!bitim) continue;
      if (t.gereken <= 0) continue;                   // oran/bedel girilmemiş → hesaplanamaz

      const { toplam: tahminiBordro } = tahminiBordroHesapla({
        santiyeId: sid, sonAyNum: t.sonAyNum, buYilAyNum,
        manuelGunler, atamalar, ucret: ucretFor,
      });
      const kisiler = aktifKisiler.get(sid) ?? [];
      const gunlukUretim = kisiler.reduce((a, p) => a + ucretFor(p, buAyStr, by), 0);
      const kisiBasiUcret = kisiler.length > 0 ? gunlukUretim / kisiler.length : (gunlukYil.get(by) ?? 0);

      const denge = primDengesi({
        kalanPrim: t.gereken - t.yatan - tahminiBordro,
        gunlukUretim, kisiBasiUcret,
        aktifKisi: kisiler.length,
        teknikKisi: teknikKisiSayisi.get(sid) ?? 0,
        bugun, bitim,
        calisilmayan: { bas: s.calisilmayan_bas, bit: s.calisilmayan_bit },
      });
      if (denge.durum === "dengede") continue;        // sapma yoksa listeye girmez
      // YAPILACAK ŞEY YOKSA LİSTELEME: prim fazla ama sigortalıların hepsi teknik
      // personel → sözleşme gereği kimse çıkarılamaz. Uyarıda tutmak listeyi meşgul
      // etmekten başka işe yaramıyor. (Eksik tarafta kişi sayısı 0 olsa bile eylem var:
      // "sigortalı girin".)
      if (denge.durum === "fazla" && denge.kisiFarki === 0) continue;
      sonuc.push({
        ...denge,
        santiyeId: sid, santiyeAd: s.is_adi, bitimTarihi: bitim,
        aktifKisi: kisiler.length, teknikKisi: teknikKisiSayisi.get(sid) ?? 0, gunlukUretim,
      });
    }
    // Önce EKSİK (işin bitimi yaklaşan üstte), sonra FAZLA (tutarı büyük üstte).
    return sonuc.sort((a, b) => {
      if (a.durum !== b.durum) return a.durum === "eksik" ? -1 : 1;
      if (a.durum === "eksik") return a.bitimTarihi.localeCompare(b.bitimTarihi);
      return (b.fazlaTutar || -b.kalanPrim) - (a.fazlaTutar || -a.kalanPrim);
    });
  } catch {
    return [];
  }
}
