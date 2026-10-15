// TAHMİNİ BORDRO — tek tanım.
//
// "Henüz işlenmemiş aylar için işçilik ne tutar?" hesabı iki yerde gerekiyor: ana ekrandaki
// Bordro Özeti ve giden evrak kaydedilirken çıkan "prim eksik" uyarısı. Aynı hesabın iki kopyası
// olursa iki ekran farklı rakam gösterir — kullanıcı tam da bunu yakaladı: uyarı tahmini bordroyu
// hiç düşmediği için Vezirköprü'de "eksik yok" sanıyordu, tabloda ise 976.556 ₺ yazıyordu.
//
// Burası SAF: Supabase'e dokunmaz, veriyi çağıran verir.

/** "MM.YYYY" ya da "YYYY-MM-..." → YYYYMM numerik. */
export function ayYilNum(s: string): number {
  if (!s) return 0;
  const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
  if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
  return 0;
}

/** Bugün — YEREL tarih. toISOString() UTC'ye kaydırıp ayın ilk/son gününü şaşırtıyor. */
export function yerelBugun(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type TahminiBordroGirdi = {
  santiyeId: string;
  /** İşlenmiş son ayın YYYYMM değeri; 0 = hiç işlenmemiş. Bu aydan SONRASI tahmin edilir. */
  sonAyNum: number;
  /** İçinde bulunulan ay (YYYYMM) — tahmin buraya kadar yürür. */
  buYilAyNum: number;
  manuelGunler: { santiye_id: string; personel_id: string; ay: string; gun: number }[];
  atamalar: { santiye_id: string; personel_id: string; baslangic_tarihi: string; bitis_tarihi: string | null }[];
  /** Personelin o aydaki günlük ücreti. */
  ucret: (personelId: string, ayStr: string, yil: number) => number;
};

/**
 * Şantiyenin tahmini bordro tutarı.
 * `buAy` ayrı döner — ana ekran tooltip'inde "bu ay / önceki aylar" dökümü gösteriliyor.
 */
export function tahminiBordroHesapla(g: TahminiBordroGirdi): { toplam: number; buAy: number; onceki: number } {
  const { santiyeId, sonAyNum, buYilAyNum, manuelGunler, atamalar, ucret } = g;
  const dahilEdilen = new Set<string>();
  let toplam = 0;
  let buAyToplam = 0;
  const sonuc = () => ({ toplam, buAy: buAyToplam, onceki: toplam - buAyToplam });

  // 1) Manuel girişler — sonAy sonrası
  for (const m of manuelGunler) {
    if (m.santiye_id !== santiyeId) continue;
    const mAyNum = ayYilNum(m.ay);
    if (sonAyNum > 0 && mAyNum <= sonAyNum) continue;
    const yil = parseInt(m.ay.split("-")[0], 10);
    const u = ucret(m.personel_id, m.ay, yil);
    if (u > 0) {
      const tutar = m.gun * u;
      toplam += tutar;
      if (mAyNum === buYilAyNum) buAyToplam += tutar;
      dahilEdilen.add(`${m.personel_id}|${m.ay}`);
    }
  }

  // 2) Doğal hesap — sonAy sonrası, manuel girilmemiş aylar
  const santiyeAtamalari = atamalar.filter((a) => a.santiye_id === santiyeId);
  if (santiyeAtamalari.length === 0) return sonuc();
  if (buYilAyNum <= sonAyNum) return sonuc();
  const baslangic = sonAyNum > 0 ? sonAyNum + 1 : (() => {
    let enErken = Infinity;
    for (const a of santiyeAtamalari) {
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
    const ayNum = yil * 100 + ay;
    const ayBaslangic = `${ayStr}-01`;
    const sonGun = new Date(yil, ay, 0).getDate();
    const ayBitis = `${ayStr}-${String(sonGun).padStart(2, "0")}`;
    const today = yerelBugun();
    // Açık atamanın bitişi: içinde bulunulan ayda BUGÜNE kadar, geçmiş ayda ay sonuna kadar.
    const aktifSanal = today >= ayBaslangic && today <= ayBitis ? today : ayBitis;

    const ayHesap = new Map<string, number>();
    for (const at of santiyeAtamalari) {
      const bH = at.bitis_tarihi ?? aktifSanal;
      if (at.baslangic_tarihi > ayBitis) continue;
      if (bH < ayBaslangic) continue;
      const cb = at.baslangic_tarihi > ayBaslangic ? at.baslangic_tarihi : ayBaslangic;
      const cbt = bH < ayBitis ? bH : ayBitis;
      const ta = new Date(cb + "T00:00:00").getTime();
      const tb = new Date(cbt + "T00:00:00").getTime();
      const gun = Math.max(0, Math.round((tb - ta) / 86400000) + 1);
      ayHesap.set(at.personel_id, (ayHesap.get(at.personel_id) ?? 0) + gun);
    }
    for (const [pId, gun] of ayHesap) {
      if (gun <= 0) continue;
      if (dahilEdilen.has(`${pId}|${ayStr}`)) continue;   // manuel giriş o ayı zaten kapattı
      const u = ucret(pId, ayStr, yil);
      if (u > 0) {
        const tutar = gun * u;
        toplam += tutar;
        if (ayNum === buYilAyNum) buAyToplam += tutar;
      }
    }
    ay += 1;
    if (ay > 12) { ay = 1; yil += 1; }
  }
  return sonuc();
}
