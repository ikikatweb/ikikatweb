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
        onMouseUp={updateActiveStates}
        onKeyUp={updateActiveStates}
        data-placeholder={placeholder}
        className="w-full border border-t-0 border-gray-200 rounded-b-lg px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 overflow-y-auto whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
        style={{ minHeight: `${rows * 1.5}rem` }}
      />
    </div>
  );
}
