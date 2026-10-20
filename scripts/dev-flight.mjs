import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import './prepare-game.mjs';
import { handleFlight } from '../server/service.mjs';
import { openLocalDatabase } from '../server/sqlite-local.mjs';
const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
const db=openLocalDatabase(fileURLToPath(new URL('../.sites-runtime/flight-dev.sqlite',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:8787');
    if(url.pathname.startsWith('/api/flight/')) {
      const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const result=await handleFlight(request,db);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/play.html':url.pathname));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const data=await readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  } catch {res.writeHead(404).end('Not found');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Flight preview http://127.0.0.1:8787/'));
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit();}));
