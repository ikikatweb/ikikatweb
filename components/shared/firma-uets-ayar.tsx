"use client";

// FİRMA > UETS E-TEBLİGAT SEKMESİ
//
// Her firmanın kendi UETS adresi ve kendi API anahtarı var. Anahtar burada girilir,
// sunucuda saklanır ve BİR DAHA GÖSTERİLMEZ — yalnız "tanımlı, son 4 hanesi ...."
// bilgisi döner. Sebep: anahtarla tebligat okunabiliyor ve silinebiliyor; PTT
// taahhütnamesi de anahtarın paylaşılmamasını şart koşuyor. (bkz. sql/firma_uets.sql)
//
// Kutu boş bırakılırsa mevcut anahtara DOKUNULMAZ. Anahtarı kaldırmak için "Kaldır".
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plug, CheckCircle2, XCircle, Trash2, Loader2, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// UETS adresi BURADA SORULMAZ: ilk tebligat gelince "recipient" alanından kendisi yazılır
// (bkz. scripts/uets-tebligat-cek.mjs). Kullanıcıdan, sistemin zaten öğreneceği bir bilgiyi
// istemenin anlamı yok; aşağıda yalnız bilinen adres gösteriliyor.
export type UetsDeger = { api_key: string; aktif: boolean; sunucu_ip: string };
export const UETS_BOS: UetsDeger = { api_key: "", aktif: true, sunucu_ip: "" };

type Durum = {
  kurulu: boolean; anahtarVar?: boolean; anahtarSon4?: string | null; aktif?: boolean;
  uets_adres?: string | null; sunucu_ip?: string | null;
  son_cekim?: string | null; son_hata?: string | null; guncelleyen?: string | null; updated_at?: string | null;
};

const anTarih = (t?: string | null) =>
  t ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function FirmaUetsAyar({
  firmaId, deger, onChange, onKurulu, disabled,
}: {
  firmaId?: string;
  deger: UetsDeger;
  onChange: (d: UetsDeger) => void;
  /** Bu firma için kayıt var mı? Form, "kaydedilecek bir şey var mı"yı buna göre bilir. */
  onKurulu?: (kurulu: boolean) => void;
  disabled?: boolean;
}) {
  const [durum, setDurum] = useState<Durum | null>(null);
  const [yukleniyor, setYukleniyor] = useState(!!firmaId);
  const [deneniyor, setDeneniyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ ok: boolean; mesaj: string } | null>(null);

  const yukle = useCallback(async () => {
    if (!firmaId) { setYukleniyor(false); return; }
    try {
      const r = await fetch(`/api/firma-uets?firma_id=${encodeURIComponent(firmaId)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDurum(j);
      onKurulu?.(!!j.kurulu);
      // Kayıtlı bilgiler forma yansısın; anahtar HARİÇ (sunucu zaten göndermiyor).
      onChange({ api_key: "", aktif: j.aktif ?? true, sunucu_ip: j.sunucu_ip ?? "" });
    } catch (e) {
      // Sessiz geçilmez: ayarın okunamaması "ayar yok" sanılırsa anahtar ikinci kez girilir.
      toast.error(`UETS ayarı okunamadı: ${e instanceof Error ? e.message : e}`, { duration: toastSuresi() });
    } finally {
      setYukleniyor(false);
    }
  // onChange her renderda değişebilir; yalnız firmaId değişince yeniden okunsun.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaId]);

  useEffect(() => { void (async () => { await yukle(); })(); }, [yukle]);

  async function dene() {
    if (!firmaId) { toast.error("Önce firmayı kaydedin.", { duration: toastSuresi() }); return; }
    setDeneniyor(true); setSonuc(null);
    try {
      const r = await fetch("/api/firma-uets", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ firma_id: firmaId, islem: "dene", api_key: deger.api_key || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSonuc(j.ok
        ? { ok: true, mesaj: `Bağlantı başarılı. UETS'te ${j.toplam} tebligat görünüyor, ${j.okunmamis} tanesi okunmamış.` }
        : { ok: false, mesaj: `${j.durum ? `HTTP ${j.durum} — ` : ""}${j.mesaj}` });
    } catch (e) {
      setSonuc({ ok: false, mesaj: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeneniyor(false);
    }
  }

  async function kaldir() {
    if (!firmaId) return;
    if (!confirm("Bu firmanın UETS anahtarı kaldırılsın mı? Tebligatları çekilmeyi durduracak.")) return;
    try {
      const r = await fetch("/api/firma-uets", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ firma_id: firmaId, islem: "sil" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      onChange({ ...UETS_BOS });
      setDurum({ kurulu: false, aktif: true });
      onKurulu?.(false);
      setSonuc(null);
      toast.success("UETS anahtarı kaldırıldı.", { duration: toastSuresi() });
    } catch (e) {
      toast.error(`Kaldırılamadı: ${e instanceof Error ? e.message : e}`, { duration: toastSuresi() });
    }
  }

  const d = (y: Partial<UetsDeger>) => onChange({ ...deger, ...y });

  return (
    <div className="space-y-4">
      {/* Hangi sistemin ayarı olduğu bir bakışta belli olsun — "API anahtarı" tek başına
          hangi servise ait olduğunu söylemiyor. */}
      <div className="flex items-center gap-2.5 border-b pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ptt-uets.png" alt="PTT UETS" className="h-8 w-auto" />
        <div className="text-xs text-gray-500">
          Ulusal Elektronik Tebligat Sistemi — bu firmanın resmî tebligatları buradan çekilir.
        </div>
      </div>

      {!firmaId && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Firmayı <b>Kaydet</b> dediğinizde buraya girdiğiniz UETS bilgileri de kaydedilir.
            Bağlantı denemesi ancak kayıttan sonra yapılabilir.
          </span>
        </div>
      )}

      {yukleniyor ? (
        <div className="py-6 text-center text-sm text-gray-500">Yükleniyor…</div>
      ) : (
        <>
          {/* Mevcut durum */}
          {durum?.kurulu && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound size={14} className="text-gray-500" />
                  {durum.anahtarVar
                    ? <>Anahtar tanımlı <span className="font-mono text-gray-600">••••{durum.anahtarSon4}</span></>
                    : <span className="text-amber-700">Anahtar girilmemiş</span>}
                </span>
                <span className="text-gray-500">Son çekim: {anTarih(durum.son_cekim)}</span>
                {durum.guncelleyen && (
                  <span className="text-gray-500">
                    Son düzenleyen: {durum.guncelleyen} · {anTarih(durum.updated_at)}
                  </span>
                )}
              </div>
              {/* Çekme işi hata veriyorsa bu firmanın tebligatları GELMİYOR demektir. */}
              {durum.son_hata && (
                <div className="mt-1.5 flex items-start gap-1.5 text-red-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>Son çekimde hata: {durum.son_hata}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="uets_api_key">UETS API Anahtarı</Label>
            <Input
              id="uets_api_key" type="password" autoComplete="off" spellCheck={false}
              placeholder={durum?.anahtarVar ? "Değiştirmek için yeni anahtarı yazın" : "PTT'nin verdiği API anahtarı"}
              value={deger.api_key}
              onChange={(e) => d({ api_key: e.target.value })}
              disabled={disabled}
            />
            <p className="text-xs text-gray-500">
              Anahtar sunucuda saklanır, ekrana bir daha getirilmez. <b>Boş bırakırsanız mevcut
              anahtar değişmez.</b> PTT UETS portalında <i>API Ayarları</i> bölümünden alınır;
              anahtar yalnızca orada tanımlı <b>statik IP</b>&apos;den çalışır.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uets_adres">UETS Adresi</Label>
              {/* SALT OKUNUR: bu adresi kullanıcı bilmek zorunda değil. İlk tebligat
                  geldiğinde "recipient" alanından kendisi yazılıyor (çekme işi), çünkü
                  alıcı zaten biziz. Elle yazılabilir olsaydı yanlış girilen bir adres
                  "bu tebligat bizim değil" gibi okunurdu. */}
              <Input
                id="uets_adres" value={durum?.uets_adres ?? ""} readOnly disabled
                placeholder="İlk tebligat geldiğinde otomatik dolar"
                className="bg-gray-100 font-mono text-gray-600"
              />
              <p className="text-xs text-gray-500">
                PTT&apos;nin bu firmaya verdiği tebligat adresi. <b>Girmenize gerek yok</b> —
                ilk tebligatla birlikte sistem kendisi yazar.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="uets_sunucu_ip">Portalda tanımlı sunucu IP&apos;si</Label>
              <Input
                id="uets_sunucu_ip" placeholder="95.9.239.71"
                value={deger.sunucu_ip} onChange={(e) => d({ sunucu_ip: e.target.value })}
                disabled={disabled}
              />
              <p className="text-xs text-gray-500">
                Sadece hatırlatma amaçlı saklanır. IP değişirse PTT portalından da güncellenmelidir,
                yoksa sorgular <b>401</b> döner.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deger.aktif} disabled={disabled}
              onChange={(e) => d({ aktif: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300" />
            <span>Tebligat çekme işi bu firmayı sorgulasın</span>
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={dene} disabled={disabled || deneniyor || !firmaId}>
              {deneniyor ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
              Bağlantıyı dene
            </Button>
            {durum?.kurulu && (
              <Button type="button" variant="outline" onClick={kaldir} disabled={disabled}
                className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700">
                <Trash2 size={15} /> Anahtarı kaldır
              </Button>
            )}
          </div>

          {sonuc && (
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              sonuc.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
              {sonuc.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{sonuc.mesaj}</span>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Tebligatlar iki saatte bir otomatik çekilir. <b>Açma işlemi otomatik yapılmaz</b> —
            UETS&apos;te tebligatı indirmek onu açmak sayıldığı için (taahhütname md. 7),
            açma kararı kullanıcıya bırakılmıştır.
          </p>
        </>
      )}
    </div>
  );
}
