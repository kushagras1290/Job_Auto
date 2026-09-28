import {sha256} from './normalize.mjs';
export async function leaseSource(db, source, now){
 const expires=new Date(new Date(now).getTime()+4*60*1000).toISOString();
 const cooldown = source.cooldown_minutes * Math.min(16,2**Math.max(0,Number(source.failure_count||0)));
 const latest=new Date(new Date(now).getTime()-cooldown*60*1000).toISOString();
 const r=await db.prepare(`UPDATE sources SET lease_until=?,last_started_at=? WHERE id=? AND active=1 AND (lease_until IS NULL OR lease_until<?) AND (last_started_at IS NULL OR last_started_at<=?)`).bind(expires,now,source.id,now,latest).run();
 return (r.meta?.changes??0)>0;
}
export async function recordJob(db,job,q,now){
 const id=await sha256(`${job.provider}\0${job.id}`);
 const descriptionHash=await sha256(job.description);
 const existing=await db.prepare('SELECT id,status,description_hash FROM jobs WHERE id=?').bind(id).first();
 // Never reset user-managed application state during rediscovery.
 await db.prepare(`INSERT INTO jobs(id,provider,source_id,source_job_id,company,title,location,apply_url,source_url,published_at,first_seen_at,last_seen_at,fit_score,eligibility,timezone_fit,reason,evidence,description_hash,status)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET company=excluded.company,title=excluded.title,location=excluded.location,apply_url=excluded.apply_url,source_url=excluded.source_url,published_at=excluded.published_at,last_seen_at=excluded.last_seen_at,fit_score=excluded.fit_score,eligibility=excluded.eligibility,timezone_fit=excluded.timezone_fit,reason=excluded.reason,evidence=excluded.evidence,description_hash=excluded.description_hash,sheet_synced_at=CASE WHEN jobs.description_hash!=excluded.description_hash OR jobs.fit_score!=excluded.fit_score OR jobs.apply_url!=excluded.apply_url OR jobs.eligibility!=excluded.eligibility OR jobs.timezone_fit!=excluded.timezone_fit THEN NULL ELSE jobs.sheet_synced_at END`).bind(
 id,job.provider,job.sourceId,String(job.id),job.company,job.title,job.location,job.apply,job.source,job.date??null,now,now,q.score,q.eligibility,q.timezone,q.reason,JSON.stringify(q.evidence),descriptionHash,q.eligibility==='rejected'?'Archived':q.eligibility==='review'||q.timezone==='review'?'Review':'Discovered'
 ).run();
 return !existing;
}
export async function finishedSource(db,source,now,error){
 await db.prepare(`UPDATE sources SET lease_until=NULL,last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,failure_count=CASE WHEN ? IS NULL THEN 0 ELSE failure_count+1 END,last_error=? WHERE id=?`).bind(error??null,now,error??null,error?.slice(0,350)??null,source.id).run();
}
export async function updateStatus(db,id,status,now,notes,followUpAt){
 const allowed=new Set(['Discovered','Review','Shortlisted','Applied','Interview','Offer','Rejected','Archived']);
 if(!allowed.has(status))throw new Error('Invalid status');
 if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid job id');
 const fields=['status=?',`applied_at=CASE WHEN ?='Applied' AND applied_at IS NULL THEN ? ELSE applied_at END`,'sheet_synced_at=NULL'];
 const args=[status,status,now];
 if(notes!==undefined){fields.push('notes=?');args.push(notes);}
 if(followUpAt!==undefined){fields.push('follow_up_at=?');args.push(followUpAt);}
 const stmt=db.prepare(`UPDATE jobs SET ${fields.join(',')} WHERE id=?`).bind(...args,id);
 const r=await stmt.run();return (r.meta?.changes??0)>0;
}
