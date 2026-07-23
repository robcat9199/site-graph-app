/* SiteGraph service worker — makes the app itself load offline.
   Same-origin: network-first, so updates land whenever the user is online and the
   cached copy serves when they're not. No cache-version bumps needed on app updates. */
"use strict";
const CACHE = "sitegraph-v2";
const PAGE_ASSETS = [
	"./",
	"./index.html",
	"./manifest.json",
	"./apple-touch-icon.png",
	"./icon.svg",
];

self.addEventListener("install", (ev) => {
	ev.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(PAGE_ASSETS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (ev) => {
	ev.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (ev) => {
	const req = ev.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	ev.respondWith(
		fetch(req)
			.then((res) => {
				if (res.ok) {
					const copy = res.clone();
					caches.open(CACHE).then((c) => c.put(req, copy));
				}
				return res;
			})
			.catch(() =>
				caches
					.match(req, { ignoreSearch: true })
					.then(
						(hit) =>
							hit ||
							(req.mode === "navigate"
								? caches.match("./index.html")
								: Response.error()),
					),
			),
	);
});
