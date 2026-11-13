const V='cars-v2',SHELL=['./','index.html','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim()});
const put=(r,x)=>{if(x&&(x.ok||x.type==='opaque')){const cp=x.clone();caches.open(V).then(c=>c.put(r,cp))}return x};
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  if(u.origin===location.origin){
    e.respondWith(fetch(r).then(x=>put(r,x)).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));return;}
  if(['www.gstatic.com','fonts.gstatic.com','fonts.googleapis.com'].includes(u.hostname))
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(x=>put(r,x))));
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json()}catch(x){}
  const m=d.data||d.notification||d;
  e.waitUntil(self.registration.showNotification(m.title||'سيارات العائلة',{body:m.body||'',icon:'icon-192.png',badge:'icon-192.png',dir:'rtl',lang:'ar',data:{url:m.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l)if('focus'in c)return c.focus();return clients.openWindow('./')}));
});
