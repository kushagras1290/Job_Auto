// Optional Google Apps Script relay: job tracker is a view; D1 is source of truth.
// Failures must never prevent discovery, and updates never clobber user-managed status/notes.
export async function syncSheets(env,limit=15){
 if(!env.SHEETS_WEB_APP_URL||!env.SHEETS_SYNC_SECRET)return 0;
 const uri=new URL(env.SHEETS_WEB_APP_URL);
 if(uri.protocol!=='https:'||!['script.google.com','script.googleusercontent.com'].includes(uri.hostname))throw Error('Sheets relay URL not trusted');
 const rows=await env.DB.prepare(`SELECT * FROM jobs WHERE sheet_synced_at IS NULL ORDER BY first_seen_at DESC LIMIT ?`).bind(limit).all();
 if(!(rows.results??[]).length)return 0;
 const r=await fetch(uri.toString(),{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({secret:env.SHEETS_SYNC_SECRET,jobs:(rows.results??[]).map(j=>({id:j.id,company:j.company,title:j.title,location:j.location,apply_url:j.apply_url,source_url:j.source_url,published_at:j.published_at,first_seen_at:j.first_seen_at,last_seen_at:j.last_seen_at,fit_score:j.fit_score,eligibility:j.eligibility,timezone_fit:j.timezone_fit,reason:j.reason,evidence:j.evidence,status:j.status,applied_at:j.applied_at,follow_up_at:j.follow_up_at,notes:j.notes}))}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error(`Sheets relay HTTP ${r.status}`);
 // Apps Script redirect or HTML errors are not a successful sync.
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error('Sheets relay returned non-JSON');}
 if(!data.ok)throw new Error(`Sheets relay refused update: ${String(data.error??'unknown')}`);
 for(const j of rows.results??[])await env.DB.prepare('UPDATE jobs SET sheet_synced_at=? WHERE id=?').bind(new Date().toISOString(),j.id).run();
 return (rows.results??[]).length;
}
