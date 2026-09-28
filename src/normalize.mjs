const decode = (s) => String(s ?? '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export const plainText = (v) => decode(String(v??'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function canonicalUrl(input) {
  const u = new URL(String(input));
  if (u.protocol !== 'https:') throw new Error('Only https job URLs accepted');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|gh_src|lever-source|source|ref|trk)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}
export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function normalizeJobs(provider, data, source) {
  const list = provider==='greenhouse' ? data.jobs : provider==='lever' ? data : provider==='ashby' ? data.jobs : provider==='remotive'? data.jobs : data.jobs;
  if(!Array.isArray(list)) throw new Error(`Unexpected ${provider} payload`);
  return list.map(j=>{
    let item;
    switch(provider) {
      case 'greenhouse': item={id:j.id,company:source.company,title:j.title,location:j.location?.name,description:j.content,apply:j.absolute_url,source:j.absolute_url,date:j.updated_at,remote:undefined}; break;
      case 'lever': item={id:j.id,company:source.company,title:j.text,location:j.categories?.location,description:[j.descriptionPlain,...(j.lists??[]).map(l=>plainText(l.content))].join(' '),apply:j.applyUrl??j.hostedUrl,source:j.hostedUrl,date:j.createdAt?new Date(j.createdAt).toISOString():undefined,remote:j.workplaceType?.toLowerCase()==='remote'};break;
      case 'ashby': item={id:j.id??j.jobUrl,company:source.company,title:j.title,location:j.location,description:j.descriptionPlain??j.descriptionHtml,apply:j.applyUrl??j.jobUrl,source:j.jobUrl??j.applyUrl,date:j.publishedAt,remote:j.isRemote};break;
      case 'remotive': item={id:j.id,company:j.company_name,title:j.title,location:j.candidate_required_location,description:j.description,apply:j.url,source:j.url,date:j.publication_date,remote:true};break;
      case 'himalayas': item={id:j.guid??j.id??j.applicationLink,company:j.companyName??j.company?.name,title:j.title,location:Array.isArray(j.locationRestrictions)?j.locationRestrictions.join(', '):j.locationRestrictions??j.location,timezoneRestrictions:j.timezoneRestrictions,description:j.description??j.descriptionText,apply:j.applicationLink??j.guid,source:j.guid??j.applicationLink,date:j.pubDate??j.publishedAt??j.createdAt,remote:true}; break;
    }
    if(!item?.id || !item?.company || !item?.title || !item?.apply) return null;
    try {item.apply=canonicalUrl(item.apply);item.source=canonicalUrl(item.source??item.apply);}catch{return null;}
    item.location=plainText(item.location);
    item.description=plainText(item.description).slice(0,35000);
    item.provider=provider;
    item.sourceId=source.id;
    return item;
  }).filter(Boolean);
}
