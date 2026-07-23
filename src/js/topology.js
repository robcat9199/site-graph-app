import * as d3 from 'd3';
import { $, searchTokens, matchesSearch, persistUI } from './ui-state.js';
import { store, nodeById, ownerOf, outE } from './store.js';
import { NODE_TYPES, GATEWAY_ROLES, SWITCH_ROLES } from './schema.js';
import { openEditor } from './ui-forms.js';

/* ================================================================
   TOPOLOGY — d3-force blueprint view (d3 from CDN, cached locally)
   ================================================================ */
const CAT = {
	gateway: { label: "Gateways", color: "#ff7a6e", r: 13 },
	switch: { label: "Switches", color: "#ffc65c", r: 11 },
	device: { label: "Devices", color: "#7fb6ff", r: 7 },
	location: { label: "Locations", color: "#9fb0cd", r: 9 },
	rack: { label: "Racks", color: "#8296bd", r: 7.5 },
	network: { label: "Networks", color: "#b79bff", r: 10 },
	person: { label: "People", color: "#8fe3a1", r: 8 },
};
const TOPO_HALO = "#0e1f45"; /* text halo matches the map's fixed dark canvas */
const EDGE_STYLES = {
	conn: {
		color: "#7fb6ff",
		w: 1.6,
		dash: null,
		label: (e) =>
			e
				? `${nodeById(e.from)?.name || ""} → ${nodeById(e.to)?.name || ""}`
				: "",
	},
	place: { color: "#5a76b8", w: 1, dash: "2 4", label: () => "" },
	net: { color: "#b79bff", w: 1.2, dash: "7 5", label: () => "" },
	use: { color: "#8fe3a1", w: 1.1, dash: "1 4 7 4", label: () => "" },
};
const catOf = (n) =>
	n.type === "device"
		? GATEWAY_ROLES.includes(n.attrs.role)
			? "gateway"
			: SWITCH_ROLES.includes(n.attrs.role)
				? "switch"
				: "device"
		: n.type === "location"
			? "location"
			: n.type === "rack"
				? "rack"
				: n.type === "prefix"
					? "network"
					: n.type === "person"
						? "person"
						: null;
const topoToggles = {
	gateway: true,
	switch: true,
	device: true,
	location: false,
	rack: false,
	network: true,
	person: true,
};
let topo = null; /* { sim, nodes, zoom, svg, centerOn, currentTransform } */

/* interfaces & IPs never render — device↔device and device↔prefix are derived projections */
function buildTopoGraph() {
	const nodes = [],
		links = [],
		byId2 = new Map();
	for (const n of store.doc.nodes) {
		const cat = catOf(n);
		if (!cat || !topoToggles[cat]) continue;
		byId2.set(n.id, { id: n.id, node: n, cat });
		nodes.push(byId2.get(n.id));
	}
	const seen = new Map();
	const addLink = (a, b, kind, edge) => {
		if (!byId2.has(a) || !byId2.has(b) || a === b) return;
		const key = [kind, ...[a, b].sort()].join("|");
		if (seen.has(key)) {
			seen.get(key).n++;
			return;
		}
		const l = { id: key, source: a, target: b, kind, edge, n: 1 };
		seen.set(key, l);
		links.push(l);
	};
	for (const e of store.doc.edges) {
		if (e.type === "connected_to")
			addLink(ownerOf(e.from), ownerOf(e.to), "conn", e);
		else if (e.type === "located_in") addLink(e.from, e.to, "place", e);
		else if (e.type === "mounted_in") addLink(e.from, e.to, "place", e);
		else if (e.type === "used_by") addLink(e.from, e.to, "use", e);
		else if (e.type === "assigned_to") {
			const dev = nodeById(e.to)?.type === "device" ? e.to : ownerOf(e.to);
			const pfx = (outE(e.from, "member_of")[0] || {}).to;
			if (dev && pfx) addLink(dev, pfx, "net", null);
		}
	}
	const degree = new Map();
	for (const l of links) {
		degree.set(l.source, (degree.get(l.source) || 0) + 1);
		degree.set(l.target, (degree.get(l.target) || 0) + 1);
	}
	for (const n of nodes)
		n.r = CAT[n.cat].r + Math.min(6, (degree.get(n.id) || 0) * 0.7);
	return { nodes, links };
}

/* d3 loader: D3 is now inlined in the compiled index.html during compilation,
   making it 100% self-contained and available offline immediately. */
function ensureD3() {
	return Promise.resolve();
}

function renderTopoTab(content) {
	const legendOpen =
		topoToggles.legendOpen !== undefined
			? topoToggles.legendOpen
			: !(
					window.matchMedia && window.matchMedia("(max-width: 47.5em)").matches
				);
	content.innerHTML = `<div class="topo-wrap">
    <svg class="topo-svg" id="topoSvg"></svg>
    <details class="topo-controls"${legendOpen ? " open" : ""}>
      <summary>Legend &amp; filters</summary>
      <div class="tc-title">Node types</div>
      ${Object.entries(CAT)
				.map(
					([
						k,
						c,
					]) => `<label><input type="checkbox" data-cat="${k}"${topoToggles[k] ? " checked" : ""}>
        <span class="swatch" style="background:${c.color}"></span>${c.label}</label>`,
				)
				.join("")}
      <div class="tc-title">Edges</div>
      ${Object.entries(EDGE_STYLES)
				.map(
					([k, s]) => `<div class="edge-key">
        <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="${s.color}" stroke-width="${s.w + 0.4}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/></svg>
        ${{ conn: "CONNECTED", place: "LOCATED / MOUNTED", net: "NETWORK", use: "USED_BY" }[k]}</div>`,
				)
				.join("")}
      <div class="topo-legendnote">Scroll to zoom<br>Drag to pan<br>Hover to trace<br>Click to edit<br>Search + Enter jumps to first hit<br>Drifting nodes are orphans</div>
    </details>
    <div class="zoom-controls"><button id="zIn" title="Zoom in">+</button><button id="zOut" title="Zoom out">−</button><button id="zFit" title="Fit">⌂</button></div>
    <div class="topo-msg" id="topoMsg"><div>Loading the map engine (d3, one-time download — cached for offline use after)…</div></div>
  </div>`;
	content.querySelectorAll("[data-cat]").forEach(
		(cb) =>
			(cb.onchange = () => {
				topoToggles[cb.dataset.cat] = cb.checked;
				persistUI();
				drawTopo(true);
			}),
	);
	content.querySelector(".topo-controls").addEventListener("toggle", (ev) => {
		topoToggles.legendOpen = ev.target.open;
		persistUI();
	});
	ensureD3()
		.then(() => {
			$("#topoMsg")?.remove();
			drawTopo(false);
		})
		.catch(() => {
			const m = $("#topoMsg");
			if (m)
				m.innerHTML = `<div>The topology map couldn't load its drawing engine (d3).<br>
        Connect to the internet once — it will be cached for offline use after that.<br>
        Every other part of SiteGraph keeps working offline.</div>
        <button class="btn" id="topoRetry">Retry</button>`;
			const r = $("#topoRetry");
			if (r) r.onclick = () => renderTopoTab(content);
		});
}

function drawTopo(preserve) {
	const svgEl = $("#topoSvg");
	if (!svgEl || !d3 || !store.doc) return;
	const prevTransform = preserve && topo ? topo.currentTransform : null;
	const prevPos =
		preserve && topo
			? new Map(topo.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
			: null;
	if (topo && topo.sim) topo.sim.stop();

	const rect = svgEl.getBoundingClientRect();
	const W = rect.width || 1000,
		H = rect.height || 640;
	const { nodes, links } = buildTopoGraph();
	for (const n of nodes) {
		const p = prevPos ? prevPos.get(n.id) : null;
		if (p) {
			n.x = p.x;
			n.y = p.y;
		}
	}

	const adj = new Map();
	nodes.forEach((n) => adj.set(n.id, new Set([n.id])));
	links.forEach((l) => {
		adj.get(l.source)?.add(l.target);
		adj.get(l.target)?.add(l.source);
	});

	const svg = d3.select(svgEl);
	svg.selectAll("*").remove();
	const defs = svg.append("defs");
	for (const [t, s] of Object.entries(EDGE_STYLES))
		defs
			.append("marker")
			.attr("id", "arr-" + t)
			.attr("viewBox", "0 -4 8 8")
			.attr("refX", 4)
			.attr("markerWidth", 7)
			.attr("markerHeight", 7)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-3.4L8,0L0,3.4")
			.attr("fill", s.color)
			.attr("opacity", 1);
	defs
		.append("pattern")
		.attr("id", "topoGrid")
		.attr("width", 60)
		.attr("height", 60)
		.attr("patternUnits", "userSpaceOnUse")
		.append("path")
		.attr("d", "M60 0H0V60")
		.attr("fill", "none")
		.attr("stroke", "#7d95cf")
		.attr("stroke-width", 0.5);
	const viewport = svg.append("g");
	viewport
		.append("rect")
		.attr("x", -1200)
		.attr("y", -1200)
		.attr("width", 4800)
		.attr("height", 3800)
		.attr("fill", "url(#topoGrid)")
		.attr("opacity", 0.1);

	const linkSel = viewport
		.append("g")
		.selectAll("path")
		.data(links, (l) => l.id)
		.join("path")
		.attr("fill", "none")
		.attr("stroke", (l) => EDGE_STYLES[l.kind].color)
		.attr(
			"stroke-width",
			(l) => EDGE_STYLES[l.kind].w + (l.n > 1 ? l.n * 0.7 : 0),
		)
		.attr("stroke-dasharray", (l) => EDGE_STYLES[l.kind].dash)
		.attr("marker-end", (l) => `url(#arr-${l.kind})`)
		.attr("opacity", 1);
	const edgeLabelSel = viewport
		.append("g")
		.selectAll("text")
		.data(
			links.filter((l) => EDGE_STYLES[l.kind].label(l.edge) || l.n > 1),
			(l) => l.id,
		)
		.join("text")
		.text(
			(l) =>
				(l.n > 1 ? "×" + l.n + " " : "") + EDGE_STYLES[l.kind].label(l.edge),
		)
		.attr("font-size", 8)
		.attr("font-family", "ui-monospace, monospace")
		.attr("fill", "#93a8d8")
		.attr("text-anchor", "middle")
		.attr("opacity", 0.85)
		.style("pointer-events", "none");

	const nodeSel = viewport
		.append("g")
		.selectAll("g")
		.data(nodes, (n) => n.id)
		.join("g")
		.style("cursor", "pointer");
	nodeSel
		.append("circle")
		.attr("class", "halo")
		.attr("r", (n) => n.r + 5)
		.attr("fill", "none")
		.attr("stroke", "#fff")
		.attr("stroke-width", 1.5)
		.attr("opacity", 0);
	nodeSel
		.append("circle")
		.attr("r", (n) => n.r)
		.attr("fill", (n) => CAT[n.cat].color)
		.attr("stroke", TOPO_HALO)
		.attr("stroke-width", 1.5);
	nodeSel
		.append("text")
		.text((n) =>
			n.node.name.length > 24 ? n.node.name.slice(0, 23) + "…" : n.node.name,
		)
		.attr("y", (n) => n.r + 12)
		.attr("text-anchor", "middle")
		.attr("fill", "#dfe6f5")
		.attr("font-size", 9.5)
		.attr("font-family", "system-ui, sans-serif")
		.attr("font-weight", 500)
		.style("paint-order", "stroke")
		.style("stroke", TOPO_HALO)
		.style("stroke-width", 2)
		.style("stroke-linejoin", "round")
		.style("pointer-events", "none");
	nodeSel
		.append("title")
		.text(
			(n) =>
				`${NODE_TYPES[n.node.type].label}: ${n.node.name}${n.node.type === "device" ? " · " + n.node.attrs.role : ""}`,
		);

	const sim = d3
		.forceSimulation(nodes)
		.force("charge", d3.forceManyBody().strength(-650))
		.force(
			"link",
			d3
				.forceLink(links)
				.id((n) => n.id)
				.distance(
					(l) => ({ conn: 144, place: 120, net: 200, use: 230 })[l.kind] || 180,
				)
				.strength(0.5),
		)
		.force("center", d3.forceCenter(W / 2, H / 2))
		.force(
			"collide",
			d3
				.forceCollide()
				.radius((n) => n.r + 22)
				.strength(0.8),
		)
		.force("x", d3.forceX(W / 2).strength(0.03))
		.force("y", d3.forceY(H / 2).strength(0.03));
	const arcPath = (l) => {
		const dx = l.target.x - l.source.x,
			dy = l.target.y - l.source.y;
		const dist = Math.sqrt(dx * dx + dy * dy) || 1;
		const tr =
			(l.target.r || 8) + 7; /* trim so the arrowhead sits on the node rim */
		const tx = l.target.x - (dx / dist) * tr,
			ty = l.target.y - (dy / dist) * tr;
		const dr = dist * 2.1; /* gentle bow */
		return `M${l.source.x},${l.source.y} A${dr},${dr} 0 0,1 ${tx},${ty}`;
	};
	const paint = () => {
		linkSel.attr("d", arcPath);
		edgeLabelSel
			.attr("x", (l) => (l.source.x + l.target.x) / 2)
			.attr("y", (l) => (l.source.y + l.target.y) / 2 - 4);
		nodeSel.attr("transform", (n) => `translate(${n.x},${n.y})`);
	};
	sim.on("tick", paint);
	if (prevPos) sim.alpha(0.25);
	else {
		/* warmup: run the layout to convergence before first paint */
		sim.stop();
		let i = 0;
		while (sim.alpha() > sim.alphaMin() && ++i < 600) sim.tick();
		paint();
	}

	const REDUCED =
		window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const zoom = d3
		.zoom()
		.scaleExtent([0.05, 6])
		.extent([
			[0, 0],
			[W, H],
		])
		.on("start", () => svgEl.classList.add("panning"))
		.on("end", () => svgEl.classList.remove("panning"))
		.on("zoom", (ev) => {
			viewport.attr("transform", ev.transform);
			if (topo) topo.currentTransform = ev.transform;
			edgeLabelSel.attr(
				"display",
				ev.transform.k < 0.6 ? "none" : null,
			); /* declutter when zoomed out */
		});
	svg.call(zoom).on("dblclick.zoom", null);
	if (prevTransform) svg.call(zoom.transform, prevTransform);

	function zoomFit(dur) {
		if (!nodes.length) return;
		const xs = nodes.map((n) => n.x ?? W / 2),
			ys = nodes.map((n) => n.y ?? H / 2);
		const minX = Math.min(...xs) - 60,
			maxX = Math.max(...xs) + 60,
			minY = Math.min(...ys) - 60,
			maxY = Math.max(...ys) + 60;
		const k = Math.max(
			0.05,
			Math.min(2, 0.92 / Math.max((maxX - minX) / W, (maxY - minY) / H)),
		);
		const tx = W / 2 - (k * (minX + maxX)) / 2,
			ty = H / 2 - (k * (minY + maxY)) / 2;
		const t = d3.zoomIdentity.translate(tx, ty).scale(k);
		const d = dur ?? 450;
		if (!d || REDUCED) svg.call(zoom.transform, t);
		else svg.transition().duration(d).call(zoom.transform, t);
	}
	function centerOn(id) {
		const n = nodes.find((x) => x.id === id);
		if (!n) return;
		const k = Math.max(topo.currentTransform.k, 1.1);
		svg
			.transition()
			.duration(REDUCED ? 0 : 450)
			.call(
				zoom.transform,
				d3.zoomIdentity.translate(W / 2 - k * n.x, H / 2 - k * n.y).scale(k),
			);
		searchDim();
	}
	/* live search baseline: matches lit, everything else dimmed; no query = all lit.
     Cheap opacity pass — never rebuilds the SVG. Returns the match count. */
	function searchDim() {
		const tokens = searchTokens();
		if (!tokens.length) {
			nodeSel.attr("opacity", 1).select(".halo").attr("opacity", 0);
			linkSel.attr("opacity", 1);
			edgeLabelSel.attr("opacity", 0.85);
			return null;
		}
		const hit = new Set(
			nodes.filter((n) => matchesSearch(n.id, tokens)).map((n) => n.id),
		);
		nodeSel
			.attr("opacity", (n) => (hit.has(n.id) ? 1 : 0.12))
			.select(".halo")
			.attr("opacity", 0);
		linkSel.attr("opacity", (l) =>
			hit.has(l.source.id) || hit.has(l.target.id) ? 1 : 0.08,
		);
		edgeLabelSel.attr("opacity", (l) =>
			hit.has(l.source.id) || hit.has(l.target.id) ? 1 : 0.08,
		);
		return hit.size;
	}
	function applyEmphasis(id) {
		if (id === null)
			return searchDim(); /* hover releases to the search baseline */
		const keep = adj.get(id) || new Set([id]);
		nodeSel.attr("opacity", (n) => (keep.has(n.id) ? 1 : 0.12));
		nodeSel.select(".halo").attr("opacity", (n) => (n.id === id ? 0.9 : 0));
		linkSel.attr("opacity", (l) =>
			l.source.id === id || l.target.id === id ? 1 : 0.08,
		);
		edgeLabelSel.attr("opacity", (l) =>
			l.source.id === id || l.target.id === id ? 1 : 0.08,
		);
	}
	nodeSel
		.on("mouseenter", (ev, n) => applyEmphasis(n.id))
		.on("mouseleave", () => applyEmphasis(null));
	let dragMoved = false;
	nodeSel.call(
		d3
			.drag()
			.on("start", (ev, n) => {
				dragMoved = false;
				n.startX = ev.x;
				n.startY = ev.y;
				if (!ev.active) sim.alphaTarget(0.3).restart();
				n.fx = n.x;
				n.fy = n.y;
			})
			.on("drag", (ev, n) => {
				if (Math.hypot(ev.x - n.startX, ev.y - n.startY) > 5) {
					dragMoved = true;
				}
				n.fx = ev.x;
				n.fy = ev.y;
			})
			.on("end", (ev, n) => {
				if (!ev.active) sim.alphaTarget(0);
				n.fx = null;
				n.fy = null;
				if (!dragMoved) {
					centerOn(n.id);
					openEditor(n.id);
				}
			}),
	);
	$("#zIn").onclick = () =>
		svg
			.transition()
			.duration(REDUCED ? 0 : 200)
			.call(zoom.scaleBy, 1.35);
	$("#zOut").onclick = () =>
		svg
			.transition()
			.duration(REDUCED ? 0 : 200)
			.call(zoom.scaleBy, 1 / 1.35);
	$("#zFit").onclick = () => zoomFit();
	topo = {
		sim,
		nodes,
		zoom,
		svg,
		centerOn,
		zoomFit,
		searchDim,
		currentTransform: prevTransform || d3.zoomIdentity,
	};
	searchDim();
	if (!prevTransform) zoomFit(0);
}

export { topoToggles, topo, renderTopoTab, drawTopo, catOf };
