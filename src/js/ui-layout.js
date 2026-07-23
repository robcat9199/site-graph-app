import { $, currentTab, reopenColMenu, setSearchStats, toast, adoptDoc, openFile, newSite, renderNav, setShowAllRows, LS_QUAR, setReopenColMenu } from './ui-state.js';
import { store, SAMPLE } from './store.js';
import { renderDevices, renderLocations, renderConnections, renderIpam, renderPeople } from './ui-tables.js';
import { renderTopoTab, topo } from './topology.js';
import { downloadText } from './ui-forms.js';
import { clone } from './utils.js';
import { placeMenu } from './main.js';

export function renderAll() {
	renderNav();
	if (currentTab !== "topology") topo?.sim?.stop();
	const content = $("#content");
	content.classList.toggle("map-mode", currentTab === "topology");
	if (!store.doc) {
		renderStart(content);
		setSearchStats();
		return;
	}
	$("#siteName").textContent = store.doc.meta.site.name;
	if (currentTab === "topology") {
		renderTopoTab(content);
		setSearchStats();
		return;
	}
	const R = {
		devices: renderDevices,
		locations: renderLocations,
		connections: renderConnections,
		ipam: renderIpam,
		people: renderPeople,
	};
	// Anchor the gear button's visual X position across column add/remove.
	// Saving raw scrollLeft only works for removals — additions shift the gear button
	// further right by the new column width, causing the menu to drift off-screen.
	// Instead: record where the gear button sits in the viewport, then after
	// re-render compute the scrollLeft that puts it back at exactly that X.
	const savedNs = reopenColMenu;
	const scroller = content.querySelector(".table-pad");
	const gearBtn = savedNs ? content.querySelector(`[data-colns="${savedNs}"]`) : null;
	const gearVisualLeft = gearBtn ? gearBtn.getBoundingClientRect().left : null;
	const savedScrollTop = scroller ? scroller.scrollTop : 0;

	try {
		content.innerHTML = "";
		R[currentTab]?.(content);
	} catch (err) {
		content.innerHTML = `<div class="empty" style="color:var(--c-warn);text-align:left;padding:2rem;"><b>Render Error:</b> ${err.message}<br><br><pre style="white-space:pre-wrap;font-size:11px;">${err.stack}</pre></div>`;
		console.error("Render error:", err);
	}
	if (reopenColMenu) {
		const m = $("#colmenu-" + reopenColMenu);
		if (m) {
			m.classList.add("open");
			placeMenu(m);
		}
		setReopenColMenu(null);
		const newScroller = content.querySelector(".table-pad");
		if (newScroller) {
			newScroller.scrollTop = savedScrollTop;
			if (gearVisualLeft !== null) {
				// After innerHTML wipe, newScroller.scrollLeft is 0.
				// naturalLeft = gear button's left edge in viewport at scrollLeft=0.
				// We want it to appear at gearVisualLeft, so:
				// desiredScrollLeft = naturalLeft - gearVisualLeft
				const newGearBtn = content.querySelector(`[data-colns="${savedNs}"]`);
				if (newGearBtn) {
					const naturalLeft = newGearBtn.getBoundingClientRect().left;
					newScroller.scrollLeft = Math.max(0, naturalLeft - gearVisualLeft);
				}
			}
		}
	}
	const btn = $("#showAllRowsBtn");
	if (btn) {
		btn.onclick = () => {
			setShowAllRows(true);
			renderAll();
		};
	}
}
export function renderStart(content) {
	$("#siteName").textContent = "—";
	content.innerHTML = `<div class="start">
    <div class="kicker">Network source of truth</div>
    <h2>SiteGraph</h2>
    <p>Offline network &amp; asset documentation. One HTML file, one JSON file per site, no server. Files are validated on load — invalid files are rejected with a full error report.</p>
    <button class="btn primary" id="stOpen">Open data.json…</button>
    <button class="btn" id="stNew">New site</button>
    <button class="btn quiet" id="stSample">Load sample site</button>
    <div class="note">Everything works offline. The app keeps a local copy of itself and the map engine after the first load. A working copy autosaves to this browser after every change.</div>
    <div class="note" id="stQuarNote" style="display:none">⚠ An unsaved working copy from an earlier visit failed validation and was set aside instead of restored.
      <button class="btn quiet" id="stQuarSave">Download it</button>
      <button class="btn quiet" id="stQuarDrop">Discard it</button></div></div>`;
	$("#stOpen").onclick = openFile;
	$("#stNew").onclick = newSite;
	$("#stSample").onclick = () => {
		adoptDoc(clone(SAMPLE), null, null, { dirty: true });
		toast("Sample site loaded");
	};
	let quar = null;
	try {
		quar = localStorage.getItem(LS_QUAR);
	} catch (e) {}
	if (quar) {
		$("#stQuarNote").style.display = "";
		$("#stQuarSave").onclick = () =>
			downloadText(
				quar,
				"sitegraph-quarantined-working-copy.json",
				"application/json",
			);
		$("#stQuarDrop").onclick = () => {
			try {
				localStorage.removeItem(LS_QUAR);
			} catch (e) {}
			$("#stQuarNote").remove();
			toast("Quarantined copy discarded");
		};
	}
}


