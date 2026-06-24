import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const env=fs.readFileSync(".env.local","utf8");const get=(k)=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^"|"$/g,""):"";};
const sb=createClient(get("NEXT_PUBLIC_SUPABASE_URL"),get("SUPABASE_SERVICE_ROLE_KEY"));
const N=(p)=>(p||"").toUpperCase().replace(/\s+/g,"");
const xe=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const WS="https://ws.arvento.com/v1/report.asmx";
const U={Username:get("ARVENTO_WS_USERNAME"),PIN1:get("ARVENTO_WS_PIN1"),PIN2:get("ARVENTO_WS_PIN2")};
async function soap(op,P){const inner=Object.entries(P).map(([k,v])=>`<${k}>${xe(v)}</${k}>`).join("");
  const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${op} xmlns="http://www.arvento.com/">${inner}</${op}></soap:Body></soap:Envelope>`;
  const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),60000);
  try{const r=await fetch(WS,{method:"POST",headers:{"Content-Type":"text/xml; charset=utf-8",SOAPAction:"http://www.arvento.com/"+op},body,signal:ac.signal});let t=await r.text();return t.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");}finally{clearTimeout(tm);}}
const fmtKm=(n)=>n==null?"-":Math.round(n).toLocaleString("tr-TR");
const fmtSa=(sn)=>`${Math.floor(sn/3600)} sa ${Math.floor(sn%3600/60)} dk`;
const aracPlaka=(p)=>/^\d{2}\s+[A-Z]/.test(p||""); // gerçek TR plakası = araç; değilse makine
(async()=>{
  const {data:c}=await sb.from("arvento_cihaz").select("node,plaka,marka,model");
  const {data:ar}=await sb.from("araclar").select("plaka,cinsi");
  const cinsMap=new Map((ar||[]).map(x=>[N(x.plaka),x.cinsi]));
  const st=await soap("GetVehicleStatusV3",{...U,Language:"1033"});
  const odo=new Map();for(const b of (st.match(/<LastPacket\b[\s\S]*?<\/LastPacket>/gi)||[])){const n=(b.match(/<strNode>([^<]*)/)||[])[1];const o=(b.match(/<dOdometer>([^<]*)/)||[])[1];odo.set(n,o?parseFloat(o):null);}
  const araclar=[],makineler=[];
  for(const x of (c||[])){if(aracPlaka(x.plaka))araclar.push({plaka:x.plaka,km:odo.get(x.node)});else makineler.push({plaka:x.plaka,node:x.node,cins:cinsMap.get(N(x.plaka))||x.model||x.marka||"İş makinesi"});}
  araclar.sort((a,b)=>(b.km||0)-(a.km||0));
  for(const m of makineler){
    try{const t=await soap("IgnitionDurationReport",{...U,StartDate:"20250624000000",EndDate:"20260624235959",Node:m.node,MinuteDif:"0",Language:"1033"});
      let sn=0;for(const r of t.matchAll(/<Ignition_x0020_On_x0020_Duration_x0020_hr>([^<]*)<[\s\S]*?_min>([^<]*)<[\s\S]*?_sec>([^<]*)</g))sn+=(+r[1]||0)*3600+(+r[2]||0)*60+(+r[3]||0);m.sn=sn;}
    catch{m.sn=null;}
  }
  makineler.sort((a,b)=>(b.sn||0)-(a.sn||0));
  console.log("=== ARAÇLAR — Toplam km (ömür boyu / odometre) ===");
  araclar.forEach((a,i)=>console.log(`${i+1}|${a.plaka}|${fmtKm(a.km)} km`));
  console.log("\n=== İŞ MAKİNELERİ — Çalışma saati (motor açık, son ~1 yıl = Arvento'nun tuttuğu tüm veri) ===");
  makineler.forEach((m,i)=>console.log(`${i+1}|${m.plaka}|${m.cins}|${m.sn==null?"veri yok":fmtSa(m.sn)}`));
})();
