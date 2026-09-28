function esc(x){return String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
export async function telegram(env, text){
 if(!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)return false;
 const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`Telegram failed with ${r.status}`);return true;
}
export async function dispatchAlerts(env,limit=10,now=new Date().toISOString()){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return 0;
 const threshold=Number(env.ALERT_MIN_SCORE??70);
 const rows=await env.DB.prepare(`SELECT id,company,title,apply_url,fit_score,reason,provider FROM jobs WHERE alerted_at IS NULL AND (alert_claim_until IS NULL OR alert_claim_until<?) AND eligibility='confirmed' AND timezone_fit='confirmed' AND fit_score>=? AND status IN ('Discovered','Shortlisted') ORDER BY fit_score DESC,first_seen_at DESC LIMIT ?`).bind(now,threshold,limit).all();
 let delivered=0;
 for(const j of rows.results??[]){
   const claimedUntil=new Date(new Date(now).getTime()+90_000).toISOString();
   const claim=await env.DB.prepare(`UPDATE jobs SET alert_claim_until=? WHERE id=? AND alerted_at IS NULL AND (alert_claim_until IS NULL OR alert_claim_until<?)`).bind(claimedUntil,j.id,now).run();
   if(!(claim.meta?.changes>0))continue;
   const msg=`🚀 <b>New verified job match</b>\n<b>${esc(j.title)}</b> — ${esc(j.company)}\nHeuristic fit: ${j.fit_score}/100\n${esc(j.reason)}\nSource: ${esc(j.provider)}\n${esc(j.apply_url)}`;
   try{
     await telegram(env,msg);
     await env.DB.prepare(`UPDATE jobs SET alerted_at=?,alert_claim_until=NULL WHERE id=? AND alert_claim_until=?`).bind(new Date().toISOString(),j.id,claimedUntil).run();
     delivered++;
   }catch(e){
     console.error('Alert delivery or acknowledgement failure',j.id,String(e));
     // Do not clear claim on an ambiguous network failure: Telegram may have
     // accepted delivery before the connection dropped. Retry after expiry.
     break;
   }
 }
 return delivered;
}
export async function dailyDigest(env,now){
 const since=new Date(new Date(now).getTime()-24*60*60*1000).toISOString();
 const rows=await env.DB.prepare(`SELECT company,title,apply_url,fit_score,eligibility,timezone_fit FROM jobs WHERE first_seen_at>=? AND eligibility!='rejected' AND timezone_fit!='rejected' ORDER BY fit_score DESC LIMIT 25`).bind(since).all();
 let message=`📬 <b>Daily AI job digest (9 AM IST)</b>\n${(rows.results??[]).length} shortlisted/review listings in the past 24h. See your tracking sheet for full details.`;
 for(const j of rows.results??[]){
  const flag=j.eligibility==='confirmed'&&j.timezone_fit==='confirmed'?'✅':'🔎';
  const chunk=`\n\n${flag} <b>${esc(j.company)}</b> · ${esc(j.title)} · ${j.fit_score}/100\n${esc(j.apply_url)}`;
  if(message.length+chunk.length>3800){await telegram(env,message);message='📬 <b>Daily AI job digest (continued)</b>';}
  message+=chunk;
 }
 return telegram(env,message);
}
