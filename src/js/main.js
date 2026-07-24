import { $, $$, currentTab, showAllRows, setShowAllRows, theme, applyTheme, persistUI, toast, closeTopOverlay, renderFileStatus, buildSearchIndex, TABS, setCurrentTab, setTheme, defaultFileName, LS_KEY, LS_BAK, LS_QUAR, searchTokens, matchesSearch, setSearchStats, hiddenCols, deviceJack, ifacesOf, ipsOf, openFile, saveFile, newSite, renderNav, bindContentEvents, persistLocal, restoreUI, toggleMenu } from './ui-state.js';
import { store, dbGet, dbSet, dbDel, buildIndex, afterMutate, setAfterMutate, performUndo, performRedo, mutate, computeImpact, deleteNode, makeNode, linkOf, blankDoc, SAMPLE, exportJson } from './store.js';
import { renderAll } from './ui-layout.js';
import { drawTopo, topo, topoToggles, catOf } from './topology.js';
import { deviceEditor, locationEditor, rackEditor, patchPanelEditor, personEditor, prefixEditor, circuitEditor, connectForm, openEditor, exportCsv, exportCypher, exportDigest, showHygiene, editSiteMeta, downloadText, showActivity } from './ui-forms.js';
import { esc, clone, slugify } from './utils.js';
import { generateXlsxBlob } from './export-xlsx.js';
import { ip4ToInt, parseCidr, isIp4, intToIp4, cidrHasHost } from './ipv4.js';
import { validateDoc } from './validator.js';
import { NODE_TYPES, EDGE_TYPES } from './schema.js';
import './components.js';

function placeMenu(m) {
	m.classList.remove("menu--flip");
	const r = m.getBoundingClientRect();
	if (r.width && r.left < 8)
		m.classList.add("menu--flip"); /* clipped off-screen left → left-align */
}

/* ================================================================
   BOOT & GLOBAL WIRING
   ================================================================ */
function installAfterMutate() {
	setAfterMutate(() => {
		buildSearchIndex();
		persistLocal();
		renderFileStatus();
		if (currentTab === "topology") {
			renderNav();
			drawTopo(true);
		} else renderAll();
		/* keep every open panel live — parent editors refresh when a child panel commits */
		document.querySelectorAll(".overlay.open").forEach((ov) => {
			if (typeof ov._refresh === "function") ov._refresh();
		});
	});
}
function addMenuAction(kind) {
	if (!store.doc) {
		toast("Open or create a site first", true);
		return;
	}
	const A = {
		device: () => deviceEditor(null),
		location: () => locationEditor(null),
		rack: () => rackEditor(null),
		patchpanel: () => patchPanelEditor(null),
		person: () => personEditor(null),
		prefix: () => prefixEditor(null),
		circuit: () => circuitEditor(null),
		connection: () => connectForm(),
	};
	A[kind]?.();
}

function init() {
	document.body.innerHTML = `
  <header class="header">
    <div class="title-block" id="siteTitle" title="Edit site details">
      <span class="kicker">Network source of truth</span>
      <h1 id="siteName">—</h1>
    </div>
    <span class="spacer"></span>
    <div class="file-status"><span class="dot" id="dirtyDot"></span><span id="fileStatusText">no file</span></div>
    <div class="header-actions">
			<button class="btn quiet" id="btnTheme" title="Toggle dark mode">◐</button>
			<div class="btn-group">
				<button class="btn quiet" id="btnUndo" title="Undo last change (Ctrl+Z)" disabled>Undo</button>
				<button class="btn quiet" id="btnRedo" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button>
			</div>
			<button class="btn" id="btnSave" disabled>Save</button>
			<div class="menu-wrap">
				<button class="btn quiet" id="btnFileMenu">File ▾</button>
				<div class="menu" id="fileMenu">
					<button id="exp-new">New site…</button>
					<button id="btnOpen">Open from JSON…</button>
					<button id="exp-clearlocal">Clear browser working copy…</button>
					<div class="menu-note">Reports</div>
					<button id="btnCheck">Integrity Check</button>
					<button id="btnActivity">Activity Log</button>
					<div class="menu-note">Machine-readable exports</div>
					<button id="exp-json">JSON (download copy)</button>
					<button id="exp-cypher">Neo4j Cypher script (.cypher)</button>
					<button id="exp-llm">LLM digest (.md — node cards + triples)</button>
					<button id="exp-csv">CSV (current table view)</button>
					<button id="exp-xlsx">Spreadsheet (.xlsx)</button>
				</div>
			</div>
			<div class="menu-wrap">
				<button class="btn primary" id="btnAdd">+ Add ▾</button>
        <div class="menu" id="addMenu">
          <button data-add="device">Device</button>
          <button data-add="connection">Connection</button>
          <button data-add="person">Person</button>
          <button data-add="location">Location</button>
          <button data-add="rack">Rack</button>
          <button data-add="patchpanel">Patch panel</button>
          <button data-add="prefix">Prefix / VLAN</button>
          <button data-add="circuit">Circuit</button>
        </div>
      </div>
    </div>
  </header>
  <nav class="nav" id="navBar">
    ${TABS.map(([id, label]) => `<button class="tab" data-tab="${id}">${label} <span class="count" id="cnt-${id}"></span></button>`).join("")}
    <span class="spacer"></span>
    <div class="search-wrap">
      <input class="search" id="searchInput" placeholder="/ search everything" aria-label="Search all records">
      <span class="search-stats" id="searchStats"></span>
    </div>
  </nav>
  <button class="search-fab" id="searchFab" aria-label="Search" title="Search">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
  </button>
  <div class="mobile-search" id="mobileSearch"></div>
  <main class="content" id="content"></main>
  <div id="toasts"></div>
  <datalist id="deptList"></datalist>
  <datalist id="cableCatList"></datalist>`;

	installAfterMutate();
	$("#btnOpen").onclick = openFile;
	$("#btnSave").onclick = saveFile;
	$("#btnUndo").onclick = () => {
		if (performUndo()) toast("Undone");
	};
	$("#btnRedo").onclick = () => {
		if (performRedo()) toast("Redone");
	};
	$("#btnTheme").onclick = () => {
		setTheme(theme === "dark" ? "light" : "dark");
		applyTheme();
		persistUI();
	};
	$("#btnCheck").onclick = () => {
		if (store.doc) showHygiene();
	};
	$("#btnActivity").onclick = () => {
		if (store.doc) showActivity();
	};
	$("#siteTitle").onclick = () => {
		if (store.doc) editSiteMeta();
	};
	$("#btnFileMenu").onclick = (ev) => {
		ev.stopPropagation();
		toggleMenu("#fileMenu");
	};
	$("#btnAdd").onclick = (ev) => {
		ev.stopPropagation();
		toggleMenu("#addMenu");
	};
	document.addEventListener("click", () =>
		$$(".menu").forEach((m) => m.classList.remove("open")),
	);
	$$("#addMenu [data-add]").forEach(
		(b) => (b.onclick = () => addMenuAction(b.dataset.add)),
	);
	$("#exp-json").onclick = () => {
		if (store.doc)
			downloadText(
				exportJson(store.doc),
				store.fileName || defaultFileName(),
				"application/json",
			);
	};
	$("#exp-cypher").onclick = () => {
		if (store.doc) exportCypher();
	};
	$("#exp-llm").onclick = () => {
		if (store.doc) exportDigest();
	};
	$("#exp-csv").onclick = () => {
		if (store.doc) exportCsv();
	};
	$("#exp-xlsx").onclick = () => {
		if (!store.doc) return;
		const blob = generateXlsxBlob(store.doc);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${slugify(store.doc.meta.site.name || 'site')}.xlsx`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	};
	$("#exp-new").onclick = newSite;
	$("#exp-clearlocal").onclick = async () => {
		if (
			!confirm(
				"Remove the browser-stored working copy and backup? Your JSON file on disk is not touched.",
			)
		)
			return;
		try {
			localStorage.removeItem(LS_KEY);
			localStorage.removeItem(LS_BAK);
		} catch (e) {}
		await dbDel(LS_KEY);
		await dbDel(LS_BAK);
		window.location.reload();
	};
	$$("#navBar .tab").forEach(
		(b) =>
			(b.onclick = () => {
				setCurrentTab(b.dataset.tab);
				setShowAllRows(false);
				persistUI();
				renderAll();
			}),
	);

	let searchTimer = null;
	bindContentEvents($("#content"));
	$("#searchInput").addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			setShowAllRows(false);
			if (currentTab !== "topology") return renderAll();
			if (topo && topo.searchDim) setSearchStats(topo.searchDim());
		}, 90);
	});
	/* iOS keyboard-accessory "done" blurs without a keypress: an empty, unfocused
     bar has no reason to stay — close it. Grace period avoids racing a FAB tap. */
	$("#searchInput").addEventListener("blur", () => {
		setTimeout(() => {
			const s = $("#searchInput");
			if (
				document.body.classList.contains("search-open") &&
				!s.value.trim() &&
				document.activeElement !== s
			)
				closeSearchPanel();
		}, 120);
	});
	$("#searchInput").addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;
		if (currentTab === "topology" && topo && topo.centerOn && store.doc) {
			const tokens = searchTokens();
			if (tokens.length) {
				const hit = store.doc.nodes.find((n) => {
					const c = catOf(n);
					return c && topoToggles[c] && matchesSearch(n.id, tokens);
				});
				if (hit) topo.centerOn(hit.id);
			}
		}
		/* mobile panel: Return commits the search — keyboard drops, panel closes, filter stays */
		if (document.body.classList.contains("search-open")) {
			e.target.blur();
			if (!e.target.value.trim()) closeSearchPanel();
		}
	});
	const searchWrapEl = () => $("#searchInput").closest(".search-wrap");
	const closeSearchPanel = () => {
		document.body.classList.remove("search-open");
		const wrap = searchWrapEl();
		if (wrap && wrap.parentElement !== $("#navBar"))
			$("#navBar").appendChild(wrap);
	};
	$("#searchFab").onclick = () => {
		const s = $("#searchInput");
		if (!document.body.classList.contains("search-open")) {
			$("#mobileSearch").appendChild(searchWrapEl());
			document.body.classList.add("search-open");
			s.focus();
			s.select();
			return;
		}
		if (!s.value.trim()) return closeSearchPanel();
		if (/^0 /.test($("#searchStats").textContent)) {
			/* dead-end query: wipe it and close */
			s.value = "";
			s.dispatchEvent(new Event("input", { bubbles: true }));
			return closeSearchPanel();
		}
		s.focus();
		s.select(); /* live filter: FAB refocuses, never hides it */
	};
	document.addEventListener("keydown", (e) => {
		const tag = document.activeElement ? document.activeElement.tagName : "";
		if (e.key === "Escape" && document.body.classList.contains("search-open")) {
			const s = $("#searchInput");
			s.value = "";
			s.dispatchEvent(new Event("input", { bubbles: true }));
			closeSearchPanel();
			s.blur();
		}
		if (
			e.key === "/" &&
			tag !== "INPUT" &&
			tag !== "TEXTAREA" &&
			tag !== "SELECT"
		) {
			e.preventDefault();
			const s = $("#searchInput");
			if (!s.offsetParent && !document.body.classList.contains("search-open"))
				return $("#searchFab").click();
			s.focus();
			s.select();
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			if (store.doc) saveFile();
		}
		if (
			(e.ctrlKey || e.metaKey) &&
			!e.shiftKey &&
			e.key.toLowerCase() === "z"
		) {
			if (
				tag !== "INPUT" &&
				tag !== "TEXTAREA" &&
				tag !== "SELECT" &&
				!document.querySelector(".overlay.open")
			) {
				e.preventDefault();
				if (performUndo()) toast("Undone");
			}
		}
		if (
			(e.ctrlKey || e.metaKey) &&
			((e.shiftKey && e.key.toLowerCase() === "z") ||
				e.key.toLowerCase() === "y")
		) {
			if (
				tag !== "INPUT" &&
				tag !== "TEXTAREA" &&
				tag !== "SELECT" &&
				!document.querySelector(".overlay.open")
			) {
				e.preventDefault();
				if (performRedo()) toast("Redone");
			}
		}
		if (e.key === "Escape") closeTopOverlay();
		if (e.key === "Tab") {
			const modal = document.querySelector(".overlay.open:last-of-type .modal");
			if (modal) {
				const items = [
					...modal.querySelectorAll("input,select,textarea,button"),
				].filter((x) => !x.disabled && x.offsetParent !== null);
				if (items.length) {
					const first = items[0],
						last = items[items.length - 1];
					if (e.shiftKey && document.activeElement === first) {
						e.preventDefault();
						last.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first.focus();
					}
				}
			}
		}
	});
	window.addEventListener("beforeunload", (ev) => {
		if (store.dirty) {
			ev.preventDefault();
			ev.returnValue = "";
		}
	});
	/* storage events only fire in OTHER tabs — one arriving for the working-copy key means
     a second tab is editing, and last-writer-wins on the autosave. Warn once. */
	let otherTabWarned = false;
	window.addEventListener("storage", (e) => {
		if (
			e.key === LS_KEY &&
			e.newValue !== null &&
			store.doc &&
			!otherTabWarned
		) {
			otherTabWarned = true;
			toast(
				"SiteGraph is open in another tab. Both tabs autosave to the same working copy, so edits in one can overwrite the other.",
				true,
			);
		}
	});
	/* service worker: makes the app itself load offline (and installable). https/localhost only — file:// can't register one. */
	if (
		"serviceWorker" in navigator &&
		(location.protocol === "https:" || location.hostname === "localhost")
	) {
		navigator.serviceWorker.register("sw.js").catch(() => {});
	}
	window.addEventListener("resize", () => {
		if (currentTab === "topology" && store.doc) drawTopo(true);
	});

	/* boot: restore working copy if valid, else start card */
	restoreUI();
	applyTheme();

	/* refresh department datalist whenever a person editor might need it */
	const dl = $("#deptList"),
		cl = $("#cableCatList");
	const refreshLists = () => {
		if (!store.doc) return;
		const d = [
			...new Set(
				store.doc.nodes
					.filter((n) => n.type === "person" || n.type === "device")
					.map((n) => n.attrs.department)
					.filter(Boolean),
			),
		].sort();
		dl.innerHTML = d.map((x) => `<option value="${esc(x)}">`).join("");
		const cats = new Set(["Ethernet", "Fiber", "Other"]);
		for (const e of store.doc.edges)
			if (e.type === "connected_to" && e.attrs?.category)
				cats.add(e.attrs.category);
		cl.innerHTML = [...cats]
			.sort()
			.map((x) => `<option value="${esc(x)}">`)
			.join("");
	};

	(async () => {
		let restored = false;
		try {
			let raw = localStorage.getItem(LS_KEY);
			if (!raw) {
				raw = await dbGet(LS_KEY);
				if (raw)
					try {
						localStorage.setItem(LS_KEY, raw);
					} catch (e) {}
			}
			if (raw) {
				const doc = JSON.parse(raw);
				if (!validateDoc(doc).length) {
					store.doc = doc;
					store.fileName = null;
					store.dirty = true;
					buildIndex();
					buildSearchIndex();
					restored = true;
				} else {
					/* never silently destroy unsaved work — set it aside; the start screen offers it back */
					try {
						localStorage.setItem(LS_QUAR, raw);
						dbSet(LS_QUAR, raw);
					} catch (e) {}
					localStorage.removeItem(LS_KEY);
					dbDel(LS_KEY);
				}
			}
		} catch (e) {}
		renderFileStatus();
		renderAll();
		if (restored)
			toast(
				"Restored unsaved working copy from this browser — Save writes it to disk",
			);
		refreshLists();
	})();

	const oldAfter = afterMutate;
	setAfterMutate(() => {
		oldAfter();
		refreshLists();
	});
}
if (typeof document !== "undefined")
	window.addEventListener("DOMContentLoaded", init);
/* Public API: module exports for the headless test suites; window.SiteGraph in the
   browser for console inspection and DOM-level tests. */
const PUBLIC_API = {
	validateDoc,
	parseCidr,
	isIp4,
	ip4ToInt,
	intToIp4,
	cidrHasHost,
	SAMPLE,
	blankDoc,
	store,
	buildIndex,
	computeImpact,
	deleteNode,
	mutate,
	performUndo,
	makeNode,
	NODE_TYPES,
	EDGE_TYPES,
	hiddenCols,
	deviceJack,
	ifacesOf,
	linkOf,
	ipsOf,
	deviceEditor,
	openEditor,
	connectForm,
	renderAll,
	closeTopOverlay,
};
export { PUBLIC_API, placeMenu };
if (typeof window !== "undefined") window.SiteGraph = PUBLIC_API;
