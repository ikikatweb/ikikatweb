// Rich text editör — contentEditable ile anlık bold/italic/underline
"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";

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
    // Enter'a basıldığında: doğal paragraf oluşsun, sonra tab ekle
    if (e.key === "Enter" && !e.shiftKey) {
      // Doğal davranışa izin ver, sonra tab ekle
      setTimeout(() => {
        document.execCommand("insertText", false, "\t");
        handleInput();
      }, 0);
    }
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

  // İlk karakter girildiğinde tab + büyük harf
  function handleBeforeInput(e: React.FormEvent<HTMLDivElement>) {
    const el = editorRef.current;
    if (!el) return;
    const inputEvent = e.nativeEvent as InputEvent;
    const data = inputEvent.data;
    if (!data) return;
    const text = el.textContent ?? "";
    if (text.length === 0) {
      e.preventDefault();
      document.execCommand("insertText", false, "\t" + data.toUpperCase());
      isInternalChange.current = true;
      onChange(el.innerHTML);
    }
  }

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
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
        onMouseUp={updateActiveStates}
        onKeyUp={updateActiveStates}
        data-placeholder={placeholder}
        className="rich-text-editor-content w-full border border-t-0 border-gray-200 rounded-b-lg px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 overflow-y-auto whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 [&_div]:text-justify [&_p]:text-justify [&_p]:my-0 [&_div]:my-0"
        style={{ minHeight: `${rows * 1.5}rem`, textAlign: "justify", tabSize: 16, MozTabSize: 16 } as React.CSSProperties}
      />
    </div>
  );
}
