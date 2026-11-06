// Bildirim tag → izin modül anahtarı eşleştirmesi.
// Hem UI (ayar paneli) hem backend (notify route) bu tabloyu kullanır.
// Kullanıcı bir modüle erişim hakkına sahip değilse, o modüle ait bildirimleri
// göremez ve push almaz.
//
// moduleKey null/undefined ise: bildirim herkese gönderilir (örn. mesajlaşma).

export const BILDIRIM_TAG_MODULE: Record<string, string | null> = {
  // Kasa
  kasa: "kasa-defteri",
  // Araçlar
  "arac-bakim": "arac-bakim",
  "yaklasan-bakim": "arac-bakim",
  "yaklasan-sigorta": "araclar-sigorta-muayene",
  // Mailden okunan poliçe/teklif — "yaklaşan"dan AYRI tag: o sabah özeti, bu anlık olay.
  // Şantiyeye bağlı DEĞİL (poliçe şirket geneli), o yüzden şantiye-bağlı listelere eklenmedi.
  "sigorta-police": "araclar-sigorta-muayene",
  arac: "yonetim-araclar",
  // Puantaj
  "arac-puantaj": "puantaj-arac",
  "personel-puantaj": "puantaj-personel",
  // Yakıt
  yakit: "yakit",
  // Yazışmalar
  // E-TEBLİGAT: resmî tebligat gelen evrakın en kritik türü — süreye bağlı.
  // Gelen evrakla aynı izin modülüne bağlı ama AYRI tag, çünkü kullanıcı
  // "gelen evrak bildirimi istemiyorum" dese bile tebligatı kaçırmamalı.
  "e-tebligat": "yazismalar-gelen-evrak",
  "gelen-evrak": "yazismalar-gelen-evrak",
  "giden-evrak": "yazismalar-giden-evrak",
  "banka-yazismalari": "yazismalar-banka-yazismalari",
  // İhale & İşçilik
  ihale: "ihale",
  "iscilik-takibi": "iscilik-takibi",
  // Personel
  personel: "yonetim-personel",
  // Kullanıcı girişi — sadece yönetici görebilir (yonetim-kullanicilar izni yalnız yöneticide)
  "kullanici-giris": "yonetim-kullanicilar",
  // Mesajlaşma — modül izninden bağımsız (herkes)
  mesaj: null,
};

/** Tag verilen kullanıcının görmesi gereken modül anahtarını döndürür. */
export function tagModuleKey(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return BILDIRIM_TAG_MODULE[tag] ?? null;
}
