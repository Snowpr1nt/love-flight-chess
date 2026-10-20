'use strict';
document.getElementById('copyLink').addEventListener('click',async()=>{
  const link=new URL('./',location.href).href;
  try{await navigator.clipboard.writeText(link);document.getElementById('copyStatus').textContent='已复制，发给另一半吧 ♡';}
  catch{document.getElementById('copyStatus').textContent='请复制浏览器地址栏中的链接。';}
});
