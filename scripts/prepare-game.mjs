import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const board=await readFile(new URL('js/board-data.js',root),'utf8');
const engine=(await readFile(new URL('js/engine.js',root),'utf8')).replace(/require\(["']\.\/board-data\.js["']\)/g,'sharedBoard');
await mkdir(new URL('server/',root),{recursive:true});
await writeFile(new URL('server/rules.mjs',root),`// Generated from the shared V4 rules; edit js/engine.js and run prepare-game.\nconst board=(()=>{const globalThis={};const module={exports:{}};${board}\nreturn module.exports;})();\nconst sharedBoard=board;\nconst engine=(()=>{const globalThis={};const module={exports:{}};${engine}\nreturn module.exports;})();\nexport {board,engine};\n`);
await mkdir(new URL('public/',root),{recursive:true});
for(const name of ['assets','css','js'])await cp(new URL(name,root),new URL('public/'+name,root),{recursive:true});
await cp(new URL('index.html',root),new URL('public/local.html',root));
let html=await readFile(new URL('index.html',root),'utf8');
html=html.replace('<link rel="stylesheet" href="css/redesign.css">','<link rel="stylesheet" href="css/redesign.css">\n  <link rel="stylesheet" href="css/online.css">');
html=html.replace('<script src="js/ui.js"></script>','<script src="js/online.js"></script>\n  <script src="js/ui.js"></script>');
html=html.replace('进度只保存在这台设备。互动以双方舒服为准。','联机棋局保留 24 小时。互动以双方舒服为准。');
html=html.replace('<title>恋爱飞行计划 · 异地情侣真心话大冒险飞行棋</title>','<title>恋爱飞行计划 · 双人联机体验</title>');
await writeFile(new URL('public/play.html',root),html);
console.log('Prepared shared game assets and server rules.');
