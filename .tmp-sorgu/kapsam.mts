import fs from "fs";
for (const s of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const i=s.indexOf("="); if(i<0||s.trim().startsWith("#"))continue; const k=s.slice(0,i).trim(); if(!(k in process.env)) process.env[k]=s.slice(i+1).trim().replace(/^["']|["']$/g,""); }
const fb:any = await import("node-firebird");
const db:any = await new Promise((res,rej)=>fb.attach({host:process.env.NETSIM_DB_HOST,port:+(process.env.NETSIM_DB_PORT||3050),database:process.env.NETSIM_DB_PATH,user:process.env.NETSIM_DB_USER,password:process.env.NETSIM_DB_PASSWORD,lowercase_keys:false,role:null,pageSize:4096},(e:any,d:any)=>e?rej(e):res(d)));
const q=(s:string)=>new Promise<any[]>((res,rej)=>db.query(s,[],(e:any,r:any)=>e?rej(e):res(r??[])));
const t=(v:any)=>String(v??"").trim();
const yil=(d:any)=> d? new Date(d).getFullYear() : 0;

// Hangi işlem kodu nerede, kaç kez, ne zamandan ne zamana
const kaynaklar:[string,string,string][] = [
  ["CARIISLM","ISLEM_KODU","TARIH"], ["BANKISLM","ISLEM_KODU","TARIH"], ["KASAISLM","ISLEM_KODU","TARIH"],
  ["ALSAASIL","ISLEM_KODU","TARIH"], ["CESEASIL","ISLEM_KODU","TARIH"], ["GRISASIL","ISLEM_KODU","TARIH"],
  ["KREDILER","ISLEM_KODU","TARIH"],
];
type K={kod:string;toplam:number;ilk:number;son:number;son2yil:number;tablolar:Record<string,number>};
const m=new Map<string,K>();
for (const [tab,kol,tar] of kaynaklar) {
  const r=await q(`SELECT ${kol} K, COUNT(*) N, MIN(${tar}) ILK, MAX(${tar}) SON FROM ${tab} GROUP BY 1`);
  const r2=await q(`SELECT ${kol} K, COUNT(*) N FROM ${tab} WHERE ${tar} > '2024-11-01' GROUP BY 1`);
  const son2=new Map(r2.map((x:any)=>[t(x.K),Number(x.N)]));
  for(const x of r){
    const kod=t(x.K); if(!kod) continue;
    const e=m.get(kod) ?? {kod,toplam:0,ilk:9999,son:0,son2yil:0,tablolar:{}};
    e.toplam+=Number(x.N); e.tablolar[tab]=Number(x.N);
    e.ilk=Math.min(e.ilk,yil(x.ILK)||9999); e.son=Math.max(e.son,yil(x.SON));
    e.son2yil+=son2.get(kod)??0;
    m.set(kod,e);
  }
}
// ISLMKODL'dan menü adı
const tanim=new Map<string,any>();
for(const x of await q(`SELECT TANIM_ISLEM_KODU K, KOD_TURU, MENU_ADI, FORM_ADI, TANIM_ISLEM_ADI, AKTIF FROM ISLMKODL`)) tanim.set(t(x.K),x);
const liste=[...m.values()].sort((a,b)=>b.toplam-a.toplam);
console.log(`KULLANILAN İŞLEM KODLARI (${liste.length} adet / ISLMKODL'da tanımlı 172)\n`);
console.log("kod     modül  toplam   son2yıl  yıllar      menü adı                         defterler");
for(const e of liste){
  const d=tanim.get(e.kod);
  const tb=Object.entries(e.tablolar).map(([k,v])=>`${k.slice(0,4)}:${v}`).join(" ");
  console.log(`${e.kod.padEnd(8)}${t(d?.KOD_TURU).padEnd(6)} ${String(e.toplam).padStart(7)} ${String(e.son2yil).padStart(8)}  ${e.ilk}-${e.son}  ${t(d?.MENU_ADI||"(tanımsız)").padEnd(32)} ${tb}`);
}
const kullanilan=new Set(liste.map(e=>e.kod));
const kullanilmayan=[...tanim.values()].filter((x:any)=>!kullanilan.has(t(x.TANIM_ISLEM_KODU)));
console.log(`\nHİÇ KULLANILMAMIŞ: ${kullanilmayan.length} işlem`);
console.log("  "+kullanilmayan.map((x:any)=>t(x.TANIM_ISLEM_KODU)).join(" "));
db.detach();
