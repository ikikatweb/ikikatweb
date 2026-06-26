import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const env=fs.readFileSync(".env.local","utf8");const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^"|"$/g,""):"";};
const xe=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const sb=createClient(get("NEXT_PUBLIC_SUPABASE_URL"),get("SUPABASE_SERVICE_ROLE_KEY"));
const {data:cz}=await sb.from("arvento_cihaz").select("node").eq("plaka","60 BP 934").maybeSingle();
const node=cz?.node||"X200129889";
const WS="https://ws.arvento.com/v1/report.asmx";
// aday metotlar (koordinat/rota/konum/genel/iz dönebilecekler)
const adaylar=["GeneralReport","GeneralReportWithDistance","RouteInformation","RouteVehiclePerformanceReport","PeriodicRegionTrackingReport","VehicleDistanceReport","CanBusOBDGeneralReport","DetailReport","PositionReport","LocationReport","TripReport","GetVehiclePositions","VehicleRoute","StopReport","IdlingReport","SpeedViolationReport","GeofenceReport"];
const chk={chkMotion:"true",chkLocation:"true",chkSpeed:"true",chkPause:"true"};
async function probe(method){
  const P={Username:get("ARVENTO_WS_USERNAME"),PIN1:get("ARVENTO_WS_PIN1"),PIN2:get("ARVENTO_WS_PIN2"),
    Node:node,StartDate:"20260624000000",EndDate:"20260624235959",Group:"",Locale:"",MinuteDif:"180",Language:"1033",Compress:"0",...chk};
  const inner=Object.entries(P).map(([k,v])=>`<${k}>${xe(v)}</${k}>`).join("");
  const body=`<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="http://www.arvento.com/">${inner}</${method}></soap:Body></soap:Envelope>`;
  try{
    const r=await fetch(WS,{method:"POST",headers:{"Content-Type":"text/xml; charset=utf-8",SOAPAction:"http://www.arvento.com/"+method},body});
    const t=await r.text();
    if(r.status!==200){const f=/<faultstring>([^<]*)</i.exec(t);return `HTTP${r.status} ${f?f[1].slice(0,40):""}`;}
    const yetkisiz=/yetkiniz yoktur|not authorized|Access denied/i.test(t);
    const koord=/<Latitude|<Longitude|Latitude_x|Longitude_x|>Latitude<|dLatitude/i.test(t);
    const satir=(t.match(/_x0020_Report>|<Table1>|<Distance>|<General/g)||[]).length;
    return `${yetkisiz?"YETKİSİZ":"yetkili "}${koord?"KOORD✓":"koord✗"} satır~${satir}`;
  }catch(e){return "HATA "+String(e).slice(0,30);}
}
for(const m of adaylar){console.log(`${m.padEnd(32)} → ${await probe(m)}`);}
