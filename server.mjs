import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {getNotionRecords} from './data.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const PASSWORD=process.env.DASHBOARD_PASSWORD||'';
const isLoopback=['127.0.0.1','::1','localhost'].includes(HOST);
if(!isLoopback&&PASSWORD.length<12)throw new Error('Network binding requires DASHBOARD_PASSWORD (12+ characters)');
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('Invalid PORT');
if(!isLoopback&&process.env.NODE_ENV!=='production')throw new Error('Network binding requires NODE_ENV=production and HTTPS termination');
const sessions=new Map();let cache=null,expiry=0;
const hash=x=>createHash('sha256').update(x).digest();
const safeEq=(a,b)=>{const aa=hash(a),bb=hash(b);return timingSafeEqual(aa,bb)};
const cookie=req=>{const s=req.headers.cookie||'';return /(?:^|;\s*)portfolio_session=([a-f0-9]{64})(?:;|$)/.exec(s)?.[1]||''};
const authenticated=req=>{if(!PASSWORD)return isLoopback;const c=cookie(req);const until=sessions.get(c);if(!until)return false;if(Date.now()>until){sessions.delete(c);return false}return true};
const respond=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});res.end(JSON.stringify(data))};
const readBody=async req=>{let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>4096)throw Error('Request too large');chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')};
const files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
const mime={'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8','js':'text/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url||'/', 'http://localhost').pathname;
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if(req.method==='POST'&&route==='/api/login'){
   const body=JSON.parse(await readBody(req));if(!PASSWORD||!safeEq(String(body.password||''),PASSWORD))return respond(res,401,{error:'Invalid password'});
   const session=randomBytes(32).toString('hex');sessions.set(session,Date.now()+12*3600e3);
   return respond(res,200,{ok:true},{'Set-Cookie':'portfolio_session='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(process.env.NODE_ENV==='production'?'; Secure':'')});
  }
  if(req.method==='POST'&&route==='/api/logout'){sessions.delete(cookie(req));return respond(res,200,{ok:true},{'Set-Cookie':'portfolio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
  if(req.method==='GET'&&route==='/api/status')return respond(res,200,{authorized:authenticated(req),protected:!!PASSWORD,configured:!!process.env.NOTION_TOKEN});
  if(req.method==='GET'&&route==='/api/portfolio'){
   if(!authenticated(req))return respond(res,401,{error:'Authentication required'});
   if(!process.env.NOTION_TOKEN)return respond(res,503,{error:'Not connected: add a read-only, project-only NOTION_TOKEN',connected:false});
   if(!cache||Date.now()>expiry){const data=await getNotionRecords(process.env.NOTION_TOKEN);cache={...data,fetchedAt:new Date().toISOString(),connected:true};expiry=Date.now()+90000}
   return respond(res,200,cache);
  }
  if(req.method!=='GET'||!(route in files))return respond(res,404,{error:'Not found'});
  const name=files[route];const ext=name.split('.').at(-1);
  const content=await readFile(path.join(root,'public',name));
  res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(e){const code=e.message==='Request too large'?413:502;respond(res,code,{error:code===502?'Unable to load current data. Check connection and permissions.':e.message})}
});
server.listen(PORT,HOST,()=>console.log('ChatGPT’s Portfolio: http://'+HOST+':'+PORT));
