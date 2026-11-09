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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, ExternalLink, AlertTriangle, Check, X, Loader2, ShieldQuestion } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { useAuth, tebligatDegisti } from "@/hooks";
import {
  getKetsisBildirimler, getSonKetsisKontrol, getKetsisTarayici, kontrolYasiGun,
  GIB_GIRIS, KONTROL_ARALIGI_GUN,
  type KetsisBildirim, type KetsisKontrol, type KetsisTarayiciDurum,
} from "@/lib/supabase/queries/ketsis";

// GİRİŞ EKRANININ KENDİSİ: dijital.gib.gov.tr ana sayfası tanıtım sayfası, giriş
// kutusu burada. 09.11.2026'da portalda doğrulandı — /portal isteği buraya yönleniyor.
const GIB_GIRIS_EKRANI = "https://dijital.gib.gov.tr/portal/login";

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
  const [islemde, setIslemde] = useState<number | "kontrol"  | null>(null);

  // TEBLİGAT DEFTERİ — ekranın asıl sonucu. Bildirim maili "gel bak" uyarısıydı;
  const yukle = useCallback(async () => {
    try {
      const [b, k, t] = await Promise.all([
        getKetsisBildirimler(), getSonKetsisKontrol(), getKetsisTarayici(),
      ]);
      setSatirlar(b); setSonKontrol(k); setTarayici(t);
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

  const yas = kontrolYasiGun(sonKontrol?.kontrol_at);
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

  async function gonder(govde: Record<string, unknown>, anahtar: number | "kontrol" ) {
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
      // Yarım kalan işlem sessiz geçilmez: rota uyarı döndürdüyse kullanıcı görsün.
      if (j.uyari) toast.error(j.uyari, { duration: 14000 });
      else toast.success("Kaydedildi.", { duration: toastSuresi() });
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

        {/* SÜZGEÇ: bildirim mailleri. Varsayılan "Bakılmamış" — daireye gidip
            bakılmamış mailler. "Hepsi" geçmişi de gösterir. */}
        <div className="ml-auto inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
          {([[false, `Bakılmamış${bekleyen.length ? ` (${bekleyen.length})` : ""}`], [true, "Hepsi"]] as const).map(([id, et]) => (
            <button key={String(id)} type="button" onClick={() => setHepsi(id)}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                hepsi === id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
              {et}
            </button>
          ))}
        </div>
        <a href={GIB_GIRIS} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white/70 px-2.5 h-7 text-xs hover:bg-gray-50">
          Dijital Vergi Dairesi <ExternalLink size={12} />
        </a>
      </div>

      {/* SONUÇ KARTI KALDIRILDI (09.11.2026 kullanıcı kararı): "Bekleyen tebligat yok ·
          son bakış …" şeridi buradaydı. Tablonun kendisi zaten aynı şeyi söylüyor ve
          boş olduğunda sebebini yazıyor. Haftalık "bakıldı" kaydı KAYBOLMADI: bir
          bildirimi "incelendi" yapmak o kaydı yazıyor (api/ketsis/kontrol), ayrıca ana
          sayfadaki uyarının kendi "Kontrol ettim" düğmesi duruyor. */}
      {/* GİB BİLDİRİM MAİLLERİ — artık bu bölümün ana içeriği.
          Önceden katlanmış ikincil bir listeydi, çünkü üstünde tebligat defteri vardı.
          Defter kaldırılınca katlı kalmasının anlamı kalmadı: ekranda gösterilecek tek
          şey bu. Mail hukuken tebligatın parçası değil — "gel bak" demek, kanıt değil. */}
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
              <th className="px-3 py-2 font-medium whitespace-nowrap">Gönderme tarihi</th>
              <th className="px-3 py-2 font-medium">Gönderen</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Tebliğ tarihi</th>
              <th className="px-3 py-2 font-medium">Konu / özet</th>
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">Durum</th>
              {/* GÜVEN EN SAĞDA: her satırda "kesin" yazıyor, günlük işte bakılan bir
                  bilgi değil — yalnız şüpheli ("aday") bir mail düştüğünde önem
                  kazanıyor. Ortada durup asıl sütunları sıkıştırıyordu. */}
              <th className="px-3 py-2 font-medium">Güven</th>
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
                {/* GÖNDERME TARİHİ, MAİLİN GELDİĞİ GÜN DEĞİL (09.11.2026).
                    GİB aynı belge için iki mail yolluyor: biri gönderildiği gün, biri
                    tebliğ günü. İkincisinden yakalanmışsa mailin tarihi 5 gün sapıyor —
                    MC09608584'te tam olarak bu oldu (mail 07.11, gönderme 02.11).
                    Belgenin ne zaman gönderildiği metinde yazıyor, oradan okunuyor.
                    Mailin geldiği gün FARKLIYSA altta gösteriliyor: "ikinci mailden
                    yakalandı" bilgisi gizlenmiyor. Metin okunamadıysa eski davranış. */}
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {s.gonderme_tarihi ? (
                    <>
                      <div>{new Date(s.gonderme_tarihi + "T00:00:00").toLocaleDateString("tr-TR")}</div>
                      {gunSaat(s.mail_tarihi).slice(0, 10) !==
                        new Date(s.gonderme_tarihi + "T00:00:00").toLocaleDateString("tr-TR") && (
                        <div className="mt-0.5 text-[11px] font-normal text-gray-500"
                          title="Belge bu tarihte gönderilmiş; bildirim maili daha sonra yakalanmış (GİB aynı belge için iki mail yolluyor).">
                          mail {gunSaat(s.mail_tarihi)}
                        </div>
                      )}
                    </>
                  ) : gunSaat(s.mail_tarihi)}
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
                  {/* ASIL GÖNDEREN KURUM ÖNDE (09.11.2026): bu sütunda iki satır da
                      ketsis-noreply@gelirler.gov.tr yazıyordu. O adres GİB'in dağıtım
                      robotu — tebligatı gönderen kurum değil. Kurum mailin metninde
                      duruyor ("Tarafınıza Emniyet Genel Müdürlüğü adına …") ve çekiliyor.
                      Trafik cezası mı, vergi dairesi yazısı mı: listeye bakınca görülsün.
                      Kurum okunamadıysa eski davranış sürer, robot adresi yazar. */}
                  {/* GÖNDEREN GENİŞ: "Emniyet Genel Müdürlüğü" dar sütunda üç satıra
                      bölünüyordu. Yer konudan alındı — konu her satırda neredeyse aynı
                      ("KETSİS Tebliğ Bilgilendirme İletisi"), ayırt edici olan kurum. */}
                  <div className="min-w-[10rem] font-medium">{s.gonderen_kurum ?? s.gonderen ?? "—"}</div>
                  {s.gonderen_kurum
                    ? <div className="text-[11px] text-gray-500">GİB üzerinden</div>
                    : s.gonderen_adres && (
                        <div className="text-[11px] text-gray-500">{s.gonderen_adres}</div>
                      )}
                </td>
                {/* TEBLİĞ TARİHİ — mailin metninden okunuyor, HESAPLANMIYOR.
                    "Ulaşma + 5" bizim hesabımız olurdu; burada GİB'in kendi beyanı var
                    ("… 07/11/2026 tarihinde tebliğ edilmiştir"). Sürenin başladığı gün
                    bu (VUK 107/A). Gelecekteyse kaç gün kaldığı da yazılıyor; o tarihe
                    kadar belge henüz tebliğ sayılmamış demektir. */}
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {s.teblig_tarihi ? (
                    <>
                      <div className="font-medium">
                        {new Date(s.teblig_tarihi + "T00:00:00").toLocaleDateString("tr-TR")}
                      </div>
                      {(() => {
                        const kalan = Math.ceil(
                          (new Date(s.teblig_tarihi + "T00:00:00").getTime() - Date.now()) / 86400000);
                        return kalan > 0
                          ? <div className="text-[11px] font-normal text-amber-700">{kalan} gün sonra</div>
                          // Gönderme tarihi artık kendi sütununda; burada tekrarlanmıyor.
                          : null;
                      })()}
                    </>
                  ) : (
                    // TARİH OKUNAMADIYSA BOŞ BIRAKILIR: uydurma tarih, yanlış güne göre
                    // iş yapılması demek. Metin mailin özetinde duruyor, oradan bakılır.
                    <span className="text-gray-400">—</span>
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
                  {/* KONU KISALDI: her satırda aynı kalıp yazıyor, ayırt edici bilgi
                      zaten üstteki belge numarası. Tamamı title'da duruyor. */}
                  <div className="max-w-[18rem] truncate font-medium" title={s.konu ?? ""}>{s.konu ?? "—"}</div>
                  {s.ozet && (
                    <div className="mt-0.5 max-w-[18rem] truncate text-[11px] text-gray-500" title={s.ozet}>
                      {s.ozet}
                    </div>
                  )}
                </td>
                {/* AÇ VE OKU — doğrudan Dijital Vergi Dairesi GİRİŞ ekranına, YENİ SEKMEDE.
                    Belge panele inmiyor: KETSİS'in alıcı tarafı için API yok, tebligat
                    yalnız o ekranda okunuyor. Düğme yolu kısaltıyor, belgeyi getirmiyor —
                    adı "Aç ve oku" ama açan kullanıcı, panel değil.
                    Portala giriş CAPTCHA istiyor (09.11.2026'da ölçüldü), o yüzden
                    doğrudan belgeye değil giriş ekranına gidiliyor; aradaki adımları
                    panelin geçmesi mümkün değil.
                    Belge no satırda yazıyor: girişten sonra hangi satıra bakılacağı belli. */}
                <td className="px-3 py-2 whitespace-nowrap">
                  {/* BASAN KİŞİ KAYDA GEÇER (09.11.2026): tıklayınca satır işaretleniyor,
                      Durum sütununda kim ne zaman bastığı yazıyor. "Bu bildirime kimse
                      gitmedi mi" sorusu böylece cevaplanıyor.
                      BU BİR VARSAYIMDIR VE SINIRI VAR: düğmeye basmak portala GİTMEK
                      demek, tebligatı OKUMUŞ olmak demek değil — kişi giriş ekranında
                      vazgeçebilir. Metin bu yüzden "bakıldı" diyor, "okundu" demiyor.
                      <a> olarak kalıyor (button + window.open değil): sekmeyi tarayıcı
                      kendi açıyor, açılır pencere engelleyicisine takılmıyor; kayıt
                      isteği arkadan gidiyor, sekmeyi geciktirmiyor. */}
                  <a href={GIB_GIRIS_EKRANI} target="_blank" rel="noopener noreferrer"
                    onClick={() => {
                      if (isaretleyebilir && s.durum === "yeni") {
                        void gonder({ islem: "bildirim-kontrol", id: s.id,
                          notlar: "Aç ve oku ile Dijital Vergi Dairesi'ne gidildi" }, s.id);
                      }
                    }}
                    title={s.belge_no
                      ? `Dijital Vergi Dairesi giriş ekranı yeni sekmede açılır. Giriş yapınca ${s.belge_no} numaralı belgeye bakın. Bastığınız kayda geçer.`
                      : "Dijital Vergi Dairesi giriş ekranı yeni sekmede açılır."}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E3A5F]/30 bg-white px-2.5 h-7 text-xs font-medium text-[#1E3A5F] hover:bg-[#1E3A5F]/5">
                    Aç ve oku <ExternalLink size={12} />
                  </a>
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
                <td className="px-3 py-2">
                  {/* RENK ANLAMI (09.11.2026): yeşil = gönderen doğrulandı, iş tamam;
                      kırmızı = DOĞRULANMADI, bakılması gereken budur. Eskiden "kesin"
                      kırmızıydı (tebligat ciddi bir şey diye) ama listede hepsi kesin
                      olduğu için tablo baştan aşağı kırmızı duruyordu ve kırmızı
                      anlamını yitiriyordu. Renk artık DURUMU değil, GÜVENİ anlatıyor. */}
                  {s.guven === "kesin" ? (
                    <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                      title="Gönderen resmî alandan ya da daha önce onaylanmış bir adresten">
                      kesin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800"
                      title="Gönderen tanıdık değil, konu vergi tebligatına benziyor — DOĞRULANMALI">
                      <ShieldQuestion size={11} /> aday
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!yukleniyor && liste.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-500">
                {/* BOŞ TABLO "KAYIT YOK" SANILIYORDU (09.11.2026, ikinci kez): bütün
                    mailler "bakıldı" işaretliyken varsayılan "Bakılmamış" süzgeci
                    hiçbirini göstermiyor ve bölüm bomboş duruyor. Kayıt OLDUĞUNU
                    söylemek gerekiyor, yoksa "çalışmadı / gelmedi" sanılıyor. */}
                {hepsi
                  ? "Hiç GİB bildirimi yakalanmadı."
                  : satirlar.length > 0
                    ? `Bekleyen GİB bildirimi yok — ${satirlar.length} mailin hepsine bakılmış.`
                    : "Bekleyen GİB bildirimi yok."}
                <div className="mt-1 text-xs text-gray-400">
                  {satirlar.length > 0 && !hepsi
                    ? <>Gelen maillerin tamamını görmek için yukarıdaki <b>Hepsi</b> düğmesine basın.</>
                    : <>Bu, tebligat olmadığı anlamına gelmez — bilgilendirme maili gelmeyebilir.</>}
                </div>
              </td></tr>
            )}
            {yukleniyor && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">Yükleniyor…</td></tr>
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
  );
}
