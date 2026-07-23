/* ============================== store / engine ============================== */
import { nowISO, slugify, clone } from './utils.js';
import { NODE_TYPES, HISTORY_CAP, LOG_CAP, SCHEMA_VERSION } from './schema.js';
import { validateDoc } from './validator.js';
import { renderFileStatus, toast } from './ui-state.js';

// Simple IndexedDB wrapper for resilient drafts and backups
const DB_NAME = "SiteGraphDB";
const DB_VERSION = 1;
const STORE_NAME = "backups";

function getDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = (e) => resolve(e.target.result);
		request.onerror = (e) => reject(e.target.error);
	});
}

export async function dbSet(key, val) {
	try {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const storeObj = tx.objectStore(STORE_NAME);
			const request = storeObj.put(val, key);
			request.onsuccess = () => resolve();
			request.onerror = (e) => reject(e.target.error);
		});
	} catch (e) {
		console.error("IndexedDB put failed:", e);
	}
}

export async function dbGet(key) {
	try {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const storeObj = tx.objectStore(STORE_NAME);
			const request = storeObj.get(key);
			request.onsuccess = () => resolve(request.result);
			request.onerror = (e) => reject(e.target.error);
		});
	} catch (e) {
		console.error("IndexedDB get failed:", e);
		return null;
	}
}

export async function dbDel(key) {
	try {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const storeObj = tx.objectStore(STORE_NAME);
			const request = storeObj.delete(key);
			request.onsuccess = () => resolve();
			request.onerror = (e) => reject(e.target.error);
		});
	} catch (e) {
		console.error("IndexedDB delete failed:", e);
	}
}

// Debounced auto-save directly to File System Access API handle
let autoSaveTimer = null;
export function autoSaveToFileHandle() {
	if (!store.doc || !store.fileHandle) return;
	clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(async () => {
		try {
			const options = { mode: "readwrite" };
			if ((await store.fileHandle.queryPermission(options)) === "granted") {
				const text = JSON.stringify(store.doc, null, 2);
				const writable = await store.fileHandle.createWritable();
				await writable.write(text);
				await writable.close();
				store.dirty = false;
				if (typeof renderFileStatus === "function") renderFileStatus();
				if (typeof toast === "function") toast("Auto-saved to file");
			}
		} catch (e) {
			console.warn("Auto-save to file handle failed:", e);
		}
	}, 1000);
}

export const store = {
	doc: null,
	dirty: false,
	fileHandle: null,
	fileName: null,
	byId: new Map(),
	out: new Map(),
	inc: new Map() /* adjacency: out/in edge lists per node */,
};
export function buildIndex() {
	store.byId = new Map();
	store.out = new Map();
	store.inc = new Map();
	for (const n of store.doc.nodes) {
		store.byId.set(n.id, n);
		store.out.set(n.id, []);
		store.inc.set(n.id, []);
	}
	for (const e of store.doc.edges) {
		store.out.get(e.from)?.push(e);
		store.inc.get(e.to)?.push(e);
	}
}
export const nodeById = (id) => store.byId.get(id);
export const nodesOfType = (t) => store.doc.nodes.filter((n) => n.type === t);
export const outE = (id, type) =>
	(store.out.get(id) || []).filter((e) => !type || e.type === type);
export const inE = (id, type) =>
	(store.inc.get(id) || []).filter((e) => !type || e.type === type);
/* connected_to is semantically undirected — always check both sides */
export const linkOf = (ifId) =>
	store.doc.edges.find(
		(e) => e.type === "connected_to" && (e.from === ifId || e.to === ifId),
	) || null;
export const peerOf = (ifId) => {
	const e = linkOf(ifId);
	return e ? (e.from === ifId ? e.to : e.from) : null;
};
export const ownerOf = (ifId) => (inE(ifId, "has_interface")[0] || {}).from || null;

export function uniqueId(type, name) {
	const base = `${NODE_TYPES[type].idp}-${slugify(name)}`;
	let id = base,
		i = 2;
	while (store.byId.has(id)) id = `${base}-${i++}`;
	return id;
}
export function pushHistory(node, summary) {
	node.history.push({ ts: nowISO(), summary });
	if (node.history.length > HISTORY_CAP)
		node.history.splice(0, node.history.length - HISTORY_CAP);
	node.updatedAt = nowISO();
}
export function pushLog(summary) {
	store.doc.meta.log.push({ ts: nowISO(), summary });
	if (store.doc.meta.log.length > LOG_CAP)
		store.doc.meta.log.splice(0, store.doc.meta.log.length - LOG_CAP);
}
/* Atomic mutation: snapshot → apply → re-validate whole doc → commit or rollback.
   On commit: snapshot goes on the undo stack, working copy persists, UI refreshes. */
const UNDO_CAP = 25;
export const undoStack = [];
export const redoStack = [];
export let afterMutate = () => {}; /* UI layer installs its refresh hook here */
export function setAfterMutate(fn) { afterMutate = fn; }
export function mutate(fn) {
	const snap = clone(store.doc);
	try {
		fn(store.doc);
		const errs = validateDoc(store.doc);
		if (errs.length) {
			store.doc = snap;
			buildIndex();
			return { ok: false, errs };
		}
		undoStack.push(JSON.stringify(snap));
		if (undoStack.length > UNDO_CAP) undoStack.shift();
		redoStack.length = 0; /* a fresh change invalidates the redo branch */
		buildIndex();
		store.dirty = true;
		afterMutate();
		return { ok: true };
	} catch (ex) {
		store.doc = snap;
		buildIndex();
		return { ok: false, errs: [ex.message || String(ex)] };
	}
}
export function performUndo() {
	if (!undoStack.length) return false;
	redoStack.push(JSON.stringify(store.doc));
	if (redoStack.length > UNDO_CAP) redoStack.shift();
	store.doc = JSON.parse(undoStack.pop());
	buildIndex();
	store.dirty = true;
	afterMutate();
	return true;
}
export function performRedo() {
	if (!redoStack.length) return false;
	undoStack.push(JSON.stringify(store.doc));
	if (undoStack.length > UNDO_CAP) undoStack.shift();
	store.doc = JSON.parse(redoStack.pop());
	buildIndex();
	store.dirty = true;
	afterMutate();
	return true;
}

/* ---- node factory ---- */
export function makeNode(type, name, attrs) {
	return {
		id: uniqueId(type, name),
		type,
		name: String(name).trim(),
		updatedAt: nowISO(),
		history: [{ ts: nowISO(), summary: "Created" }],
		attrs: attrs || {},
	};
}
/* replace a subject's singleton edge (located_in / mounted_in / used_by / terminated_at / assigned_to) */
export function setSingletonEdge(doc, from, type, to, attrs) {
	doc.edges = doc.edges.filter((e) => !(e.type === type && e.from === from));
	if (to) {
		const e = { from, type, to };
		if (attrs && Object.keys(attrs).length) e.attrs = attrs;
		doc.edges.push(e);
	}
}

/* ---- cascade impact ----
   Composition (deleted with parent): device→interfaces, device/interface→assigned IPs, prefix→member IPs.
   Aggregation (edge severed, node survives): location, rack, person, circuit links. */
export function computeImpact(rootId) {
	const delNodes = new Set([rootId]);
	const root = nodeById(rootId);
	const addIpsAssignedTo = (id) => {
		for (const e of inE(id, "assigned_to")) delNodes.add(e.from);
	};
	if (root.type === "device") {
		addIpsAssignedTo(rootId);
		for (const e of outE(rootId, "has_interface")) {
			delNodes.add(e.to);
			addIpsAssignedTo(e.to);
		}
	}
	if (root.type === "interface") addIpsAssignedTo(rootId);
	if (root.type === "prefix")
		for (const e of inE(rootId, "member_of")) delNodes.add(e.from);
	const delEdges = store.doc.edges.filter(
		(e) => delNodes.has(e.from) || delNodes.has(e.to),
	);
	/* surviving nodes that lose a link (for the impact preview) */
	const severed = [];
	for (const e of delEdges) {
		const other = delNodes.has(e.from)
			? e.to
			: delNodes.has(e.to)
				? e.from
				: null;
		if (other && !delNodes.has(other))
			severed.push({ node: nodeById(other), via: e.type });
	}
	return { nodes: [...delNodes].map(nodeById), edges: delEdges, severed };
}
export function deleteNode(rootId) {
	const impact = computeImpact(rootId);
	const root = nodeById(rootId);
	const ids = new Set(impact.nodes.map((n) => n.id));
	const res = mutate((doc) => {
		doc.nodes = doc.nodes.filter((n) => !ids.has(n.id));
		doc.edges = doc.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
		const extra = impact.nodes.length - 1;
		pushLog(
			`Deleted ${NODE_TYPES[root.type].label.toLowerCase()} "${root.name}"` +
				(extra ? ` (+${extra} dependent node${extra > 1 ? "s" : ""})` : ""),
		);
		for (const s of impact.severed)
			if (s.node && doc.nodes.find((n) => n.id === s.node.id)) {
				const live = doc.nodes.find((n) => n.id === s.node.id);
				pushHistory(live, `Link removed (${s.via} → "${root.name}" deleted)`);
			}
	});
	return { ...res, impact };
}

export function exportJson(doc) {
	// Deep clone with deterministic key sorting for objects
	const sortObjectKeys = (obj) => {
		if (obj === null || typeof obj !== "object") return obj;
		if (Array.isArray(obj)) return obj.map(sortObjectKeys);
		return Object.keys(obj).sort().reduce((acc, key) => {
			acc[key] = sortObjectKeys(obj[key]);
			return acc;
		}, {});
	};

	const sortedDoc = {
		meta: sortObjectKeys(doc.meta),
		nodes: doc.nodes.map(sortObjectKeys).sort((a, b) => a.id.localeCompare(b.id)),
		edges: doc.edges.map(sortObjectKeys).sort((a, b) => {
			if (a.from !== b.from) return a.from.localeCompare(b.from);
			if (a.to !== b.to) return a.to.localeCompare(b.to);
			return a.type.localeCompare(b.type);
		}),
	};

	return JSON.stringify(sortedDoc, null, 2);
}

/* ---- blank / sample documents ---- */
export function blankDoc(siteName) {
	return {
		meta: {
			schemaVersion: SCHEMA_VERSION,
			site: { name: siteName || "New site", address: "", notes: "" },
			log: [{ ts: nowISO(), summary: "Site created" }],
		},
		nodes: [],
		edges: [],
	};
}

export const SAMPLE = (() => {
	const t = "2026-07-20T12:00:00.000Z";
	const nn = (id, type, name, attrs) => ({
		id,
		type,
		name,
		updatedAt: t,
		history: [{ ts: t, summary: "Created" }],
		attrs,
	});
	const ee = (from, type, to, attrs) =>
		attrs ? { from, type, to, attrs } : { from, type, to };
	const nodes = [],
		edges = [];
	const N24 = 24,
		N12 = 12,
		N48 = 48;

	/* -------- LOCATIONS & RACKS -------- */
	nodes.push(
		nn("loc-hq", "location", "Headquarters", { locationType: "building" }),
		nn("loc-hq-mdf", "location", "MDF Closet", { locationType: "MDF" }),
		nn("loc-hq-servers", "location", "Server Room", { locationType: "room" }),
		nn("loc-hq-floor1", "location", "Floor 1 Sales", { locationType: "showfloor" }),
		
		nn("loc-branch", "location", "Branch Office", { locationType: "building" }),
		nn("loc-branch-idf", "location", "Branch IDF", { locationType: "IDF" }),
		nn("loc-branch-sales", "location", "Branch Showroom", { locationType: "showfloor" }),
		
		nn("rack-hq-core", "rack", "HQ Core Rack", { heightU: 42 }),
		nn("rack-hq-svr", "rack", "HQ Server Rack", { heightU: 42 }),
		nn("rack-branch-1", "rack", "Branch Rack", { heightU: 24 })
	);
	
	edges.push(
		ee("loc-hq-mdf", "located_in", "loc-hq"),
		ee("loc-hq-servers", "located_in", "loc-hq"),
		ee("loc-hq-floor1", "located_in", "loc-hq"),
		ee("loc-branch-idf", "located_in", "loc-branch"),
		ee("loc-branch-sales", "located_in", "loc-branch"),
		
		ee("rack-hq-core", "located_in", "loc-hq-mdf"),
		ee("rack-hq-svr", "located_in", "loc-hq-servers"),
		ee("rack-branch-1", "located_in", "loc-branch-idf")
	);

	/* -------- PATCH PANELS -------- */
	nodes.push(
		nn("pp-hq-1", "patch_panel", "PP-HQ-1", { jackCount: 48 }),
		nn("pp-hq-2", "patch_panel", "PP-HQ-2", { jackCount: 48 }),
		nn("pp-branch-1", "patch_panel", "PP-Branch-1", { jackCount: 24 })
	);
	
	edges.push(
		ee("pp-hq-1", "mounted_in", "rack-hq-core", { rackU: 42 }),
		ee("pp-hq-2", "mounted_in", "rack-hq-core", { rackU: 40 }),
		ee("pp-branch-1", "mounted_in", "rack-branch-1", { rackU: 24 })
	);

	/* -------- DEVICES -------- */
	nodes.push(
		nn("dev-fw-hq", "device", "fw-core-01", { role: "firewall", mac: "00:11:22:33:44:55", ipAssignment: "static", notes: "Primary HQ Firewall and Gateway" }),
		nn("dev-sw-core1", "device", "sw-core-01", { role: "core-switch", mac: "00:11:22:33:44:56", ipAssignment: "static" }),
		nn("dev-sw-acc1", "device", "sw-acc-01", { role: "switch", mac: "00:11:22:33:44:57", ipAssignment: "static" }),
		nn("dev-sw-acc2", "device", "sw-acc-02", { role: "switch", mac: "00:11:22:33:44:58", ipAssignment: "static" }),
		
		nn("dev-svr-db", "device", "svr-db-01", { role: "server", ipAssignment: "static", notes: "Main Postgres Database" }),
		nn("dev-svr-app", "device", "svr-app-01", { role: "server", ipAssignment: "static", notes: "Web application server" }),
		
		nn("dev-fw-branch", "device", "fw-branch-01", { role: "firewall", ipAssignment: "static", notes: "Branch office VPN gateway" }),
		nn("dev-sw-branch1", "device", "sw-branch-01", { role: "switch", ipAssignment: "static" })
	);
	
	edges.push(
		ee("dev-fw-hq", "mounted_in", "rack-hq-core", { rackU: 38 }),
		ee("dev-sw-core1", "mounted_in", "rack-hq-core", { rackU: 36 }),
		ee("dev-sw-acc1", "mounted_in", "rack-hq-core", { rackU: 34 }),
		ee("dev-sw-acc2", "mounted_in", "rack-hq-core", { rackU: 32 }),
		
		ee("dev-svr-db", "mounted_in", "rack-hq-svr", { rackU: 10 }),
		ee("dev-svr-app", "mounted_in", "rack-hq-svr", { rackU: 12 }),
		
		ee("dev-fw-branch", "mounted_in", "rack-branch-1", { rackU: 22 }),
		ee("dev-sw-branch1", "mounted_in", "rack-branch-1", { rackU: 20 })
	);

	/* -------- INTERFACES -------- */
	const ifaces = [];
	
	// fw-hq
	ifaces.push(
		nn("if-fw-hq-wan1", "interface", "wan1", { portMode: "access", media: "copper" }),
		nn("if-fw-hq-wan2", "interface", "wan2", { portMode: "access", media: "copper" }),
		nn("if-fw-hq-lan", "interface", "lan1", { portMode: "trunk", nativeVlan: 10, media: "sfp+" })
	);
	edges.push(
		ee("dev-fw-hq", "has_interface", "if-fw-hq-wan1"),
		ee("dev-fw-hq", "has_interface", "if-fw-hq-wan2"),
		ee("dev-fw-hq", "has_interface", "if-fw-hq-lan")
	);
	
	// sw-core1
	ifaces.push(
		nn("if-sw-core1-sfp1", "interface", "SFP1", { portMode: "trunk", nativeVlan: 10, media: "sfp+" }),
		nn("if-sw-core1-sfp2", "interface", "SFP2", { portMode: "trunk", nativeVlan: 10, media: "sfp+" }),
		nn("if-sw-core1-sfp3", "interface", "SFP3", { portMode: "trunk", nativeVlan: 10, media: "sfp+" }),
	);
	for (let i = 1; i <= 24; i++) {
		ifaces.push(nn(`if-sw-core1-p${i}`, "interface", `p${i}`, { portMode: "access", accessVlan: 20, media: "copper", stdName: `p${i}` }));
	}
	edges.push(
		ee("dev-sw-core1", "has_interface", "if-sw-core1-sfp1"),
		ee("dev-sw-core1", "has_interface", "if-sw-core1-sfp2"),
		ee("dev-sw-core1", "has_interface", "if-sw-core1-sfp3"),
	);
	for (let i = 1; i <= 24; i++) {
		edges.push(ee("dev-sw-core1", "has_interface", `if-sw-core1-p${i}`));
	}
	
	// sw-acc1 (generate 24 ports + 2 uplinks)
	for(let i=1; i<=24; i++) {
		ifaces.push(nn(`if-sw-acc1-p${i}`, "interface", `p${i}`, { portMode: "access", accessVlan: 30, media: "copper", stdName: `p${i}` }));
		edges.push(ee("dev-sw-acc1", "has_interface", `if-sw-acc1-p${i}`));
	}
	ifaces.push(nn("if-sw-acc1-sfp1", "interface", "SFP1", { portMode: "trunk", nativeVlan: 10, media: "sfp+" }));
	edges.push(ee("dev-sw-acc1", "has_interface", "if-sw-acc1-sfp1"));
	
	// sw-acc2 (generate 24 ports + 2 uplinks)
	for(let i=1; i<=24; i++) {
		ifaces.push(nn(`if-sw-acc2-p${i}`, "interface", `p${i}`, { portMode: "access", accessVlan: 30, media: "copper", stdName: `p${i}` }));
		edges.push(ee("dev-sw-acc2", "has_interface", `if-sw-acc2-p${i}`));
	}
	ifaces.push(nn("if-sw-acc2-sfp1", "interface", "SFP1", { portMode: "trunk", nativeVlan: 10, media: "sfp+" }));
	edges.push(ee("dev-sw-acc2", "has_interface", "if-sw-acc2-sfp1"));
	
	// servers
	ifaces.push(
		nn("if-svr-db-eth0", "interface", "eth0", { portMode: "access", accessVlan: 20, media: "copper" }),
		nn("if-svr-app-eth0", "interface", "eth0", { portMode: "access", accessVlan: 20, media: "copper" })
	);
	edges.push(
		ee("dev-svr-db", "has_interface", "if-svr-db-eth0"),
		ee("dev-svr-app", "has_interface", "if-svr-app-eth0")
	);
	
	// fw-branch
	ifaces.push(
		nn("if-fw-branch-wan", "interface", "wan1", { portMode: "access", media: "copper" }),
		nn("if-fw-branch-lan", "interface", "lan1", { portMode: "trunk", nativeVlan: 100, media: "copper" })
	);
	edges.push(
		ee("dev-fw-branch", "has_interface", "if-fw-branch-wan"),
		ee("dev-fw-branch", "has_interface", "if-fw-branch-lan")
	);
	
	// sw-branch1
	ifaces.push(nn("if-sw-branch1-p13", "interface", "p13", { portMode: "trunk", nativeVlan: 100, media: "copper", stdName: "p13" }));
	edges.push(ee("dev-sw-branch1", "has_interface", "if-sw-branch1-p13"));
	for(let i=1; i<=12; i++) {
		ifaces.push(nn(`if-sw-branch1-p${i}`, "interface", `p${i}`, { portMode: "access", accessVlan: 110, media: "copper", stdName: `p${i}` }));
		edges.push(ee("dev-sw-branch1", "has_interface", `if-sw-branch1-p${i}`));
	}

	/* -------- CIRCUITS -------- */
	nodes.push(
		nn("circ-inet-primary", "circuit", "Comcast Fiber", { circuitType: "internet", provider: "Comcast", bandwidth: "10 Gbps", wanIp: "198.51.100.2" }),
		nn("circ-inet-backup", "circuit", "AT&T Coax", { circuitType: "internet", provider: "AT&T", bandwidth: "1 Gbps", wanIp: "203.0.113.5" }),
		nn("circ-mpls", "circuit", "Lumen MPLS", { circuitType: "mpls", provider: "Lumen", bandwidth: "500 Mbps" })
	);
	
	edges.push(
		ee("circ-inet-primary", "terminated_at", "if-fw-hq-wan1"),
		ee("circ-inet-backup", "terminated_at", "if-fw-hq-wan2"),
		ee("circ-mpls", "terminated_at", "if-fw-branch-wan")
	);

	/* -------- ENDPOINTS & PEOPLE -------- */
	nodes.push(
		nn("person-bob", "person", "Bob Smith", { title: "Sales Director", department: "Sales", email: "bob@example.com" }),
		nn("person-alice", "person", "Alice Jones", { title: "Systems Engineer", department: "IT", email: "alice@example.com" }),
		nn("person-charlie", "person", "Charlie Brown", { title: "Branch Manager", department: "Sales", email: "charlie@example.com" })
	);
	edges.push(
		ee("person-bob", "located_in", "loc-hq-floor1"),
		ee("person-alice", "located_in", "loc-hq-mdf"),
		ee("person-charlie", "located_in", "loc-branch-sales")
	);
	
	nodes.push(
		nn("dev-ep-bob-lap", "device", "L-BOB-01", { role: "laptop", ipAssignment: "dhcp" }),
		nn("dev-ep-bob-phone", "device", "P-BOB-01", { role: "phone", ipAssignment: "dhcp" }),
		nn("dev-ep-alice-lap", "device", "L-ALICE-01", { role: "laptop", ipAssignment: "dhcp" }),
		nn("dev-ep-charlie-lap", "device", "L-CHARLIE-01", { role: "laptop", ipAssignment: "dhcp" }),
		nn("dev-ep-hq-print", "device", "PRN-HQ-01", { role: "printer", ipAssignment: "static" }),
		nn("dev-ep-cam1", "device", "CAM-HQ-01", { role: "camera", ipAssignment: "static" })
	);
	
	// Create interfaces for these endpoints so we can connect them to the switch
	ifaces.push(
		nn("if-ep-bob-phone", "interface", "eth0", { portMode: "access", media: "copper" }),
		nn("if-ep-hq-print", "interface", "eth0", { portMode: "access", media: "copper" }),
		nn("if-ep-cam1", "interface", "eth0", { portMode: "access", media: "copper" }),
		nn("if-ep-charlie-lap", "interface", "eth0", { portMode: "access", media: "copper" })
	);
	edges.push(
		ee("dev-ep-bob-phone", "has_interface", "if-ep-bob-phone"),
		ee("dev-ep-hq-print", "has_interface", "if-ep-hq-print"),
		ee("dev-ep-cam1", "has_interface", "if-ep-cam1"),
		ee("dev-ep-charlie-lap", "has_interface", "if-ep-charlie-lap")
	);

	// Push all accumulated interfaces
	nodes.push(...ifaces);
	
	edges.push(
		ee("dev-ep-bob-lap", "used_by", "person-bob"),
		ee("dev-ep-bob-phone", "used_by", "person-bob"),
		ee("dev-ep-alice-lap", "used_by", "person-alice"),
		ee("dev-ep-charlie-lap", "used_by", "person-charlie"),
		
		ee("dev-ep-bob-lap", "located_in", "loc-hq-floor1"),
		ee("dev-ep-bob-phone", "located_in", "loc-hq-floor1"),
		ee("dev-ep-hq-print", "located_in", "loc-hq-floor1"),
		ee("dev-ep-cam1", "located_in", "loc-hq-floor1"),
		ee("dev-ep-alice-lap", "located_in", "loc-hq-mdf"),
		ee("dev-ep-charlie-lap", "located_in", "loc-branch-sales")
	);

	/* -------- CABLES & CONNECTIONS -------- */
	edges.push(
		// Core switch uplinks to FW and Access switch
		ee("if-sw-core1-sfp1", "connected_to", "if-fw-hq-lan", { cableColor: "yellow", length: "1m", category: "fiber" }),
		ee("if-sw-core1-sfp2", "connected_to", "if-sw-acc1-sfp1", { cableColor: "aqua", length: "2m", category: "fiber" }),
		
		// Servers to Core switch
		ee("if-svr-db-eth0", "connected_to", "if-sw-core1-p23", { cableColor: "blue", length: "3m", category: "cat6" }),
		ee("if-svr-app-eth0", "connected_to", "if-sw-core1-p24", { cableColor: "blue", length: "3m", category: "cat6" }),
		
		// Branch
		ee("if-fw-branch-lan", "connected_to", "if-sw-branch1-p13", { cableColor: "black", length: "1m", category: "cat6" })
	);

	// Patch some endpoints through patch panels to the switch
	// INTERFACE to INTERFACE!
	edges.push(
		ee("if-ep-bob-phone", "connected_to", "if-sw-acc1-p1", { jack: "PP-HQ-1:1", cableColor: "green" }),
		ee("if-ep-hq-print", "connected_to", "if-sw-acc1-p2", { jack: "PP-HQ-1:2", cableColor: "grey" }),
		ee("if-ep-cam1", "connected_to", "if-sw-acc1-p3", { jack: "PP-HQ-1:3", cableColor: "white" }),
		ee("if-ep-charlie-lap", "connected_to", "if-sw-branch1-p1", { jack: "PP-Branch-1:1", cableColor: "blue" })
	);

	/* -------- IPAM: PREFIXES -------- */
	nodes.push(
		nn("pfx-mgmt", "prefix", "10.0.0.0/24", { description: "HQ Management", vlanId: 10, gatewayIp: "10.0.0.1" }),
		nn("pfx-servers", "prefix", "10.0.10.0/24", { description: "HQ Servers", vlanId: 20, gatewayIp: "10.0.10.1" }),
		nn("pfx-users", "prefix", "10.0.20.0/24", { description: "HQ Users", vlanId: 30, gatewayIp: "10.0.20.1", dhcpStart: "10.0.20.100", dhcpEnd: "10.0.20.200" }),
		nn("pfx-voice", "prefix", "10.0.30.0/24", { description: "HQ Voice", vlanId: 40, gatewayIp: "10.0.30.1", dhcpStart: "10.0.30.100", dhcpEnd: "10.0.30.200" }),
		
		nn("pfx-branch-mgmt", "prefix", "10.1.0.0/24", { description: "Branch Management", vlanId: 100, gatewayIp: "10.1.0.1" }),
		nn("pfx-branch-users", "prefix", "10.1.10.0/24", { description: "Branch Users", vlanId: 110, gatewayIp: "10.1.10.1", dhcpStart: "10.1.10.100", dhcpEnd: "10.1.10.200" })
	);

	/* -------- IPAM: ADDRESSES -------- */
	
	// Gateway IPs -> Assigned to the Core Firewall! (Multi-IP support in action)
	nodes.push(
		nn("ip-gw-mgmt", "ip_address", "10.0.0.1", { description: "Gateway" }),
		nn("ip-gw-svr", "ip_address", "10.0.10.1", { description: "Gateway" }),
		nn("ip-gw-users", "ip_address", "10.0.20.1", { description: "Gateway" }),
		nn("ip-gw-voice", "ip_address", "10.0.30.1", { description: "Gateway" }),
		
		nn("ip-sw-core1", "ip_address", "10.0.0.2", { description: "Management IP" }),
		nn("ip-sw-acc1", "ip_address", "10.0.0.3", { description: "Management IP" }),
		nn("ip-sw-acc2", "ip_address", "10.0.0.4", { description: "Management IP" }),
		
		nn("ip-svr-db", "ip_address", "10.0.10.10", { description: "DB Primary" }),
		nn("ip-svr-app", "ip_address", "10.0.10.20", { description: "App Server" }),
		
		nn("ip-print", "ip_address", "10.0.20.50", { description: "Sales Printer" }),
		nn("ip-cam1", "ip_address", "10.0.20.51", { description: "Floor Camera" }),
		
		// Branch
		nn("ip-gw-branch-mgmt", "ip_address", "10.1.0.1", { description: "Branch Gateway" }),
		nn("ip-gw-branch-users", "ip_address", "10.1.10.1", { description: "Branch Gateway" }),
		nn("ip-sw-branch1", "ip_address", "10.1.0.2", { description: "Management IP" })
	);
	
	edges.push(
		// Multi-IP Assignments to HQ Firewall
		ee("ip-gw-mgmt", "member_of", "pfx-mgmt"),
		ee("ip-gw-mgmt", "assigned_to", "if-fw-hq-lan"),
		
		ee("ip-gw-svr", "member_of", "pfx-servers"),
		ee("ip-gw-svr", "assigned_to", "if-fw-hq-lan"),
		
		ee("ip-gw-users", "member_of", "pfx-users"),
		ee("ip-gw-users", "assigned_to", "if-fw-hq-lan"),
		
		ee("ip-gw-voice", "member_of", "pfx-voice"),
		ee("ip-gw-voice", "assigned_to", "if-fw-hq-lan"),
		
		// Multi-IP Assignment to Branch Firewall
		ee("ip-gw-branch-mgmt", "member_of", "pfx-branch-mgmt"),
		ee("ip-gw-branch-mgmt", "assigned_to", "if-fw-branch-lan"),
		ee("ip-gw-branch-users", "member_of", "pfx-branch-users"),
		ee("ip-gw-branch-users", "assigned_to", "if-fw-branch-lan"),
		
		// Switches
		ee("ip-sw-core1", "member_of", "pfx-mgmt"),
		ee("ip-sw-core1", "assigned_to", "dev-sw-core1"),
		ee("ip-sw-acc1", "member_of", "pfx-mgmt"),
		ee("ip-sw-acc1", "assigned_to", "dev-sw-acc1"),
		ee("ip-sw-acc2", "member_of", "pfx-mgmt"),
		ee("ip-sw-acc2", "assigned_to", "dev-sw-acc2"),
		ee("ip-sw-branch1", "member_of", "pfx-branch-mgmt"),
		ee("ip-sw-branch1", "assigned_to", "dev-sw-branch1"),
		
		// Servers & Endpoints
		ee("ip-svr-db", "member_of", "pfx-servers"),
		ee("ip-svr-db", "assigned_to", "if-svr-db-eth0"),
		
		ee("ip-svr-app", "member_of", "pfx-servers"),
		ee("ip-svr-app", "assigned_to", "if-svr-app-eth0"),
		
		ee("ip-print", "member_of", "pfx-users"),
		ee("ip-print", "assigned_to", "dev-ep-hq-print"),
		
		ee("ip-cam1", "member_of", "pfx-users"),
		ee("ip-cam1", "assigned_to", "dev-ep-cam1")
	);

	/* -------- INTENTIONAL WARNINGS -------- */
	nodes.push(
		nn("pfx-guest", "prefix", "10.0.99.0/24", { description: "HQ Guest Wi-Fi", vlanId: 99, gatewayIp: "10.0.99.1", dhcpStart: "10.0.99.100", dhcpEnd: "10.0.99.200" })
	);

	return {
		meta: {
			schemaVersion: SCHEMA_VERSION,
			site: {
				name: "Acme Corp Headquarters",
				address: "123 Main St, Tech City",
				notes: "HQ and Branch network topology",
			},
			log: [{ ts: t, summary: "Sample dataset generated" }],
		},
		nodes,
		edges,
	};
})();
