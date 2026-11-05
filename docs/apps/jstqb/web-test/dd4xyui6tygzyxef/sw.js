// 网页的离线缓存（pika 10-31 选「加离线缓存」）：iPhone Safari 刷新时会逐个问服务器 90 多个文件变没变，要 2–3 秒。
// 这里把本版的文件（程序、引擎、字体、シラバス等）存在浏览器里，刷新直接从这里取，不再逐个问。
// 不会卡在旧版：每次打开页面（导航）都从网上取 index.html 和 boot_sizes.json（构建时写的版本记号 stamp），
// 记号变了就清掉旧版文件再取新的；取不到记号（开发时、离线）不存也不用缓存，全部照常走网络。
// index.html、boot_sizes.json、flutter_bootstrap.js、sw.js 自己从不缓存。
// Google 上的两样启动要死等的外部文件（Firebase 脚本、引擎的 Roboto）也存一份，另放一个不随版本清的缓存：
// 它们的地址带版本号、内容不会变；不存的话刷新时 Google 一慢，加载页就停多久（pika 10-31「刷新在 logo 页停了 10 来秒」，
// 本地把 www.gstatic.com 或 fonts.gstatic.com 拖慢 6 秒，刷新就多等 6 秒）。

// 缓存名带本页的路径：网页正式版（/apps/jstqb/web/）和测试版（/apps/jstqb/web-test/…/）在同一个网站下，浏览器缓存按网站共用，
// 不带路径的话两边每次打开都把对方的缓存当旧版删掉（JST-230，11-05）。
const prefix = 'jstqb-app-' + new URL(self.registration.scope).pathname + '-';
// 11-05 以前的缓存名不带路径（jstqb-app-v2-<stamp>），见到就删。
const legacy = /^jstqb-app-v\d+-/;
// v2-：11-03 起本版缓存只存带版本记号取来的文件；名字换一下，旧 sw.js 在交接那一次可能存进去的混版缓存一律作废。
const generation = 'v2-';
const externalCache = 'jstqb-ext-1';
const neverCache = ['boot_sizes.json', 'flutter_bootstrap.js', 'sw.js', 'index.html'];
let stamp = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** 从网上读本版记号；读到了且和缓存的不同，删掉别的版本的缓存。读不到返回 null。 */
async function refreshStamp() {
  try {
    // 最多等 5 秒：这个请求挂住不回时，页面要的每个文件都在等它，加载页就停住不动（pika 11-04「偶发卡在 99%」）。
    // 超时当读不到：这次不用缓存，全部照常走网络。
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    const res = await fetch(new URL('boot_sizes.json', self.registration.scope), { cache: 'no-store', signal: abort.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(String(res.status));
    const value = (await res.json()).stamp;
    if (typeof value !== 'string' || !value) throw new Error('没有 stamp');
    const keep = prefix + generation + value;
    for (const name of await caches.keys()) {
      if ((name.startsWith(prefix) && name !== keep) || legacy.test(name)) await caches.delete(name);
    }
    return value;
  } catch (_) {
    return null;
  }
}

// 同时来的请求共用一次读取；读不到后 30 秒内不再读，直接走网络：boot_sizes.json 挂住时，
// 以前每个文件都各自再等 5 秒，几十个文件排下来加载页像停住一样（JST-350 复测）。
let stampPending = null;
let stampFailedAt = 0;
function stampOnce() {
  if (Date.now() - stampFailedAt < 30000) return Promise.resolve(null);
  stampPending ??= refreshStamp().then((value) => {
    if (!value) stampFailedAt = Date.now();
    stampPending = null;
    return value;
  });
  return stampPending;
}

function pathOf(request) {
  return request.url.slice(self.registration.scope.length).split('?')[0];
}

function cacheable(request) {
  if (request.method !== 'GET' || request.headers.has('range')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return false;
  const path = pathOf(request);
  return path !== '' && !neverCache.includes(path);
}

// version.json 每次带不同的 cachebuster 参数来取（package_info_plus 网页版），按参数比对永远对不上：
// 每次刷新都要走一趟网络，缓存里还越积越多。它每版构建只有一份，按路径比对就行。
const ignoreQuery = ['version.json'];

/** 地址里带版本、内容不变的外部文件：Firebase 脚本（firebasejs/<版本>/）、Google 字体（地址带 v32 这样的版本）。 */
function external(request) {
  if (request.method !== 'GET') return false;
  const url = request.url;
  return url.startsWith('https://www.gstatic.com/firebasejs/') || url.startsWith('https://fonts.gstatic.com/s/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (external(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(externalCache);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      // 只存取全了的（cors 200）；不透明的响应看不到状态，不存。
      if (res.ok && res.type === 'cors') cache.put(request, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  if (request.mode === 'navigate') {
    // 先确定版本记号再给页面：页面接着要的文件都按新记号判断，不会混进旧版。
    event.respondWith((async () => {
      const [page, value] = await Promise.all([fetch(request), refreshStamp()]);
      stamp = value;
      stampFailedAt = value ? 0 : Date.now();
      return page;
    })());
    return;
  }
  // 刚读过 boot_sizes.json 没读到（挂住或出错）：页面里 flutter_bootstrap.js 再读时马上回失败，不让它再等 5 秒（JST-350 复测）。
  if (pathOf(request) === 'boot_sizes.json' && Date.now() - stampFailedAt < 30000) {
    event.respondWith(new Response('', { status: 504 }));
    return;
  }
  if (!cacheable(request)) return;
  event.respondWith((async () => {
    // 还不知道本版记号（第一次打开时 SW 中途接管、或被浏览器停过又唤醒）：这次直接走网络，后台去读，读到了之后的请求再用缓存。
    // 不在这里等：boot_sizes.json 挂住时每个文件都要陪着等（JST-350 复测）。
    if (!stamp) {
      stampOnce().then((value) => { if (value && !stamp) stamp = value; });
      return fetch(request);
    }
    const cache = await caches.open(prefix + generation + stamp);
    const hit = await cache.match(request, { ignoreSearch: ignoreQuery.includes(pathOf(request)) });
    if (hit) return hit;
    const res = await fetchFresh(request, stamp);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  })());
});

// 存进本版缓存的文件必须是本版的：网址带上版本记号、并跟服务器核对，不拿浏览器或 CDN 手里的旧版。
// 以前直接 fetch(request)：刚发版的 10 分钟内（GitHub Pages 和 Cloudflare 都按 max-age=600 缓存）会拿到上一版的
// main.dart.js 或 app.json，和新版的其他文件混在一起存进新版缓存，之后每次刷新都从缓存取这份混版。
// 11-03 app.json 改了格式（syllabusAbout 换成 points），新旧对不上，启动读配置就出错，加载页一直停在 99%。
function fetchFresh(request, value) {
  const url = new URL(request.url);
  url.searchParams.set('b', value);
  return fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
}
