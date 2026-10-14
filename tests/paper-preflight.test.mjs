import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaperOrder, INITIAL_PAPER_CAPITAL_CENTS, PaperPreflightError } from '../safety/paper-preflight.mjs';
const nowMs = Date.parse('2026-10-14T14:00:00Z');
const valid=()=>({
 configuration:{executionEnabled:true,investmentRulesReviewed:true,paperOnly:true,allowlistedPaperAccount:'PAPER_TEST_ACCOUNT'},
 connection:{authenticated:true,brokerEnvironment:'PAPER',paperVerified:true,accountId:'PAPER_TEST_ACCOUNT',host:'127.0.0.1',port:4002},
 portfolio:{initialFundingCents:INITIAL_PAPER_CAPITAL_CENTS,additionalFundingCents:0,reconciled:true,unresolvedOrders:0,cashCents:100_000,positions:{'TEST-CONTRACT':3}},
 quote:{contractId:'TEST-CONTRACT',marketOpen:true,isDelayed:false,isIndicative:false,source:'verified-feed',unitPriceEUR:120,receivedAtMs:nowMs-1000},
 order:{side:'BUY',contractId:'TEST-CONTRACT',units:1,feesMaxCents:125,fxMaxCents:35,slippageBufferCents:50},nowMs
});
const blocked=(change,code)=>{const args=valid();change(args);assert.throws(()=>checkPaperOrder(args),e=>e instanceof PaperPreflightError&&e.code===code)};
test('rejects execution until deliberately enabled',()=>blocked(x=>x.configuration.executionEnabled=false,'EXECUTION_DISABLED'));
test('rejects unreviewed investment rules',()=>blocked(x=>x.configuration.investmentRulesReviewed=false,'RULES_NOT_APPROVED'));
test('rejects live trading session',()=>blocked(x=>x.connection.brokerEnvironment='LIVE','NOT_AUTHENTICATED_PAPER_SESSION'));
test('rejects unverified paper assertion',()=>blocked(x=>x.connection.paperVerified=false,'PAPER_ENVIRONMENT_NOT_VERIFIED'));
test('rejects different account, even if paper flag is true',()=>blocked(x=>x.connection.accountId='OTHER_ACCOUNT','ACCOUNT_NOT_ALLOWLISTED'));
test('rejects live gateway port',()=>blocked(x=>x.connection.port=4001,'UNAPPROVED_ENDPOINT'));
test('rejects non-loopback gateway host',()=>blocked(x=>x.connection.host='0.0.0.0','UNAPPROVED_ENDPOINT'));
test('rejects unrecognized initial capital',()=>blocked(x=>x.portfolio.initialFundingCents=1_000_000,'INITIAL_CAPITAL_MISMATCH'));
test('rejects additional paper contributions',()=>blocked(x=>x.portfolio.additionalFundingCents=25_000,'ADDITIONAL_FUNDING_NOT_AUTHORIZED'));
test('blocks during unreconciled order',()=>blocked(x=>x.portfolio.unresolvedOrders=1,'LEDGER_NOT_RECONCILED'));
test('rejects stale or delayed quotes',()=>{
 blocked(x=>x.quote.receivedAtMs=nowMs-61_000,'QUOTE_STALE');
 blocked(x=>x.quote.isDelayed=true,'NON_EXECUTABLE_QUOTE');
});
test('blocks unknown FX and transaction costs',()=>{
 blocked(x=>x.quote.unitPriceEUR=null,'FX_OR_PRICE_UNVERIFIED');
 blocked(x=>x.order.feesMaxCents=null,'COST_UNKNOWN');
});
test('blocks spend above dedicated strategy cash, even with huge broker buying power',()=>blocked(x=>{
 x.portfolio.cashCents=1000;x.connection.brokerBuyingPowerCents=100_000_000;
},'INSUFFICIENT_STRATEGY_CASH'));
test('blocks leveraged/short positions',()=>blocked(x=>{x.order.side='SELL';x.order.units=4},'NO_SHORTS_OR_UNKNOWN_POSITION'));
test('passes a verified paper-only cash-funded dry-run',()=>{
 const result=checkPaperOrder(valid());
 assert.equal(result.eligible,true); assert.equal(result.costCeilingCents,12210); assert.equal(result.paperAccountId,'PAPER_TEST_ACCOUNT');
});
