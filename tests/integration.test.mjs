import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {recordJob,updateStatus,leaseSource,finishedSource} from '../src/storage.mjs';
import {qualify} from '../src/eligibility.mjs';
import {dispatchAlerts} from '../src/notifications.mjs';

function db(){
  const engine=new DatabaseSync(':memory:');
  for(const file of ['0001_initial.sql','0002_verified_company_boards.sql','0003_notification_claim.sql'])engine.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  return {
    engine,
    prepare(sql){const stmt=engine.prepare(sql);return {
      bind(...params){const values=params.map(x=>x===undefined?null:x);return {
        first: async()=>stmt.get(...values)??null,
        all: async()=>({results:stmt.all(...values)}),
        run:async()=>{const result=stmt.run(...values);return {meta:{changes:Number(result.changes)}};}
      };}
    };}
  };
}
const now='2026-09-28T07:30:00.000Z';
const job={id:'a-123',provider:'ashby',sourceId:'ashby:emergence',company:'Test Vendor',title:'AI & Automation Engineer',location:'India',description:'Fully remote. Based in India, flexible hours. 4+ years Python and RAG experience.',remote:true,apply:'https://jobs.ashbyhq.com/test/123',source:'https://jobs.ashbyhq.com/test/123',date:now};

test('real SQLite migration succeeds; seeded employer sources exist',()=>{
  const d=db();const sources=d.engine.prepare("SELECT id FROM sources WHERE tier='priority' ORDER BY id").all().map(x=>x.id);
  assert.deepEqual(sources,['ashby:emergence','ashby:mightybot','greenhouse:particle41llc']);
  assert.equal(d.engine.prepare("SELECT COUNT(*) AS n FROM sources WHERE tier='broad'").get().n,1);d.engine.close();
});
test('source lease is atomic and failure backoff leaves source active',async()=>{
  const d=db(), source=d.engine.prepare("SELECT * FROM sources WHERE id='ashby:emergence'").get();
  assert.equal(await leaseSource(d,source,now),true);
  assert.equal(await leaseSource(d,source,now),false);
  await finishedSource(d,source,now,'rate-limited');
  assert.equal(d.engine.prepare('SELECT failure_count FROM sources WHERE id=?').get(source.id).failure_count,1);
  d.engine.close();
});
test('idempotent upsert preserves application status and applied timestamp',async()=>{
  const d=db(),q=qualify(job);
  assert.equal(await recordJob(d,job,q,now),true);
  assert.equal(await recordJob(d,job,q,now),false);
  const id=d.engine.prepare('SELECT id FROM jobs').get().id;
  assert.equal(await updateStatus(d,id,'Applied',now,'Sent official application'),true);
  await updateStatus(d,id,'Applied',now,'Sent official application','2026-10-05');
  await recordJob(d,{...job,description:job.description+' updated'},q,'2026-09-28T08:00:00.000Z');
  const result=d.engine.prepare('SELECT status,applied_at,notes,follow_up_at FROM jobs WHERE id=?').get(id);
  assert.deepEqual({...result},{status:'Applied',applied_at:now,notes:'Sent official application',follow_up_at:'2026-10-05'});
  assert.equal(d.engine.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,1);
  d.engine.close();
});
test('concurrent alert dispatches never double-send the same job',async()=>{
  const d=db(),q=qualify(job);await recordJob(d,job,q,now);
  const old=globalThis.fetch;let sends=0;
  globalThis.fetch=async url=>{assert.match(url,/api.telegram.org/);sends++;return new Response('{"ok":true}',{status:200});};
  try{
    const env={DB:d,TELEGRAM_BOT_TOKEN:'fake-test-token',TELEGRAM_CHAT_ID:'123',ALERT_MIN_SCORE:'70'};
    const counts=await Promise.all([dispatchAlerts(env,10,now),dispatchAlerts(env,10,now)]);
    assert.equal(counts.reduce((a,b)=>a+b),1);assert.equal(sends,1);
    assert.equal(d.engine.prepare('SELECT alerted_at FROM jobs').get().alerted_at!==null,true);
  }finally{globalThis.fetch=old;d.engine.close();}
});
