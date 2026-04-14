// Metin düzenleme toolbar — kalın, italik, altı çizili (toggle modlu)
"use client";

import { useState } from "react";
import { Bold, Italic, Underline } from "lucide-react";

type Props = {
  textareaId: string;
  value: string;
  onChange: (val: string) => void;
};

// Aktif tag'ları yönet — toggle modunda yazarken otomatik tag ekle/kapat
export default function MetinToolbar({ textareaId, value, onChange }: Props) {
  const [boldActive, setBoldActive] = useState(false);
  const [italicActive, setItalicActive] = useState(false);
  const [underlineActive, setUnderlineActive] = useState(false);

  // Seçili metin varsa sarma, yoksa toggle modu
  function handleTag(tag: string, active: boolean, setActive: (v: boolean) => void) {
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);

    if (selected) {
      // Seçili metin var — sarma/çıkarma
      const openTag = `<${tag}>`;
      const closeTag = `</${tag}>`;
      const before = value.substring(0, start);
      const after = value.substring(end);

      if (selected.startsWith(openTag) && selected.endsWith(closeTag)) {
        const unwrapped = selected.slice(openTag.length, -closeTag.length);
        onChange(before + unwrapped + after);
        requestAnimationFrame(() => { textarea.focus(); textarea.selectionStart = start; textarea.selectionEnd = start + unwrapped.length; });
      } else {
        const wrapped = `${openTag}${selected}${closeTag}`;
        onChange(before + wrapped + after);
        requestAnimationFrame(() => { textarea.focus(); textarea.selectionStart = start; textarea.selectionEnd = start + wrapped.length; });
      }
    } else {
      // Seçim yok — toggle modu: cursor pozisyonuna açma/kapama tag'ı ekle
      const openTag = `<${tag}>`;
      const closeTag = `</${tag}>`;
      const before = value.substring(0, start);
      const after = value.substring(end);

      if (active) {
        // Kapatma tag'ı ekle
        const newVal = before + closeTag + after;
        onChange(newVal);
        setActive(false);
        requestAnimationFrame(() => { textarea.focus(); textarea.selectionStart = start + closeTag.length; textarea.selectionEnd = start + closeTag.length; });
      } else {
        // Açma tag'ı ekle
        const newVal = before + openTag + after;
        onChange(newVal);
        setActive(true);
        requestAnimationFrame(() => { textarea.focus(); textarea.selectionStart = start + openTag.length; textarea.selectionEnd = start + openTag.length; });
      }
    }
  }

  return (
    <div className="flex items-center gap-1 border border-gray-200 rounded-t-lg px-2 py-1 bg-gray-50">
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); handleTag("b", boldActive, setBoldActive); }}
        className={`p-1.5 rounded text-gray-600 ${boldActive ? "bg-gray-300" : "hover:bg-gray-200"}`}
        title="Kalın (Ctrl+B)">
        <Bold size={15} />
      </button>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); handleTag("i", italicActive, setItalicActive); }}
        className={`p-1.5 rounded text-gray-600 ${italicActive ? "bg-gray-300" : "hover:bg-gray-200"}`}
        title="İtalik (Ctrl+I)">
        <Italic size={15} />
      </button>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); handleTag("u", underlineActive, setUnderlineActive); }}
        className={`p-1.5 rounded text-gray-600 ${underlineActive ? "bg-gray-300" : "hover:bg-gray-200"}`}
        title="Altı Çizili (Ctrl+U)">
        <Underline size={15} />
      </button>
      <span className="text-[9px] text-gray-400 ml-2">
        {boldActive || italicActive || underlineActive
          ? "Yazın, bitince tekrar basın"
          : "Tıklayıp yazın veya metni seçip basın"}
      </span>
    </div>
  );
}
