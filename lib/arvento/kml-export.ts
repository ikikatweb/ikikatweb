// KML dışa aktarma yardımcıları — Google Earth için. Araç rotaları (her biri kendi renginde) + haritaya
// YÜKLÜ KML katmanları (referans NetCAD/KML) tek .kml'de birleşir. Tüm Arvento harita bileşenleri kullanır.
import { getHaritaKatmanlari } from "@/lib/supabase/queries/arvento-katman";
import type { HaritaGeometri } from "@/lib/arvento/kml-parse";
import type { KatmanIzin } from "@/lib/arvento/harita-katman";

// #rrggbb → KML rengi aabbggrr (KML ARGB, ters BGR).
export function kmlRenk(hex: string): string {
  const h = (hex || "#eab308").replace("#", "");
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function geoKml(g: HaritaGeometri, sid: string): string {
  const c = g.noktalar.filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln)).map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)},0`).join(" ");
  if (!c) return "";
  const ad = g.ad ? `<name>${esc(g.ad)}</name>` : "";
  if (g.tip === "alan") return `<Placemark>${ad}<styleUrl>#${sid}</styleUrl><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${c}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  if (g.tip === "nokta") return `<Placemark>${ad}<styleUrl>#${sid}</styleUrl><Point><coordinates>${c}</coordinates></Point></Placemark>`;
  return `<Placemark>${ad}<styleUrl>#${sid}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${c}</coordinates></LineString></Placemark>`;
}

// Haritaya YÜKLÜ KML katmanlarını (referans NetCAD/KML) KML'e çevirir — her katman kendi renginde, ayrı klasörde.
// { stiller, folder } döner; çağıran <Document> içine (stilleri başa, folder'ı gövdeye) ekler. İzinli+görünür olanlar dahil.
export async function yukluKatmanlarKml(katmanIzinli?: KatmanIzin): Promise<{ stiller: string; folder: string }> {
  let stiller = "", ic = "";
  try {
    const katmanlar = (await getHaritaKatmanlari()).filter((kt) => kt.gorunur && (!katmanIzinli || katmanIzinli(kt)));
    katmanlar.forEach((kt, ki) => {
      const sid = `yk${ki}`, renk = kmlRenk(kt.renk || "#eab308");
      stiller += `<Style id="${sid}"><LineStyle><color>${renk}</color><width>${Math.max(2, kt.kalinlik || 2)}</width></LineStyle><PolyStyle><color>33${renk.slice(2)}</color></PolyStyle><IconStyle><color>${renk}</color><scale>0.8</scale></IconStyle></Style>`;
      const geos = (kt.geometriler ?? []).map((g) => geoKml(g, sid)).filter(Boolean).join("\n        ");
      if (geos) ic += `\n      <Folder><name>${esc(kt.ad)}</name>\n        ${geos}\n      </Folder>`;
    });
  } catch { /* katman çekilemezse boş dön → rotalar yine gider */ }
  const folder = ic ? `\n    <Folder><name>Yüklü KML Katmanları</name>${ic}\n    </Folder>` : "";
  return { stiller, folder };
}
