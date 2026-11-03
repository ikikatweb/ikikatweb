// Rich text editör — contentEditable ile anlık bold/italic/underline
"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Bold, Italic, Underline, SpellCheck, X } from "lucide-react";

// YAZIM DENETİMİ NOTU — bir kezlik, tarayıcı başına.
//
// Kırmızı alt çizgiyi TARAYICI çizer ve denetimi site açamaz: Chrome bunu kullanıcı
// tercihi sayıp sayfanın erişimine kapatmıştır (spellcheck özniteliği "açıksa kullan"
// demekten ibarettir). Durumunu JavaScript'ten okumanın da yolu yok — "kapalıysa göster"
// diyemiyoruz, bu yüzden not herkese bir kez çıkar ve kapatılınca bir daha çıkmaz.
//
// Kayıt localStorage'da, KULLANICI HESABINDA DEĞİL: ayarın kendisi de tarayıcı
// başınadır. Aynı kişi denetimi kapalı başka bir tarayıcıdan girdiğinde notu
// yeniden görmesi DOĞRU davranıştır.
const NOT_ANAHTARI = "yazim-denetimi-notu";

type Props = {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
};

export default function RichTextEditor({ value, onChange, placeholder = "", disabled = false, rows = 8 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  function updateActiveStates() {
    setIsBold(document.queryCommandState("bold"));
    setIsItalic(document.queryCommandState("italic"));
    setIsUnderline(document.queryCommandState("underline"));
  }

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    isInternalChange.current = true;
    onChange(el.innerHTML);
    updateActiveStates();
  }, [onChange]);

  function execCmd(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) {
        isInternalChange.current = true;
        onChange(el.innerHTML);
      }
      updateActiveStates();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey && e.key === "b") { e.preventDefault(); execCmd("bold"); }
    if (e.ctrlKey && e.key === "i") { e.preventDefault(); execCmd("italic"); }
    if (e.ctrlKey && e.key === "u") { e.preventDefault(); execCmd("underline"); }
    if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "\t"); }
    // Enter: doğal paragraf oluşur, otomatik tab eklenmez
  }

  // Word'den yapıştırılan içerik için temizleme — mso-* attribute'leri, conditional
  // comment'ler, font-family fragmentları vb. sıyrılır. Sadece bold/italic/underline
  // ve paragraf/satır yapısı korunur
  function wordYapistirmaTemizle(html: string): string {
    const temiz = html
      // Word conditional comments ve XML namespaced tag'lar
      .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
      .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[a-z]+:[a-z0-9_-]+\b[^>]*>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<meta[^>]*>/gi, "")
      .replace(/<link[^>]*>/gi, "");

    // DOMParser ile güvenli temizleme
    if (typeof DOMParser === "undefined") return temiz;
    const doc = new DOMParser().parseFromString(`<div>${temiz}</div>`, "text/html");
    const root = doc.body.firstChild as HTMLElement | null;
    if (!root) return "";

    const escapeText = (s: string) => {
      // Word'den gelen \n, \r'ları boşluğa çevir; tab'ları ve normal boşlukları koru
      const normalized = s
        .replace(/[\r\n]+/g, " ")   // satır sonu → boşluk
        .replace(/ {2,}/g, " ");     // sadece çoklu BOŞLUK → tek (tab dokunulmaz)
      return normalized.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    // Walk: her blok (<p>/<div>/<h1-6>) için paragraf içeriğini düz toplar
    // İçindeki span/b/i/u gibi inline tag'ları kendi biçimleriyle korur
    // Return: { blok: true/false, text: string }
    // - blok true ise bu node bir paragraf, text tek div olarak sarıldı
    // - blok false ise inline text, üst blok tarafından birleştirilir

    function walkInline(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeText(node.textContent ?? "");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const icerik = Array.from(el.childNodes).map(walkInline).join("");

      if (tag === "b" || tag === "strong") return icerik ? `<b>${icerik}</b>` : "";
      if (tag === "i" || tag === "em") return icerik ? `<i>${icerik}</i>` : "";
      if (tag === "u") return icerik ? `<u>${icerik}</u>` : "";
      // Paragraf içindeki <br> (Word'ün satır kaydırması için koyduğu) → boşluk
      // Kullanıcı gerçek satır kesmek isterse Enter ile yeni paragraf oluşturur
      if (tag === "br") return " ";

      // Span/font → style-tabanlı biçim
      const style = el.getAttribute("style") ?? "";
      const bold = /font-weight\s*:\s*(bold|[6-9]00|1000)/i.test(style);
      const italic = /font-style\s*:\s*italic/i.test(style);
      const underline = /text-decoration[^;]*underline/i.test(style);
      let sonuc = icerik;
      if (sonuc) {
        if (bold) sonuc = `<b>${sonuc}</b>`;
        if (italic) sonuc = `<i>${sonuc}</i>`;
        if (underline) sonuc = `<u>${sonuc}</u>`;
      }
      return sonuc;
    }

    // Bir elementin içinde blok (p/div/h*) varsa, her biri ayrı paragraf olur
    // Yoksa tek paragraf olarak inline içeriği döner
    // Her paragraf için inline style: iki yana yaslı, margin sıfır
    // (Word'ün kendi boş paragrafları aralıkları sağlar — biz otomatik eklemiyoruz)
    const PARAGRAF_STYLE = 'style="text-align:justify;margin:0"';

    function walkBlok(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = escapeText(node.textContent ?? "");
        return t.trim() ? `<div ${PARAGRAF_STYLE}>${t}</div>` : "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // İçinde blok element var mı?
      const cocuklarBlok = Array.from(el.children).some((c) => {
        const ct = c.tagName.toLowerCase();
        return ct === "p" || ct === "div" || /^h[1-6]$/.test(ct) || ct === "table" || ct === "tr" || ct === "td" || ct === "li" || ct === "ul" || ct === "ol";
      });

      if (tag === "p" || tag === "div" || /^h[1-6]$/.test(tag) || tag === "li") {
        if (cocuklarBlok) {
          return Array.from(el.childNodes).map(walkBlok).join("");
        }
        const icerik = Array.from(el.childNodes).map(walkInline).join("").trim();
        // BOŞ paragraflar — Word'ün aralık için kullandığı boş <p>'leri <div><br></div>
        if (!icerik) return '<div style="margin:0"><br></div>';

        // Paragrafın liste maddesi / kısa etiket olup olmadığını kontrol et
        // Liste maddeleri: "a)", "b)", "- ", "• ", "1.", "2.", vb.
        // Kısa etiketler: "Konu:", "Tarih:", "Sonuç olarak;", "Bu kapsamda;"
        // "T.C.", "TOKAT" gibi ortalı başlıklar — 30 karakterden az
        const plainText = icerik.replace(/<[^>]+>/g, "").trim();
        const listeMaddesi = /^[a-zçğıöşüA-ZÇĞİÖŞÜ][\.\)]\s|^\d+[\.\)]\s|^[-•*◦–—]\s|^["'„]/.test(plainText);
        const kisaEtiket = plainText.length < 30 && /[:;]$/.test(plainText);
        const coKisa = plainText.length < 15; // "T.C.", "TOKAT" gibi

        // Word'ün paragraf style'ında text-indent var mı?
        const style = el.getAttribute("style") ?? "";
        const indentMatch = style.match(/text-indent\s*:\s*([^;]+)/i);
        const className = el.getAttribute("class") ?? "";

        let paragrafStyle = "text-align:justify;margin:0";
        if (indentMatch) {
          // Word'den direkt indent geldi
          const indentDeger = indentMatch[1].trim();
          if (indentDeger && !/^0(pt|px|cm|mm|em|%)?\s*$/.test(indentDeger)) {
            paragrafStyle += `;text-indent:${indentDeger}`;
          }
        } else if (/BodyTextIndent|FirstLine/i.test(className)) {
          paragrafStyle += ";text-indent:1.25cm";
        } else if (!listeMaddesi && !kisaEtiket && !coKisa) {
          // Word'den indent gelmedi VE liste maddesi/kısa etiket değil
          // → varsayılan 1.25cm tab ekle (uzun prose paragraflar için)
          paragrafStyle += ";text-indent:1.25cm";
        }

        return `<div style="${paragrafStyle}">${icerik}</div>`;
      }

      if (cocuklarBlok) {
        return Array.from(el.childNodes).map(walkBlok).join("");
      }
      const icerik = Array.from(el.childNodes).map(walkInline).join("").trim();
      return icerik ? `<div ${PARAGRAF_STYLE}>${icerik}</div>` : "";
    }

    const hamHtml = walkBlok(root);

    // Post-process: Word'ün ayrı <w:p>'ye böldüğü ama görsel olarak tek paragraf
    // olan bölümleri birleştir. Heuristik: önceki paragraf .!?:;… ile bitmiyorsa VE
    // sonraki paragraf küçük harfle başlıyorsa — birleştir
    if (typeof DOMParser === "undefined") return hamHtml;
    const postDoc = new DOMParser().parseFromString(`<div>${hamHtml}</div>`, "text/html");
    const postRoot = postDoc.body.firstChild as HTMLElement | null;
    if (!postRoot) return hamHtml;

    const paragraflar: HTMLElement[] = [];
    for (const c of Array.from(postRoot.children)) {
      const el = c as HTMLElement;
      if (el.tagName.toLowerCase() !== "div") {
        paragraflar.push(el);
        continue;
      }
      const mevcutText = (el.textContent ?? "").trim();
      const oncekiP = paragraflar[paragraflar.length - 1];
      if (!oncekiP) {
        paragraflar.push(el);
        continue;
      }
      const oncekiText = (oncekiP.textContent ?? "").trim();

      // Önceki boşsa veya şu anki boşsa → birleştirme
      if (!oncekiText || !mevcutText) {
        paragraflar.push(el);
        continue;
      }

      // Önceki paragraf cümle sonu ile bitiyor mu?
      const cumleBitisRegex = /[.!?:;…»"']\s*$/;
      const oncekiTamBitmis = cumleBitisRegex.test(oncekiText);

      // Şu anki küçük harfle (Türkçe dahil) başlıyor mu?
      const ilkKarakter = mevcutText.charAt(0);
      const kucukHarfBasliyor = /^[a-zçğıöşü]/.test(ilkKarakter);

      if (!oncekiTamBitmis && kucukHarfBasliyor) {
        // Birleştir: şu anki içeriği önceki'nin sonuna ekle (boşluk ile)
        oncekiP.innerHTML = oncekiP.innerHTML.trimEnd() + " " + el.innerHTML.trimStart();
      } else {
        paragraflar.push(el);
      }
    }

    return paragraflar.map((p) => p.outerHTML).join("");
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Clipboard'daki HTML'i al (varsa)
    const clipboardHtml = e.clipboardData.getData("text/html");
    const clipboardText = e.clipboardData.getData("text/plain");

    if (!clipboardHtml && !clipboardText) return; // browser'a bırak

    e.preventDefault();

    let icerik: string;
    if (clipboardHtml) {
      // Word/HTML yapıştırma → temizle
      icerik = wordYapistirmaTemizle(clipboardHtml);
    } else {
      // Plain text → newline'ları <br> veya <div>'e çevir
      icerik = clipboardText
        .split("\n")
        .map((line) => `<div>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</div>`)
        .join("");
    }

    // İmleç konumuna insert et
    document.execCommand("insertHTML", false, icerik);
    handleInput();
  }

  // İlk karakter girildiğinde sadece büyük harf (tab otomatik eklenmez)
  function handleBeforeInput(e: React.FormEvent<HTMLDivElement>) {
    const el = editorRef.current;
    if (!el) return;
    const inputEvent = e.nativeEvent as InputEvent;
    const data = inputEvent.data;
    if (!data) return;
    const text = el.textContent ?? "";
    if (text.length === 0) {
      e.preventDefault();
      document.execCommand("insertText", false, data.toUpperCase());
      isInternalChange.current = true;
      onChange(el.innerHTML);
    }
  }

  // Not: ilk açılışta görünür, "Anladım" ile kapanır.
  const [notGoster, setNotGoster] = useState(false);
  const [nasilAcik, setNasilAcik] = useState(false);
  useEffect(() => {
    // Gizli sekmede/depo kapalıysa okuma hata atar — notun çıkması zarar vermez, çıksın.
    try { if (localStorage.getItem(NOT_ANAHTARI) !== "kapali") setNotGoster(true); }
    catch { setNotGoster(true); }
  }, []);
  // Simge: anlatımı açar/kapatır. Şerit kapatılmışsa geri getirir — ama KALICI kaydı
  // değiştirmez; kullanıcı "Anladım"a basmadıkça tercihi bozulmaz.
  const anlatimAcKapa = () => {
    if (notGoster && nasilAcik) { setNotGoster(false); setNasilAcik(false); return; }
    setNotGoster(true); setNasilAcik(true);
  };
  const notuKapat = () => {
    setNotGoster(false);
    // Yazılamazsa not bir dahaki açılışta YİNE çıkar; sessiz bir kayıp değil, kullanıcı görür.
    try { localStorage.setItem(NOT_ANAHTARI, "kapali"); } catch { /* depo kapalı */ }
  };

  function btnClass(active: boolean) {
    return `p-1.5 rounded ${active ? "bg-[#1E3A5F] text-white" : "text-gray-600 hover:bg-gray-200"}`;
  }

  return (
    <div>
      <div className="flex items-center gap-1 border border-gray-200 rounded-t-lg px-2 py-1 bg-gray-50">
        <button type="button"
          onMouseDown={(e) => { e.preventDefault(); execCmd("bold"); }}
          className={btnClass(isBold)}
          title="Kalın (Ctrl+B)">
          <Bold size={15} />
        </button>
        <button type="button"
          onMouseDown={(e) => { e.preventDefault(); execCmd("italic"); }}
          className={btnClass(isItalic)}
          title="İtalik (Ctrl+I)">
          <Italic size={15} />
        </button>
        <button type="button"
          onMouseDown={(e) => { e.preventDefault(); execCmd("underline"); }}
          className={btnClass(isUnderline)}
          title="Altı Çizili (Ctrl+U)">
          <Underline size={15} />
        </button>
        {/* Şerit "Anladım" ile kapandıktan sonra anlatıma ulaşmanın tek yolu bu simge.
            Yazım denetiminin açık mı kapalı mı olduğunu tarayıcı sayfaya söylemediği
            için "yalnız kapalı olana göster" denemiyor; onun yerine kimseyi
            rahatsız etmeyen kalıcı bir giriş bırakılıyor. */}
        <button type="button"
          onClick={anlatimAcKapa}
          className="ml-auto flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          title="Hatalı kelimelerin altı çizilmiyor mu? Yazım denetimi nasıl açılır">
          <SpellCheck size={14} /> Yazım denetimi
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        // Yazım denetimi (kırmızı alt çizgi) tarayıcının işi; burada AÇIKÇA isteniyor.
        // Öznitelik yazılmadığında değer üst öğeden miras kalıyor ve ortama göre
        // değişebiliyordu — canlıda çizgi çıkmıyordu. lang="tr": Chrome sözlüğü
        // buradan seçiyor, yoksa yabancı sözlükle denetleyip hiçbir şey işaretlemiyor.
        spellCheck
        lang="tr"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
        onMouseUp={updateActiveStates}
        onKeyUp={updateActiveStates}
        data-placeholder={placeholder}
        className="rich-text-editor-content w-full border border-t-0 border-gray-200 rounded-b-lg px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 overflow-y-auto whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 [&_div]:text-justify [&_p]:text-justify [&_p]:my-0 [&_div]:my-0"
        style={{ minHeight: `${rows * 1.5}rem`, textAlign: "justify", tabSize: "1.25cm", MozTabSize: "1.25cm" } as React.CSSProperties}
      />
      {!disabled && notGoster && (
        <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] leading-snug text-blue-900">
          <div className="flex items-start gap-2">
            <SpellCheck size={15} className="mt-0.5 shrink-0 text-blue-600" />
            <div className="flex-1">
              <b>Hatalı kelimelerin altı kırmızı çizilmiyor mu?</b> Yazım denetimi tarayıcı
              ayarıdır, site kendiliğinden açamaz — üç adımda siz açarsınız, sonra açık kalır.
            </div>
            <button type="button" onClick={() => setNasilAcik((v) => !v)}
              className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-blue-700">
              {nasilAcik ? "Gizle" : "Nasıl açılır?"}
            </button>
            <button type="button" onClick={notuKapat}
              className="shrink-0 rounded-md border border-blue-300 bg-white px-2 py-1 text-[11.5px] font-semibold text-blue-800 hover:bg-blue-100"
              title="Bu notu bir daha gösterme">
              Anladım
            </button>
            <button type="button" onClick={notuKapat} className="shrink-0 text-blue-400 hover:text-blue-700" title="Kapat">
              <X size={14} />
            </button>
          </div>
          {/* OKUYUP UYGULAYAMAYAN İÇİN: menünün nasıl göründüğü ÇİZİLİ olarak gösterilir.
              Sağ tık menüsünü sayfa açamadığı için en fazlası budur. */}
          {nasilAcik && (
            <div className="mt-2 flex flex-wrap items-start gap-4 border-t border-blue-200 pt-2">
              <ol className="flex-1 min-w-[220px] list-decimal space-y-1 pl-4">
                <li>Yukarıdaki <b>yazı alanının içine sağ tıklayın</b>.</li>
                <li>Açılan menüde <b>Yazım denetimi</b> satırının üstüne gelin.</li>
                <li>Yandaki listede <b>Bu metin alanında yazım denetimi yap</b> seçeneğini işaretleyin.</li>
                <li className="text-blue-700">Hâlâ çizilmiyorsa: Chrome <b>Ayarlar → Diller → Yazım denetimi</b>&apos;nde <b>Türkçe</b>&apos;yi işaretleyin.</li>
              </ol>
              <svg viewBox="0 0 330 150" className="h-[150px] w-[330px] shrink-0" role="img"
                aria-label="Sağ tık menüsünde Yazım denetimi ve Bu metin alanında yazım denetimi yap seçeneği">
                <rect x="1" y="1" width="150" height="130" rx="7" fill="#fff" stroke="#cbd5e1" />
                <text x="14" y="24" fontSize="11" fill="#475569">Geri al</text>
                <text x="14" y="44" fontSize="11" fill="#475569">Kes</text>
                <text x="14" y="64" fontSize="11" fill="#475569">Kopyala</text>
                <text x="14" y="84" fontSize="11" fill="#475569">Yapıştır</text>
                <rect x="6" y="94" width="140" height="22" rx="4" fill="#dbeafe" stroke="#60a5fa" />
                <text x="14" y="109" fontSize="11" fontWeight="600" fill="#1e3a5f">Yazım denetimi</text>
                <text x="134" y="109" fontSize="11" fill="#1e3a5f">›</text>
                <path d="M152 105 L168 105" stroke="#60a5fa" strokeWidth="1.5" />
                <rect x="168" y="62" width="160" height="62" rx="7" fill="#fff" stroke="#cbd5e1" />
                <rect x="173" y="68" width="150" height="34" rx="4" fill="#dbeafe" stroke="#60a5fa" />
                <text x="181" y="82" fontSize="10" fontWeight="600" fill="#1e3a5f">✓ Bu metin alanında</text>
                <text x="181" y="95" fontSize="10" fontWeight="600" fill="#1e3a5f">   yazım denetimi yap</text>
                <text x="181" y="116" fontSize="10" fill="#475569">Yazım denetimi ayarları</text>
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
