// KML / KMZ dosyalarını harita geometrilerine çevirir (tarayıcı tarafı).
// NetCAD vb. CAD yazılımlarından "Google Earth'e Aktar" ile üretilen KML'ler WGS84
// (enlem/boylam) olduğundan doğrudan Leaflet'e basılabilir. KMZ = zip'li KML (jszip ile açılır).
// Harici togeojson bağımlılığı yok; KML standart XML olduğundan DOMParser ile okunur.

export type HaritaGeometri = {
  tip: "cizgi" | "alan" | "nokta";
  noktalar: [number, number][]; // [lat, lng] sırasıyla
  ad?: string;
};

// "lng,lat,alt lng,lat,alt ..." → [[lat,lng], ...]
function koordinatAyikla(metin: string): [number, number][] {
  const out: [number, number][] = [];
  for (const tok of metin.trim().split(/\s+/)) {
    const p = tok.split(",");
    if (p.length < 2) continue;
    const lng = parseFloat(p[0]);
    const lat = parseFloat(p[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
  }
  return out;
}

function kmlMetniAyrıştır(kml: string): HaritaGeometri[] {
  const doc = new DOMParser().parseFromString(kml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("KML çözümlenemedi (geçersiz XML).");
  }
  const geos: HaritaGeometri[] = [];
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const liste: Element[] = placemarks.length ? placemarks : [doc.documentElement];

  for (const pm of liste) {
    const ad = pm.getElementsByTagName("name")[0]?.textContent?.trim() || undefined;

    for (const ls of Array.from(pm.getElementsByTagName("LineString"))) {
      const c = ls.getElementsByTagName("coordinates")[0]?.textContent;
      if (!c) continue;
      const n = koordinatAyikla(c);
      if (n.length >= 2) geos.push({ tip: "cizgi", noktalar: n, ad });
    }
    for (const pg of Array.from(pm.getElementsByTagName("Polygon"))) {
      const ring = pg.getElementsByTagName("LinearRing")[0];
      const c = ring?.getElementsByTagName("coordinates")[0]?.textContent;
      if (!c) continue;
      const n = koordinatAyikla(c);
      if (n.length >= 3) geos.push({ tip: "alan", noktalar: n, ad });
    }
    for (const pt of Array.from(pm.getElementsByTagName("Point"))) {
      const c = pt.getElementsByTagName("coordinates")[0]?.textContent;
      if (!c) continue;
      const n = koordinatAyikla(c);
      if (n.length >= 1) geos.push({ tip: "nokta", noktalar: [n[0]], ad });
    }
  }
  return geos;
}

// .kml veya .kmz dosyasından geometrileri çıkar. Hiç geometri yoksa hata fırlatır.
export async function dosyadanGeometriler(file: File): Promise<HaritaGeometri[]> {
  const adKucuk = file.name.toLowerCase();
  let kml: string;
  if (adKucuk.endsWith(".kmz")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".kml"));
    if (!kmlEntry) throw new Error("KMZ içinde .kml dosyası bulunamadı.");
    kml = await kmlEntry.async("string");
  } else {
    kml = await file.text();
  }
  const geos = kmlMetniAyrıştır(kml);
  if (geos.length === 0) throw new Error("Dosyada çizgi/alan/nokta bulunamadı.");
  return geos;
}
