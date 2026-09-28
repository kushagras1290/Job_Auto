const ROLE = /\b(ai|artificial intelligence|machine learning|ml|genai|generative|llm|rag|agentic|nlp|python|deep learning)\b/i;
const ROLE_KIND = /\b(engineer|developer|scientist|architect|research|automation|applied|specialist)\b/i;
const TOO_SENIOR = /\b(principal|staff|director|head of|vp\b|vice president|intern|internship|graduate|fresher)\b/i;
const INDIAN = /\b(india|indian|ist\b|asia\/kolkata)\b/i;
const WORLD = /\b(worldwide|work from anywhere|anywhere in the world|global remote|globally remote)\b/i;
const EXCLUDED_INDIA = /\b(?:not hiring in india|india excluded|unable to hire in india|cannot hire in india|not available in india)\b/i;
const FOREIGN_ONLY = /\b(us only|usa only|united states only|north america only|canada only|uk only|europe only|eu only|emea only|citizens? only|must be based in (the )?(us|usa|united states|uk|europe|eu|canada)|authorized to work in (the )?(us|usa|united states|uk|europe|eu|canada))\b/i;
const US_HOURS = /\b(us (working|business|office) hours|north american (working|business|office) hours|est only|edt only|pst only|pdt only|must overlap.{0,35}(est|edt|pst|pdt)|(?:est|edt|pst|pdt).{0,35}(?:mandatory|required))\b/i;
const EU_HOURS = /\b(ist|asia\/kolkata|cet|cest|gmt|bst|european (working|business|office) hours|eu (working|business|office) hours|india (working|business|office) hours|async|asynchronous|flexible hours|any time ?zone|timezone agnostic)\b/i;
function yearsRequired(text) {
  const t=text.toLowerCase();
  const regexes=[/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\s*(?:of)?\s*(?:relevant|professional|work|industry|hands.on)?\s*experience/,/\bminimum\s+(?:of\s+)?(\d{1,2})\s*(?:years?|yrs?)/,/\bat least\s+(\d{1,2})\s*(?:years?|yrs?)/];
  for (const rx of regexes){const m=t.match(rx);if(m)return Number(m[1]);}
  return null;
}
export function qualify(job) {
  const text=[job.title,job.location,job.description].filter(Boolean).join(' ');
  const title=String(job.title??'');
  const evidence=[];
  if(!ROLE.test(title) || !ROLE_KIND.test(title))return {score:0,eligibility:'rejected',timezone:'review',reason:'Role does not match target AI engineering functions',evidence};
  if(TOO_SENIOR.test(title))return {score:0,eligibility:'rejected',timezone:'review',reason:'Position is outside mid-level scope',evidence};
  if(job.remote === false || /\b(onsite|on.site only|hybrid only|not remote|no remote)\b/i.test(text))return {score:0,eligibility:'rejected',timezone:'review',reason:'Remote arrangement not confirmed or explicitly onsite',evidence};
  if(EXCLUDED_INDIA.test(text) || FOREIGN_ONLY.test(text))return {score:0,eligibility:'rejected',timezone:'review',reason:'Explicit location/work-authorization restriction excludes India',evidence:['foreign-only']};
  const remoteSupported = job.remote === true || /\b(fully remote|remote[- ]first|remote\s*[-/(]\s*india|india\s*[-/]\s*remote|remote only|work from home|work from anywhere|fully distributed)\b/i.test([job.title,job.location,job.description].join(' '));
  const location=String(job.location??'');
  let eligibility = 'review';
  if(!remoteSupported)evidence.push('remote-status-unconfirmed');
  if(INDIAN.test(location) || /\b(eligible to work|hiring|accepting applicants|candidates)\b.{0,60}\b(india|indian)\b/i.test(text)){
    eligibility='confirmed'; evidence.push('explicit-india');
  } else if(WORLD.test(location) || WORLD.test(text)){
    evidence.push('worldwide-claim-needs-verification');
  }
  const tzMeta=Array.isArray(job.timezoneRestrictions)?job.timezoneRestrictions.join(', '):String(job.timezoneRestrictions??'');
  const tzText=[tzMeta,job.description].join(' ');
  let timezone='review';
  if(US_HOURS.test(tzText)){timezone='rejected'; evidence.push('north-american-hours-required');}
  else if(EU_HOURS.test(tzText)){timezone='confirmed';evidence.push('ist-eu-or-flexible-hours');}
  else evidence.push('working-hours-not-specified');
  const min=yearsRequired(job.description??'');
  if(min!==null && min>6)return {score:0,eligibility:'rejected',timezone,reason:`Minimum ${min} years exceeds maximum 6`,evidence};
  let score=35;
  if(/\b(langgraph|langchain|multi.agent|agentic|rag|llm)\b/i.test(text))score+=15;
  if(/\b(python|fastapi|pytorch|transformers)\b/i.test(text))score+=10;
  if(eligibility==='confirmed'&&remoteSupported)score+=20;
  if(timezone==='confirmed')score+=15;
  if(min!==null && min>=3 && min<=5)score+=5;
  score=Math.min(score,100);
  let reason= eligibility==='confirmed'&&timezone==='confirmed'&&remoteSupported?'India, remote status and hours explicitly supported':`Manual verification: ${eligibility==='review'?'India hiring eligibility ':''}${timezone==='review'?'working hours ':''}${timezone==='rejected'?'requires US hours':''}`.trim();
  if(!remoteSupported){eligibility='review';reason='Manual verification: explicit remote arrangement not found';}
  return {score,eligibility,timezone,reason,evidence};
}
export function shouldAlert(q, threshold=70){return q.score>=threshold && q.eligibility==='confirmed'&&q.timezone==='confirmed';}
