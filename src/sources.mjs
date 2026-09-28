import {normalizeJobs} from './normalize.mjs';
const ALLOWED = new Set(['boards-api.greenhouse.io','api.lever.co','api.eu.lever.co','api.ashbyhq.com','remotive.com','himalayas.app']);
export function sourceUrl(s){
  // 'board' must be a slug, never a user-controlled URL. Strict allowlisting prevents SSRF.
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(s.board))throw new Error('Invalid board slug');
  switch(s.provider){
    case 'greenhouse':return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s.board)}/jobs?content=true`;
    case 'lever': return `https://api.lever.co/v0/postings/${encodeURIComponent(s.board)}?mode=json&limit=100`;
    case 'ashby':return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s.board)}`;
    case 'remotive':return 'https://remotive.com/api/remote-jobs';
    case 'himalayas':return 'https://himalayas.app/jobs/api?limit=20';
    default:throw new Error('Unrecognized source provider');
  }
}
export async function fetchJobs(source, fetchFn=fetch){
  const uri=sourceUrl(source);
  const target=new URL(uri);
  if(target.protocol!=='https:'||!ALLOWED.has(target.hostname))throw new Error('Disallowed source');
  // Lever paginates; guard against an unexpectedly huge board or buggy API.
  const batches=source.provider==='lever'?5:1;
  const all=[];
  for(let page=0;page<batches;page++){
    if(page>0)target.searchParams.set('skip',String(page*100));
    const response=await fetchFn(target.toString(),{
      method:'GET',headers:{'accept':'application/json','user-agent':'InstantJobRadar/0.1 personal job discovery'},
      signal:AbortSignal.timeout(9000),redirect:'error'
    });
    if(response.status===429||response.status===503){const e=new Error(`Source backoff ${response.status}`);e.retry=true;throw e;}
    if(!response.ok)throw new Error(`${source.provider} HTTP ${response.status}`);
    const contentType=response.headers.get('content-type')??'';
    if(!contentType.includes('json'))throw new Error('Expected JSON response');
    const length=Number(response.headers.get('content-length')??0);
    if(length>4_000_000)throw new Error('Source payload exceeds size cap');
    // Enforce bound even when Content-Length is omitted/chunked.
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>4_000_000)throw new Error('Source payload exceeds size cap');
    let data;
    try{data=JSON.parse(new TextDecoder().decode(bytes));}
    catch{throw new Error('Invalid JSON from source');}
    const jobs=normalizeJobs(source.provider,data,source);
    all.push(...jobs);
    if(source.provider!=='lever'||!Array.isArray(data)||data.length<100)break;
  }
  return all;
}
