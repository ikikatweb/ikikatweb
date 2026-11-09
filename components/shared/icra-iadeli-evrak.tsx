// İADELİ TAAHHÜTLÜ CEVAP — evrak ELLE YAZILMAZ, GİDEN EVRAKTAN GELİR.
//
// NİYE: iadeli taahhütlü cevap, panelde zaten yazılan bir giden evraktır. Tarihi
// ve kayıt numarasını ikinci kez elle yazdırmak iki kayıt arasında tutarsızlık
// üretiyordu — icra defterinde "12345" yazarken giden evrakta "12346" olabiliyor
// ve hangisinin doğru olduğu sonradan anlaşılmıyordu. Artık ya var olan evrak
// seçiliyor ya da pencere kapanmadan yenisi yazılıyor; iki alan da oradan geliyor.
//
// ÖDENEN TUTAR SORULMAZ: iadeli taahhütlü bir yazışma, ödeme değil.
"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FileText, Loader2, PenLine, Search, X } from "lucide-react";
import { getGidenEvraklar } from "@/lib/supabase/queries/giden-evrak";
import { trAramaNormalize } from "@/lib/utils/isim";
import type { GidenEvrakWithRelations } from "@/lib/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GidenEvrakForm from "@/components/shared/giden-evrak-form";

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");

/** HTML etiketleri atılmış düz metin — arama <p>cevap</p> gibi etiketlere takılmasın. */
const duzMetin = (m: string | null | undefined) =>
  String(m ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Arama metnin İÇİNDE eşleşiyorsa, eşleşen yerin çevresinden kısa bir parça.
 * Konu/muhatapta zaten görünen eşleşme için boş döner — aynı şeyi iki kere
 * göstermenin anlamı yok. Metinde eşleşip listede hiçbir yerde görünmeyen bir
 * satır "niye bu çıktı" sorusunu doğuruyordu.
 */
function metinOzeti(e: { konu?: string | null; muhatap?: string | null; metin?: string | null }, arama: string): string {
  const q = trAramaNormalize(arama.trim());
  if (q.length < 3) return "";
  if (trAramaNormalize([e.konu, e.muhatap].filter(Boolean).join(" ")).includes(q)) return "";
  const duz = duzMetin(e.metin);
  const i = trAramaNormalize(duz).indexOf(q);
  if (i < 0) return "";
  return duz.slice(Math.max(0, i - 35), i + q.length + 45);
}

/**
 * İcra defterine yazılacak evrak numarası.
 * evrak_kayit_no asıl kayıt numarasıdır ama boş olabilir; o zaman evrak sayı
 * numarasına düşülür. Uydurulmaz: ikisi de yoksa boş kalır ve ekran söyler.
 */
export function evrakNumarasi(e: { evrak_kayit_no?: string | null; evrak_sayi_no?: string | null }): string {
  return (e.evrak_kayit_no ?? "").trim() || (e.evrak_sayi_no ?? "").trim();
}

export default function IcraIadeliEvrak({ evrakNo, cevapTarihi, degistir, kilitli }: {
  evrakNo: string;
  cevapTarihi: string;
  degistir: (y: { evrak_no?: string; cevap_tarihi?: string }) => void;
  kilitli?: boolean;
}) {
  const [secimAcik, setSecimAcik] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [liste, setListe] = useState<GidenEvrakWithRelations[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [arama, setArama] = useState("");

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try { setListe((await getGidenEvraklar()) as GidenEvrakWithRelations[]); }
    catch (e) {
      // SESSİZ GEÇİLMEZ: liste gelmezse kullanıcı "evrak yok" sanır ve elle yazmaya
      // kalkar; oysa alan elle doldurulmuyor.
      toast.error(e instanceof Error ? e.message : "Giden evraklar okunamadı.");
    }
    finally { setYukleniyor(false); }
  }, []);

  useEffect(() => { if (secimAcik) void yukle(); }, [secimAcik, yukle]);

  function sec(e: GidenEvrakWithRelations) {
    const no = evrakNumarasi(e);
    if (!no) {
      toast.error("Bu evrakın kayıt/sayı numarası yok — icra defterine yazılacak numara bulunamadı.");
      return;
    }
    degistir({ evrak_no: no, cevap_tarihi: e.evrak_tarihi });
    setSecimAcik(false);
    toast.success(`Evrak seçildi · ${no} · ${tarihGoster(e.evrak_tarihi)}`);
  }

  const gorunen = (() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return liste.slice(0, 60);
    // METİN DE ARANIR: insan yazıyı konusundan değil içinden hatırlıyor ("şu
    // dosyada haciz ihbarnamesine cevap yazmıştık"). Konu çoğu evrakta kısa ve
    // birbirine benziyor; ayırt edici olan metnin kendisi.
    return liste.filter((e) => trAramaNormalize(
      [e.konu, e.muhatap, e.evrak_kayit_no, e.evrak_sayi_no, e.firmalar?.firma_adi,
        duzMetin(e.metin), (e.ilgi_listesi ?? []).join(" ")].filter(Boolean).join(" "),
    ).includes(q)).slice(0, 60);
  })();

  const dugme = "inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors";

  return (
    <div className="sm:col-span-2">
      <label className="text-xs font-medium text-gray-600 mb-1 block">Cevap yazısı</label>

      {evrakNo || cevapTarihi ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <FileText size={14} className="shrink-0" />
          <span><strong>{evrakNo || "numara yok"}</strong> · {tarihGoster(cevapTarihi || null)}</span>
          {!kilitli && (
            <button type="button" onClick={() => degistir({ evrak_no: "", cevap_tarihi: "" })}
              className="ml-auto inline-flex items-center gap-1 text-emerald-700 hover:underline">
              <X size={12} /> kaldır
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={kilitli} onClick={() => setSecimAcik(true)}
            className={`${dugme} border-gray-300 bg-white text-[#1E3A5F] hover:bg-gray-50 disabled:opacity-50`}>
            <Search size={14} /> Eski yazışmalardan seç
          </button>
          <button type="button" disabled={kilitli} onClick={() => setYeniAcik(true)}
            className={`${dugme} border-[#1E3A5F] bg-[#1E3A5F] text-white hover:bg-[#162c47] disabled:opacity-50`}>
            <PenLine size={14} /> Yeni yaz
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-gray-500">
        Evrak numarası ve cevap tarihi seçilen giden evraktan gelir; elle yazılmaz.
      </p>

      {/* ESKİ YAZIŞMALARDAN SEÇ */}
      <Dialog open={secimAcik} onOpenChange={setSecimAcik}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Giden evraktan seç</DialogTitle></DialogHeader>
          <div className="relative shrink-0">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={arama} onChange={(e) => setArama(e.target.value)}
              placeholder="Konu, muhatap, evrak no, yazının içinde geçen söz…"
              className="w-full h-9 pl-8 pr-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {yukleniyor ? (
              <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
                <Loader2 size={16} className="animate-spin" /> Yükleniyor…
              </div>
            ) : gorunen.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                {arama.trim() ? "Aramayla eşleşen evrak yok." : "Giden evrak yok."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {gorunen.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => sec(e)}
                      className="w-full text-left px-2 py-2 hover:bg-gray-50">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-[#1E3A5F] truncate">{e.konu}</span>
                        <span className="shrink-0 text-xs tabular-nums text-gray-500">{tarihGoster(e.evrak_tarihi)}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {evrakNumarasi(e) || <span className="text-amber-700">numara yok</span>}
                        {e.muhatap ? ` · ${e.muhatap.split("\n")[0]}` : ""}
                      </div>
                      {/* EŞLEŞME METİNDEYSE GÖSTERİLİR: konu ve muhatapta görünmeyen
                          bir eşleşme "niye bu satır çıktı" sorusunu doğuruyordu. */}
                      {metinOzeti(e, arama) && (
                        <div className="text-[11px] text-gray-400 truncate">…{metinOzeti(e, arama)}…</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* YENİ YAZ — icra penceresi KAPANMADAN üstte açılır. Evrak kaydedilince
          numarası ve tarihi buraya düşer; kullanıcı icra penceresine geri döner. */}
      <Dialog open={yeniAcik} onOpenChange={(a, d) => {
        // Boşluğa/ESC'e basınca kapanmasın: içeride yazılmış metin kaybolur.
        if (!a && (d as { reason?: string } | undefined)?.reason === "escape-key") return;
        setYeniAcik(a);
      }} disablePointerDismissal>
        {/* BOYUT SAYFADAKİYLE AYNI: giden evrak sayfasının açtığı pencere
            !w-[95vw] md:!w-[50vw] max-h-[95vh] pb-0 kullanıyor. Burada daha dar
            açılınca aynı form iki yerde farklı görünüyor, metin kutusu daralıyordu. */}
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[95vh] overflow-y-auto pb-0">
          <DialogHeader><DialogTitle>Yeni Giden Evrak</DialogTitle></DialogHeader>
          <GidenEvrakForm
            onCancel={() => setYeniAcik(false)}
            onSuccess={(kaydedilen) => {
              setYeniAcik(false);
              if (!kaydedilen) {
                // SESSİZ GEÇİLMEZ: evrak kaydedildi ama bilgisi geri gelmedi.
                toast.error("Evrak kaydedildi ama numarası okunamadı — listeden seçin.");
                return;
              }
              const no = evrakNumarasi(kaydedilen);
              if (!no) {
                toast.error("Evrak kaydedildi ama kayıt/sayı numarası boş — icra defterine yazılacak numara yok.");
                return;
              }
              degistir({ evrak_no: no, cevap_tarihi: kaydedilen.evrak_tarihi });
              toast.success(`Evrak yazıldı · ${no} · ${tarihGoster(kaydedilen.evrak_tarihi)}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
