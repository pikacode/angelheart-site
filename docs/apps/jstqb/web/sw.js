// 网页正式版 11-05 起搬到 /jstqb/（pika 11-05）。这里以前装的离线缓存：浏览器更新到这一份时删掉本地址的缓存、注销自己。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const prefix = 'jstqb-app-' + new URL(self.registration.scope).pathname + '-';
  for (const k of await caches.keys()) if (k.startsWith(prefix)) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
