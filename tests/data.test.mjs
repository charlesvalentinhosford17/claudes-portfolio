import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData,SOURCES} from '../data.mjs';
const row=(properties,url='https://notion.so/example')=>({properties:Object.fromEntries(Object.entries(properties).map(([key,[type,v]])=>[key,{type,[type]:type==='title'||type==='rich_text'?[{plain_text:v}]:type==='select'?{name:v}:type==='date'?{start:v}:v}])),url});
test('data sources are isolated to the four portfolio collections',()=>{assert.deepEqual(Object.keys(SOURCES).sort(),['activity','history','holdings','reports','watchlist']);for(const x of Object.values(SOURCES))assert.match(x,/^[a-f0-9-]{36}$/)});
test('does not infer holdings, NAV or trades from an empty ledger',()=>{const d=normalizeData({});assert.equal(d.latest,null);assert.deepEqual(d.trades,[]);assert.deepEqual(d.holdings,[]);assert.equal(d.meta.paperOnly,true)});
test('excludes any live or proposed position, retains only paper holdings',()=>{
 const d=normalizeData({holdings:[row({'Holding':['title','A'],'Position type':['select','Paper'],'Value EUR':['number',100]}),row({'Holding':['title','B'],'Position type':['select','Live - verified'],'Value EUR':['number',900]}),row({'Holding':['title','C'],'Position type':['select','Proposal'],'Value EUR':['number',700]})]});
 assert.equal(d.holdings.length,1);assert.equal(d.holdings[0].name,'A');assert.equal(d.holdings[0].value,100);
});
test('records trades only when completed and explicitly classified paper trade',()=>{
 const activity=[row({'Event':['title','Paper buy'],'Category':['select','Paper trade'],'Status':['select','Completed']}),row({'Event':['title','Potential purchase'],'Category':['select','Paper trade'],'Status':['select','Needs review']}),row({'Event':['title','Company research'],'Category':['select','Research'],'Status':['select','Completed']})];
 const d=normalizeData({activity});assert.equal(d.trades.length,1);assert.equal(d.trades[0].event,'Paper buy');
});
test('NAV is absent unless history contains verified numeric value',()=>{
 const d=normalizeData({history:[row({'Snapshot':['title','Incomplete'],'As of':['date','2026-10-14'],'Total NAV EUR':['number',null]})]});assert.equal(d.latest,null);
});

test('dated report metadata is shown without claiming a PDF attachment',()=> {
 const d=normalizeData({reports:[row({'Report':['title','Daily report'],'Report date':['date','2026-10-14'],'Status':['select','Incomplete'],'Summary':['rich_text','PDF delivered through ChatGPT Library'],'Trades recorded':['number',0]})]});
 assert.equal(d.reports.length,1);assert.equal(d.reports[0].status,'Incomplete');assert.deepEqual(d.reports[0].pdf,[]);assert.equal(d.reports[0].trades,0);
});
test('attached PDFs are visible only when the Notion files property actually exists',()=>{
 const d=normalizeData({reports:[{properties:{Report:{type:'title',title:[{plain_text:'Daily report'}]},'Report date':{type:'date',date:{start:'2026-10-15'}},PDF:{type:'files',files:[{name:'2026-10-15.pdf',type:'file',file:{url:'https://example.com/signed-pdf',expiry_time:'2026-10-15T20:00:00Z'}}]}},url:'https://notion.so/report'}]});
 assert.equal(d.reports[0].pdf.length,1);assert.equal(d.reports[0].pdf[0].url,'https://example.com/signed-pdf');
});

test('paper NAV remains unavailable if cash and positions do not reconcile',()=>{
 const d=normalizeData({history:[
   row({'Snapshot':['title','Incorrect'],'As of':['date','2026-10-14'],'Paper cash EUR':['number',900],'Positions EUR':['number',60],'Total NAV EUR':['number',1000]})
 ]});
 assert.equal(d.latest,null);assert.equal(d.history[0].nav,null);assert.equal(d.meta.invalidNavSnapshots,1);
});
test('arithmetically reconciled paper NAV can be presented with source date',()=>{
 const d=normalizeData({history:[
   row({'Snapshot':['title','Baseline'],'As of':['date','2026-10-14'],'Paper cash EUR':['number',900],'Positions EUR':['number',100],'Total NAV EUR':['number',1000]})
 ]});
 assert.equal(d.latest.nav,1000);assert.equal(d.latest.date,'2026-10-14');assert.equal(d.meta.invalidNavSnapshots,0);
});
test('paper NAV refuses a value with missing source balance',()=>{
 const d=normalizeData({history:[
   row({'Snapshot':['title','Incomplete'],'As of':['date','2026-10-14'],'Positions EUR':['number',100],'Total NAV EUR':['number',1000]})
 ]});
 assert.equal(d.latest,null);assert.equal(d.meta.invalidNavSnapshots,1);
});
