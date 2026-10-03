/*
 * Service worker: lets Write.JS open without network.
 * Served from /sw.js (routers/web.py) so it controls the whole site, not only /static/.
 *  - the page "/" is network-first, the last good render is the offline fallback
 *  - assets are served from cache and refreshed in the background; they are versioned with ?NN,
 *    so a bumped version is a new URL and old versions get pruned
 *  - /api is never touched
 */
const CACHE = "writejs-v1";
const PAGE = "/";
// referenced only from JS or the manifest, so the page scan below doesn't find them
const EXTRA_ASSETS = ["/static/manifest.webmanifest", "/static/icons/icon-192.png", "/static/icons/icon-512.png"];

self.addEventListener("install", (event) => {
	event.waitUntil((async () => {
		const resp = await fetch(PAGE, {cache: "no-store"});
		if ( isCacheablePage(resp) ) { await cachePage(resp) }
		const cache = await caches.open(CACHE);
		await Promise.all(EXTRA_ASSETS.map((url) => cache.add(url).catch(() => {})));
		await self.skipWaiting();
	})());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		for ( const key of await caches.keys() ) {
			if ( key !== CACHE ) { await caches.delete(key) }
		}
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if ( request.method !== "GET" ) { return }
	const url = new URL(request.url);
	const sameOrigin = url.origin === self.location.origin;

	if ( request.mode === "navigate" ) {
		if ( sameOrigin && url.pathname === PAGE ) { event.respondWith(pageNetworkFirst(request)) }
		return
	}
	if ( sameOrigin ) {
		if ( url.pathname.startsWith("/api/") ) { return }
		if ( url.pathname.startsWith("/static/") || url.pathname === "/favicon.svg" ) {
			event.respondWith(staleWhileRevalidate(event, request));
		}
		return
	}
	// themes server stylesheet/script, Google Fonts css and font files
	if ( ["style", "script", "font"].includes(request.destination) ) {
		event.respondWith(staleWhileRevalidate(event, request));
	}
});

async function pageNetworkFirst(request) {
	try {
		const resp = await fetch(request);
		if ( isCacheablePage(resp) ) { cachePage(resp.clone()) }
		return resp
	} catch ( err ) {
		const cached = await caches.match(PAGE);
		if ( cached ) { return cached }
		throw err
	}
}

async function staleWhileRevalidate(event, request) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	const network = fetch(request).then((resp) => {
		// opaque (status 0) responses are no-cors scripts from the themes server; still worth keeping offline
		if ( resp.ok || resp.type === "opaque" ) { cache.put(request, resp.clone()) }
		return resp
	});
	if ( cached ) {
		event.waitUntil(network.catch(() => {}));
		return cached
	}
	return network
}

function isCacheablePage(resp) {
	return resp.ok && resp.type === "basic" && !resp.redirected
}

// stores the rendered page and precaches every stylesheet/script it loads, dropping replaced versions
async function cachePage(resp) {
	const cache = await caches.open(CACHE);
	const html = await resp.clone().text();
	await cache.put(PAGE, resp);

	const assets = assetUrls(html);
	const cachedRequests = await cache.keys();
	const cachedUrls = new Set(cachedRequests.map((r) => r.url));
	const wanted = new Set(assets.map(({url}) => url.href));
	for ( const req of cachedRequests ) {
		const url = new URL(req.url);
		const replaced = assets.some(({url: u}) => u.origin === url.origin && u.pathname === url.pathname && !wanted.has(url.href));
		if ( replaced ) { await cache.delete(req) }
	}
	await Promise.all(assets.filter(({url}) => !cachedUrls.has(url.href)).map(async ({url: u, cors}) => {
		try {
			// same mode the page will request it with, a no-cors (opaque) copy can't answer a crossorigin request
			const sameOrigin = u.origin === self.location.origin;
			const r = await fetch(u.href, sameOrigin || cors ? {mode: "cors"} : {mode: "no-cors"});
			if ( r.ok || r.type === "opaque" ) { await cache.put(u.href, r) }
		} catch ( err ) {}   // an unreachable asset (e.g. themes server down) must not break the rest
	}));
}

function assetUrls(html) {
	const assets = [];
	const add = (href, cors) => assets.push({url: new URL(href.replaceAll("&amp;", "&"), self.location.origin + PAGE), cors});
	for ( const [tag] of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(?:link|script)\b[^>]*>/g) ) {
		if ( /rel="(?:preconnect|manifest|apple-touch-icon)"/.test(tag) ) { continue }
		const src = tag.match(/\b(?:href|src)="([^"]+)"/);
		if ( src ) { add(src[1], /\bcrossorigin\b/.test(tag)) }
		// the bundled theme the stylesheet falls back to when the themes server fails
		const fallback = tag.match(/this\.href='([^']+)'/);
		if ( fallback ) { add(fallback[1], false) }
	}
	return assets
}
