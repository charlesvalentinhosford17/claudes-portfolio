const IDS=Object.freeze({holdings:'04792c14-6a6d-46fd-9157-19d5dfd76e67',watchlist:'bde219e6-2cac-45f2-a824-ea222a4c0bc8',activity:'3b4de5e5-2ce0-430d-bb7d-c12db4d10aac',history:'81b3bf2a-8ff1-4f45-8df9-567f770ed6dc',reports:'960094d4-1c87-4d41-9551-ababc1879698'});
export const SOURCES=IDS;
const plain=(v)=>Array.isArray(v)?v.map(x=>x.plain_text??x.text?.content??'').join(''):'';
const val=(p)=>{if(!p)return null;switch(p.type){case'title':case'rich_text':return plain(p[p.type]);case'select':return p.select?.name??null;case'number':return Number.isFinite(p.number)?p.number:null;case'date':return p.date?.start??null;case'url':return p.url??null;case'files':case'file':return (Array.isArray(p.files)?p.files:Array.isArray(p.file)?p.file:[]).map(f=>({name:f.name??'PDF report',url:f.file?.url??f.external?.url??null,expires:f.file?.expiry_time??null}));default:return null}};
const prop=(page,key)=>val(page.properties?.[key]);
const date=(v)=>typeof v==='string'?v.slice(0,10):null;
const finite=(n)=>typeof n==='number'&&Number.isFinite(n)?n:null;
export function normalizeData(raw){
 const rows=(name)=>Array.isArray(raw[name])?raw[name]:[];
 const holdings=rows('holdings').filter(p=>prop(p,'Position type')==='Paper').map(p=>({name:prop(p,'Holding')||'Unnamed position',ticker:prop(p,'Ticker'),isin:prop(p,'ISIN'),units:finite(prop(p,'Units')),value:finite(prop(p,'Value EUR')),weight:finite(prop(p,'Weight %')),asOf:date(prop(p,'As of')),thesis:prop(p,'Investment thesis'),url:p.url}));
 const watchlist=rows('watchlist').map(p=>({name:prop(p,'Company')||'Unnamed company',ticker:prop(p,'Ticker'),status:prop(p,'Research status')||'Unreviewed',priority:prop(p,'Priority'),reason:prop(p,'Why on watch'),change:prop(p,'Recent change'),reviewed:date(prop(p,'Last reviewed')),evidence:date(prop(p,'Evidence date')),source:prop(p,'Primary source'),url:p.url})).sort((a,b)=>(b.reviewed||'').localeCompare(a.reviewed||''));
 const activity=rows('activity').map(p=>({event:prop(p,'Event')||'Activity',date:date(prop(p,'Date')),category:prop(p,'Category'),status:prop(p,'Status'),details:prop(p,'Details'),ticker:prop(p,'Ticker'),source:prop(p,'Source'),url:p.url})).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const history=rows('history').map(p=>({name:prop(p,'Snapshot'),date:date(prop(p,'As of')),nav:finite(prop(p,'Total NAV EUR')),cash:finite(prop(p,'Paper cash EUR')),positions:finite(prop(p,'Positions EUR')),realized:finite(prop(p,'Realized P&L EUR')),unrealized:finite(prop(p,'Unrealized P&L EUR')),funding:finite(prop(p,'Net funding EUR')),benchmark:finite(prop(p,'Benchmark value EUR')),notes:prop(p,'Notes')})).filter(x=>x.date).sort((a,b)=>a.date.localeCompare(b.date));
 const latest=[...history].reverse().find(x=>x.nav!==null)||null;
 const trades=activity.filter(x=>x.category==='Paper trade'&&x.status==='Completed');
 const reports=rows('reports').map(p=>({name:prop(p,'Report')||'Daily report',date:date(prop(p,'Report date')),summary:prop(p,'Summary'),status:prop(p,'Status')||'Incomplete',pdf:prop(p,'PDF')||[],nav:finite(prop(p,'Paper NAV EUR')),trades:finite(prop(p,'Trades recorded')),reviewed:finite(prop(p,'Reviewed companies')),url:p.url})).filter(x=>x.date).sort((a,b)=>b.date.localeCompare(a.date));
 return {holdings,watchlist,activity,history,trades,reports,latest,meta:{paperOnly:true,holdingsDate:holdings.map(x=>x.asOf).filter(Boolean).sort().at(-1)??null,watchDate:watchlist.map(x=>x.reviewed).filter(Boolean).sort().at(-1)??null,navDate:latest?.date??null}};
}
export async function getNotionRecords(token,fetcher=fetch){
 if(!token)throw new Error('Notion integration is not configured');
 const results={};
 for(const [name,id] of Object.entries(IDS)){
  let cursor=null,rows=[],pages=0;
  do{
   const body={page_size:100};if(cursor)body.start_cursor=cursor;
   const response=await fetcher('https://api.notion.com/v1/data_sources/'+id+'/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(14000)});
   if(!response.ok)throw new Error('Notion '+name+' query failed (HTTP '+response.status+')');
   const json=await response.json();
   if(!Array.isArray(json.results))throw new Error('Unexpected Notion '+name+' response');
   rows.push(...json.results);cursor=json.has_more?json.next_cursor:null;
   if(++pages>=20&&cursor)throw new Error('Notion '+name+' exceeded pagination limit');
  }while(cursor);
  results[name]=rows;
 }
 return normalizeData(results);
}
