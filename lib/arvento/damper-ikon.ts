// "Damper indi" harita işareti — kalkık damperinden malzeme boşaltan kamyon SVG'si.
// TÜM sekmelerde (Stabilize/Serme/Tümü) aynı görünsün diye ortak modül. CSS: app/globals.css
// (.damper-wrap / .damper-rozet / .damper-ikon). renk = işaret rengi; adet>1 ise sağ üstte ×N rozeti.
export function damperKamyonIkonHtml(renk: string, adet = 1): string {
  const rozet = adet > 1 ? `<span class="damper-rozet">${adet}</span>` : "";
  return `<div class="damper-wrap">${rozet}<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="17" cy="30" rx="9" ry="2.2" fill="rgba(0,0,0,.35)"/>
    <circle cx="12" cy="25" r="3.1" fill="#111827"/><circle cx="23" cy="25" r="3.1" fill="#111827"/>
    <circle cx="12" cy="25" r="1.2" fill="#9ca3af"/><circle cx="23" cy="25" r="1.2" fill="#9ca3af"/>
    <rect x="6" y="21" width="21" height="2.4" rx="1" fill="#1f2937"/>
    <path d="M22 13 h4.5 a2 2 0 0 1 1.8 1.2 l1.4 3 a1.5 1.5 0 0 1 .1 .6 V21 H22 Z" fill="${renk}" stroke="#0f172a" stroke-width="1" stroke-linejoin="round"/>
    <rect x="23.2" y="14.6" width="3.4" height="3" rx="0.6" fill="#dbeafe" stroke="#0f172a" stroke-width="0.7"/>
    <polygon points="5,20 8.5,7.5 20.5,10.5 20.5,20" fill="${renk}" stroke="#0f172a" stroke-width="1.1" stroke-linejoin="round"/>
    <g fill="#b45309"><circle cx="4.2" cy="21" r="1.2"/><circle cx="2.7" cy="23.6" r="1"/><circle cx="5.3" cy="24" r="0.9"/></g>
  </svg></div>`;
}
