"use client";

// VERGİ DAİRESİ TEBLİGATI (GİB · KETSİS) — E-Tebligat ekranının ikinci bölümü.
//
// NEDEN BURADA, PTT TABLOSUNUN ALTINDA: ikisi de "resmî tebligat" ama AYRI sistem.
// Vergi dairesi tebligatı UETS'te değil, GİB'in KETSİS'inde durur ve alıcı tarafı için
// API'si yok — belgeyi program indiremez (gerekçe: sql/ketsis_bildirim.sql). Burada
// gördüğünüz satırlar tebligat değil, GİB'in bilgilendirme MAİLİ: "gel bak" uyarısı.
//
// İKİ ŞEY BİRLİKTE DURUYOR, ÇÜNKÜ MAİL GARANTİ DEĞİL:
//   · Bildirim listesi → mail geldiyse.
//   · Son kontrol satırı → mail GELMESE DE haftada bir bakılmalı. Bilgilendirme maili
//     hukuken tebligatın parçası değil; gelmemesi süreyi durdurmaz (VUK 107/A).
// Bu yüzden liste boşken de ekran "temiz" demez, "bakıldı mı?" diye sorar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Landmark, ExternalLink, AlertTriangle, Check, X, Loader2, ShieldQuestion, Trash2, Mail, Link2 as LinkIcon } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { useAuth, tebligatDegisti } from "@/hooks";
import {
  getKetsisBildirimler, getSonKetsisKontrol, getKetsisTarayici, kontrolYasiGun,
  getKetsisTebligatlar, ketsisKalanGun, ketsisTebligGunu,
  GIB_GIRIS, KONTROL_ARALIGI_GUN,
  type KetsisBildirim, type KetsisKontrol, type KetsisTarayiciDurum, type KetsisTebligat,
} from "@/lib/supabase/queries/ketsis";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";

const NOTR = "#9ca3af";

const gunSaat = (t: string | null) =>
  t ? new Date(t).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).replace(" ", " saat ") : "—";

/** Tarayıcı kaç saattir sessiz? Görev sessizce ölebiliyor; tek belirti bu damga. */
const saatFarki = (t: string | null) =>
  t ? Math.floor((Date.now() - new Date(t).getTime()) / 3600000) : null;
const TARAYICI_TOLERANS_SAAT = 6;   // yarım saatte bir dönüyor; 6 saat sessizlik arızadır

export default function KetsisTablosu() {
  const { hasPermission, isYonetici } = useAuth();
  const gor = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");
  // İşaretlemek gönderen öğretir / satırı listeden düşürür → "düzenle" yetkisi.
  const isaretleyebilir = isYonetici || hasPermission("yazismalar-e-tebligat", "duzenle");

  const [satirlar, setSatirlar] = useState<KetsisBildirim[]>([]);
  const [sonKontrol, setSonKontrol] = useState<KetsisKontrol | null>(null);
  const [tarayici, setTarayici] = useState<KetsisTarayiciDurum[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hepsi, setHepsi] = useState(false);
  const [islemde, setIslemde] = useState<number | "kontrol" | "ekle" | "anahtar" | null>(null);

  // TEBLİGAT DEFTERİ — ekranın asıl sonucu. Bildirim maili "gel bak" uyarısıydı;
  // bunlar daireye bakıldığında GÖRÜLEN tebligatlar, süreleriyle birlikte.
  const [tebligatlar, setTebligatlar] = useState<KetsisTebligat[]>([]);
  const [firmaListe, setFirmaListe] = useState<{ id: string; kisa_adi: string | null; firma_adi: string }[]>([]);
  const [tebHepsi, setTebHepsi] = useState(false);
  const [mailAcik, setMailAcik] = useState(false);
  const [portalAcik, setPortalAcik] = useState(false);
  // HAM ANAHTAR YALNIZ BURADA, YALNIZ ÜRETİLDİĞİ AN: sunucu sha256 özetini saklıyor,
  // geri okunamıyor. Sayfa yenilenirse yer imi kutusu "üret" durumuna döner; eskisi
  // çalışmaya devam eder, yenisi üretilirse eski geçersiz olur.
  const [anahtar, setAnahtar] = useState<string | null>(null);
  const [portalDurum, setPortalDurum] = useState<
    { kurulu: boolean; anahtar_son4?: string; son_kullanim?: string; son_sonuc?: string } | null>(null);

  const yukle = useCallback(async () => {
    try {
      const [b, k, t, d, f] = await Promise.all([
        getKetsisBildirimler(), getSonKetsisKontrol(), getKetsisTarayici(),
        getKetsisTebligatlar(), getFirmalar(),
      ]);
      setSatirlar(b); setSonKontrol(k); setTarayici(t); setTebligatlar(d);
      setFirmaListe((f ?? []) as { id: string; kisa_adi: string | null; firma_adi: string }[]);
      setHata(null);
    } catch (e) {
      // Hata YUTULMAZ: boş tablo "tebligat yok" diye okunur, oysa sorgu patlamıştır.
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!gor) return;
    void (async () => { await yukle(); })();
  }, [gor, yukle]);

  const liste = useMemo(
    () => hepsi ? satirlar : satirlar.filter((s) => s.durum === "yeni"),
    [satirlar, hepsi],
  );
  const bekleyen = satirlar.filter((s) => s.durum === "yeni");
  const kesinBekleyen = bekleyen.filter((s) => s.guven === "kesin").length;

  // Açılmamış = portalda henüz okunmadı diye işaretlenmemiş olan. Süre bundan bağımsız
  // işliyor (VUK 107/A) — o yüzden sıralama okunup okunmadığına değil SON GÜNE göre.
  const acikTebligat = tebligatlar.filter((t) => !t.okundu_at);
  const tebListe = tebHepsi ? tebligatlar : acikTebligat;
  const enYakin = acikTebligat.length
    ? acikTebligat.map((t) => ketsisKalanGun(ketsisTebligGunu(t).gun)).sort((x, y) => x - y)[0]
    : null;
  const suresiGecenTeb = acikTebligat.filter((t) => ketsisKalanGun(ketsisTebligGunu(t).gun) < 0).length;

  const yas = kontrolYasiGun(sonKontrol?.kontrol_at);
  const anahtarSon4 = anahtar ? anahtar.slice(-4) : portalDurum?.anahtar_son4 ?? "";
  const yerImiRef = useRef<HTMLAnchorElement | null>(null);

  // ═══ YER İMİ ═══ Portalın KENDİ sayfasında çalışır (aynı origin → CORS duvarı yok,
  // oturum anahtarı sessionStorage'dan okunur). Tek yaptığı LİSTEYİ OKUMAK: hiçbir belge
  // indirilmiyor, çünkü indirmek tebligatı açmak demek ve o karar insanın.
  // Sessiz başarı yok: sonuç da, oturum düşmesi de, atlanan kayıt da ekrana basılıyor.
  const yerImi = useMemo(() => {
    if (!anahtar) return "";
    const kod = `(async()=>{try{
if(!location.hostname.endsWith("dijital.gib.gov.tr")){alert("Bu yer imi Dijital Vergi Dairesi sayfasinda calisir.");return;}
var t=sessionStorage.getItem("token");
if(!t){alert("Portal oturumu bulunamadi. Giris yapip e-Tebligat sayfasini acin, sonra tekrar tiklayin.");return;}
var hepsi=[],vkn="";
try{var u=await fetch("/apigateway/auth/tdvd/user-info",{headers:{Authorization:t}});if(u.ok){var uj=await u.json();var ara=function(o){if(!o||typeof o!=="object")return"";for(var k in o){var v=o[k];if(typeof v==="string"&&/vkn|vergiKimlik|tckn|kimlikNo/i.test(k)&&/^[0-9]{10,11}$/.test(v))return v;if(typeof v==="object"){var r=ara(v);if(r)return r;}}return"";};vkn=ara(uj);}}catch(e){}
for(var a=0;a<2;a++){for(var sf=1;sf<=60;sf++){
var r=await fetch("/apigateway/etebligat/etebligat/tebligat-listele",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json, text/plain, */*","page-name":"e-tebligat","ui-client":"fe","Authorization":t},body:JSON.stringify({meta:{pagination:{pageNo:sf,pageSize:50},sortFieldName:"id",sortType:"ASC",filters:[{fieldName:"arsivDurum",values:[String(a)]}]}})});
if(r.status===401){alert("Portal oturumu dusmus. Tekrar giris yapip HEMEN tiklayin.");return;}
if(!r.ok){alert("Portal listesi alinamadi: HTTP "+r.status);return;}
var j=await r.json();var d=(j&&j.data&&j.data.tebligatDtoList)||[];hepsi=hepsi.concat(d);
var tp=(j&&j.pageDetail&&j.pageDetail.totalPage)||1;if(sf>=tp||d.length===0)break;}}
var res=await fetch(${JSON.stringify(typeof window === "undefined" ? "" : window.location.origin)}+"/api/ketsis/portal-aktar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({anahtar:${JSON.stringify(anahtar)},vkn:vkn,kayitlar:hepsi})});
var jj=await res.json().catch(function(){return {};});
if(!res.ok){alert("Panele yazilamadi: "+(jj.error||("HTTP "+res.status)));return;}
alert("Aktarildi - "+jj.mesaj+(jj.firmaEslesti?"":"\\n\\nNot: VKN bir firmayla eslesmedi, kayitlar 'belirsiz' olarak girdi.")+((jj.atlanan&&jj.atlanan.length)?"\\n\\nAtlananlar:\\n"+jj.atlanan.join("\\n"):""));
}catch(e){alert("Yer imi hata verdi: "+(e&&e.message?e.message:e));}})();`;
    return "javascript:" + encodeURIComponent(kod.replace(/\n/g, ""));
  }, [anahtar]);

  const kontrolGerekli = yas === null || yas >= KONTROL_ARALIGI_GUN;

  // Tarayıcı sessizliği: en son çalışan kutuya bakılır (biri çalışıyorsa görev ayakta).
  const enSonTarama = tarayici
    .map((t) => t.son_calisma).filter((x): x is string => !!x)
    .sort().at(-1) ?? null;
  const taramaSaat = saatFarki(enSonTarama);
  // YUKLENİRKEN ALARM VERME: başlangıçta tarayici=[] olduğu için bu uyarı her sayfa
  // açılışında bir an "Hiç çalışmamış" diye kırmızı yanıp sönüyordu — görev çalışırken bile.
  // Yalan alarm, gerçek alarmı değersizleştirir: insan kırmızıyı görmezden gelmeyi öğrenir.
  const tarayiciSessiz = !yukleniyor
    && (tarayici.length === 0 || taramaSaat === null || taramaSaat > TARAYICI_TOLERANS_SAAT);
  const tarayiciHata = tarayici.map((t) => t.son_hata).filter(Boolean)[0] ?? null;

  // Yer imi adresini DOM'a doğrudan yaz (yukarıdaki nota bak: React href'i temizliyor).
  useEffect(() => {
    if (yerImiRef.current && yerImi) yerImiRef.current.setAttribute("href", yerImi);
  }, [yerImi, portalAcik, anahtar]);

  // Yer imi kurulu mu, en son ne zaman çalıştı, sonucu neydi? HAM ANAHTAR DÖNMEZ —
  // yalnız son 4 hanesi, "doğru yer imini mi kullanıyorum" sorusuna yetsin diye.
  const portalDurumOku = useCallback(async () => {
    try {
      const r = await fetch("/api/ketsis/kontrol", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ islem: "portal-durum" }),
      });
      if (r.ok) setPortalDurum(await r.json());
    } catch { /* ekranın geri kalanı çalışsın; kutu "üret" durumunda kalır */ }
  }, []);
  useEffect(() => { void portalDurumOku(); }, [portalDurumOku]);

  async function gonder(govde: Record<string, unknown>, anahtar: number | "kontrol" | "ekle" | "anahtar") {
    setIslemde(anahtar);
    try {
      const r = await fetch("/api/ketsis/kontrol", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(govde),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      // HAM ANAHTAR SADECE BURADA GÖRÜLÜR: sunucu özetini saklıyor, bir daha dönmüyor.
      // Yer imi bu değerle üretiliyor; kullanıcı kurmadan sayfayı yenilerse yeniden
      // üretmesi gerekir (eskisi çalışmaya devam eder).
      if (typeof j.anahtar === "string") setAnahtar(j.anahtar);
      // Yarım kalan işlem sessiz geçilmez: rota uyarı döndürdüyse kullanıcı görsün.
      if (j.uyari) toast.error(j.uyari, { duration: 14000 });
      else toast.success("Kaydedildi.", { duration: toastSuresi() });
      await portalDurumOku();
      await yukle();
      tebligatDegisti();   // menü rozeti de düşsün
    } catch (e) {
      toast.error(`Kaydedilemedi: ${e instanceof Error ? e.message : e}`, { duration: 14000 });
    } finally {
      setIslemde(null);
    }
  }

  if (!gor) return null;

  return (
    /* mt-10 + kesik çizgi: bu bölüm yukarıdaki PTT tablosunun DEVAMI DEĞİL, ayrı sistem. */
    <div className="mt-10 border-t-2 border-dashed border-gray-200 pt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-r-lg border-l-4 border-amber-500 bg-amber-50/60 px-3 py-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#1E3A5F]">
          {/* ADLANDIRMA (09.11.2026): portaldan çekilen kayıtlara bakılınca görüldü ki
              KETSİS yalnız vergi dairesi tebligatı taşımıyor — gelen 87 kaydın tamamı
              EMNİYET GENEL MÜDÜRLÜĞÜ / Trafik Başkanlığı'ndan idari para cezası. Başlığı
              "vergi dairesi" diye bırakmak, buraya düşen trafik cezasının gözden
              kaçmasına yol açardı. Okunduğu yer hâlâ Dijital Vergi Dairesi. */}
          <Landmark size={18} /> Vergi dairesi ve kurum tebligatları
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
            title="Kurumsal Elektronik Tebligat Sistemi — GİB işletir, PTT UETS'ten ayrıdır">
            GİB · KETSİS
          </span>
          <span className="text-xs font-normal text-gray-500">— yalnız Dijital Vergi Dairesi&apos;nde okunur</span>
        </h2>

        {/* ŞERİTTEKİ SÜZGEÇ ARTIK TEBLİGAT TABLOSUNU SÜZÜYOR, bildirim maillerini değil:
            ekranın asıl konusu tebligat. Mailler aşağıda, kendi başlığının altında. Ölçüler
            PTT şeridiyle aynı (h-7/text-xs), iki bölüm eşit ağırlıkta görünsün. */}
        <div className="ml-auto inline-flex items-center rounded-lg border border-gray-200 bg-white/70 p-0.5">
          {([[false, `Açılmamış${acikTebligat.length ? ` (${acikTebligat.length})` : ""}`], [true, "Hepsi"]] as const).map(([id, et]) => (
            <button key={String(id)} type="button" onClick={() => setTebHepsi(id)}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                tebHepsi === id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
              {et}
            </button>
          ))}
        </div>
        <a href={GIB_GIRIS} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white/70 px-2.5 h-7 text-xs hover:bg-gray-50">
          Dijital Vergi Dairesi <ExternalLink size={12} />
        </a>
      </div>

      {/* ═══ SONUÇ KARTI ═══
          Bu ekranın cevaplaması gereken tek soru: "vergi dairesinde bekleyen tebligat
          var mı, son gün ne zaman?" Eskiden burada yalnız "en son ne zaman bakıldı"
          yazıyordu — yapılan işin kaydıydı, sonucun değil. Artık önce cevap, sonra kaydı. */}
      <div className={`mb-3 rounded-lg border px-3 py-2.5 ${
        suresiGecenTeb > 0 ? "border-red-300 bg-red-50"
          : acikTebligat.length > 0 ? "border-amber-300 bg-amber-50"
          : kontrolGerekli ? "border-amber-200 bg-amber-50/60"
          : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${
            suresiGecenTeb > 0 ? "text-red-800"
              : acikTebligat.length > 0 ? "text-amber-900"
              : kontrolGerekli ? "text-amber-900" : "text-emerald-800"}`}>
            {acikTebligat.length > 0
              ? <>
                  {acikTebligat.length} tebligat açılmamış
                  {enYakin !== null && (enYakin < 0
                    ? <> · <b>{-enYakin} gün önce tebliğ sayıldı</b></>
                    : <> · en yakın son güne <b>{enYakin} gün</b></>)}
                </>
              : yas === null
                ? "Dijital Vergi Dairesi hiç kontrol edilmedi — bekleyen tebligat olup olmadığı bilinmiyor."
                : kontrolGerekli
                  ? `${yas} gündür bakılmadı — bu sürede tebligat gelmiş olabilir.`
                  : "Bekleyen tebligat yok."}
          </span>
          {yas !== null && (
            <span className="text-xs text-gray-600">
              Son bakış: {gunSaat(sonKontrol!.kontrol_at)}
              {sonKontrol?.kullanici_ad && <> · {sonKontrol.kullanici_ad}</>}
            </span>
          )}
          {isaretleyebilir && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* ELLE GİRİŞ KALDIRILDI (09.11.2026): defter elle doldurulmak için değil,
                  portaldan aktarılmak için var. Buradaki düğme artık yer imi kurulumunu
                  açıyor — kayıtlar Dijital Vergi Dairesi'nden tek tıkla geliyor. */}
              <button type="button" onClick={() => setPortalAcik((a) => !a)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 h-7 text-xs font-medium hover:bg-gray-50">
                <LinkIcon size={12} /> Portal bağlantısı
              </button>
              <button type="button" disabled={islemde === "kontrol"}
                onClick={() => gonder({ islem: "kontrol-kaydi", bulgu: "temiz" }, "kontrol")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-2.5 h-7 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
                {islemde === "kontrol" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Baktım, tebligat yok
              </button>
            </div>
          )}
        </div>

        {/* ═══ PORTAL BAĞLANTISI (YER İMİ) ═══
            NİYE YER İMİ: 09.11.2026'da portal üzerinde keşif yapıldı.
              · Girişte CAPTCHA var → sunucu kendi kendine giremez.
              · Oturum sessionStorage'da ve ~6-8 dakikada düşüyor → şifre saklamanın
                anlamı yok; zaten saklanmıyor.
              · Tarayıcı, panelin portal servislerini okumasına izin vermiyor (CORS) —
                ama portalın KENDİ sayfasında çalışan kod okuyabiliyor.
            Bu yüzden: girişi kullanıcı yapar, e-Tebligat ekranında yer imine tıklar,
            yer imi listeyi okuyup panele gönderir. BELGE AÇILMAZ, yalnız liste okunur. */}
        {portalAcik && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
            {!anahtar ? (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={islemde === "anahtar"}
                  onClick={() => gonder({ islem: "portal-anahtar-uret" }, "anahtar")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3 h-8 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
                  {islemde === "anahtar" ? <Loader2 size={12} className="animate-spin" /> : <LinkIcon size={12} />}
                  Yer imini üret
                </button>
                <span className="text-xs text-gray-600">
                  Tek seferlik kurulum. Şifreniz hiçbir yerde saklanmaz.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="font-medium text-[#1E3A5F]">Yer imi hazır — kurulumu bir kez yapın:</div>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-700">
                  <li>Aşağıdaki bağlantıyı tarayıcınızın <b>yer imi çubuğuna sürükleyin</b>
                    (ya da sağ tık → yer imi olarak ekle).</li>
                  <li>Dijital Vergi Dairesi&apos;ne girip <b>e-Tebligat</b> sayfasını açın.</li>
                  <li>Yer imine tıklayın. Liste panele düşer.</li>
                </ol>
                {/* href REACT ÜZERİNDEN VERİLMİYOR (09.11.2026). React, "javascript:" ile
                    başlayan href'i güvenlik gereği temizliyor ve yerine
                    "React has blocked a javascript: URL" fırlatan bir kod koyuyor —
                    yer imi sürüklenip kullanıldığında sessizce çalışmıyordu. Bu yüzden
                    adres, bağlama sonrası doğrudan DOM'a yazılıyor (aşağıdaki effect). */}
                <a ref={yerImiRef} onClick={(e) => e.preventDefault()}
                  title="Bu bağlantıyı yer imi çubuğuna sürükleyin"
                  className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border-2 border-dashed border-[#1E3A5F] bg-[#1E3A5F]/5 px-3 py-1.5 text-xs font-semibold text-[#1E3A5F]">
                  <LinkIcon size={13} /> Vergi dairesi tebligatlarını aktar
                </a>
                {/* OTURUM KISA: girişten hemen sonra tıklanmalı, yoksa 401 gelir.
                    Bunu baştan söylemek, "çalışmıyor" sanılmasını önlüyor. */}
                <div className="text-[11px] text-amber-800">
                  Portal oturumu birkaç dakikada düşüyor — girişten <b>hemen sonra</b> tıklayın.
                  Düşmüşse yer imi size &quot;oturum düşmüş&quot; der, sessiz kalmaz.
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-gray-500">
                  <span>Anahtar sonu: <b className="font-mono">…{anahtarSon4}</b></span>
                  {portalDurum?.son_kullanim && (
                    <span>Son aktarım: {gunSaat(portalDurum.son_kullanim)}
                      {portalDurum.son_sonuc ? ` · ${portalDurum.son_sonuc}` : ""}</span>
                  )}
                  <button type="button" onClick={() => { setAnahtar(null); void gonder({ islem: "portal-anahtar-sil" }, "anahtar"); }}
                    className="underline underline-offset-2 hover:text-red-700">
                    Bağlantıyı iptal et
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ TEBLİGAT TABLOSU ═══ PTT tablosuyla aynı mantık: sıralama son güne göre. */}
      <div className="mb-4 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Firma</th>
              <th className="px-3 py-2 font-medium">Gönderen kurum</th>
              <th className="px-3 py-2 font-medium">Konu</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Ulaşma</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Tebliğ sayılacağı gün</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Kalan</th>
              <th className="px-3 py-2 font-medium">Durum</th>
              {isaretleyebilir && <th className="px-3 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tebListe.map((t) => {
              // Geçerli gün: portal kaydında GİB'in kendi bildirdiği tarih, yoksa bizim
              // hesabımız (bkz. ketsisTebligGunu). Fark varsa aşağıda açıkça yazılıyor.
              const { gun: tebligGunu, farkli: tarihFarkli } = ketsisTebligGunu(t);
              const kalan = ketsisKalanGun(tebligGunu);
              const gecti = kalan < 0;
              return (
                <tr key={t.id} className={!t.okundu_at && gecti ? "bg-red-50" : (!t.okundu_at && kalan <= 2 ? "bg-amber-50" : "")}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                        style={{ backgroundColor: t.firmalar?.renk ?? NOTR }} />
                      <span className="font-medium">
                        {t.firmalar?.kisa_adi || t.firmalar?.firma_adi || "belirsiz"}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">{t.vergi_dairesi ?? "—"}</td>
                  <td className="px-3 py-2">
                    {t.konu ?? "—"}
                    {t.belge_no && <div className="font-mono text-[11px] text-gray-500">{t.belge_no}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {new Date(t.ulasma_tarihi + "T00:00:00").toLocaleDateString("tr-TR")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums font-medium">
                    {new Date(tebligGunu + "T00:00:00").toLocaleDateString("tr-TR")}
                    {/* FARK SESSİZ GEÇİLMEZ: GİB'in günü ile bizim hesabımız tutmuyorsa
                        GİB'inki gösterilir ama bizimki de söylenir — hangi güne göre iş
                        yapılacağı bu ekranın tek konusu. */}
                    {tarihFarkli && (
                      <div className="text-[11px] font-normal text-amber-700"
                        title="GİB'in bildirdiği gün ile ulaşma + 5 hesabı tutmuyor. Gösterilen, GİB'in bildirdiği gündür.">
                        GİB&apos;e göre · bizim hesap {new Date(t.teblig_tarihi + "T00:00:00").toLocaleDateString("tr-TR")}
                      </div>
                    )}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${
                    gecti ? "text-red-700" : kalan <= 2 ? "text-amber-700" : "text-gray-700"}`}>
                    {gecti ? `${-kalan} gün geçti` : `${kalan} gün`}
                  </td>
                  <td className="px-3 py-2">
                    {t.okundu_at
                      ? <span className="text-xs text-gray-600">
                          okundu{t.okuyan_ad ? ` · ${t.okuyan_ad}` : ""}
                        </span>
                      : <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">açılmamış</span>}
                  </td>
                  {isaretleyebilir && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {!t.okundu_at && (
                          <button type="button" disabled={islemde === t.id}
                            onClick={() => gonder({ islem: "tebligat-okundu", id: t.id }, t.id)}
                            title="Portalda açıldı (süreyi değiştirmez)"
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 h-7 text-xs hover:bg-gray-50">
                            {islemde === t.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Okudum
                          </button>
                        )}
                        <button type="button" disabled={islemde === t.id}
                          onClick={() => { if (confirm("Bu tebligat kaydı silinsin mi?")) void gonder({ islem: "tebligat-sil", id: t.id }, t.id); }}
                          title="Yanlış girilen kaydı sil"
                          className="inline-flex items-center rounded-lg border border-red-200 px-2 h-7 text-xs text-red-600 hover:bg-red-50">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!yukleniyor && tebListe.length === 0 && (
              <tr>
                <td colSpan={isaretleyebilir ? 8 : 7} className="px-3 py-8 text-center text-gray-500">
                  {tebHepsi ? "Hiç tebligat kaydı yok." : "Açılmamış tebligat yok."}
                  <div className="mt-1 text-xs text-gray-400">
                    Bu defter elle tutulur: Dijital Vergi Dairesi&apos;nde gördüğünüzü buraya yazın,
                    süreyi panel takip etsin.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ İKİNCİL BÖLÜM: GİB BİLDİRİM MAİLLERİ ═══
          Bu liste artık ekranın konusu değil, İPUCU: GİB yeni tebligat gelince
          bilgilendirme maili yolluyor. Mail hukuken tebligatın parçası değil (VUK 107/A) —
          gelmemesi, spam'e düşmesi ya da geç gelmesi süreyi durdurmuyor. Bu yüzden
          yukarıdaki defterin altında, ikincil ağırlıkta duruyor. Katlanabilir: işe
          yarayan taraf tebligat tablosu, bu liste yalnız "nereden haberimiz oldu". */}
      <button type="button" onClick={() => setMailAcik((a) => !a)}
        className="mb-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 h-8 text-xs font-medium text-gray-700 hover:bg-gray-100">
        <Mail size={13} />
        GİB bildirim mailleri
        {bekleyen.length > 0 && (
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            kesinBekleyen ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
            {bekleyen.length} bakılmamış
          </span>
        )}
        <span className="text-gray-400">{mailAcik ? "gizle" : "göster"}</span>
      </button>

      {mailAcik && (
      <div>
      <div className="mb-2 inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
        {([[false, `Bakılmamış${bekleyen.length ? ` (${bekleyen.length})` : ""}`], [true, "Hepsi"]] as const).map(([id, et]) => (
          <button key={String(id)} type="button" onClick={() => setHepsi(id)}
            className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
              hepsi === id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
            {et}
          </button>
        ))}
      </div>

      {/* TARAYICI SESSİZ Mİ? Görev çökerse mail hiç okunmaz ve bu bölüm boş kalır —
          boşluk "tebligat yok" diye okunmasın. */}
      {tarayiciSessiz && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Mail tarayıcısı sessiz.</b>{" "}
            {tarayici.length === 0
              ? "Hiç çalışmamış (ofisteki zamanlanmış görev kurulu mu?)."
              : `En son ${gunSaat(enSonTarama)} — ${taramaSaat} saat önce.`}{" "}
            Bu bölümün boş olması &quot;tebligat yok&quot; anlamına gelmez; Dijital Vergi
            Dairesi&apos;ni elle kontrol edin.
          </span>
        </div>
      )}
      {tarayiciHata && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Son taramada hata: {tarayiciHata}
        </div>
      )}
      {hata && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          GİB bildirimleri alınamadı: {hata}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Firma</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Mail tarihi</th>
              <th className="px-3 py-2 font-medium">Gönderen</th>
              <th className="px-3 py-2 font-medium">Konu / özet</th>
              <th className="px-3 py-2 font-medium">Güven</th>
              <th className="px-3 py-2 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {liste.map((s) => (
              <tr key={s.id} className={s.durum === "yeni" && s.guven === "kesin" ? "bg-red-50" : s.durum === "yeni" ? "bg-amber-50" : ""}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5" title={s.firmalar?.firma_adi ?? s.kutu}>
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                      style={{ backgroundColor: s.firmalar?.renk ?? NOTR }} />
                    <span className="font-medium">
                      {s.firmalar?.kisa_adi || s.firmalar?.firma_adi || "firma belirsiz"}
                    </span>
                  </span>
                  {s.vkn && <div className="mt-0.5 text-[11px] text-gray-500">VKN {s.vkn}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {gunSaat(s.mail_tarihi)}
                  {/* INBOX DIŞINDAKİ KLASÖR BİR BULGUDUR: Junk'a düşmüş ya da silinmiş
                      bir tebligat bildirimi hiç görülmemiş olabilir. */}
                  {s.klasor && s.klasor !== "INBOX" && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700"
                      title="Mail gelen kutusunda değil, bu klasörde bulundu">
                      {s.klasor}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div>{s.gonderen ?? "—"}</div>
                  {s.gonderen_adres && (
                    <div className="text-[11px] text-gray-500">{s.gonderen_adres}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* BELGE NO önce: Dijital Vergi Dairesi'nde tebligatlar bu numarayla
                      listeleniyor, kullanıcı hangi satıra bakacağını bilsin. */}
                  {s.belge_no && (
                    <div className="font-mono text-xs font-semibold text-[#1E3A5F]">
                      belge {s.belge_no}
                    </div>
                  )}
                  <div className="font-medium">{s.konu ?? "—"}</div>
                  {s.ozet && (
                    <div className="mt-0.5 max-w-[32rem] truncate text-[11px] text-gray-500" title={s.ozet}>
                      {s.ozet}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {s.guven === "kesin" ? (
                    <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs text-red-800"
                      title="Gönderen resmî alandan ya da daha önce onaylanmış bir adresten">
                      kesin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                      title="Gönderen tanıdık değil, konu vergi tebligatına benziyor — doğrulanmalı">
                      <ShieldQuestion size={11} /> aday
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {s.durum === "yeni" ? (
                    isaretleyebilir ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" disabled={islemde === s.id}
                          onClick={() => gonder({ islem: "bildirim-kontrol", id: s.id }, s.id)}
                          title="Dijital Vergi Dairesi'ne girip baktım — bu gerçekten vergi tebligatıydı"
                          className="inline-flex items-center gap-1 rounded bg-[#1E3A5F] px-2 py-1 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
                          {islemde === s.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Baktım
                        </button>
                        <button type="button" disabled={islemde === s.id}
                          onClick={() => gonder({ islem: "bildirim-ilgisiz", id: s.id }, s.id)}
                          title="Bu mail vergi tebligatı değil — listeden düşsün"
                          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60">
                          <X size={11} /> İlgisiz
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-700">bakılmadı</span>
                    )
                  ) : s.durum === "kontrol_edildi" ? (
                    <div className="text-[11px] text-gray-600">
                      {s.kontrol_eden_ad ?? "?"} tarafından {gunSaat(s.kontrol_at)}&apos;de bakıldı
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">ilgisiz</span>
                  )}
                </td>
              </tr>
            ))}
            {!yukleniyor && liste.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                {hepsi ? "Hiç GİB bildirimi yakalanmadı." : "Bekleyen GİB bildirimi yok."}
                <div className="mt-1 text-xs text-gray-400">
                  Bu, tebligat olmadığı anlamına gelmez — bilgilendirme maili gelmeyebilir.
                </div>
              </td></tr>
            )}
            {yukleniyor && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Yükleniyor…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Vergi dairesi tebligatları <b>UETS&apos;te değil</b>, GİB&apos;in KETSİS&apos;inde durur ve
        alıcı tarafı için yayınlanmış bir API yoktur: belge yalnız <b>Dijital Vergi
        Dairesi</b> ekranından görülebilir. Panel, GİB&apos;in bilgilendirme mailini muhasebe
        posta kutularından okuyup buraya düşürür. <b>Bu bir uyarıdır, garanti değildir</b> —
        bilgilendirme maili hukuken tebligatın parçası değil, gelmemesi süreyi durdurmaz
        (VUK 107/A: adrese ulaştığı tarihi izleyen beşinci günün sonunda tebliğ edilmiş
        sayılır). Bu yüzden haftada bir elle kontrol istenir.
      </p>
      </div>
      )}
    </div>
  );
}
