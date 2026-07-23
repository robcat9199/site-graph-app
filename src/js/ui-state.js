import { nowISO, html, esc, safe, clone, fmtDate, slugify, ISO_RE, isPlainObj } from './utils.js';
import { ip4ToInt, parseCidr, isIp4, intToIp4, cidrHasHost } from './ipv4.js';
import { ENUMS, GATEWAY_ROLES, SWITCH_ROLES, PORT_GEN_ROLES, IP_DEFAULT_BY_ROLE, IP_EXPECTED_ROLES, INFRA_ROLES, NODE_TYPES, EDGE_TYPES, HISTORY_CAP, LOG_CAP, SCHEMA_VERSION } from './schema.js';
import { store, nodeById, nodesOfType, outE, inE, linkOf, peerOf, ownerOf, uniqueId, pushHistory, pushLog, undoStack, redoStack, afterMutate, setAfterMutate, mutate, performUndo, performRedo, makeNode, setSingletonEdge, computeImpact, deleteNode, blankDoc, SAMPLE, dbSet, dbGet, dbDel, autoSaveToFileHandle, buildIndex, exportJson } from './store.js';
import { validateDoc } from './validator.js';
import { deviceEditor, locationEditor, rackEditor, patchPanelEditor, personEditor, circuitEditor, prefixEditor, ipEditor, portEditor, connectForm, flipConnection, connectionEditor, openEditor } from './ui-forms.js';
import { drawTopo, topoToggles, topo, renderTopoTab } from './topology.js';
import { renderAll } from './ui-layout.js';

/* ============================== derived lookups (view helpers) ============================== */
const locationOf = (id) => {
	const e = outE(id, "located_in")[0];
	if (e) return nodeById(e.to);
	const r = rackOf(id);
	return r ? locationOf(r.rack.id) : null;
};
const rackOf = (id) => {
	const e = outE(id, "mounted_in")[0];
	return e ? { rack: nodeById(e.to), rackU: (e.attrs || {}).rackU } : null;
};
const userOf = (id) => {
	const e = outE(id, "used_by")[0];
	return e ? nodeById(e.to) : null;
};
const ipsOf = (devId) => {
	/* IPs assigned to a device or any of its interfaces */
	const targets = [devId, ...outE(devId, "has_interface").map((e) => e.to)];
	const out = [];
	for (const t of targets)
		for (const e of inE(t, "assigned_to"))
			out.push({ ip: nodeById(e.from), target: nodeById(t) });
	return out;
};
const prefixOfIp = (ipId) => {
	const e = outE(ipId, "member_of")[0];
	return e ? nodeById(e.to) : null;
};
const assignmentOfIp = (ipId) => {
	const e = outE(ipId, "assigned_to")[0];
	return e ? nodeById(e.to) : null;
};
const ifacesOf = (devId) =>
	outE(devId, "has_interface").map((e) => nodeById(e.to));
/* shared placement/connectivity predicates — used by the Devices tab, Locations tab, and Check */
const isUnplaced = (id) => !locationOf(id) && !rackOf(id);
const isUnconnected = (devId) => !ifacesOf(devId).some((i) => peerOf(i.id));
const locPath = (id) => {
	/* "Admin › MDF Room" breadcrumb */
	const parts = [];
	let cur = locationOf(id);
	const guard = new Set();
	while (cur && !guard.has(cur.id)) {
		guard.add(cur.id);
		parts.unshift(cur.name);
		cur = locationOf(cur.id);
	}
	return parts;
};
function describeIfaceTarget(ifId) {
	const dev = nodeById(ownerOf(ifId));
	const i = nodeById(ifId);
	return `${dev ? dev.name : "?"} · ${i ? i.name : ifId}`;
}
/* short "what is it" descriptor for rack slots, tables, and cards */
const nodeKindLabel = (n) =>
	n.type === "patch_panel"
		? `panel · ${n.attrs.jackCount} jacks`
		: n.type === "device"
			? n.attrs.role
			: n.type === "rack"
				? `rack ${n.attrs.heightU}U`
				: n.type === "location"
					? n.attrs.locationType
					: NODE_TYPES[n.type]?.label || n.type;

/* ================================================================
   UI LAYER v2 — paper-ledger shell (user prototype) over engine v3
   ================================================================ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function toast(msg, isErr) {
	const t = document.createElement("div");
	t.className = "toast" + (isErr ? " err" : "");
	t.textContent = msg;
	$("#toasts").appendChild(t);
	setTimeout(() => t.remove(), isErr ? 5200 : 2600);
}
function fmtRel(iso) {
	const d = new Date(iso);
	if (isNaN(d)) return String(iso);
	const s = (Date.now() - d.getTime()) / 1000;
	if (s < 50) return "just now";
	if (s < 3600) return Math.round(s / 60) + "m ago";
	if (s < 86400) return Math.round(s / 3600) + "h ago";
	if (s < 86400 * 30) return Math.round(s / 86400) + "d ago";
	return d.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/* ---------- overlay stack (supports editor → confirm/history on top) ---------- */
let lastFocus = null;
function openOverlay(html, wide) {
	if (!document.querySelector(".overlay.open"))
		lastFocus = document.activeElement;
	const o = document.createElement("div");
	o.className = "overlay open";
	o.innerHTML = `<div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true"><button type="button" class="modal-x" data-close aria-label="Close" title="Close">✕</button>${html}</div>`;
	document.body.appendChild(o);
	o.addEventListener("pointerdown", (ev) => {
		if (ev.target === o) closeOverlay(o);
	});
	o.querySelectorAll("[data-close]").forEach(
		(b) => (b.onclick = () => closeOverlay(o)),
	);
	const f = FINE_POINTER
		? o.querySelector("input,select,textarea,button:not(.modal-x)")
		: null;
	if (f) f.focus();
	return o;
}
function closeOverlay(o) {
	o.remove();
	const rest = document.querySelectorAll(".overlay.open");
	if (!rest.length && lastFocus && lastFocus.focus) {
		try {
			lastFocus.focus();
		} catch (e) {}
	}
}
function closeTopOverlay() {
	const all = document.querySelectorAll(".overlay.open");
	if (all.length) {
		closeOverlay(all[all.length - 1]);
		return true;
	}
	return false;
}

/* ---------- localStorage working copy ---------- */
const LS_KEY = "sitegraph.v3.working",
	LS_BAK = "sitegraph.v3.backup",
	LS_UI = "sitegraph.v4.ui",
	LS_D3 = "sitegraph.d3.cache",
	LS_QUAR = "sitegraph.v3.quarantine";
let localSaveFailed = false;
function persistLocal() {
	if (!store.doc) return;
	const raw = JSON.stringify(store.doc);
	try {
		localStorage.setItem(LS_KEY, raw);
		if (localSaveFailed) {
			localSaveFailed = false;
			renderFileStatus();
		}
	} catch (e) {
		if (!localSaveFailed) {
			localSaveFailed = true;
			renderFileStatus();
		}
	}
	dbSet(LS_KEY, raw);
	autoSaveToFileHandle();
}
function persistUI() {
	try {
		localStorage.setItem(
			LS_UI,
			JSON.stringify({
				currentTab,
				sortState,
				filters,
				topoToggles,
				hiddenCols,
				theme,
			}),
		);
	} catch (e) {}
}
function restoreUI() {
	try {
		const u = JSON.parse(localStorage.getItem(LS_UI) || "null");
		if (u) {
			if (u.currentTab) currentTab = u.currentTab;
			if (u.sortState) Object.assign(sortState, u.sortState);
			if (u.filters) Object.assign(filters, u.filters);
			if (u.topoToggles) Object.assign(topoToggles, u.topoToggles);
			if (u.hiddenCols) Object.assign(hiddenCols, u.hiddenCols);
			if (u.theme === "dark" || u.theme === "light") theme = u.theme;
		}
	} catch (e) {}
	if (!TABS.some((t) => t[0] === currentTab))
		currentTab = "devices"; /* e.g. removed circuits tab */
	if (!["room", "name", "devices"].includes(sortState.racks.key))
		sortState.racks = { key: "room", dir: 1 };
	if (["a", "b", "arr", "act"].includes(sortState.connections.key))
		sortState.connections = { key: "conn", dir: 1 };
	if (filters.role && !ENUMS.role.includes(filters.role))
		filters.role = ""; /* e.g. retired 'patch-panel' role */
}

/* ---------- file status ---------- */
function renderFileStatus() {
	const dot = $("#dirtyDot"),
		txt = $("#fileStatusText");
	if (!store.doc) {
		dot.className = "dot";
		txt.textContent = "no file";
		return;
	}
	dot.className =
		"dot" + (localSaveFailed ? " error" : store.dirty ? " dirty" : "");
	txt.textContent =
		(store.fileName || defaultFileName()) +
		(store.dirty ? " — unsaved" : "") +
		(localSaveFailed ? " — working copy NOT saved" : "");
	$("#btnSave").disabled = !store.doc;
	$("#btnUndo").disabled = !undoStack.length;
	$("#btnRedo").disabled = !redoStack.length;
}

/* ---------- search index ---------- */
let searchIndex = new Map();
let _searchIndexTimer = null;
function buildSearchIndex() {
	if (_searchIndexTimer) clearTimeout(_searchIndexTimer);
	_searchIndexTimer = setTimeout(() => {
		const newIndex = new Map();
		if (!store.doc) {
			searchIndex = newIndex;
			return;
		}
		for (const n of store.doc.nodes) {
		const bits = [n.name, n.id, NODE_TYPES[n.type].label];
		for (const [k, v] of Object.entries(n.attrs)) {
			if (k === "custom" && typeof v === "object" && v !== null) {
				for (const cv of Object.values(v)) bits.push(String(cv));
			} else if (v !== undefined) {
				bits.push(String(v));
			}
		}
		bits.push(...locPath(n.id));
		const loc = locationOf(n.id);
		if (loc) bits.push(loc.name);
		if (n.type === "device") {
			for (const i of ifacesOf(n.id)) bits.push(i.name);
			for (const x of ipsOf(n.id)) bits.push(x.ip.name);
			const r = rackOf(n.id);
			if (r) bits.push(r.rack.name);
			const u = userOf(n.id);
			if (u) bits.push(u.name);
		}
		if (n.type === "patch_panel") {
			const r = rackOf(n.id);
			if (r) bits.push(r.rack.name);
		}
		if (n.type === "interface") {
			const o = nodeById(ownerOf(n.id));
			if (o) bits.push(o.name);
		}
		if (n.type === "ip_address") {
			const p = prefixOfIp(n.id);
			if (p) bits.push(p.name);
			const a = assignmentOfIp(n.id);
			if (a) bits.push(a.name);
		}
			if (n.type === "prefix")
				for (const e of inE(n.id, "member_of")) bits.push(nodeById(e.from).name);
			newIndex.set(n.id, bits.join(" ").toLowerCase());
		}
		searchIndex = newIndex;
		renderAll(); // Re-render table if search filter was active during index rebuild
	}, 150);
}
function searchTokens() {
	return ($("#searchInput")?.value || "")
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}
function matchesSearch(id, tokens) {
	if (!tokens.length) return true;
	const hay = searchIndex.get(id) || "";
	return tokens.every((t) => hay.includes(t));
}

/* ---------- file I/O ---------- */
const FSAA = typeof window !== "undefined" && "showOpenFilePicker" in window;
const FINE_POINTER =
	typeof window !== "undefined" &&
	window.matchMedia &&
	window.matchMedia("(hover:hover) and (pointer:fine)").matches;
/* Embedded (iframe) detection: iOS resolves vh/dvh against the OUTER window inside
   frames, oversizing the app shell and clipping it. Framed mode switches the shell
   to percentage heights, which size against the iframe correctly. */
if (typeof window !== "undefined" && typeof document !== "undefined") {
	try {
		if (window.self !== window.top)
			document.documentElement.classList.add("framed");
	} catch (e) {
		document.documentElement.classList.add("framed");
	}
}
function defaultFileName() {
	const s = (store.doc?.meta?.site?.name || "")
		.trim()
		.toLowerCase()
		.replace(/[^\w\- ]+/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-");
	return s ? s + ".json" : "data.json";
}
function adoptDoc(doc, handle, name, opts) {
	const errs = validateDoc(doc);
	if (errs.length) {
		showLoadErrors(name || "file", errs);
		return false;
	}
	store.doc = doc;
	store.fileHandle = handle || null;
	store.fileName = name || null;
	store.dirty = !!(opts && opts.dirty);
	undoStack.length = 0;
	redoStack.length = 0;
	buildIndex();
	buildSearchIndex();
	persistLocal();
	renderFileStatus();
	renderAll();
	return true;
}
function showLoadErrors(name, errs) {
	openOverlay(
		html`
    <h2>“${name}” failed validation — file rejected</h2>
    <div class="modal-meta">Nothing was loaded. Fix the file and open it again. ${errs.length} problem${errs.length > 1 ? "s" : ""}:</div>
    <div class="err-list">${errs.map((e) => "• " + esc(e)).join("\n")}</div>
    <div class="modal-actions"><div></div><div class="right"><button class="btn primary" data-close>Close</button></div></div>`,
		true,
	);
}
function parseAndAdopt(text, handle, name) {
	let doc;
	try {
		doc = JSON.parse(text);
	} catch (ex) {
		showLoadErrors(name, ["Not valid JSON: " + ex.message]);
		return;
	}
	if (adoptDoc(doc, handle, name)) toast(`Loaded “${name}”`);
}
async function openFile() {
	if (
		store.dirty &&
		!confirm("You have unsaved changes. Discard them and open another file?")
	)
		return;
	if (FSAA) {
		try {
			const [h] = await window.showOpenFilePicker({
				types: [
					{
						description: "SiteGraph JSON",
						accept: { "application/json": [".json"] },
					},
				],
			});
			const f = await h.getFile();
			parseAndAdopt(await f.text(), h, f.name);
		} catch (ex) {
			if (ex && ex.name !== "AbortError") toast(ex.message, true);
		}
	} else {
		const inp = document.createElement("input");
		inp.type = "file";
		inp.accept = ".json,application/json";
		inp.onchange = async () => {
			const f = inp.files[0];
			if (f) parseAndAdopt(await f.text(), null, f.name);
		};
		inp.click();
	}
}
async function saveFile() {
	if (!store.doc) return;
	const text = exportJson(store.doc);
	try {
		localStorage.setItem(LS_BAK, text);
	} catch (e) {}
	store.dirty = false;
	renderFileStatus();
	toast("Working copy saved locally");
}
function newSite() {
	if (
		store.dirty &&
		!confirm("You have unsaved changes. Discard them and start a new site?")
	)
		return;
	const o = openOverlay(`
    <h2>New site</h2><div class="modal-meta">One JSON file per site.</div>
    <div class="form-grid"><div class="field full"><label>Site name</label><input id="ns-name"></div></div>
    <div class="modal-actions"><div></div><div class="right">
      <button class="btn quiet" data-close>Cancel</button>
      <button class="btn primary" id="ns-go">Create</button></div></div>`);
	o.querySelector("#ns-go").onclick = () => {
		const name = o.querySelector("#ns-name").value.trim();
		if (!name) return;
		closeOverlay(o);
		adoptDoc(blankDoc(name), null, null, { dirty: true });
		toast("New site created — remember to Save");
	};
}

/* ================================================================
   TABS & TABLES — sortable, sticky, zebra, row-capped
   ================================================================ */
const TABS = [
	["devices", "Devices"],
	["locations", "Locations"],
	["connections", "Connections"],
	["ipam", "IPAM"],
	["people", "People"],
	["topology", "Topology"],
];
export let currentTab = "devices";
export function setCurrentTab(v) { currentTab = v; }
export let showAllRows = false;
export function setShowAllRows(v) { showAllRows = v; }
const ROW_LIMIT = 500;
const sortState = {
	devices: { key: "updatedAt", dir: -1 },
	connections: { key: "upd", dir: -1 },
	locations: { key: "name", dir: 1 },
	racks: { key: "room", dir: 1 },
	prefixes: { key: "updatedAt", dir: -1 },
	ips: { key: "updatedAt", dir: -1 },
	circuits: { key: "updatedAt", dir: -1 },
	people: { key: "updatedAt", dir: -1 },
};
const filters = { role: "", dept: "", unplaced: false, unconnected: false };
export let theme = "light";
export function setTheme(v) { theme = v; }
const applyTheme = () => {
	document.documentElement.dataset.theme = theme;
	/* iOS 26 Safari paints its toolbar / Dynamic Island surround from theme-color
     (falling back to fixed/sticky-edge or body backgrounds). Keep it in lockstep
     with the app's own toggle, not the OS scheme. */
	const c =
		getComputedStyle(document.documentElement)
			.getPropertyValue("--surface")
			.trim() || "#fffdf8";
	document
		.querySelectorAll('meta[name="theme-color"]')
		.forEach((m) => m.remove());
	const m = document.createElement("meta");
	m.name = "theme-color";
	m.content = c;
	document.head.appendChild(m);
};
/* per-table hidden column keys — editable via the Columns ▾ menu, persisted with UI state */
const hiddenCols = {
	devices: ["mac"],
	connections: [],
	circuits: [],
	prefixes: [],
	ips: [],
	people: [],
};
export let reopenColMenu = null;
export function setReopenColMenu(v) { reopenColMenu = v; }
const visCols = (ns, cols) =>
	cols.filter((c) => !c.label || !(hiddenCols[ns] || []).includes(c.key));
function colMenuItems(ns) {
	return (COLSETS[ns] || [])
		.filter((c) => c.label)
		.map(
			(c) =>
				html`<button data-coltog="${ns}" data-colkey="${c.key}">${(hiddenCols[ns] || []).includes(c.key) ? "☐" : "☑"} ${c.label}</button>`,
		)
		.join("");
}
export function toggleMenu(id) {
	const m = $(id);
	const was = m.classList.contains("open");
	$$(".menu").forEach((x) => x.classList.remove("open"));
	if (!was) {
		m.classList.add("open");
		// minimal placement logic, assuming m is already in correct relative context
		m.classList.remove("menu--flip");
		const r = m.getBoundingClientRect();
		if (r.width && r.left < 8)
			m.classList.add("menu--flip"); /* clipped off-screen left → left-align */
	}
}

function bindContentEvents(content) {
	content.addEventListener("click", (ev) => {
		const gear = ev.target.closest("[data-colns]");
		if (gear) {
			ev.stopPropagation();
			toggleMenu("#colmenu-" + gear.dataset.colns);
			return;
		}
		const tog = ev.target.closest("[data-coltog]");
		if (tog) {
			ev.stopPropagation();
			const ns = tog.dataset.coltog,
				key = tog.dataset.colkey;
			const list = (hiddenCols[ns] = hiddenCols[ns] || []);
			const i = list.indexOf(key);
			if (i >= 0) list.splice(i, 1);
			else {
				const visible = (COLSETS[ns] || []).filter(
					(c) => c.label && !list.includes(c.key),
				);
				if (visible.length <= 1) {
					toast("At least one column must stay visible", true);
					return;
				}
				list.push(key);
			}
			persistUI();
			reopenColMenu = ns;
			renderAll();
			return;
		}
		const th = ev.target.closest("th[data-sort]");
		if (th) {
			const tablePad = th.closest(".table-pad");
			const scrollLeft = tablePad ? tablePad.scrollLeft : 0;
			const scrollTop = tablePad ? tablePad.scrollTop : 0;
			
			const ss = sortState[th.dataset.sortns];
			if (ss.key === th.dataset.sort) ss.dir = -ss.dir;
			else {
				ss.key = th.dataset.sort;
				ss.dir = 1;
			}
			persistUI();
			renderAll();
			
			const newTablePad = document.querySelector(".table-pad");
			if (newTablePad) {
				newTablePad.scrollLeft = scrollLeft;
				newTablePad.scrollTop = scrollTop;
			}
			return;
		}
		const flip = ev.target.closest("[data-flip]");
		if (flip) {
			ev.stopPropagation();
			flipConnection(flip.dataset.flip);
			return;
		}
		const connRow = ev.target.closest("tr[data-conn]");
		if (connRow) {
			if (ev.target.closest("button")) return;
			connectionEditor(connRow.dataset.conn);
			return;
		}
		const opener = ev.target.closest("[data-open]");
		if (opener) {
			const btn = ev.target.closest("button");
			if (btn && !btn.hasAttribute("data-open"))
				return; /* action buttons inside rows */
			openEditor(opener.dataset.open);
		}
	});
}

const badgeOf = (d) =>
	GATEWAY_ROLES.includes(d.attrs.role)
		? "b-gw"
		: SWITCH_ROLES.includes(d.attrs.role)
			? "b-sw"
			: "b-dev";
const firstIpInt = (d) => {
	const ips = ipsOf(d.id);
	return ips.length ? (ip4ToInt(ips[0].ip.name) ?? Infinity) : Infinity;
};

function deviceJack(d) {
	for (const i of ifacesOf(d.id)) {
		const l = linkOf(i.id);
		if (l?.attrs?.jack) return l.attrs.jack;
	}
	return "";
}
const COLS = {
	devices: [
		{
			key: "name",
			label: "Device",
			get: (n) => n.name,
			render: (n) =>
				html`<b>${n.name}</b>${n.attrs.hostname ? html` <span class="dim mono">${esc(n.attrs.hostname)}</span>` : ""}`,
		},
		{
			key: "role",
			label: "Role",
			get: (n) => n.attrs.role,
			render: (n) =>
				html`<span class="badge ${badgeOf(n)}">${n.attrs.role}</span>`,
		},
		{
			key: "ip",
			label: "IP",
			get: firstIpInt,
			render: (n) => {
				const ips = ipsOf(n.id);
				return ips.length
					? html`<span class="mono">${ips[0].ip.name}${ips.length > 1 ? ", ..." : ""}</span>`
					: html`<span class="dim">${n.attrs.ipAssignment}</span>`;
			},
		},
		{
			key: "mac",
			label: "MAC",
			get: (n) => n.attrs.mac || "",
			render: (n) => n.attrs.mac
				? html`<span class="mono">${esc(n.attrs.mac)}</span>`
				: html`<span class="dim">—</span>`,
		},
		{
			key: "loc",
			label: "Location",
			get: (n) => locPath(n.id).join(" › "),
			render: (n) => {
				const p = locPath(n.id);
				return p.length
					? esc(p.join(" › "))
					: '<span class="badge b-warn">unplaced</span>';
			},
		},
		{
			key: "rack",
			label: "Rack",
			get: (n) => {
				const r = rackOf(n.id);
				return r ? r.rack.name : "";
			},
			render: (n) => {
				const r = rackOf(n.id);
				return r
					? html`${r.rack.name}${r.rackU !== undefined ? html` <span class="dim mono">U${r.rackU}</span>` : ""}`
					: '<span class="dim">—</span>';
			},
		},
		{ key: "user", label: "Person", get: (n) => userOf(n.id)?.name || "" },
		{ key: "jack", label: "Jack", get: (n) => deviceJack(n), mono: true },
		{
			key: "updatedAt",
			label: "Updated",
			cls: "col-upd",
			get: (n) => n.updatedAt,
			render: (n) =>
				html`<span class="mono dim" title="${fmtDate(n.updatedAt)}">${fmtRel(n.updatedAt)}</span>`,
		},
	],
	circuits: [
		{
			key: "name",
			label: "Circuit",
			get: (n) => n.name,
			render: (n) => html`<b>${n.name}</b>`,
		},
		{ key: "provider", label: "Provider", get: (n) => n.attrs.provider },
		{
			key: "type",
			label: "Type",
			get: (n) => n.attrs.circuitType,
			render: (n) => html`<span class="pill">${n.attrs.circuitType}</span>`,
		},
		{ key: "bw", label: "Bandwidth", get: (n) => n.attrs.bandwidth || "" },
		{
			key: "wan",
			label: "WAN IP",
			get: (n) => n.attrs.wanIp || "",
			mono: true,
		},
		{
			key: "term",
			label: "Terminates at",
			get: (n) => {
				const t = outE(n.id, "terminated_at")[0];
				return t ? describeIfaceTarget(t.to) : "";
			},
			render: (n) => {
				const t = outE(n.id, "terminated_at")[0];
				return t
					? esc(describeIfaceTarget(t.to))
					: '<span class="badge b-warn">unterminated</span>';
			},
		},
		{
			key: "updatedAt",
			label: "Updated",
			cls: "col-upd",
			get: (n) => n.updatedAt,
			render: (n) => `<span class="mono dim">${fmtRel(n.updatedAt)}</span>`,
		},
	],
	people: [
		{
			key: "name",
			label: "Name",
			get: (n) => n.name,
			render: (n) => html`<b>${n.name}</b>`,
		},
		{ key: "title", label: "Title", get: (n) => n.attrs.title || "" },
		{ key: "dept", label: "Department", get: (n) => n.attrs.department },
		{ key: "did", label: "DID", get: (n) => n.attrs.did || "", mono: true },
		{
			key: "ext",
			label: "Ext",
			get: (n) => n.attrs.extension || "",
			mono: true,
		},
		{
			key: "email",
			label: "Email",
			get: (n) => n.attrs.email || "",
			mono: true,
		},
		{ key: "loc", label: "Location", get: (n) => locationOf(n.id)?.name || "" },
		{
			key: "uses",
			label: "Person",
			get: (n) =>
				inE(n.id, "used_by")
					.map((e) => nodeById(e.from).name)
					.join(", "),
		},
		{
			key: "updatedAt",
			label: "Updated",
			cls: "col-upd",
			get: (n) => n.updatedAt,
			render: (n) => `<span class="mono dim">${fmtRel(n.updatedAt)}</span>`,
		},
	],
	prefixes: [
		{
			key: "name",
			label: "Network",
			get: (n) => parseCidr(n.name)?.net ?? 0,
			render: (n) => html`<b class="mono">${n.name}</b>`,
		},
		{
			key: "desc",
			label: "Description",
			get: (n) => n.attrs.description || "",
		},
		{
			key: "vlan",
			label: "VLAN",
			get: (n) => n.attrs.vlanId ?? -1,
			render: (n) =>
				n.attrs.vlanId !== undefined
					? `<span class="pill">v${n.attrs.vlanId}</span>`
					: '<span class="dim">—</span>',
		},
		{
			key: "gw",
			label: "Gateway",
			get: (n) => n.attrs.gatewayIp || "",
			mono: true,
		},
		{
			key: "dhcp",
			label: "DHCP pool",
			get: (n) => n.attrs.dhcpStart || "",
			render: (n) =>
				n.attrs.dhcpStart
					? html`<span class="mono">${n.attrs.dhcpStart} – ${n.attrs.dhcpEnd || "?"}</span>`
					: '<span class="dim">—</span>',
		},
		{
			key: "used",
			label: "IPs used",
			get: (n) => inE(n.id, "member_of").length,
			render: (n) => {
				const c = parseCidr(n.name);
				const usable = c ? (c.bits >= 31 ? c.size : c.size - 2) : 0;
				return `<span class="mono">${inE(n.id, "member_of").length} / ${usable}</span>`;
			},
		},
		{
			key: "updatedAt",
			label: "Updated",
			cls: "col-upd",
			get: (n) => n.updatedAt,
			render: (n) => `<span class="mono dim">${fmtRel(n.updatedAt)}</span>`,
		},
	],
	ips: [
		{
			key: "name",
			label: "Address",
			get: (n) => ip4ToInt(n.name) ?? 0,
			render: (n) => html`<b class="mono">${n.name}</b>`,
		},
		{
			key: "prefix",
			label: "Prefix",
			get: (n) => prefixOfIp(n.id)?.name || "",
			mono: true,
		},
		{
			key: "assigned",
			label: "Assigned to",
			get: (n) => {
				const a = assignmentOfIp(n.id);
				return a
					? a.type === "interface"
						? describeIfaceTarget(a.id)
						: a.name
					: "";
			},
			render: (n) => {
				const a = assignmentOfIp(n.id);
				return a
					? esc(a.type === "interface" ? describeIfaceTarget(a.id) : a.name)
					: '<span class="dim">unassigned</span>';
			},
		},
		{
			key: "desc",
			label: "Description",
			get: (n) => n.attrs.description || "",
		},
		{
			key: "updatedAt",
			label: "Updated",
			cls: "col-upd",
			get: (n) => n.updatedAt,
			render: (n) => `<span class="mono dim">${fmtRel(n.updatedAt)}</span>`,
		},
	],
};

export const vlanOf = (i) =>
	i.attrs.portMode === "trunk"
		? "trunk" + (i.attrs.nativeVlan ? ` n${i.attrs.nativeVlan}` : "")
		: i.attrs.accessVlan
			? "v" + i.attrs.accessVlan
			: "";
COLS.connections = [
	{
		key: "conn",
		label: "Connection",
		get: (x) =>
			`${x.da?.name || ""} ${x.a.name} ${x.db?.name || ""} ${x.b.name}`,
		render: (x) =>
			html`<span class="mono"><b>${x.da?.name || "?"}</b> · ${x.a.name}</span>` +
			` <button class="mini flip" data-flip="${x.e.from}" title="Flip display order">↔</button> ` +
			html`<span class="mono"><b>${x.db?.name || "?"}</b> · ${x.b.name}</span>`,
	},
	{
		key: "vlan",
		label: "VLAN",
		get: (x) => [vlanOf(x.a), vlanOf(x.b)].filter(Boolean).join(" "),
		render: (x) =>
			[vlanOf(x.a), vlanOf(x.b)]
				.filter(Boolean)
				.map((v) => html`<span class="pill">${v}</span>`)
				.join(" ") || '<span class="dim">—</span>',
	},
	{ key: "jack", label: "Jack", get: (x) => x.e.attrs?.jack || "", mono: true },
	{ key: "cat", label: "Category", get: (x) => x.e.attrs?.category || "" },
	{ key: "cable", label: "Cable", get: (x) => x.e.attrs?.cableColor || "" },
	{ key: "len", label: "Length", get: (x) => x.e.attrs?.length || "" },
	{
		key: "upd",
		label: "Updated",
		cls: "col-upd",
		get: (x) => x.e.updatedAt || "",
		render: (x) =>
			x.e.updatedAt
				? `<span class="mono dim">${fmtRel(x.e.updatedAt)}</span>`
				: '<span class="dim">—</span>',
	},
];
const COLSETS = {
	devices: COLS.devices,
	connections: COLS.connections,
	circuits: COLS.circuits,
	prefixes: COLS.prefixes,
	ips: COLS.ips,
	people: COLS.people,
};
function sortRows(rows, cols, ss) {
	const col = cols.find((c) => c.key === ss.key) || cols[0];
	rows.sort((a, b) => {
		const va = col.get(a),
			vb = col.get(b);
		if (typeof va === "number" && typeof vb === "number")
			return (va - vb) * ss.dir;
		return (
			String(va ?? "").localeCompare(String(vb ?? ""), undefined, {
				numeric: true,
			}) * ss.dir
		);
	});
	return rows;
}
const NO_MATCH_MSG = "No records match. + Add one or adjust search/filters.";
function tableHtml(cols, rows, ss, sortNs, emptyMsg, colNs) {
	if (!rows.length) return `<div class="empty">${NO_MATCH_MSG}</div>`;
	let h = "<table><thead><tr>";
	for (const c of cols) {
		const sortable = ss && !c.nosort;
		const arrow =
			sortable && ss.key === c.key
				? `<span class="arrow">${ss.dir > 0 ? "▲" : "▼"}</span>`
				: "";
		h += sortable
			? html`<th data-sortns="${sortNs}" data-sort="${c.key}"${safe(c.cls ? ` class="${c.cls}"` : "")}>${c.label}${safe(arrow)}</th>`
			: html`<th class="nosort${safe(c.cls ? " " + c.cls : "")}">${c.label}</th>`;
	}
	if (colNs)
		h += `<th class="nosort th-cols"><span class="menu-wrap"><button class="col-gear" data-colns="${colNs}" title="Show / hide columns">⚙</button><div class="menu" id="colmenu-${colNs}">${colMenuItems(colNs)}</div></span></th>`;
	h += "</tr></thead><tbody>";
	for (const n of rows) {
		h += html`<tr${safe(n.id ? ` data-open="${esc(n.id)}"` : "")}${safe(n.conn ? ` data-conn="${esc(n.conn)}"` : "")}>`;
		for (const c of cols) {
			let v;
			if (c.render) v = c.render(n);
			else {
				const raw = c.get(n);
				v =
					raw !== "" && raw !== undefined && raw !== null
						? c.mono
							? html`<span class="mono">${raw}</span>`
							: esc(raw)
						: '<span class="dim">—</span>';
			}
			h += `<td${c.cls ? ` class="${c.cls}"` : ""}>${v}</td>`;
		}
		if (colNs) h += '<td class="td-cols"></td>';
		h += "</tr>";
	}
	return h + "</tbody></table>";
}

function capNote(total) {
	return `<div class="empty cap-note">Showing ${ROW_LIMIT} of ${total} rows — <button class="btn quiet" id="showAllRowsBtn">Show all ${total}</button></div>`;
}
function applyCap(rows) {
	return !showAllRows && rows.length > ROW_LIMIT
		? rows.slice(0, ROW_LIMIT)
		: rows;
}

function renderNav() {
	const counts = { devices: "device", people: "person" };
	for (const [tab] of TABS) {
		const el = $(`#cnt-${tab}`);
		if (!el) continue;
		if (!store.doc) {
			el.textContent = "";
			continue;
		}
		let c = null;
		if (counts[tab])
			c = store.doc.nodes.filter((n) => n.type === counts[tab]).length;
		else if (tab === "locations")
			c = store.doc.nodes.filter(
				(n) =>
					n.type === "location" ||
					n.type === "rack" ||
					n.type === "patch_panel",
			).length;
		else if (tab === "connections")
			c =
				store.doc.edges.filter((e) => e.type === "connected_to").length +
				nodesOfType("circuit").length;
		else if (tab === "ipam") c = nodesOfType("ip_address").length;
		el.textContent = c === null ? "" : c;
	}
	$$("#navBar .tab").forEach((b) =>
		b.classList.toggle("on", b.dataset.tab === currentTab),
	);
}

const setSearchStats = (n, one = "match", many = "matches") => {
	$("#searchStats").textContent =
		n == null || !searchTokens().length ? "" : `${n} ${n === 1 ? one : many}`;
};

export {
  locationOf, rackOf, userOf, ipsOf, prefixOfIp, assignmentOfIp, ifacesOf,
  isUnplaced, isUnconnected, locPath, describeIfaceTarget, nodeKindLabel,
  $, $$, toast, fmtRel, openOverlay, closeOverlay, closeTopOverlay,
  persistLocal, persistUI, restoreUI, renderFileStatus, buildSearchIndex,
  searchTokens, matchesSearch, adoptDoc, showLoadErrors, parseAndAdopt,
  openFile, saveFile, newSite, TABS, ROW_LIMIT, sortState, filters, applyTheme,
  hiddenCols, visCols, colMenuItems, bindContentEvents, badgeOf, firstIpInt,
  deviceJack, COLS, COLSETS, sortRows, NO_MATCH_MSG, tableHtml, capNote, applyCap,
  renderNav, setSearchStats, FSAA, FINE_POINTER, defaultFileName, LS_KEY, LS_BAK, LS_QUAR
};
