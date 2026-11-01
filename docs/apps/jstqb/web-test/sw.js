// 网页测试版以前的 service worker（从解密缓存给 App）已停用：浏览器更新到这一份时注销自己、清掉缓存，之后 app/ 直接走网络。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await caches.delete('jstqb-web-test');
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
