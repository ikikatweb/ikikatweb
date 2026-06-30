// Maliyet Raporu — şantiye bazlı yıllık maliyet kalemleri (yalnız yöneticiye açık).
// Tablo: her satır bir şantiye; sütunlar nakit, k.k., personel, SGK, yakıt, makine kira + toplam.
// "Gizle" ikonu şantiyeyi Silinenler sekmesine taşır — VERİ SİLİNMEZ, hesaplanmaya devam eder,
// sadece ayrı sekmede listelenir. Liste DB'de PAYLAŞIMLI: bir yöneticinin gizlediği tüm yöneticilerde gizli.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks";
import { getMaliyetRaporu, getMaliyetGizliSantiyeler, setMaliyetGizliSantiye, type MaliyetSatir, SGK_ORAN } from "@/lib/supabase/queries/maliyet";
import { FileBarChart2, Trash2, RotateCcw } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BU_YIL = new Date().getFullYear();
const YILLAR = Array.from({ length: 6 }, (_, i) => BU_YIL - i); // bu yıl + 5 geri

export default function MaliyetRaporuPage() {
  const { isYonetici, loading: authYukleniyor } = useAuth();
  const [mod, setMod] = useState<"yil" | "aralik">("yil");
  const [yil, setYil] = useState(BU_YIL);
  const [arBas, setArBas] = useState(`${BU_YIL}-01-01`);
  const [arBit, setArBit] = useState(`${BU_YIL}-12-31`);
  // Fetch'i tetikleyen UYGULANMIŞ aralık (ilk açılışta = bu yıl).
  const [sorgu, setSorgu] = useState<{ bas: string; bit: string }>({ bas: `${BU_YIL}-01-01`, bit: `${BU_YIL}-12-31` });
  const [satirlar, setSatirlar] = useState<MaliyetSatir[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  // Gizlenen (Silinenler) şantiyeler — PAYLAŞIMLI (DB). Bir yöneticinin gizlediği herkeste gizli.
  const [gizliIds, setGizliIds] = useState<Set<string>>(new Set());
  const [sekme, setSekme] = useState<"aktif" | "silinen">("aktif");

  // Gizli listeyi DB'den yükle (yönetici girişinde).
  useEffect(() => {
    if (authYukleniyor || !isYonetici) return;
    let iptal = false;
    getMaliyetGizliSantiyeler().then((ids) => { if (!iptal) setGizliIds(new Set(ids)); }).catch(() => {});
    return () => { iptal = true; };
  }, [isYonetici, authYukleniyor]);

  // Optimistik güncelle + DB'ye yaz (hata olursa eski hale dön).
  const gizliDegistir = (id: string, gizli: boolean) => {
    setGizliIds((prev) => { const n = new Set(prev); if (gizli) n.add(id); else n.delete(id); return n; });
    setMaliyetGizliSantiye(id, gizli).catch(() => {
      setGizliIds((prev) => { const n = new Set(prev); if (gizli) n.delete(id); else n.add(id); return n; }); // geri al
    });
  };
  const gizle = (id: string) => gizliDegistir(id, true);
  const geriAl = (id: string) => gizliDegistir(id, false);

  useEffect(() => {
    if (authYukleniyor || !isYonetici) return;
    let iptal = false;
    setYukleniyor(true);
    setHata(null);
    getMaliyetRaporu(sorgu.bas, sorgu.bit)
      .then((r) => {
        if (iptal) return;
        setSatirlar(r.satirlar);
      })
      .catch((e) => {
        if (iptal) return;
        console.error(e);
        setHata("Maliyet verileri yüklenemedi.");
      })
      .finally(() => { if (!iptal) setYukleniyor(false); });
    return () => { iptal = true; };
  }, [sorgu, isYonetici, authYukleniyor]);

  const gorunen = useMemo(() => satirlar.filter((s) => !gizliIds.has(s.santiyeId)), [satirlar, gizliIds]);
  const gizli = useMemo(() => satirlar.filter((s) => gizliIds.has(s.santiyeId)), [satirlar, gizliIds]);
  const gosterilen = sekme === "aktif" ? gorunen : gizli;

  const toplamlar = useMemo(() => {
    const t = { nakit: 0, kart: 0, personel: 0, sgk: 0, yakit: 0, makineKira: 0, bakim: 0, toplam: 0 };
    for (const s of gosterilen) {
      t.nakit += s.nakit; t.kart += s.kart; t.personel += s.personel;
      t.sgk += s.sgk; t.yakit += s.yakit; t.makineKira += s.makineKira; t.bakim += s.bakim; t.toplam += s.toplam;
    }
    return t;
  }, [gosterilen]);

  if (authYukleniyor) {
    return <div className="p-6 text-sm text-gray-500">Yükleniyor…</div>;
  }
  if (!isYonetici) {
    return <div className="p-6 text-sm text-red-600">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
            <FileBarChart2 size={20} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Maliyet Raporu</h1>
            <p className="text-xs text-gray-500">Şantiye bazlı yıllık maliyetler</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mod: Yıl (varsayılan) / Tarih Aralığı */}
          <div className="flex rounded-lg border border-input overflow-hidden text-sm">
            <button type="button"
              onClick={() => { setMod("yil"); setSorgu({ bas: `${yil}-01-01`, bit: `${yil}-12-31` }); }}
              className={`px-3 h-9 ${mod === "yil" ? "bg-[#1E3A5F] text-white" : "bg-white text-gray-600"}`}>Yıl</button>
            <button type="button"
              onClick={() => setMod("aralik")}
              className={`px-3 h-9 border-l border-input ${mod === "aralik" ? "bg-[#1E3A5F] text-white" : "bg-white text-gray-600"}`}>Tarih Aralığı</button>
          </div>
          {mod === "yil" ? (
            <select
              value={yil}
              onChange={(e) => { const y = Number(e.target.value); setYil(y); setSorgu({ bas: `${y}-01-01`, bit: `${y}-12-31` }); }}
              className="h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring"
            >
              {YILLAR.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-1">
              <input type="date" value={arBas} onChange={(e) => setArBas(e.target.value)}
                className="h-9 rounded-lg border border-input bg-white px-2 text-sm outline-none focus:border-ring" />
              <span className="text-gray-400 text-xs">—</span>
              <input type="date" value={arBit} onChange={(e) => setArBit(e.target.value)}
                className="h-9 rounded-lg border border-input bg-white px-2 text-sm outline-none focus:border-ring" />
              <button type="button"
                onClick={() => { if (arBas && arBit && arBas <= arBit) setSorgu({ bas: arBas, bit: arBit }); }}
                className="h-9 px-3 rounded-lg bg-[#1E3A5F] text-white text-sm">Uygula</button>
            </div>
          )}
        </div>
      </div>

      {/* Bilgi notu */}
      <p className="text-[11px] text-gray-400">
        Personel = (aylık maaş ÷ 30) × puantaj günü (yalnız maaşı tanımlı personel). SGK = Yüklenici Prim Esas Kazanç × {SGK_ORAN}.
        Yakıt = verilen litre × o şantiyenin en son alım fiyatı. Makine kira = çalışılan gün × (aylık bedel ÷ 30); yarım gün ×0,5 (Araç Puantaj firma kira ile aynı).
        Bakım/Onarım = araç bakım/tamirat/yedek parça tutarı, işlem tarihindeki araç puantajının şantiyesine yansır.
      </p>

      {/* Sekmeler: Aktif / Silinenler */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button type="button" onClick={() => setSekme("aktif")}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${sekme === "aktif" ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Aktif ({gorunen.length})
        </button>
        <button type="button" onClick={() => setSekme("silinen")}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 flex items-center gap-1.5 ${sekme === "silinen" ? "border-rose-600 text-rose-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          <Trash2 size={14} /> Silinenler ({gizli.length})
        </button>
      </div>

      {hata && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{hata}</div>}

      {yukleniyor ? (
        <div className="p-6 text-sm text-gray-500">Maliyetler hesaplanıyor…</div>
      ) : gosterilen.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">
          {sekme === "silinen"
            ? "Silinenler boş — gizlemek istediğin şantiyeyi Aktif sekmesindeki çöp ikonuyla buraya taşıyabilirsin."
            : satirlar.length === 0 ? "Seçilen dönem için maliyet kaydı bulunamadı." : "Tüm şantiyeler gizlenmiş."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs border-b">
                <th className="text-left px-3 py-2 font-semibold">Şantiye</th>
                <th className="text-right px-3 py-2 font-semibold">Nakit</th>
                <th className="text-right px-3 py-2 font-semibold">K.K.</th>
                <th className="text-right px-3 py-2 font-semibold">Personel</th>
                <th className="text-right px-3 py-2 font-semibold">SGK</th>
                <th className="text-right px-3 py-2 font-semibold">Yakıt</th>
                <th className="text-right px-3 py-2 font-semibold">Makine Kira</th>
                <th className="text-right px-3 py-2 font-semibold">Bakım/Onarım</th>
                <th className="text-right px-3 py-2 font-semibold">Toplam</th>
                <th className="px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {gosterilen.map((s) => (
                <tr key={s.santiyeId} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900">{s.isAdi}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.nakit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.kart)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.personel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.sgk)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.yakit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.makineKira)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmt(s.bakim)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{fmt(s.toplam)}</td>
                  <td className="px-2 py-2 text-center">
                    {sekme === "aktif" ? (
                      <button type="button" onClick={() => gizle(s.santiyeId)} title="Listeden gizle (Silinenlere taşı)"
                        className="text-gray-300 hover:text-rose-600 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <button type="button" onClick={() => geriAl(s.santiyeId)} title="Geri al (Aktife taşı)"
                        className="text-gray-300 hover:text-emerald-600 transition-colors">
                        <RotateCcw size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold text-gray-900 border-t-2">
                <td className="px-3 py-2">TOPLAM</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.nakit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.kart)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.personel)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.sgk)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.yakit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.makineKira)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.bakim)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(toplamlar.toplam)}</td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
