import { $, $$, currentTab, showAllRows, reopenColMenu, sortState, filters, theme, hiddenCols, renderFileStatus, buildSearchIndex, searchTokens, matchesSearch, adoptDoc, showLoadErrors, parseAndAdopt, openFile, saveFile, newSite, TABS, applyTheme, visCols, colMenuItems, bindContentEvents, toast, setShowAllRows, isUnplaced, isUnconnected, COLS, COLSETS, nodeKindLabel, locPath, badgeOf, firstIpInt, deviceJack, describeIfaceTarget, locationOf, rackOf, userOf, ipsOf, prefixOfIp, assignmentOfIp, ifacesOf, sortRows, tableHtml, capNote, applyCap, setSearchStats, ROW_LIMIT, vlanOf, NO_MATCH_MSG, persistUI } from './ui-state.js';
import { store, nodesOfType, nodeById, outE, ownerOf, linkOf } from './store.js';
import { ENUMS, GATEWAY_ROLES } from './schema.js';
import { esc, clone } from './utils.js';
import { parseCidr } from './ipv4.js';
import { renderAll } from './ui-layout.js';

function renderDevices(content) {
	const tokens = searchTokens();
	const all = nodesOfType("device");
	const unplaced = all.filter((d) => isUnplaced(d.id));
	const unconnected = all.filter((d) => isUnconnected(d.id));
	let rows = all.filter(
		(n) =>
			matchesSearch(n.id, tokens) &&
			(!filters.role || n.attrs.role === filters.role) &&
			(!filters.dept || n.attrs.department === filters.dept) &&
			(!filters.unplaced || isUnplaced(n.id)) &&
			(!filters.unconnected || isUnconnected(n.id)),
	);
	setSearchStats(rows.length);
	sortRows(rows, COLS.devices, sortState.devices);
	const depts = [
		...new Set(all.map((n) => n.attrs.department).filter(Boolean)),
	].sort();
	const shown = applyCap(rows);
	content.innerHTML = `<div class="table-pad">
    <div class="section-title section-title--gap">All Devices (${all.length}) <span class="count-note">· ${unplaced.length} unplaced · ${unconnected.length} with no connection</span><span class="line"></span></div>
    <div class="filters-row">
      <select class="filter filter-role" id="fRole"><option value="">All roles</option>${ENUMS.role.map((r) => `<option${filters.role === r ? " selected" : ""}>${r}</option>`).join("")}</select>
      <select class="filter" id="fDept"><option value="">All departments</option>${depts.map((d) => `<option${filters.dept === d ? " selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <label class="filter"><input type="checkbox" id="fUnp"${filters.unplaced ? " checked" : ""}> unplaced</label>
      <label class="filter"><input type="checkbox" id="fUnc"${filters.unconnected ? " checked" : ""}> no connection</label>
    </div>
    ${rows.length ? tableHtml(visCols("devices", COLS.devices), shown, sortState.devices, "devices", "", "devices") : `<div class="empty">${NO_MATCH_MSG}</div>`}
    ${!showAllRows && rows.length > ROW_LIMIT ? capNote(rows.length) : ""}</div>`;
	$("#fRole").onchange = (e) => {
		filters.role = e.target.value;
		persistUI();
		renderAll();
	};
	const fd = $("#fDept");
	if (fd)
		fd.onchange = (e) => {
			filters.dept = e.target.value;
			persistUI();
			renderAll();
		};
	const fUnp = $("#fUnp");
	if (fUnp) {
		fUnp.checked = !!filters.unplaced;
		fUnp.onchange = (e) => {
			filters.unplaced = e.target.checked;
			persistUI();
			renderAll();
		};
	}
	const fUnc = $("#fUnc");
	if (fUnc) {
		fUnc.checked = !!filters.unconnected;
		fUnc.onchange = (e) => {
			filters.unconnected = e.target.checked;
			persistUI();
			renderAll();
		};
	}
}

function renderLocations(content) {
	const tokens = searchTokens();
	const locs = nodesOfType("location");
	const racks = nodesOfType("rack");
	const devInRoom = (id) =>
		store.doc.nodes.filter(
			(n) =>
				n.type === "device" && !rackOf(n.id) && locationOf(n.id)?.id === id,
		);
	const pplInRoom = (id) =>
		store.doc.nodes.filter(
			(n) => n.type === "person" && locationOf(n.id)?.id === id,
		);
	const kidsOf = (id) => locs.filter((l) => locationOf(l.id)?.id === id);
	const slotsOf = (r) =>
		store.doc.edges
			.filter((e) => e.type === "mounted_in" && e.to === r.id)
			.map((e) => ({ dev: nodeById(e.from), u: (e.attrs || {}).rackU }))
			.sort((a, b) => (b.u ?? -1) - (a.u ?? -1)); /* top of rack first */
	const hitBy = (id) => matchesSearch(id, tokens);
	let matchCount = 0;

	const rackCard = (r) => {
		const slots = slotsOf(r);
		const home = locationOf(r.id);
		const hit =
			!tokens.length || hitBy(r.id) || slots.some((s) => hitBy(s.dev.id));
		if (hit && tokens.length) matchCount++;
		return `<div class="rack-card${hit ? "" : " row-dim"}">
      <button class="rack-card-head" data-open="${r.id}">
        <b>${esc(r.name)}</b><span class="dim">· ${r.attrs.heightU}U</span>
        <span class="spacer"></span>
        ${home ? `<span class="dim">${esc(home.name)}</span>` : '<span class="badge b-warn">unplaced</span>'}
      </button>
      ${
				slots
					.map(
						(s) => `<button class="rack-slot" data-open="${s.dev.id}">
          <span class="u">${s.u !== undefined ? "U" + s.u : "U?"}</span>
          <span class="nm">${esc(s.dev.name)}</span>
          <span class="role">${esc(nodeKindLabel(s.dev))}</span></button>`,
					)
					.join("") || '<div class="rack-empty">empty</div>'
			}
    </div>`;
	};

	const ss = sortState.locations;
	const roomList = [...locs];
	if (ss.key === "type")
		roomList.sort(
			(a, b) =>
				String(a.attrs.locationType).localeCompare(b.attrs.locationType) ||
				a.name.localeCompare(b.name),
		);
	else if (ss.key === "devices")
		roomList.sort(
			(a, b) =>
				devInRoom(b.id).length - devInRoom(a.id).length ||
				a.name.localeCompare(b.name),
		);
	else
		roomList.sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true }),
		);

	const ipTextOf = (d) => {
		const ips = ipsOf(d.id);
		return ips.length
			? ips[0].ip.name + (ips.length > 1 ? ", ..." : "")
			: d.attrs.ipAssignment;
	};
	const devEntry = (d) => `<button class="room-dev" data-open="${d.id}">
    <span><b>${esc(d.name)}</b> <span class="dim">${esc(d.attrs.role)}</span></span>
    <span class="mono dim">${esc(ipTextOf(d))}</span></button>`;

	const pnlInRoom = (id) =>
		store.doc.nodes.filter(
			(n) =>
				n.type === "patch_panel" &&
				!rackOf(n.id) &&
				locationOf(n.id)?.id === id,
		);
	const roomCard = (l) => {
		const devs = devInRoom(l.id).sort((a, b) => a.name.localeCompare(b.name));
		const ppl = pplInRoom(l.id),
			kids = kidsOf(l.id),
			pnls = pnlInRoom(l.id);
		const rk = racks.filter((r) => locationOf(r.id)?.id === l.id);
		const hit =
			!tokens.length ||
			hitBy(l.id) ||
			devs.some((d) => hitBy(d.id)) ||
			ppl.some((p) => hitBy(p.id)) ||
			pnls.some((p) => hitBy(p.id));
		if (hit && tokens.length) matchCount++;
		const path = locPath(l.id);
		return `<div class="room-card${hit ? "" : " row-dim"}">
      <div class="room-head">
        <button class="room-name" data-open="${l.id}">${esc(l.name)}</button>
        <span class="badge b-loc">${esc(l.attrs.locationType)}</span>
        <span class="dim mono">${devs.length} device${devs.length === 1 ? "" : "s"}${rk.length ? ` · ${rk.length} rack${rk.length === 1 ? "" : "s"}` : ""}</span>
        <span class="spacer"></span>
        ${path.length ? `<span class="dim">in ${esc(path.join(" › "))}</span>` : ""}
      </div>
      ${
				kids.length || ppl.length || pnls.length
					? `<div class="room-sub">
        ${kids.length ? `<span>contains:</span> ${kids.map((k) => `<button class="chip-link" data-open="${k.id}">${esc(k.name)}</button>`).join("")}` : ""}
        ${pnls.length ? `<span>panels:</span> ${pnls.map((p) => `<button class="chip-link" data-open="${p.id}">${esc(p.name)} · ${p.attrs.jackCount}j</button>`).join("")}` : ""}
        ${ppl.length ? `<span>people:</span> ${ppl.map((p) => `<button class="chip-link" data-open="${p.id}">${esc(p.name)}</button>`).join("")}` : ""}
      </div>`
					: ""
			}
      ${
				devs.length
					? `<div class="room-grid">${devs.map(devEntry).join("")}</div>`
					: rk.length
						? ""
						: '<div class="rack-empty">no unracked devices here</div>'
			}
    </div>`;
	};

	const unplacedDevs = store.doc.nodes.filter(
		(n) => n.type === "device" && isUnplaced(n.id),
	);
	setSearchStats(matchCount, "matching card", "matching cards");

	const rs = sortState.racks;
	const mountedCount = (r) =>
		store.doc.edges.filter((e) => e.type === "mounted_in" && e.to === r.id)
			.length;
	const rackStripOrder = racks.toSorted((a, b) => {
		if (rs.key === "name")
			return a.name.localeCompare(b.name, undefined, { numeric: true });
		if (rs.key === "devices")
			return mountedCount(b) - mountedCount(a) || a.name.localeCompare(b.name);
		return (
			(locationOf(a.id)?.name || "~").localeCompare(
				locationOf(b.id)?.name || "~",
			) || a.name.localeCompare(b.name)
		);
	});

	content.innerHTML = `<div class="table-pad">
    <div class="filters-row">
      <select class="filter" id="rackSort">
        <option value="room"${rs.key === "room" ? " selected" : ""}>Racks: by location</option>
        <option value="name"${rs.key === "name" ? " selected" : ""}>Racks: A → Z</option>
        <option value="devices"${rs.key === "devices" ? " selected" : ""}>Racks: most devices</option>
      </select>
      <select class="filter" id="locSort">
        <option value="name"${ss.key === "name" ? " selected" : ""}>Locations: A → Z</option>
        <option value="type"${ss.key === "type" ? " selected" : ""}>Locations: by type</option>
        <option value="devices"${ss.key === "devices" ? " selected" : ""}>Locations: most devices</option>
      </select>
    </div>
    ${
			racks.length
				? `<div class="section-title">Racks (${racks.length})<span class="line"></span></div>
      <div class="rack-strip">${rackStripOrder.map(rackCard).join("")}</div>`
				: ""
		}
    ${
			roomList.length
				? `<div class="section-title section-title--gap">Locations (${roomList.length})<span class="line"></span></div>
      ${roomList.map(roomCard).join("")}`
				: ""
		}
    ${
			unplacedDevs.length
				? `<div class="section-title section-title--gap">Unplaced (${unplacedDevs.length})<span class="line"></span></div>
      <div class="room-card"><div class="room-grid">${unplacedDevs
				.map(
					(d) =>
						`<button class="room-dev" data-open="${d.id}"><span><b>${esc(d.name)}</b> <span class="dim">${esc(d.attrs.role)}</span></span><span class="badge b-warn">unplaced</span></button>`,
				)
				.join("")}</div></div>`
				: ""
		}
    ${!racks.length && !roomList.length ? `<div class="empty">${NO_MATCH_MSG}</div>` : ""}
  </div>`;
	$("#rackSort").onchange = (e) => {
		sortState.racks = { key: e.target.value, dir: 1 };
		persistUI();
		renderAll();
	};
	$("#locSort").onchange = (e) => {
		sortState.locations = { key: e.target.value, dir: 1 };
		persistUI();
		renderAll();
	};
}

function renderConnections(content) {
	const tokens = searchTokens();
	let circuits = nodesOfType("circuit").filter((n) =>
		matchesSearch(n.id, tokens),
	);
	sortRows(circuits, COLS.circuits, sortState.circuits);
	let cables = store.doc.edges
		.filter((e) => e.type === "connected_to")
		.map((e) => {
			const a = nodeById(e.from),
				b = nodeById(e.to),
				da = nodeById(ownerOf(e.from)),
				db = nodeById(ownerOf(e.to));
			return { id: "", conn: e.from, e, a, b, da, db };
		})
		.filter(
			(x) =>
				!tokens.length ||
				tokens.every((t) =>
					`${x.da?.name} ${x.a.name} ${x.db?.name} ${x.b.name} ${x.e.attrs?.cableColor || ""} ${x.e.attrs?.jack || ""} ${vlanOf(x.a)} ${vlanOf(x.b)}`
						.toLowerCase()
						.includes(t),
				),
		);
	sortRows(cables, COLS.connections, sortState.connections);
	const total = circuits.length + cables.length;
	setSearchStats(total);
	const free = store.doc.nodes.filter(
		(n) => n.type === "interface" && !linkOf(n.id),
	).length;
	content.innerHTML = `<div class="table-pad">
    <div class="section-title">Circuits (${circuits.length})<span class="line"></span></div>
    ${tableHtml(
			visCols("circuits", COLS.circuits),
			circuits,
			sortState.circuits,
			"circuits",
			"No circuits documented. <b>+ Add ▾ → Circuit</b> for internet, SIP, MPLS and other provider services.",
			"circuits",
		)}
    <div class="section-title section-title--gap">Links (${cables.length})
      <span class="count-note">· ${free} free ports</span><span class="line"></span></div>
    ${tableHtml(
			visCols("connections", COLS.connections),
			cables,
			sortState.connections,
			"connections",
			"No links documented. <b>+ Add ▾ → Connection</b> joins two free ports; ports live on each device.",
			"connections",
		)}</div>`;
}
function renderIpam(content) {
	const tokens = searchTokens();
	let pfx = nodesOfType("prefix").filter((n) => matchesSearch(n.id, tokens));
	let ips = nodesOfType("ip_address").filter((n) =>
		matchesSearch(n.id, tokens),
	);
	setSearchStats(pfx.length + ips.length);
	sortRows(pfx, COLS.prefixes, sortState.prefixes);
	sortRows(ips, COLS.ips, sortState.ips);
	const unassigned = store.doc.nodes.filter(
		(n) => n.type === "ip_address" && !assignmentOfIp(n.id),
	).length;
	content.innerHTML = `<div class="table-pad">
    <div class="section-title">Prefixes (${pfx.length})<span class="line"></span></div>
    ${tableHtml(visCols("prefixes", COLS.prefixes), pfx, sortState.prefixes, "prefixes", "No prefixes. <b>+ Add ▾ → Prefix</b>, e.g. 10.0.10.0/24.", "prefixes")}
    <div class="section-title section-title--gap">IP addresses (${ips.length}) ${unassigned ? `<span class="count-note">· ${unassigned} unassigned</span>` : ""}<span class="line"></span></div>
    ${tableHtml(visCols("ips", COLS.ips), applyCap(ips), sortState.ips, "ips", "No IP addresses documented. Every IP belongs to exactly one prefix.", "ips")}
    ${!showAllRows && ips.length > ROW_LIMIT ? capNote(ips.length) : ""}</div>`;
}

function renderPeople(content) {
	const tokens = searchTokens();
	let rows = nodesOfType("person").filter((n) => matchesSearch(n.id, tokens));
	setSearchStats(rows.length);
	sortRows(rows, COLS.people, sortState.people);
	content.innerHTML = `<div class="table-pad">\n    <div class="section-title">People (${rows.length})<span class="line"></span></div>\n    ${tableHtml(visCols("people", COLS.people), rows, sortState.people, "people", "No people documented. <b>+ Add ▾ → Person</b>.", "people")}</div>`;
}

/* ================================================================
   FORMS & EDITORS — fieldsets, chip-add optional fields, quick connect
   ================================================================ */

export { renderDevices, renderLocations, renderConnections, renderIpam, renderPeople };
