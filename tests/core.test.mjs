import test from 'node:test';
import assert from 'node:assert/strict';
import {qualify,shouldAlert} from '../src/eligibility.mjs';
import {normalizeJobs,canonicalUrl,plainText} from '../src/normalize.mjs';
import {sourceUrl,fetchJobs} from '../src/sources.mjs';
import worker from '../src/index.mjs';
const candidate={title:'Remote AI Engineer',company:'TestCo',location:'India - Remote',description:'Fully remote. Work IST or CET hours. 4+ years experience with Python, LangGraph, FastAPI and RAG.',remote:true,apply:'https://jobs.ashbyhq.com/test/example'};
const source={id:'ashby:example',company:'TestCo',provider:'ashby',board:'example',tier:'priority'};
test('High confidence when India, remote and IST/EU are explicit',()=>{
 const fit=qualify(candidate);assert.equal(fit.eligibility,'confirmed');assert.equal(fit.timezone,'confirmed');assert.equal(shouldAlert(fit),true);
});
test('Reject explicit US-only working hours',()=>{
 const fit=qualify({...candidate,description:'Must overlap with PST only, 4 years Python experience'});assert.equal(fit.timezone,'rejected');assert.equal(shouldAlert(fit),false);
});
test('Reject EU-only hiring despite CET overlap',()=>{
 const fit=qualify({...candidate,location:'Remote Europe only',description:'CET hours, Python, 4 years'});assert.equal(fit.eligibility,'rejected');assert.equal(shouldAlert(fit),false);
});
test('Reject explicit exclusion of India',()=>{
 const fit=qualify({...candidate,description:'Remote flexible hours; not hiring in India'});assert.equal(fit.eligibility,'rejected');
});
test('Worldwide claims require explicit legal verification',()=>{
 const fit=qualify({...candidate,location:'Worldwide remote',description:'Worldwide flexible hours, remote; 4 years of Python experience'});assert.equal(fit.eligibility,'review');assert.equal(shouldAlert(fit),false);
});
test('US timezone with worldwide location is never urgent',()=>{
 const fit=qualify({...candidate,location:'Worldwide',description:'Remote, must overlap EDT only; 4 years'});assert.equal(fit.timezone,'rejected');
});
test('Missing remote information is held for review',()=>{
 const fit=qualify({...candidate,remote:undefined,title:'AI Engineer',location:'India',description:'CET hours and 4 years Python experience'});assert.equal(fit.eligibility,'review');assert.equal(shouldAlert(fit),false);
});
test('Reject roles beyond 6 years minimum',()=>{
 const fit=qualify({...candidate,description:'India remote IST hours. At least 8 years experience. Python LangGraph'});assert.equal(fit.eligibility,'rejected');
});
test('Reject principal and internships',()=>{
 for(const title of ['Principal AI Engineer','AI Engineering Intern'])assert.equal(qualify({...candidate,title}).eligibility,'rejected');
});
test('Strip HTML and tracking parameters',()=>{
 assert.equal(plainText('<div>AI &amp; ML <em>Engineer</em></div>'),'AI & ML Engineer');
 assert.equal(canonicalUrl('https://example.com/jobs/123?utm_source=abc&id=22#application'),'https://example.com/jobs/123?id=22');
 assert.throws(()=>canonicalUrl('http://example.com/x'));
});
test('Normalize three official ATS forms',()=>{
 const g=normalizeJobs('greenhouse',{jobs:[{id:14,title:'AI Engineer',location:{name:'India Remote'},content:'<p>4+ years. IST. Remote</p>',absolute_url:'https://boards.greenhouse.io/t/jobs/14'}]}, {...source,provider:'greenhouse'});
 const l=normalizeJobs('lever',[{id:'l1',text:'AI Engineer',categories:{location:'India'},descriptionPlain:'Remote work IST',hostedUrl:'https://jobs.lever.co/t/l1',workplaceType:'remote'}],{...source,provider:'lever'});
 const a=normalizeJobs('ashby',{jobs:[{id:'a1',title:'AI Engineer',location:'India',descriptionPlain:'Remote IST',applyUrl:'https://jobs.ashbyhq.com/t/a1',isRemote:true}]},source);
 assert.equal(g.length,1);assert.equal(l[0].remote,true);assert.equal(a[0].title,'AI Engineer');
});
test('Aggregator parsers and attribution links',()=>{
 const r=normalizeJobs('remotive',{jobs:[{id:1,title:'AI Engineer',company_name:'X',candidate_required_location:'India',description:'IST remote',url:'https://remotive.com/remote-jobs/123'}]},{...source,provider:'remotive'});
 const h=normalizeJobs('himalayas',{jobs:[{id:'2',title:'AI Engineer',companyName:'X',locationRestrictions:['India'],timezoneRestrictions:['IST'],applicationLink:'https://himalayas.app/jobs/2'}]},{...source,provider:'himalayas'});
 assert.equal(r[0].source,'https://remotive.com/remote-jobs/123');assert.equal(h[0].timezoneRestrictions[0],'IST');
});
test('Allowlist blocks arbitrary host and invalid board slugs',()=>{
 assert.match(sourceUrl(source),/^https:\/\/api.ashbyhq.com\//);
 assert.throws(()=>sourceUrl({...source,board:'https://metadata.internal'}));
});
test('HTTP fetch validates JSON type and follows no redirects',async()=>{
 const items=await fetchJobs(source,async(url,opts)=>{
   assert.match(url,/ashby/);assert.equal(opts.redirect,'error');
   return new Response(JSON.stringify({jobs:[{id:'4',title:'AI Engineer',location:'India',applyUrl:'https://jobs.ashbyhq.com/x/4'}]}),{status:200,headers:{'content-type':'application/json'}});
 });assert.equal(items.length,1);
 await assert.rejects(fetchJobs(source,async()=>new Response('oops',{status:200,headers:{'content-type':'text/html'}})),/Expected JSON/);
});
test('Unauthenticated API calls are denied; health is public',async()=>{
 const ctx={waitUntil() {}};
 const unauthed=await worker.fetch(new Request('https://radar.example/api/jobs'),{ADMIN_TOKEN:'very-long-test-secret'},ctx);
 assert.equal(unauthed.status,401);
 const health=await worker.fetch(new Request('https://radar.example/health'),{},ctx);
 assert.equal((await health.json()).ok,true);
});

test('US-hours requirement is rejected even if posting also mentions IST',()=>{
 const fit=qualify({...candidate,description:'India remote; must overlap PST business hours, optional IST meetings. Python 4 years.'});
 assert.equal(fit.timezone,'rejected');
});
test('Non-remote wording must never pass remote qualification',()=>{
 const fit=qualify({...candidate,remote:undefined,location:'India',title:'AI Engineer',description:'Not remote. IST work; 4 years Python.'});
 assert.equal(fit.eligibility,'rejected');
});

test('Lever multi-page ATS feed is fetched and normalized',async()=>{
 let calls=0;const item=i=>({id:String(i),text:'AI Engineer',categories:{location:'India'},hostedUrl:`https://jobs.lever.co/demo/${i}`,descriptionPlain:'Remote IST'});
 const source={id:'lever:demo',company:'Demo',provider:'lever',board:'demo'};
 const rows=await fetchJobs(source,async url=>{calls++;if(calls===2)assert.match(url,/skip=100/);const jobs=calls===1?Array.from({length:100},(_,i)=>item(i)):[item(100)];return new Response(JSON.stringify(jobs),{headers:{'content-type':'application/json'}});});
 assert.equal(calls,2);assert.equal(rows.length,101);
});
