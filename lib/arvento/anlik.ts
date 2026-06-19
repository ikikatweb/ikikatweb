// Arvento Web Servisi (SOAP) — araçların ANLIK durumu/konumu.
//   Endpoint : https://ws.arvento.com/v1/report.asmx
//   Metod    : GetVehicleStatusReturnObject(Username, PIN1, PIN2, Language)
//   Yanıt    : ...Result içinde (HTML-escaped) XmlDocument — araç listesi.
// Kimlik bilgileri .env'den okunur (ASLA koda/sohbete yazılmaz):
//   ARVENTO_WS_USERNAME, ARVENTO_WS_PIN1, ARVENTO_WS_PIN2, ARVENTO_WS_LANG (varsayılan "tr")
const WS_URL = "https://ws.arvento.com/v1/report.asmx";
const SOAP_ACTION = "http://www.arvento.com/GetVehicleStatusReturnObject";

export type AnlikArac = {
  plaka: string | null;
  lat: number | null;
  lng: number | null;
  hiz: number | null;       // km/s
  tarih: string | null;     // son konum zamanı
  adres: string | null;
  durum: string | null;     // hareket/durdu/kontak vb.
  ham: Record<string, string>; // tüm ham alanlar (parser netleşene kadar)
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
    <GetVehicleStatusReturnObject xmlns="http://www.arvento.com/">
      <Username>${xmlEsc(user)}</Username>
      <PIN1>${xmlEsc(pin1)}</PIN1>
      <PIN2>${xmlEsc(pin2)}</PIN2>
      <Language>${xmlEsc(lang)}</Language>
    </GetVehicleStatusReturnObject>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(WS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Web servisi HTTP ${res.status}: ${text.slice(0, 300)}`);

  // SOAP gövdesinden Result'ı çıkar ve HTML-escape'i çöz
  const m = text.match(/<GetVehicleStatusReturnObjectResult>([\s\S]*?)<\/GetVehicleStatusReturnObjectResult>/i);
  const inner = m ? htmlUnesc(m[1]).trim() : "";
  return { araclar: parseAnlikXml(inner), hamXml: inner };
}

// Araç node'larını ham olarak çıkar. Gerçek alan adları yanıt görülünce eşlenecek;
// şimdilik yaygın isimlerle (plate/latitude/longitude/speed/...) deneme eşlemesi yapılır.
function parseAnlikXml(xml: string): AnlikArac[] {
  if (!xml) return [];
  const out: AnlikArac[] = [];
  // Her tekrar eden kayıt bloğu: <Vehicle>...</Vehicle> ya da benzeri tek seviye node
  // (yapı netleşene kadar en içteki tekrar eden elemanları yakalamaya çalışıyoruz)
  const bloklar = xml.match(/<(Vehicle|Arac|Item|Table|Record)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const blok of bloklar) {
    const ham: Record<string, string> = {};
    for (const mm of blok.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) {
      ham[mm[1].toLowerCase()] = mm[2].trim();
    }
    const al = (...adlar: string[]): string | undefined => {
      for (const a of adlar) if (ham[a] != null && ham[a] !== "") return ham[a];
      return undefined;
    };
    out.push({
      plaka: al("plate", "plaka", "licenseplate", "vehicleplate") ?? null,
      lat: sayi(al("latitude", "lat", "enlem")),
      lng: sayi(al("longitude", "lng", "lon", "boylam")),
      hiz: sayi(al("speed", "hiz", "velocity")),
      tarih: al("date", "datetime", "tarih", "lastupdate", "fixtime") ?? null,
      adres: al("address", "adres", "location") ?? null,
      durum: al("status", "durum", "state") ?? null,
      ham,
    });
  }
  return out;
}
