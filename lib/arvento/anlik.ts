// Arvento Web Servisi (SOAP) — araçların ANLIK durumu/konumu.
//   Endpoint : https://ws.arvento.com/v1/report.asmx
//   Metod    : GetVehicleStatusV3(Username, PIN1, PIN2, Language)  [abonelikte YETKİLİ]
//   Yanıt    : ...Result içinde <LastPacket> blokları (strNode, dLatitude, dLongitude,
//              dSpeed, strAddress, nCourse, dOdometer, dtLocalDateTime, ...).
//   NOT: Bu metod PLAKA döndürmez, cihaz NODE'u (strNode) döndürür. Plaka eşlemesi için
//        ayrıca GetVehicleInfoReturnObject (LicensePlate listesi) gerekir.
// Kimlik bilgileri .env'den okunur (ASLA koda/sohbete yazılmaz):
//   ARVENTO_WS_USERNAME, ARVENTO_WS_PIN1, ARVENTO_WS_PIN2, ARVENTO_WS_LANG (varsayılan "tr")
const WS_URL = "https://ws.arvento.com/v1/report.asmx";
const SOAP_ACTION = "http://www.arvento.com/GetVehicleStatusV3";

export type AnlikArac = {
  node: string | null;      // cihaz node (strNode) — plaka eşlemesi ayrı yapılır
  plaka: string | null;
  lat: number | null;
  lng: number | null;
  hiz: number | null;       // km/s
  tarih: string | null;     // son konum zamanı (yerel)
  adres: string | null;
  yon: number | null;       // yön (derece)
  odometre: number | null;  // toplam km
  ham: Record<string, string>; // tüm ham alanlar
};

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlUnesc(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}
function sayi(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Arvento web servisinden anlık araç durumlarını çeker.
export async function cekAnlikDurum(): Promise<{ araclar: AnlikArac[]; hamXml: string }> {
  const user = process.env.ARVENTO_WS_USERNAME;
  const pin1 = process.env.ARVENTO_WS_PIN1;
  const pin2 = process.env.ARVENTO_WS_PIN2;
  const lang = process.env.ARVENTO_WS_LANG ?? "tr";
  if (!user || !pin1 || !pin2) {
    throw new Error("Arvento web servisi bilgileri eksik (.env: ARVENTO_WS_USERNAME / PIN1 / PIN2)");
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetVehicleStatusV3 xmlns="http://www.arvento.com/">
      <Username>${xmlEsc(user)}</Username>
      <PIN1>${xmlEsc(pin1)}</PIN1>
      <PIN2>${xmlEsc(pin2)}</PIN2>
      <Language>${xmlEsc(lang)}</Language>
    </GetVehicleStatusV3>
  </soap:Body>
</soap:Envelope>`;

  // Arvento yabancı/art arda isteklere bazen EKSİK liste döndürüyor (özellikle Vercel
  // veri merkezi IP'sinden). En dolu yanıtı almak için birkaç kez dene, en çoğunu tut.
  const uyku = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let enIyi: { araclar: AnlikArac[]; hamXml: string } = { araclar: [], hamXml: "" };
  let sonHata: Error | null = null;
  let erisimYok = false; // "Access denied" → tekrar denemeyi kes
  const DENEME = 4;
  for (let i = 0; i < DENEME; i++) {
    if (i > 0) await uyku(1800); // rate-limit'e karşı aralık
    try {
      const res = await fetch(WS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION },
        body,
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) { sonHata = new Error(`Web servisi HTTP ${res.status}`); continue; }
      const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
      if (fault) { sonHata = new Error(`Web servisi hatası: ${htmlUnesc(fault[1]).trim()}`); continue; }
      const m = text.match(/<GetVehicleStatusV3Result>([\s\S]*?)<\/GetVehicleStatusV3Result>/i);
      const inner = (m ? m[1] : "").trim();
      // Arvento, izinsiz IP'den gelen isteğe tek "Access denied" kaydı döndürür → net hata, tekrar deneme YOK.
      if (/access denied/i.test(inner)) {
        erisimYok = true;
        sonHata = new Error(
          "Arvento web servisi bu sunucunun IP adresine erişim izni vermiyor (\"Access denied\"). " +
          "Arvento panelinde web servisi IP kısıtlamasını kaldırın ya da bu sunucunun çıkış IP'sini izinli listeye ekletin.",
        );
        break;
      }
      const araclar = parseAnlikXml(inner);
      if (araclar.length > enIyi.araclar.length) enIyi = { araclar, hamXml: inner };
      if (araclar.length >= 10) break; // yeterince dolu → dur (filo birden çok araç)
    } catch (e) {
      sonHata = e instanceof Error ? e : new Error(String(e));
    }
  }
  if ((erisimYok || enIyi.araclar.length === 0) && sonHata) throw sonHata;
  return enIyi;
}

// GetVehicleStatusV3 yanıtındaki <LastPacket> bloklarını AnlikArac'a çevirir.
// Alanlar: strNode, dLatitude, dLongitude, dSpeed, strAddress, nCourse, dOdometer, dtLocalDateTime.
function parseAnlikXml(xml: string): AnlikArac[] {
  if (!xml) return [];
  const out: AnlikArac[] = [];
  const bloklar = xml.match(/<LastPacket\b[\s\S]*?<\/LastPacket>/gi) ?? [];
  for (const blok of bloklar) {
    const ham: Record<string, string> = {};
    for (const mm of blok.matchAll(/<([A-Za-z0-9_]+)\s*\/>/g)) ham[mm[1].toLowerCase()] = ""; // boş self-closing
    for (const mm of blok.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) ham[mm[1].toLowerCase()] = mm[2].trim();
    const al = (...adlar: string[]): string | undefined => {
      for (const a of adlar) if (ham[a] != null && ham[a] !== "") return ham[a];
      return undefined;
    };
    out.push({
      node: al("strnode", "node") ?? null,
      plaka: al("strplate", "licenseplate", "plaka") ?? null, // V3'te yok → null (eşleme ayrı)
      lat: sayi(al("dlatitude", "latitude", "lat")),
      lng: sayi(al("dlongitude", "longitude", "lng")),
      hiz: sayi(al("dspeed", "speed", "hiz")),
      tarih: al("dtlocaldatetime", "dtgmtdatetime", "datetime") ?? null,
      adres: al("straddress", "address", "adres") ?? null,
      yon: sayi(al("ncourse", "course", "yon")),
      odometre: sayi(al("dodometer", "odometer")),
      ham,
    });
  }
  return out;
}
