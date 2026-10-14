(() => {
'use strict';
const by=id=>document.getElementById(id);
let data=null,active='overview';
const views={overview:['OVERVIEW','Portfolio overview','Your independent portfolio, decisions and research — in one place.'],holdings:['PORTFOLIO','Portfolio holdings','Recorded paper positions and valuations.'],trades:['PAPER TRADES','Transaction history','An auditable view of completed simulated trades.'],watchlist:['WATCHLIST','Research watchlist','Companies being followed by ChatGPT’s Portfolio.'],activity:['ACTIVITY','Activity timeline','What the independent research process has actually recorded.'],reports:['DAILY REPORTS','Daily PDF reports','One-page, dated summaries of the verified paper-portfolio work.']};
const euro=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n):'—';
const text=x=>x===null||x===undefined||x===''?'—':String(x);
const date=x=>x?new Date(x+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'Not recorded';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label='Source')=>typeof url==='string'&&url.startsWith('https://')?'<a target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">'+esc(label)+' ↗</a>':'—';
const empty=(title,message)=>'<div class="empty"><div class="emptyicon">◇</div><strong>'+esc(title)+'</strong><p>'+esc(message)+'</p></div>';
const table=(cols,rows)=>'<div class="tableWrap"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const pill=(label)=>'<span class="pill '+(/potential buy|completed|paper executed/i.test(label||'')?'green':/watching|researching/i.test(label||'')?'gold':'')+'">'+esc(label||'Unreviewed')+'</span>';
const warn=(msg,type='')=>{by('alert').className='alert '+type;by('alert').textContent=msg};
function setPage(name){
 active=name;const [section,title,description]=views[name];by('sectionName').textContent=section;by('pageTitle').textContent=title;by('pageDesc').textContent=description;
 document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===name));
 document.querySelectorAll('[data-section]').forEach(n=>n.hidden=!n.dataset.section.split(' ').includes(name));
}
function renderChart(history){
 const pts=history.filter(x=>typeof x.nav==='number');if(pts.length<2){by('chartArea').innerHTML=empty('No performance history yet','Two or more dated paper NAV snapshots are needed to draw a return path.');return}
 const list=pts.slice(-100),mn=Math.min(...list.map(x=>x.nav)),mx=Math.max(...list.map(x=>x.nav)),span=Math.max(1,mx-mn);
 const path=list.map((x,i)=>(i?'L':'M')+(30+i*840/Math.max(1,list.length-1)).toFixed(1)+','+(192-(x.nav-mn)/span*156).toFixed(1)).join(' ');
 by('chartArea').innerHTML='<svg class="linechart" viewBox="0 0 900 230" role="img" aria-label="Recorded paper NAV history"><line x1="30" y1="192" x2="870" y2="192" stroke="#e6ebf1"/><line x1="30" y1="36" x2="870" y2="36" stroke="#e6ebf1"/><path d="'+path+'"/><text x="30" y="215">'+esc(date(list[0].date))+'</text><text x="760" y="215">'+esc(date(list.at(-1).date))+'</text><text x="32" y="29">'+esc(euro(mx))+'</text><text x="32" y="186">'+esc(euro(mn))+'</text></svg>';
}
function render(){
 if(!data)return;
 const h=data.holdings||[],w=data.watchlist||[],a=data.activity||[],t=data.trades||[],hist=data.history||[],r=data.reports||[],latest=data.latest;
 const lastResearch=a.find(x=>(x.category==='Research'||x.category==='Watchlist')&&x.status==='Completed');
 by('researchState').textContent=lastResearch?'Last recorded '+date(lastResearch.date):'No review recorded';
 by('executionState').textContent=t.length?t.length+' recorded · latest '+date(t[0].date):'No paper fills yet';
 by('reportState').textContent=r.length?date(r[0].date)+' · '+(r[0].pdf?.length?'PDF attached':'Library delivery'):'No report indexed';
 by('navValue').textContent=euro(latest?.nav);by('navDate').textContent=latest?.date?'NAV as of '+date(latest.date):'No recorded NAV';
 by('investedValue').textContent=euro(latest?.positions);by('holdingCount').textContent=String(h.length);by('watchCount').textContent=String(w.length);
 by('holdingAsOf').textContent=data.meta?.holdingsDate?'Latest holding: '+date(data.meta.holdingsDate):'No dated holdings';
 by('tradesCount').textContent=t.length+' recorded';by('activityCount').textContent=a.length+' events';by('reportCount').textContent=r.length+' reports';
 by('chartDate').textContent=latest?.date?'Last NAV: '+date(latest.date):'Awaiting performance history';
 renderChart(hist);
 by('holdingsTable').innerHTML=h.length?table(['Holding','Units','Value (EUR)','Weight','As of','Thesis'],h.map(x=>['<strong>'+esc(x.name)+'</strong><small>'+esc(x.ticker||'')+'</small>',esc(text(x.units)),esc(euro(x.value)),x.weight===null?'—':esc(x.weight)+'%',esc(date(x.asOf)),esc(text(x.thesis))])):empty('No paper holdings yet','The investing process has not recorded any simulated positions in this independent portfolio.');
 by('tradesTable').innerHTML=t.length?table(['Date','Recorded event','Ticker','Details','Source'],t.map(x=>[esc(date(x.date)),'<strong>'+esc(x.event)+'</strong>',esc(text(x.ticker)),esc(text(x.details)),link(x.source)])):empty('No completed paper trades','This list will show completed, recorded simulated trade events. Proposals and unfilled decisions are excluded.');
 const filter=by('watchFilter').value;
 const display=filter==='all'?w:w.filter(x=>x.status===filter);
 by('watchTable').innerHTML=display.length?table(['Company','Research status','Why it is watched','Latest evidence','Reviewed'],display.map(x=>['<strong>'+esc(x.name)+'</strong><small>'+esc(x.ticker||'')+'</small>',pill(x.status),esc(text(x.reason)),esc(text(x.change))+'<small>'+link(x.source)+'</small>',esc(date(x.reviewed))])):empty(w.length?'No matches for this filter':'No companies on watch yet',w.length?'Choose another research status to see other candidates.':'The independent research process has not populated its watchlist yet.');
 by('activityTable').innerHTML=a.length?table(['Date','Event','Category','Details'],a.map(x=>[esc(date(x.date)),'<strong>'+esc(x.event)+'</strong><small>'+link(x.source)+'</small>',pill(x.category),esc(text(x.details))])):empty('No recorded activity','Verified research and portfolio updates will appear here when written to the independent database.');
 by('reportsTable').innerHTML=r.length?table(['Date','Report summary','Status','PDF'],r.map(x=>[
   esc(date(x.date)),
   '<strong>'+esc(x.name)+'</strong><small>'+esc(text(x.summary))+'</small>',
   pill(x.status),
   x.pdf.some(f=>typeof f.url==='string'&&f.url.startsWith('https://'))
     ?link(x.pdf.find(f=>typeof f.url==='string'&&f.url.startsWith('https://')).url,'Open PDF')
     :'<span class="tiny">PDF not attached</span><small>'+link(x.url,'Report record')+'</small>'
 ])):empty('No daily reports archived','The daily one-page PDF is delivered through the scheduled ChatGPT task. This archive shows reports stored in the dedicated Notion database; an unattached file will be marked clearly.');
 by('lastFetch').textContent=data.fetchedAt?'Fetched '+new Date(data.fetchedAt).toLocaleString('en-GB'):'Not synchronized';
}
async function load(){
 try{
  const res=await fetch('/api/portfolio',{credentials:'same-origin',cache:'no-store'}),json=await res.json();
  if(res.status===401){by('login').hidden=false;by('workspace').hidden=true;warn('Dashboard locked. Enter the private password to continue.');return}
  if(!res.ok){by('workspace').hidden=true;warn(json.error||'Failed to load data.','bad');return}
  by('login').hidden=true;by('workspace').hidden=false;data=json;render();
  warn('Connected to the independent ChatGPT’s Portfolio records. Paper only · Last retrieval '+new Date(json.fetchedAt).toLocaleString('en-GB'),'good');
 }catch(e){by('workspace').hidden=true;warn('Could not reach the portfolio server. No current figures are being shown.','bad')}
}
document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
by('watchFilter').addEventListener('change',render);
by('refresh').addEventListener('click',load);
by('loginButton').addEventListener('click',async()=>{
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:by('password').value})});
 if(r.ok){by('password').value='';by('loginError').textContent='';by('logout').hidden=false;load()}else by('loginError').textContent='Invalid password';
});
by('password').addEventListener('keydown',e=>{if(e.key==='Enter')by('loginButton').click()});
by('logout').addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});location.reload()});
setPage(active);load();
setInterval(()=>{if(!document.hidden)load()},300000);
})();