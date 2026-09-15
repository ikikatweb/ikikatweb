// Güzergah (rota) satırlarının TARAYICI ÖNBELLEĞİ — IndexedDB.
//
// NEDEN: `arac_arvento_guzergah` veritabanındaki en büyük tablo; `noktalar` (GPS izi) kolonu
// yüzünden satır başına ~37 KB. Harita sayfası seçilen aralığı `select("*")` ile çektiği için
// bir aylık aralık ~24 MB, sezon (1 Ocak → bugün) ~69 MB indiriyordu — VE bu her sayfa
// açılışında baştan iniyordu. Aylık 5 GB'lık Supabase çıkış kotasının 1 ve 4 Eylül'deki
// sıçramalarının kaynağı buydu.
//
// TEMEL GÖZLEM: GEÇMİŞ günlerin rotası bir daha DEĞİŞMEZ. O yüzden bir kez indirilip
// tarayıcıda saklanabilir; ağdan yalnız hiç görülmemiş günler ve BUGÜN çekilir.
// Bugün asla önbelleğe yazılmaz (dakikada bir yeni nokta ekleniyor).
//
// GÜVENLİ BAŞARISIZLIK: IndexedDB yoksa/kapalıysa (gizli sekme, kota dolu, eski tarayıcı)
// her şey sessizce eski davranışa döner — veri hep ağdan gelir, yalnız yavaşlar.
import type { AracArventoGuzergah } from "@/lib/supabase/types";

const DB_ADI = "ikikat-arvento";
const DB_SURUM = 1;
const S_SATIR = "satir"; // anahtar: `${tarih}|${plaka}` → güzergah satırı
const S_GUN = "gun";     // anahtar: `${tarih}|${kapsam}` → o gün/kapsam için TAM plaka listesi
const SAKLAMA_GUN = 150; // bundan eski kayıtlar temizlenir (sezon ~1 Ocak'ta başlıyor)
// Bir günün anahtar aralığının ÜST sınırı: `${tarih}|` ile `${tarih}|<en büyük karakter>` arası,
// o güne ait tüm plakaları kapsar. Mümkün olan en büyük kod birimi kullanılır ki hiçbir plaka dışarıda kalmasın.
const GUN_UST = String.fromCharCode(0xffff);

// Bir çekimin "kapsamı": plaka süzgeci yoksa "*" (o günün TAMAMI), varsa sıralı plaka listesi.
// "*" kapsamı her alt kümeyi karşılar; dar kapsam yalnız kendi anahtarıyla eşleşir.
export function kapsamAnahtari(plakalar?: string[] | null): string {
  if (!plakalar || plakalar.length === 0) return "*";
  return [...plakalar].sort().join(",");
}

export function guzergahGunleri(bas: string, bitis: string): string[] {
  const gunler: string[] = [];
  const d = new Date(bas + "T00:00:00");
  const son = new Date(bitis + "T00:00:00");
  for (; d <= son; d.setDate(d.getDate() + 1)) {
    gunler.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return gunler;
}

// Önbellek HİÇBİR koşulda veri yolunu bekletmemeli. IndexedDB sessizce kilitlenebiliyor:
// bekleyen bir deleteDatabase açık bağlantı yüzünden ilerleyemezse `open` çağrısı success/error/
// blocked olaylarının HİÇBİRİNİ tetiklemez — o zaman `await dbAc()` sonsuza kadar asılı kalır ve
// sayfa iskelet ekranında donar. Bu yüzden önbelleğe dokunan her adım süre sınırlıdır; süre
// dolarsa önbellek yokmuş gibi davranılır (veri ağdan gelir, yalnız tasarruf olmaz).
const ACILIS_MS = 3000;
const ISLEM_MS = 5000;

function sureliSoz<T>(soz: Promise<T>, ms: number, varsayilan: T): Promise<T> {
  return new Promise((cozumle) => {
    const t = setTimeout(() => cozumle(varsayilan), ms);
    soz.then((d) => { clearTimeout(t); cozumle(d); }, () => { clearTimeout(t); cozumle(varsayilan); });
  });
}

let dbSozu: Promise<IDBDatabase | null> | null = null;

function dbAc(): Promise<IDBDatabase | null> {
  if (dbSozu) return dbSozu;
  const ham = new Promise<IDBDatabase | null>((cozumle) => {
    try {
      if (typeof indexedDB === "undefined") { cozumle(null); return; }
      const istek = indexedDB.open(DB_ADI, DB_SURUM);
      istek.onupgradeneeded = () => {
        const db = istek.result;
        if (!db.objectStoreNames.contains(S_SATIR)) db.createObjectStore(S_SATIR, { keyPath: "anahtar" });
        if (!db.objectStoreNames.contains(S_GUN)) db.createObjectStore(S_GUN, { keyPath: "anahtar" });
      };
      istek.onsuccess = () => cozumle(istek.result);
      istek.onerror = () => cozumle(null);
      istek.onblocked = () => cozumle(null);
    } catch { cozumle(null); }
  });
  // Sonuç (null dahil) tek sefer hesaplanır: kilitli bir IndexedDB her çağrıda 3 sn beklememeli.
  dbSozu = sureliSoz(ham, ACILIS_MS, null);
  return dbSozu;
}

function istekSozu<T>(istek: IDBRequest<T>): Promise<T | null> {
  return new Promise((cozumle) => {
    istek.onsuccess = () => cozumle(istek.result);
    istek.onerror = () => cozumle(null);
  });
}

type GunKaydi = { anahtar: string; tarih: string; kapsam: string; plakalar: string[] };

/**
 * Verilen günleri önbellekten okur.
 * Dönen `bulunan`: tarih → o günün satırları (boş dizi de geçerli bir cevap: "o gün veri yok").
 * Dönen `eksik`: önbellekte olmayan, ağdan çekilmesi gereken günler.
 */
export function guzergahOnbellektenOku(
  gunler: string[],
  kapsam: string,
): Promise<{ bulunan: Map<string, AracArventoGuzergah[]>; eksik: string[] }> {
  // Süre dolarsa "hiçbiri önbellekte yok" denir → çağıran hepsini ağdan çeker (doğru, yalnız yavaş).
  return sureliSoz(okuIc(gunler, kapsam), ISLEM_MS, { bulunan: new Map(), eksik: gunler });
}

async function okuIc(
  gunler: string[],
  kapsam: string,
): Promise<{ bulunan: Map<string, AracArventoGuzergah[]>; eksik: string[] }> {
  const bulunan = new Map<string, AracArventoGuzergah[]>();
  const eksik: string[] = [];
  const db = await dbAc();
  if (!db) return { bulunan, eksik: gunler };
  try {
    const ix = db.transaction([S_GUN, S_SATIR], "readonly");
    const gunDeposu = ix.objectStore(S_GUN);
    const satirDeposu = ix.objectStore(S_SATIR);
    const istenen = kapsam === "*" ? null : new Set(kapsam.split(","));
    for (const gun of gunler) {
      // Önce TAM gün kaydı ("*"), yoksa bu çekimin kendi kapsamı. Kayıt yoksa o gün hiç
      // önbelleğe alınmamıştır — "satır yok" ile "bilinmiyor" ayrımı bu kayıtla yapılır.
      let kayit = (await istekSozu(gunDeposu.get(`${gun}|*`))) as GunKaydi | null;
      if (!kayit && istenen) kayit = (await istekSozu(gunDeposu.get(`${gun}|${kapsam}`))) as GunKaydi | null;
      if (!kayit) { eksik.push(gun); continue; }
      // O günün satırlarını TEK istekle al (plaka başına ayrı get, sezon boyu binlerce istek ederdi).
      // Anahtar `${tarih}|${plaka}` olduğu için gün, bitişik bir anahtar aralığıdır.
      const hepsi = (await istekSozu(
        satirDeposu.getAll(IDBKeyRange.bound(`${gun}|`, `${gun}|${GUN_UST}`)),
      )) as Array<{ satir: AracArventoGuzergah }> | null;
      const satirlar = (hepsi ?? []).map((x) => x.satir).filter((s) => !!s);
      // Dar kapsamla istendiyse, depoda başka kapsamlardan kalmış plakalar da olabilir → süz.
      bulunan.set(gun, istenen ? satirlar.filter((s) => istenen.has(s.plaka)) : satirlar);
    }
  } catch { return { bulunan: new Map(), eksik: gunler }; }
  return { bulunan, eksik };
}

/**
 * Ağdan yeni çekilen satırları önbelleğe yazar.
 * `gunler` çekimin KAPSADIĞI tüm günlerdir — içinde satırı olmayan gün de "o gün boş" olarak
 * işaretlenir, yoksa veri üretmeyen günler her açılışta yeniden sorgulanırdı.
 * BUGÜN bu listeye verilmemelidir (çağıran ayıklar).
 */
export function guzergahOnbellegeYaz(
  gunler: string[],
  kapsam: string,
  satirlar: AracArventoGuzergah[],
): Promise<void> {
  return sureliSoz(yazIc(gunler, kapsam, satirlar), ISLEM_MS, undefined);
}

async function yazIc(
  gunler: string[],
  kapsam: string,
  satirlar: AracArventoGuzergah[],
): Promise<void> {
  if (gunler.length === 0) return;
  const db = await dbAc();
  if (!db) return;
  const gunBazli = new Map<string, AracArventoGuzergah[]>();
  for (const g of gunler) gunBazli.set(g, []);
  for (const s of satirlar) {
    const liste = gunBazli.get(s.rapor_tarihi);
    if (liste) liste.push(s); // aralık dışı satır gelirse yok say
  }
  try {
    const ix = db.transaction([S_GUN, S_SATIR], "readwrite");
    const gunDeposu = ix.objectStore(S_GUN);
    const satirDeposu = ix.objectStore(S_SATIR);
    for (const [gun, liste] of gunBazli) {
      // TAM gün çekimi ("*") o güne dair KESİN doğrudur → önce günü sil, sonra yaz. Böylece daha
      // önce dar kapsamla yazılmış, artık veritabanında olmayan bir plaka satırı geride kalmaz.
      if (kapsam === "*") satirDeposu.delete(IDBKeyRange.bound(`${gun}|`, `${gun}|${GUN_UST}`));
      for (const s of liste) satirDeposu.put({ anahtar: `${gun}|${s.plaka}`, satir: s });
      const kayit: GunKaydi = { anahtar: `${gun}|${kapsam}`, tarih: gun, kapsam, plakalar: liste.map((s) => s.plaka) };
      gunDeposu.put(kayit);
    }
    await new Promise<void>((cozumle) => {
      ix.oncomplete = () => cozumle();
      // Kota dolduysa (QuotaExceededError) yazma düşer — okuma yolu zaten eksik günü ağdan
      // çekiyor, davranış bozulmaz. Yer açmak için eski kayıtları temizle.
      ix.onerror = () => { void guzergahOnbellekTemizle(true); cozumle(); };
      ix.onabort = () => { void guzergahOnbellekTemizle(true); cozumle(); };
    });
  } catch { /* yazılamadı → önbelleksiz devam */ }
}

/** SAKLAMA_GUN'den eski kayıtları siler. Oturum başına bir kez çalışır. */
let temizlendi = false;
export function guzergahOnbellekTemizle(zorla = false): Promise<void> {
  return sureliSoz(temizleIc(zorla), ISLEM_MS, undefined);
}

async function temizleIc(zorla: boolean): Promise<void> {
  if (temizlendi && !zorla) return;
  temizlendi = true;
  const db = await dbAc();
  if (!db) return;
  const esik = new Date(Date.now() + 3 * 3600000 - SAKLAMA_GUN * 86400000).toISOString().slice(0, 10);
  try {
    const ix = db.transaction([S_GUN, S_SATIR], "readwrite");
    // Anahtarlar `YYYY-MM-DD|...` biçiminde; tarih önde olduğu için sözlük sırası = tarih sırası.
    // Eşikten küçük tüm anahtarlar tek aralıkta silinir.
    const aralik = IDBKeyRange.upperBound(`${esik}|`, true);
    ix.objectStore(S_GUN).delete(aralik);
    ix.objectStore(S_SATIR).delete(aralik);
    await new Promise<void>((cozumle) => { ix.oncomplete = () => cozumle(); ix.onerror = () => cozumle(); ix.onabort = () => cozumle(); });
  } catch { /* temizlik başarısızsa önemli değil */ }
}
