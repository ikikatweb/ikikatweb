import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { ImapFlow } from "imapflow"; import { simpleParser } from "mailparser"; import { createClient } from "@supabase/supabase-js";
import { isyeriSicili } from "@/lib/personel/sicil";
import { olayTarihi } from "@/lib/personel/bildirge-fetch";
const __dirname = path.dirname(fileURLToPath(import.meta.url)); const kok = path.resolve(__dirname, "..");
for (const d of [".env.local",".env"]){const p=path.join(kok,d);if(!fs.existsSync(p))continue;for(const s of fs.readFileSync(p,"utf8").split(/\r?\n/)){const i=s.indexOf("=");if(i<0||s.trim().startsWith("#"))continue;const k=s.slice(0,i).trim();const v=s.slice(i+1).trim().replace(/^["']|["']$/g,"");if(!(k in process.env))process.env[k]=v;}}
function trUpper(s:string){return s.replace(/İ/g,"I").replace(/ı/g,"I").replace(/i/g,"I").replace(/Ş/g,"S").replace(/ş/g,"S").replace(/Ğ/g,"G").replace(/ğ/g,"G").replace(/Ü/g,"U").replace(/ü/g,"U").replace(/Ö/g,"O").replace(/ö/g,"O").replace(/Ç/g,"C").replace(/ç/g,"C").toUpperCase();}
async function pdfMetin(buf:Buffer){const spec="pdfjs-dist/legacy/build/pdf.mjs";const pdfjs:any=await import(spec);const t=pdfjs.getDocument({data:new Uint8Array(buf),useSystemFonts:true,isEvalSupported:false});const pdf=await t.promise;let x="";for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();x+=c.items.map((it:any)=>it.str??"").join(" ")+"\n";}try{await pdf.cleanup();}catch{}return {text:x,pages:pdf.numPages};}
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
const {data:firmalar}=await sb.from("firmalar").select("smtp_user, smtp_password").not("smtp_user","is",null).not("smtp_password","is",null);
const kutular:any[]=[];for(const f of firmalar??[]){const u=(f.smtp_user??"").trim();const p=f.smtp_password??"";if(!u||!p)continue;const a=u.split("@")[1]??"";const h=(process.env.BILDIRGE_IMAP_HOST||`mail.${a}`).trim();kutular.push({user:u,pass:p,host:h,etiket:a.split(".")[0]});}
const port=parseInt(process.env.BILDIRGE_IMAP_PORT??"993",10);const since=new Date(Date.now()-1.5*86400000);
for(const kutu of kutular){
  const c=new ImapFlow({host:kutu.host,port,secure:port===993,auth:{user:kutu.user,pass:kutu.pass},logger:false,tls:{rejectUnauthorized:false}});
  try{await c.connect();const lock=await c.getMailboxLock("INBOX");
  try{const seqs=await c.search({since});const sel=(Array.isArray(seqs)?seqs:[]).slice(-150);
    for await(const msg of c.fetch(sel,{source:true})){ if(!msg.source)continue;let parsed;try{parsed=await simpleParser(msg.source as Buffer);}catch{continue;}
      const tarih=parsed.date?parsed.date.toLocaleString("tr-TR"):"?";
      for(const ek of (parsed.attachments??[]).filter((a:any)=>/\.pdf$/i.test(a.filename??"")||/pdf/i.test(a.contentType??""))){
        const fn=ek.filename??""; const fnUp=trUpper(fn);
        const tcFn=(fn.match(/\d{11}/)??[])[0]??null;
        const tip=/AYRIL|ISTEN|CIKIS/.test(fnUp)?"cikis":(/GIRIS|ISE/.test(fnUp)?"giris":null);
        const {text,pages}=await pdfMetin(ek.content as Buffer); const norm=trUpper(text).replace(/\s+/g," ");
        const ad=/NACI/.test(norm)&&/SAHIN/.test(norm);
        const sicil=isyeriSicili(norm);
        const sorun = !tcFn || !tip || !sicil;
        if(!sorun && !ad) continue;
        console.log(`\n===== [${kutu.etiket}] ${tarih} =====`);
        console.log(`dosya: "${fn}"${ad?"  ← NACI ŞAHIN":""}`);
        console.log(`dosyadan TC=${tcFn??"—"} tip=${tip??"—"} | isyeriSicili=${sicil??"—"} | olay=${olayTarihi(norm)??"—"} | sayfa=${pages} len=${norm.length}`);
        console.log(`METİN TAM:\n${norm.slice(0,1400)}`);
      }
    }
  }finally{lock.release();}
  await c.logout();
  }catch(e){console.log(`${kutu.etiket} hata:`,e instanceof Error?e.message:e);try{await c.logout();}catch{}}
}
process.exit(0);
