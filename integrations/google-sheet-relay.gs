/** Install as a Google Apps Script project attached to the Tracker Google Sheet.
 *  Script Properties: SYNC_SECRET, WORKER_URL, ADMIN_TOKEN, SPREADSHEET_ID.
 *  Deploy web app: Execute as me; Access: Anyone (the high-entropy SYNC_SECRET is mandatory).
 *  Never place these secrets in publicly accessible source control values.
 *  Google Apps Script onEdit requires an INSTALLABLE trigger, installed by setupEditTrigger().
 */
const TRACKER_HEADERS=['Job ID','Company','Role','Location','Match','India eligibility','Hours','Application URL','Original source URL','Published','First seen','Last seen','Reason','Evidence','Status','Applied at','Follow-up date','Notes'];
const STATUS_ALLOWED=['Discovered','Review','Shortlisted','Applied','Interview','Offer','Rejected','Archived'];
function tracker_(){
 const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
 const ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();
 const sheet=ss.getSheetByName('Tracker') || ss.insertSheet('Tracker');
 if(sheet.getLastRow()<1){sheet.appendRow(TRACKER_HEADERS);sheet.setFrozenRows(1);}
 return sheet;
}
function doPost(e){
 const prop=PropertiesService.getScriptProperties();
 try{
   const data=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
   if(!data.secret||data.secret!==prop.getProperty('SYNC_SECRET'))throw Error('Unauthorized');
   if(!Array.isArray(data.jobs)||data.jobs.length>30)throw Error('Invalid jobs count');
   const sheet=tracker_();const lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw Error('Concurrent update');
   try{
     const all=sheet.getDataRange().getValues();const rows=new Map();
     for(let i=1;i<all.length;i++)if(all[i][0])rows.set(String(all[i][0]),i+1);
     for(const j of data.jobs){
       if(!/^[a-f0-9]{64}$/.test(String(j.id)))continue;
       const row=[j.id,j.company,j.title,j.location,j.fit_score,j.eligibility,j.timezone_fit,j.apply_url,j.source_url,j.published_at,j.first_seen_at,j.last_seen_at,j.reason,j.evidence,j.status,j.applied_at,j.follow_up_at,j.notes];
       const found=rows.get(j.id);
       if(found){
         // Metadata columns only. Preserve locally edited Status, Applied at, Follow-up, Notes.
         sheet.getRange(found,2,1,13).setValues([row.slice(1,14)]);
       }else{
         sheet.appendRow(row);rows.set(j.id,sheet.getLastRow());
       }
     }
     return ContentService.createTextOutput(JSON.stringify({ok:true,updated:data.jobs.length})).setMimeType(ContentService.MimeType.JSON);
   }finally{lock.releaseLock();}
 }catch(err){return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);}
}
function onTrackerEdit(e){
 if(!e||!e.range)return;
 const sheet=e.range.getSheet();if(sheet.getName()!=='Tracker'||e.range.getRow()<2||![15,17,18].includes(e.range.getColumn())||e.range.getNumRows()!==1)return;
 const status=String(e.range.getValue());if(!STATUS_ALLOWED.includes(status))return;
 const row=e.range.getRow(),id=String(sheet.getRange(row,1).getValue());if(!/^[a-f0-9]{64}$/.test(id))return;
 const p=PropertiesService.getScriptProperties();
 const root=p.getProperty('WORKER_URL'),secret=p.getProperty('ADMIN_TOKEN');if(!root||!secret)throw Error('Missing Worker endpoint or admin token');
 const resp=UrlFetchApp.fetch(root.replace(/\/$/,'')+'/api/jobs/'+id+'/status',{
   method:'patch',contentType:'application/json',headers:{Authorization:'Bearer '+secret},payload:JSON.stringify({status,notes:String(sheet.getRange(row,18).getDisplayValue()),follow_up_at:(()=>{const v=sheet.getRange(row,17).getValue();return v instanceof Date?Utilities.formatDate(v,'UTC','yyyy-MM-dd'):(String(v).trim()||null);})()}),muteHttpExceptions:true});
 if(resp.getResponseCode()!==200)throw Error('Status sync failed: '+resp.getResponseCode());
}
function setupEditTrigger(){
 const sheet=tracker_();
 for(const trigger of ScriptApp.getProjectTriggers())if(trigger.getHandlerFunction()==='onTrackerEdit')ScriptApp.deleteTrigger(trigger);
 ScriptApp.newTrigger('onTrackerEdit').forSpreadsheet(sheet.getParent()).onEdit().create();
 const range=sheet.getRange('O2:O1000');const rule=SpreadsheetApp.newDataValidation().requireValueInList(STATUS_ALLOWED,true).setAllowInvalid(false).build();range.setDataValidation(rule);
}
