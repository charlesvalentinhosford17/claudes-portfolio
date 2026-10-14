import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData,SOURCES} from '../data.mjs';
const row=(properties,url='https://notion.so/example')=>({properties:Object.fromEntries(Object.entries(properties).map(([key,[type,v]])=>[key,{type,[type]:type==='title'||type==='rich_text'?[{plain_text:v}]:type==='select'?{name:v}:type==='date'?{start:v}:v}])),url});
test('data sources are isolated to the four portfolio collections',()=>{assert.deepEqual(Object.keys(SOURCES).sort(),['activity','history','holdings','watchlist']);for(const x of Object.values(SOURCES))assert.match(x,/^[a-f0-9-]{36}$/)});
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
