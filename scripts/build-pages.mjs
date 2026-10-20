import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
// Only remove this fixed generated directory inside this checkout.
const output=new URL('pages-dist/',root);
await rm(output,{recursive:true,force:true});
const game=new URL('doubao/',output);
await mkdir(game,{recursive:true});
await import('./prepare-game.mjs');
for(const folder of ['assets','css','js'])await cp(new URL(folder+'/',root),new URL(folder+'/',game),{recursive:true});
for(const name of ['index.html','delivery.css','delivery.js'])await cp(new URL('delivery-page/'+name,root),new URL(name,game));
await mkdir(new URL('previews/',game),{recursive:true});
await cp(new URL('previews/online-desktop.png',root),new URL('previews/online-desktop.png',game));
const api='https://love-flight-duo-demo.sunnylyric36.chatgpt.site/api/flight';
const policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src "+new URL(api).origin+"; object-src 'none'; base-uri 'self'; form-action 'self'";
let html=await readFile(new URL('public/play.html',root),'utf8');
html=html.replace('<meta charset="utf-8">','<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="'+policy+'">\n  <meta name="referrer" content="strict-origin-when-cross-origin">');
html=html.replace('<script src="js/online.js"></script>','<script src="js/pages-config.js"></script>\n  <script src="js/online.js"></script>');
html=html.replace('<nav class="top-actions" aria-label="游戏菜单">','<nav class="top-actions" aria-label="游戏菜单"><a class="text-button" href="./">展示首页</a>');
await writeFile(new URL('play.html',game),html);
await writeFile(new URL('js/pages-config.js',game),'window.LOVE_FLIGHT_CONFIG=Object.freeze('+JSON.stringify({apiBase:api})+');\n');
await cp(new URL('public/local.html',root),new URL('local.html',game));
await writeFile(new URL('.nojekyll',output),'');
await writeFile(new URL('index.html',output),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./doubao/"><title>恋爱飞行计划</title><p><a href="./doubao/">进入恋爱飞行计划</a></p></html>');
console.log('Built GitHub Pages delivery at pages-dist/doubao/');
