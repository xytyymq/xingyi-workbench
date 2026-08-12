const CACHE="xingyi-badminton-v2";
const ASSETS=["./index.html","./manifest.webmanifest","./icon.png"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS);}).then(function(){return self.skipWaiting();}));});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  e.respondWith(fetch(e.request).then(function(resp){
    var cp=resp.clone();
    caches.open(CACHE).then(function(c){c.put(e.request,cp);});
    return resp;
  }).catch(function(){return caches.match(e.request).then(function(r){return r||caches.match("./index.html");});}));
});