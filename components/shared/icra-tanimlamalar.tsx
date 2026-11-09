// İcra Tanımlamaları — İcra Takibi sayfasının "Tanımlamalar" sekmesi içeriği (şimdilik: Cevap Şekli seçenekleri).
"use client";

import { useCallback, useEffect, useState } from "react";
import { getTanimlamalar, createTanimlama, updateTanimlama, deleteTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import { createClient } from "@/lib/supabase/client";
import type { Tanimlama } from "@/lib/supabase/types";
import { Plus, Trash2, Loader2, Pencil, Check, X, Scale } from "lucide-react";
import { getAvukatlar, insertAvukat, updateAvukat, deleteAvukat } from "@/lib/supabase/queries/avukatlar";
import { telefonGoster } from "@/lib/utils/telefon";
import type { Avukat } from "@/lib/supabase/types";
import toast from "react-hot-toast";

const KATEGORI = "icra_cevap_sekli";

export default function IcraTanimlamalar({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [liste, setListe] = useState<Tanimlama[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yeni, setYeni] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [duzenleId, setDuzenleId] = useState<string | null>(null);
  const [duzenleDeger, setDuzenleDeger] = useState("");

  const yukle = useCallback(async () => {
    try { const d = await getTanimlamalar(KATEGORI); setListe((d ?? []) as Tanimlama[]); }
    catch { toast.error("Yüklenemedi."); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const varMi = (v: string) => liste.some((t) => t.deger.toLocaleLowerCase("tr") === v.trim().toLocaleLowerCase("tr"));

  async function ekle(deger: string, sira: number) {
    await createTanimlama({ kategori: KATEGORI, sekme: "icra", deger: deger.trim(), sira, aktif: true });
  }
  async function yeniEkle() {
    const v = yeni.trim();
    if (!v) return;
    if (varMi(v)) { toast.error("Bu değer zaten var."); return; }
    setKaydediliyor(true);
    try { await ekle(v, liste.reduce((m, t) => Math.max(m, t.sira), 0) + 1); setYeni(""); await yukle(); }
    catch { toast.error("Eklenemedi."); }
    finally { setKaydediliyor(false); }
  }
  async function sil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu değer silinsin mi?")) return;
    try { await deleteTanimlama(id); await yukle(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Silinemedi."); }
  }
  function duzenleBasla(t: Tanimlama) { setDuzenleId(t.id); setDuzenleDeger(t.deger); }
  async function duzenleKaydet() {
    if (!duzenleId) return;
    const v = duzenleDeger.trim();
    if (!v) { toast.error("Boş olamaz."); return; }
    const eski = liste.find((t) => t.id === duzenleId)?.deger ?? ""; // eski değer (icra kayıtlarında saklı)
    if (liste.some((t) => t.id !== duzenleId && t.deger.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) { toast.error("Bu değer zaten var."); return; }
    try {
      await updateTanimlama(duzenleId, { deger: v });
      // Bu cevap şeklini KULLANAN mevcut icra kayıtlarını da yeni değere güncelle (geriye dönük — tabloda da değişsin)
      if (eski && eski !== v) {
        try { await createClient().from("icra").update({ cevap_sekli: v }).eq("cevap_sekli", eski); } catch { /* sessiz */ }
      }
      setDuzenleId(null); await yukle();
    } catch { toast.error("Güncellenemedi."); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl items-start">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="mb-3">
          <h2 className="font-semibold text-gray-800">Cevap Şekli</h2>
        </div>

        {yukleniyor ? (
          <div className="flex items-center gap-2 text-gray-400 py-6"><Loader2 size={16} className="animate-spin" /> Yükleniyor…</div>
        ) : (
          <>
            {liste.length === 0 && <p className="text-sm text-gray-400 mb-3">Henüz seçenek yok. Aşağıdan ekleyin.</p>}
            <ul className="divide-y divide-gray-100 mb-3">
              {liste.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 gap-2">
                  {duzenleId === t.id ? (
                    <>
                      <input value={duzenleDeger} onChange={(e) => setDuzenleDeger(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void duzenleKaydet(); } if (e.key === "Escape") setDuzenleId(null); }}
                        className="flex-1 h-8 px-2 text-sm rounded border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
                      <button type="button" onClick={duzenleKaydet} className="text-emerald-600" title="Kaydet"><Check size={16} /></button>
                      <button type="button" onClick={() => setDuzenleId(null)} className="text-gray-400 hover:text-gray-600" title="İptal"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-800 flex-1">{t.deger}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {canDuzenle && <button type="button" onClick={() => duzenleBasla(t)} className="text-gray-300 hover:text-[#1E3A5F]" title="Düzenle"><Pencil size={14} /></button>}
                        {canSil && <button type="button" onClick={() => sil(t.id)} className="text-gray-300 hover:text-red-600" title="Sil"><Trash2 size={15} /></button>}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {canEkle && (
              <div className="flex items-center gap-2">
                <input type="text" value={yeni} onChange={(e) => setYeni(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void yeniEkle(); } }}
                  placeholder="Yeni cevap şekli (ör. KEP)"
                  className="flex-1 h-9 px-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
                <button type="button" onClick={yeniEkle} disabled={kaydediliyor || !yeni.trim()}
                  className="flex items-center gap-1 h-9 px-3 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                  <Plus size={15} /> Ekle
                </button>
              </div>
            )}
          </>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Buraya eklenen değerler Üçüncü Şahıs Hacizleri tablosundaki “Cevap Şekli” açılır listesinde görünür.</p>
      </div>

      <AvukatListesi canEkle={canEkle} canDuzenle={canDuzenle} canSil={canSil} />
    </div>
  );
}

/**
 * AVUKAT LİSTESİ — "Avukat Aracılığı" ile cevap verildiğinde seçilecek kişiler.
 *
 * NİYE CEVAP ŞEKLİ LİSTESİYLE AYNI TABLODA DEĞİL: orada tek bir metin tutuluyor.
 * Avukatta üç alan var (ad soyad, e-posta, cep) ve ikisi iletişim bilgisi; üçünü
 * tek metne sıkıştırmak "avukatın maili neydi" sorusunu cevaplanamaz hale getirirdi.
 *
 * SİLMEK YERİNE PASİFE ALIN: silinen avukatın bağlı olduğu icra kayıtlarında
 * avukat_id boşalır. Adı kalır (kayıtta anlık kopya duruyor) ama iletişim bilgisi
 * kaybolur. Pasif avukat seçim listesinde çıkmaz, eski kayıtlar bozulmaz.
 */
function AvukatListesi({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [liste, setListe] = useState<Avukat[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [duzenleId, setDuzenleId] = useState<string | null>(null);
  const [form, setForm] = useState({ ad_soyad: "", email: "", telefon: "" });

  const yukle = useCallback(async () => {
    try { setListe(await getAvukatlar()); setHata(null); }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setHata(/avukatlar/.test(m) && /does not exist|schema cache/i.test(m)
        ? "avukatlar tablosu yok — sql/avukatlar.sql çalıştırılmalı."
        : m);
    }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const temizle = () => { setForm({ ad_soyad: "", email: "", telefon: "" }); setDuzenleId(null); };

  async function kaydet() {
    const ad = form.ad_soyad.trim();
    if (!ad) { toast.error("Ad soyad zorunlu."); return; }
    // E-POSTA KONTROL EDİLİR: yanlış yazılmış bir adres, "avukata gönderdim"
    // kaydının sessizce boşa çıkması demek. Boş bırakılabilir, hatalı yazılamaz.
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("E-posta adresi geçerli değil."); return;
    }
    setKaydediliyor(true);
    try {
      const veri = { ad_soyad: ad, email: form.email.trim() || null, telefon: form.telefon.trim() || null };
      if (duzenleId) await updateAvukat(duzenleId, veri);
      else await insertAvukat({ ...veri, aktif: true, sira: liste.reduce((m, a) => Math.max(m, a.sira), 0) + 1 });
      temizle(); await yukle();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Kaydedilemedi.";
      toast.error(/duplicate|avukatlar_ad_uq/.test(m) ? "Bu avukat zaten kayıtlı." : m);
    }
    finally { setKaydediliyor(false); }
  }

  async function aktifDegistir(a: Avukat) {
    try { await updateAvukat(a.id, { aktif: !a.aktif }); await yukle(); }
    catch { toast.error("Güncellenemedi."); }
  }

  async function sil(a: Avukat) {
    if (typeof window !== "undefined" && !window.confirm(
      `${a.ad_soyad} silinsin mi?\n\nBu avukatla cevap verilmiş icra kayıtlarında ADI kalır ama `
      + `iletişim bilgisi kaybolur. Artık çalışmıyorsa SİLMEK yerine pasife almanız önerilir.`)) return;
    try { await deleteAvukat(a.id); await yukle(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Silinemedi."); }
  }

  const inp = "h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Scale size={16} className="text-[#1E3A5F]" />
        <h2 className="font-semibold text-gray-800">Avukatlar</h2>
      </div>

      {hata ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">{hata}</div>
      ) : yukleniyor ? (
        <div className="flex items-center gap-2 text-gray-400 py-6"><Loader2 size={16} className="animate-spin" /> Yükleniyor…</div>
      ) : (
        <>
          {liste.length === 0 && <p className="text-sm text-gray-400 mb-3">Henüz avukat yok. Aşağıdan ekleyin.</p>}
          <ul className="divide-y divide-gray-100 mb-3">
            {liste.map((a) => (
              <li key={a.id} className={`flex items-start justify-between gap-2 py-2 ${a.aktif ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800">
                    {a.ad_soyad}
                    {!a.aktif && <span className="ml-1.5 text-[10px] font-normal text-gray-500">(pasif)</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {a.email || "e-posta yok"} · {a.telefon ? telefonGoster(a.telefon) : "telefon yok"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canDuzenle && (
                    <button type="button" onClick={() => aktifDegistir(a)}
                      title={a.aktif ? "Pasife al (seçim listesinde çıkmaz)" : "Yeniden aktif et"}
                      className="text-[11px] text-gray-400 hover:text-[#1E3A5F]">{a.aktif ? "pasife al" : "aktif et"}</button>
                  )}
                  {canDuzenle && (
                    <button type="button" title="Düzenle" className="text-gray-300 hover:text-[#1E3A5F]"
                      onClick={() => { setDuzenleId(a.id); setForm({ ad_soyad: a.ad_soyad, email: a.email ?? "", telefon: a.telefon ?? "" }); }}>
                      <Pencil size={14} />
                    </button>
                  )}
                  {canSil && <button type="button" onClick={() => sil(a)} className="text-gray-300 hover:text-red-600" title="Sil"><Trash2 size={15} /></button>}
                </div>
              </li>
            ))}
          </ul>

          {(canEkle || duzenleId) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className={`${inp} sm:col-span-2`} value={form.ad_soyad} placeholder="Ad soyad (ör. Av. Ali Veli)"
                onChange={(e) => setForm((f) => ({ ...f, ad_soyad: e.target.value }))} />
              <input className={inp} value={form.email} placeholder="E-posta" inputMode="email"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <input className={inp} value={form.telefon} placeholder="Cep telefonu" inputMode="tel"
                onChange={(e) => setForm((f) => ({ ...f, telefon: e.target.value }))} />
              <div className="sm:col-span-2 flex items-center gap-2">
                <button type="button" onClick={kaydet} disabled={kaydediliyor || !form.ad_soyad.trim()}
                  className="flex items-center gap-1 h-9 px-3 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                  {duzenleId ? <Check size={15} /> : <Plus size={15} />} {duzenleId ? "Kaydet" : "Ekle"}
                </button>
                {duzenleId && (
                  <button type="button" onClick={temizle}
                    className="flex items-center gap-1 h-9 px-3 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                    <X size={15} /> Vazgeç
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-gray-400 mt-3">
        Cevap şekli “Avukat Aracılığı” seçilince bu listeden avukat seçilir; seçilen avukatın
        e-postası ve telefonu pencerede görünür.
      </p>
    </div>
  );
}
