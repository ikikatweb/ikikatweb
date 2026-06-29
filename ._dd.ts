import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const env=fs.readFileSync(".env.local","utf8");const get=(k:string)=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^"|"$/g,""):"";};
const sb=createClient(get("NEXT_PUBLIC_SUPABASE_URL"),get("SUPABASE_SERVICE_ROLE_KEY"));
const norm=(s:string)=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,"");
async function all<T>(b:(o:number,p:number)=>any):Promise<T[]>{const P=1000;let o=0;const out:T[]=[];while(true){const{data,error}=await b(o,P);if(error)throw error;const pc=(data??[]) as T[];out.push(...pc);if(pc.length<P)break;o+=P;if(o>50000)break;}return out;}
(async()=>{
  const bas="2026-06-01",bit="2026-06-29";
  const rap=await all<any>((o,p)=>sb.from("arac_arvento_rapor").select("plaka,damper_olaylar,damper_sayisi").gte("rapor_tarihi",bas).lte("rapor_tarihi",bit).range(o,o+p-1));
  const greyder=["06-00-10-1096","60-04-07-008"].map(norm);const set=new Set<string>();
  for(const r of rap){if((r.damper_olaylar?.length||0)>0||(r.damper_sayisi||0)>0)set.add(r.plaka);if(greyder.includes(norm(r.plaka)))set.add(r.plaka);}
  const ilgili=[...set];
  const G:string[]=[];const d=new Date(bas+"T00:00:00"),s=new Date(bit+"T00:00:00");for(;d<=s;d.setDate(d.getDate()+1))G.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  let t=Date.now();const rows:any[]=[];
  for(let i=0;i<G.length;i+=4){const res=await Promise.all(G.slice(i,i+4).map(g=>sb.from("arac_arvento_guzergah").select("*").eq("rapor_tarihi",g).in("plaka",ilgili).order("plaka")));for(const r of res){if(r.error)throw r.error;for(const x of (r.data||[]))rows.push(x);}}
  let bytes=0;for(const x of rows)bytes+=JSON.stringify(x.noktalar||[]).length;
  console.log(`GÜN-GÜN scoped stabilize: ${Date.now()-t}ms, ${rows.length} satır, ~${(bytes/1048576).toFixed(1)} MB`);
})();
