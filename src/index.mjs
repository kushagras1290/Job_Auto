import {fetchJobs} from './sources.mjs';
import {normalizeJobs,sha256} from './normalize.mjs';
import {qualify} from './eligibility.mjs';
import {leaseSource,recordJob,finishedSource,updateStatus} from './storage.mjs';
import {dispatchAlerts,dailyDigest} from './notifications.mjs';
import {syncSheets} from './sheets.mjs';
const TYPES=new Set(['greenhouse','lever','ashby','remotive','himalayas']);
const STATUSES=new Set(['Discovered','Review','Shortlisted','Applied','Interview','Offer','Rejected','Archived']);
const json=(obj,status=200)=>Response.json(obj,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function authorized(request,secret){
 const given=request.headers.get('authorization')??'';const expected=`Bearer ${secret??''}`;
 if(!secret||given.length!==expected.length)return false;
 let x=0;for(let i=0;i<given.length;i++)x|=given.charCodeAt(i)^expected.charCodeAt(i);return x===0;
}
async function processJob(env,job,now){
 const q=qualify(job);
 if(q.eligibility==='rejected'||q.timezone==='rejected')return {seen:1,new:0};
 return {seen:1,new:(await recordJob(env.DB,job,q,now))?1:0};
}
async function processSource(env,s,now){
 if(!(await leaseSource(env.DB,s,now)))return {scanned:0,seen:0,created:0,failed:0};
 let seen=0,created=0,err=null;
 try{
   const jobs=await fetchJobs(s);
   for(const j of jobs){
     const result=await processJob(env,j,now);
     seen+=result.seen;created+=result.new;
   }
 }catch(e){err=String(e?.message??e);console.error('source failure',{source:s.id,error:err});}
 finally{await finishedSource(env.DB,s,new Date().toISOString(),err);}
 return {scanned:1,seen,created,failed:err?1:0};
}
export async function scan(env,tier,now=new Date().toISOString()){
 if(!['priority','broad','daily'].includes(tier))throw new Error('Invalid tier');
 const runId=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO runs(id,started_at,tier) VALUES(?,?,?)').bind(runId,now,tier).run();
 const limit=tier==='priority'?Number(env.PRIORITY_BATCH_LIMIT??12):Number(env.BROAD_BATCH_LIMIT??12);
 const count=Math.max(1,Math.min(20,limit));
 const sources=await env.DB.prepare('SELECT * FROM sources WHERE active=1 AND tier=? ORDER BY COALESCE(last_started_at,\'1970-01-01\') ASC LIMIT ?').bind(tier,count).all();
 const stats={scanned:0,seen:0,created:0,failed:0};
 // Sequential network calls bound parallelism and respect each provider's quota.
 for(const source of sources.results??[]){const result=await processSource(env,source,now);for(const k of Object.keys(stats))stats[k]+=result[k];}
 await env.DB.prepare('UPDATE runs SET finished_at=?,sources_checked=?,jobs_seen=?,new_jobs=?,errors=? WHERE id=?').bind(new Date().toISOString(),stats.scanned,stats.seen,stats.created,stats.failed,runId).run();
 try{stats.alerts=await dispatchAlerts(env);}catch(e){console.error('alerts',String(e));}
 try{stats.sheetSynced=await syncSheets(env);}catch(e){console.error('sheets',String(e));}
 return {runId,tier,...stats};
}
async function handle(req,env,ctx){
 const u=new URL(req.url);if(u.pathname==='/health'&&req.method==='GET')return json({ok:true,service:'instant-job-radar'});
 if(!authorized(req,env.ADMIN_TOKEN))return json({error:'Unauthorized'},401);
 if(u.pathname==='/api/jobs'&&req.method==='GET'){
   const limit=Math.max(1,Math.min(100,Number(u.searchParams.get('limit')??30)||30));
   const offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset')??0)||0));
   const rows=await env.DB.prepare('SELECT id,company,title,location,apply_url,source_url,published_at,first_seen_at,fit_score,eligibility,timezone_fit,reason,status,applied_at,follow_up_at,notes FROM jobs ORDER BY first_seen_at DESC LIMIT ? OFFSET ?').bind(limit,offset).all();
   return json({jobs:rows.results??[],limit,offset});
 }
 if(u.pathname==='/api/sources'&&req.method==='GET'){
   const rows=await env.DB.prepare('SELECT id,company,provider,board,tier,active,cooldown_minutes,last_started_at,last_success_at,failure_count,last_error FROM sources ORDER BY company').all();
   return json({sources:rows.results??[]});
 }
 if(u.pathname==='/api/sources'&&req.method==='POST'){
   const b=await boundedJson(req);
   if(!TYPES.has(b.provider)||typeof b.company!=='string'||b.company.length<2||b.company.length>140||typeof b.board!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(b.board))return json({error:'Invalid provider, company or board'},400);
   // High-frequency polling only for employer-provided boards, never public aggregators.
   const tier=b.provider==='remotive'||b.provider==='himalayas'?'daily':b.tier==='priority'?'priority':'broad';
   const min= tier==='priority'?5:tier==='broad'?30:b.provider==='remotive'?360:1440;
   if((b.provider==='remotive'||b.provider==='himalayas') && b.board!=='all')return json({error:'Aggregator board must be all'},400);
   const id=`${b.provider}:${b.board}`;
   await env.DB.prepare(`INSERT INTO sources(id,company,provider,board,tier,cooldown_minutes) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET company=excluded.company,tier=excluded.tier,cooldown_minutes=excluded.cooldown_minutes,active=1`).bind(id,b.company,b.provider,b.board,tier,min).run();
   return json({ok:true,id,tier,cooldown_minutes:min},201);
 }
 if(u.pathname==='/api/scan'&&req.method==='POST'){
   const b=await boundedJson(req);if(!['priority','broad','daily'].includes(b.tier))return json({error:'Invalid tier'},400);
   // WaitUntil preserves response latency; monitor /api/runs to obtain result.
   const requestId=crypto.randomUUID();ctx.waitUntil(scan(env,b.tier).catch(e=>console.error('manual scan',requestId,e)));
   return json({accepted:true,requestId},202);
 }
 if(u.pathname==='/api/runs'&&req.method==='GET'){
   const rows=await env.DB.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 30').all();
   return json({runs:rows.results??[]});
 }
 if(u.pathname.startsWith('/api/jobs/') && u.pathname.endsWith('/status')&&req.method==='PATCH'){
   const id=u.pathname.split('/')[3]; const b=await boundedJson(req);
   if(!STATUSES.has(b.status)||b.notes!==undefined&&(typeof b.notes!=='string'||b.notes.length>3000)||b.follow_up_at!==undefined&&b.follow_up_at!==null&&(typeof b.follow_up_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.follow_up_at)||Number.isNaN(Date.parse(b.follow_up_at))))return json({error:'Invalid status, notes or follow-up date'},400);
   return json({updated:await updateStatus(env.DB,id,b.status,new Date().toISOString(),b.notes,b.follow_up_at)});
 }
 if(u.pathname==='/webhooks/authorized-job-event'&&req.method==='POST'){
   // Only an authorized partner may POST. This is NOT an unsolicited Greenhouse/Lever/Ashby webhook.
   const b=await boundedJson(req);
   if(!TYPES.has(b.provider)||typeof b.sourceId!=='string'||typeof b.payload!=='object')return json({error:'Invalid event'},400);
   const source=await env.DB.prepare('SELECT * FROM sources WHERE id=? AND provider=? AND active=1').bind(b.sourceId,b.provider).first();
   if(!source)return json({error:'Unknown source'},404);
   const normalized=normalizeJobs(b.provider,b.provider==='lever'?[b.payload]:{jobs:[b.payload]},source);
   for(const j of normalized)await processJob(env,j,new Date().toISOString());
   ctx.waitUntil(Promise.allSettled([dispatchAlerts(env),syncSheets(env)]));
   return json({accepted:true,processed:normalized.length},202);
 }
 return json({error:'Not found'},404);
}
async function boundedJson(request){
 if(Number(request.headers.get('content-length')??0)>50000)throw new Error('Payload too large');
 const text=await request.text();if(text.length>50000)throw new Error('Payload too large');return JSON.parse(text);
}
export default {
 async fetch(request,env,ctx){try{return await handle(request,env,ctx);}catch(e){console.error('api',String(e));return json({error:'Request failed'},400);}},
 async scheduled(controller,env,ctx){
   const cron=controller.cron;
   if(cron==='30 3 * * *'){
     ctx.waitUntil(dailyDigest(env,new Date().toISOString()).catch(e=>console.error('digest',e)));
   } else {
     const tier=cron==='*/5 * * * *'?'priority':cron==='*/30 * * * *'?'broad':cron==='0 */6 * * *'?'daily':null;
     if(tier)ctx.waitUntil(scan(env,tier).catch(e=>console.error('scheduled scan',tier,e)));
   }
 }
};
