import { $, $$, currentTab, showAllRows, reopenColMenu, sortState, filters, theme, hiddenCols, renderFileStatus, buildSearchIndex, searchTokens, matchesSearch, adoptDoc, showLoadErrors, parseAndAdopt, openFile, saveFile, newSite, TABS, applyTheme, visCols, colMenuItems, bindContentEvents, toast, setShowAllRows, isUnplaced, isUnconnected, COLS, COLSETS, nodeKindLabel, locPath, badgeOf, firstIpInt, deviceJack, describeIfaceTarget, locationOf, rackOf, userOf, ipsOf, prefixOfIp, assignmentOfIp, ifacesOf, openOverlay, closeOverlay, FINE_POINTER } from './ui-state.js';
import { store, nodeById, nodesOfType, outE, inE, peerOf, ownerOf, mutate, pushHistory, uniqueId, linkOf, makeNode, setSingletonEdge, computeImpact, deleteNode, blankDoc, SAMPLE } from './store.js';
import { ENUMS, GATEWAY_ROLES, SWITCH_ROLES, PORT_GEN_ROLES, IP_DEFAULT_BY_ROLE, IP_EXPECTED_ROLES, INFRA_ROLES, NODE_TYPES, EDGE_TYPES, HISTORY_CAP, LOG_CAP, SCHEMA_VERSION } from './schema.js';
import { esc, clone, nowISO, slugify, fmtDate } from './utils.js';
import { ip4ToInt, parseCidr, isIp4, intToIp4, cidrHasHost } from './ipv4.js';

function fieldCtl(f) {
	const val = f.value ?? "";
	const req = f.required ? " required" : "";
	if (f.type === "enum" || f.type === "select") {
		const opts =
			f.type === "enum"
				? ENUMS[f.enum].map((v) => ({ v, l: v }))
				: f.options || [];
		return `<select data-k="${f.key}"${req}>${f.required ? (val === "" ? '<option value="">— select —</option>' : "") : '<option value="">— none —</option>'}${opts
			.map(
				(o) =>
					`<option value="${esc(o.v)}"${String(o.v) === String(val) ? " selected" : ""}>${esc(o.l)}</option>`,
			)
			.join("")}</select>`;
	}
	if (f.type === "bool")
		return `<select data-k="${f.key}"${req}><option value="">— unset —</option><option value="true"${val === true ? " selected" : ""}>yes</option><option value="false"${val === false ? " selected" : ""}>no</option></select>`;
	if (f.type === "textarea")
		return `<textarea data-k="${f.key}"${req}>${esc(val)}</textarea>`;
	return `<input data-k="${f.key}" type="${f.type === "int" ? "number" : "text"}"${f.type === "int" ? ' step="1"' : ""} value="${esc(val)}" placeholder="${esc(f.placeholder || "")}"${f.list ? ` list="${f.list}"` : ""}${f.disabled ? " disabled" : ""}${req}>`;
}
function fieldHtml(f, removable) {
	return `<div class="field${f.full ? " full" : ""}" data-fw="${f.key}">
    <label>${esc(f.label)}${removable ? `<button type="button" class="field-x" data-remf="${f.key}">remove</button>` : ""}</label>
    ${fieldCtl(f)}${f.help ? `<div class="hint">${esc(f.help)}</div>` : ""}</div>`;
}
/* ---------- custom fields helpers ---------- */
function collectCustomAttrs(o) {
	const custom = {};
	o.querySelectorAll(".custom-field-row").forEach((row) => {
		const key = row.querySelector("[data-custom-key]").value.trim();
		const rawVal = row.querySelector("[data-custom-val]").value.trim();
		if (key === "") return;
		let val = rawVal;
		if (val === "true") val = true;
		else if (val === "false") val = false;
		else if (/^\d+$/.test(val)) val = parseInt(val, 10);
		else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
		custom[key] = val;
	});
	return Object.keys(custom).length ? custom : undefined;
}

function attachCustomFieldsZone(o, node) {
	const fs = document.createElement("fieldset");
	fs.className = "fieldset custom-fields-fs";

	let rowsHtml = "";
	if (node && node.attrs && node.attrs.custom) {
		for (const [k, v] of Object.entries(node.attrs.custom)) {
			rowsHtml += `
        <div class="port-row custom-field-row">
          <input type="text" placeholder="Key" data-custom-key value="${esc(k)}" class="custom-key-input">
          <input type="text" placeholder="Value" data-custom-val value="${esc(v)}" class="custom-val-input">
          <button type="button" class="mini red remove-custom-field-btn custom-remove-btn">remove</button>
        </div>
      `;
		}
	}

	fs.innerHTML = `
    <legend>Custom Fields</legend>
    <div class="subrows custom-fields-rows">
      ${rowsHtml}
    </div>
    <button type="button" class="subrow-add add-custom-field-btn custom-add-btn">＋ Add custom field</button>
  `;

	const rowsContainer = fs.querySelector(".custom-fields-rows");
	const addBtn = fs.querySelector(".add-custom-field-btn");

	addBtn.onclick = () => {
		const row = document.createElement("div");
		row.className = "port-row custom-field-row";
		row.innerHTML = `
      <input type="text" placeholder="Key" data-custom-key class="custom-key-input">
      <input type="text" placeholder="Value" data-custom-val class="custom-val-input">
      <button type="button" class="mini red remove-custom-field-btn custom-remove-btn">remove</button>
    `;
		row.querySelector(".remove-custom-field-btn").onclick = () => row.remove();
		rowsContainer.appendChild(row);
		row.querySelector("[data-custom-key]").focus();
	};

	fs.querySelectorAll(".remove-custom-field-btn").forEach((btn) => {
		btn.onclick = (e) => e.target.closest(".custom-field-row").remove();
	});

	o.querySelector(".modal-actions").before(fs);
}

/* sections: [{legend, cols, fields, chips:[fields], adder}] — chips render as +pills until opened */
function openEditorForm({
	title,
	meta,
	sections,
	submitLabel,
	deleteLabel,
	onSubmit,
	onDelete,
	onDuplicate,
	historyOf,
	wide,
	showCustomFields,
	node,
}) {
	const html = sections
		.map((s, si) => {
			const openChips = (s.chips || []).filter(
				(f) => f.value !== undefined && f.value !== "" && f.value !== null,
			);
			const closedChips = (s.chips || []).filter((f) => !openChips.includes(f));
			openChips.sort((a, b) => a.label.localeCompare(b.label));
			closedChips.sort((a, b) => a.label.localeCompare(b.label));
			const body = `<div class="form-grid${s.cols === 3 ? " cols-3" : ""}">${(
				s.fields || []
			)
				.map((f) => fieldHtml(f, false))
				.join("")}${openChips.map((f) => fieldHtml(f, true)).join("")}</div>
      <div class="addfield-menu addfield-chips">${closedChips.map((f) => `<sg-chip class="chip-add" data-chip="${f.key}" label="${esc(f.chipLabel || f.label)}"></sg-chip>`).join("")}</div>`;
			if (
				s.adder &&
				!openChips.length &&
				!s.fields.some(
					(f) => f.value !== undefined && f.value !== "" && f.value !== null,
				)
			)
				return `<div class="section-adder" data-sec="${si}"><button type="button">＋ ${esc(s.legend)}</button></div>
        <fieldset class="fieldset" data-secbody="${si}" hidden><legend>${esc(s.legend)} <button type="button" class="legend-x" data-secx="${si}">remove</button></legend>${body}</fieldset>`;
			return `<fieldset class="fieldset"><legend>${esc(s.legend)}</legend>${body}</fieldset>`;
		})
		.join("");
	const o = openOverlay(
		`
    <h2>${esc(title)}</h2><div class="modal-meta">${esc(meta || "")}</div>
    <div class="form-err"></div>
    ${html}
    <div class="modal-actions">
      <div>${historyOf ? '<button class="btn quiet fm-hist">History</button>' : ""}</div>
      <div class="right">
        ${onDuplicate ? '<button class="btn quiet fm-dup" title="Copy with unique fields cleared">Duplicate</button>' : ""}
        <button class="btn quiet" data-close>Cancel</button>
        ${onDelete ? `<button class="btn danger fm-del">${esc(deleteLabel || "Delete")}</button>` : ""}
        <button class="btn primary fm-go">${esc(submitLabel || "Save")}</button>
      </div></div>`,
		wide,
	);
	const m = o.querySelector(".modal");
	const allFields = sections.flatMap((s) => [...s.fields, ...(s.chips || [])]);
	/* chips: one delegated handler — no rebinding, grids resolved per click */
	m.addEventListener("click", (ev) => {
		const chip = ev.target.closest(".chip-add[data-chip]");
		if (chip) {
			const f = allFields.find((x) => x.key === chip.dataset.chip);
			const grid =
				chip.closest("fieldset")?.querySelector(".form-grid") ||
				chip.parentElement.previousElementSibling;
			const menu = chip.parentElement;
			chip.remove();
			if (!menu.children.length) menu.remove();
			grid.insertAdjacentHTML("beforeend", fieldHtml(f, true));
			if (FINE_POINTER)
				grid.querySelector(`[data-fw="${f.key}"] [data-k]`)?.focus();
			return;
		}
		const rem = ev.target.closest(".field-x[data-remf]");
		if (rem) {
			const key = rem.dataset.remf;
			const f = allFields.find((x) => x.key === key);
			const wrap = m.querySelector(`[data-fw="${key}"]`);
			const grid = wrap.parentElement;
			wrap.remove();
			const menus = grid.parentElement.querySelectorAll(".addfield-chips");
			let menu = menus[0];
			if (!menu) {
				menu = document.createElement("div");
				menu.className = "addfield-menu addfield-chips";
				grid.after(menu);
			}
			
			// If there are multiple menus for some reason, consolidate them
			if (menus.length > 1) {
				for (let i = 1; i < menus.length; i++) {
					Array.from(menus[i].querySelectorAll(".chip-add")).forEach(c => menu.appendChild(c));
					menus[i].remove();
				}
			}

			menu.insertAdjacentHTML(
				"beforeend",
				`<sg-chip class="chip-add" data-chip="${esc(key)}" label="${esc(f.chipLabel || f.label)}"></sg-chip>`,
			);
			
			const chips = Array.from(menu.querySelectorAll(".chip-add"));
			chips.sort((a, b) => (a.getAttribute("label") || a.textContent).localeCompare(b.getAttribute("label") || b.textContent));
			menu.innerHTML = ""; // Clear any text nodes or phantom breaks
			chips.forEach((c) => menu.appendChild(c));
		}
	});
	m.querySelectorAll("[data-sec]").forEach(
		(d) =>
			(d.querySelector("button").onclick = () => {
				d.hidden = true;
				m.querySelector(`[data-secbody="${d.dataset.sec}"]`).hidden = false;
			}),
	);
	m.querySelectorAll("[data-secx]").forEach(
		(b) =>
			(b.onclick = () => {
				const si = b.dataset.secx;
				const body = m.querySelector(`[data-secbody="${si}"]`);
				body.querySelectorAll("input,select,textarea").forEach((el) => {
					if (el.type === "checkbox") el.checked = false;
					else el.value = "";
				});
				body.hidden = true;
				m.querySelector(`[data-sec="${si}"]`).hidden = false;
			}),
	);
	const showErr = (msg) => {
		const e = m.querySelector(".form-err");
		e.textContent = msg;
		e.classList.add("on");
		e.scrollIntoView({ block: "nearest" });
	};
	/* validator messages carry a "nodes[12] (dev-x):" locator for file debugging — noise in a form */
	const humanErr = (s) =>
		String(s).replace(/^(nodes|edges)\[\d+\]\s*(\([^)]*\))?:\s*/, "");
	const collect = () => {
		const vals = {};
		for (const f of allFields) {
			const el = m.querySelector(`[data-k="${f.key}"]`);
			if (!el) {
				vals[f.key] = undefined;
				continue;
			} /* chip never opened / section removed */
			let v = el.value;
			if (f.type === "int") v = v === "" ? undefined : Number(v);
			else if (f.numeric) v = v === "" ? undefined : Number(v);
			else if (f.type === "bool") v = v === "" ? undefined : v === "true";
			else {
				v = String(v).trim();
				if (v === "") v = undefined;
			}
			if (f.required && v === undefined) {
				showErr(`"${f.label}" is required.`);
				return null;
			}
			vals[f.key] = v;
		}
		return vals;
	};
	m.querySelector(".fm-go").onclick = () => {
		const vals = collect();
		if (!vals) return;
		const r = onSubmit(vals, o);
		if (r && r.ok === false) showErr(r.errs.map(humanErr).join("\n"));
		else closeOverlay(o);
	};
	m.addEventListener("keydown", (ev) => {
		if (
			ev.key === "Enter" &&
			ev.target.tagName !== "TEXTAREA" &&
			!ev.target.closest(".addfield-menu")
		) {
			ev.preventDefault();
			m.querySelector(".fm-go").click();
		}
	});
	if (onDelete) m.querySelector(".fm-del").onclick = () => onDelete(o);
	if (onDuplicate) m.querySelector(".fm-dup").onclick = () => onDuplicate(o);
	if (historyOf)
		m.querySelector(".fm-hist").onclick = () => showHistory(historyOf);
	if (showCustomFields) attachCustomFieldsZone(o, node);
	return o;
}

const attrField = (type, k, node, required) => {
	const spec = NODE_TYPES[type][required ? "required" : "optional"][k];
	return {
		key: "attr:" + k,
		label: k === "poe" ? "PoE Requirement" : k.replace(/([A-Z])/g, " $1").toLowerCase(),
		chipLabel: k === "poe" ? "poe" : undefined,
		required,
		type:
			spec.t === "enum"
				? "enum"
				: spec.t === "bool"
					? "bool"
					: spec.t === "int"
						? "int"
						: spec.area
							? "textarea"
							: "text",
		enum: spec.e,
		value: node ? node.attrs[k] : undefined,
		full: !!spec.area,
	};
};
const attrFieldsFor = (type, node, keys, required) =>
	keys.map((k) => attrField(type, k, node, required));
const vlanChoices = () => {
	const s = new Set();
	for (const n of store.doc.nodes) {
		if (n.type === "prefix" && n.attrs.vlanId) s.add(n.attrs.vlanId);
		if (n.type === "interface") {
			if (n.attrs.accessVlan) s.add(n.attrs.accessVlan);
			if (n.attrs.nativeVlan) s.add(n.attrs.nativeVlan);
		}
	}
	return [...s].toSorted((a, b) => a - b);
};
const collectAttrs = (vals, o) => {
	const a = {};
	for (const [k, v] of Object.entries(vals))
		if (k.startsWith("attr:") && v !== undefined) a[k.slice(5)] = v;
	if (o) {
		const custom = collectCustomAttrs(o);
		if (custom !== undefined) a.custom = custom;
	}
	return a;
};
const selOpts = (type, extra) =>
	store.doc.nodes
		.filter((n) => n.type === type && (!extra || extra(n)))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((n) => ({ v: n.id, l: n.name }));
const locOpts = (excludeId) =>
	store.doc.nodes
		.filter((n) => n.type === "location" && n.id !== excludeId)
		.map((n) => ({ v: n.id, l: [...locPath(n.id), n.name].join(" › ") }))
		.sort((a, b) => a.l.localeCompare(b.l));
const assignTargetOpts = () => {
	const out = [];
	for (const d of store.doc.nodes.filter(
		(n) =>
			n.type === "device" &&
			["static", "dhcp-reservation"].includes(n.attrs.ipAssignment),
	)) {
		out.push({ v: d.id, l: `${d.name} (device)` });
		for (const i of ifacesOf(d.id))
			out.push({ v: i.id, l: `${d.name} · ${i.name}` });
	}
	return out.sort((a, b) => a.l.localeCompare(b.l));
};
const edgeVal = (node, t) => {
	if (!node) return "";
	let v = (outE(node.id, t)[0] || {}).to || "";
	if (!v && t === "located_in") v = locationOf(node.id)?.id || "";
	return v;
};
function syncEdges(doc, nodeId, vals, rackU) {
	if (vals["edge:mounted_in"]) vals["edge:located_in"] = "";
	for (const [k, v] of Object.entries(vals)) {
		if (!k.startsWith("edge:")) continue;
		const et = k.slice(5);
		const eattrs =
			et === "mounted_in" && rackU !== undefined ? { rackU } : undefined;
		setSingletonEdge(doc, nodeId, et, v || null, eattrs);
	}
}
/* create/find a named port on a device, inside a mutation (index may be stale) */
function findPortIn(doc, devId, portName) {
	const owned = new Set(
		doc.edges
			.filter((e) => e.type === "has_interface" && e.from === devId)
			.map((e) => e.to),
	);
	const wanted = String(portName).trim().toLowerCase();
	let p = doc.nodes.find(
		(n) => owned.has(n.id) && n.name.trim().toLowerCase() === wanted,
	);
	/* bare numbers mean the generated port: "24" → p24 (never a second port named "24") */
	if (!p && /^\d+$/.test(wanted))
		p = doc.nodes.find(
			(n) => owned.has(n.id) && n.name.trim().toLowerCase() === "p" + wanted,
		);
	return p || null;
}
function ensurePortIn(doc, devId, portName, attrs) {
	const p0 = findPortIn(doc, devId, portName);
	if (p0) return p0;
	const dev = doc.nodes.find((n) => n.id === devId);
	const base = `if-${slugify(dev.name)}-${slugify(portName)}`;
	let id = base,
		i = 2;
	while (doc.nodes.some((n) => n.id === id)) id = `${base}-${i++}`;
	const p = {
		id,
		type: "interface",
		name: String(portName).trim(),
		updatedAt: nowISO(),
		history: [{ ts: nowISO(), summary: "Created" }],
		attrs: attrs || { portMode: "access" },
	};
	doc.nodes.push(p);
	doc.edges.push({ from: devId, type: "has_interface", to: p.id });
	return p;
}
const freeIn = (doc, ifId) =>
	!doc.edges.some(
		(e) => e.type === "connected_to" && (e.from === ifId || e.to === ifId),
	);

/* ---------- history / activity ---------- */
function showHistory(id) {
	const n = nodeById(id);
	if (!n) return;
	const items = [...(n.history || [])].reverse();
	openOverlay(`<h2>History — ${esc(n.name)}</h2>
    <div class="modal-meta">Newest first · capped at ${HISTORY_CAP} entries per record.</div>
    <ul class="history-list">${items.map((h) => `<li class="history-item"><div class="history-ts">${esc(fmtDate(h.ts))}</div><div class="history-summary">${esc(h.summary)}</div></li>`).join("") || '<li class="history-item dim">No entries.</li>'}</ul>
    <div class="modal-actions"><div></div><div class="right"><button class="btn quiet" data-close>Close</button></div></div>`);
}
function showActivity() {
	const items = [...store.doc.meta.log].reverse();
	openOverlay(
		`<h2>Activity log</h2>
    <div class="modal-meta">Deletions and site-level events, newest first · capped at ${LOG_CAP}. Per-record edits live in each record's history.</div>
    <ul class="history-list">${items.map((h) => `<li class="history-item"><div class="history-ts">${esc(fmtDate(h.ts))}</div><div class="history-summary">${esc(h.summary)}</div></li>`).join("") || '<li class="history-item dim">Nothing yet.</li>'}</ul>
    <div class="modal-actions"><div></div><div class="right"><button class="btn quiet" data-close>Close</button></div></div>`,
		true,
	);
}

/* ---------- delete with impact preview ---------- */
function confirmDelete(id, parentOverlay, onSuccess) {
	const impact = computeImpact(id);
	const root = nodeById(id);
	const extra = impact.nodes.filter((n) => n.id !== id);
	const sever = impact.severed.filter(
		(s, i, arr) =>
			arr.findIndex((x) => x.node.id === s.node.id && x.via === s.via) === i,
	);
	const o = openOverlay(`
    <h2>Delete ${esc(NODE_TYPES[root.type].label.toLowerCase())} “${esc(root.name)}”?</h2>
    <div class="modal-meta">Undo (Ctrl+Z) can bring it back until you close the app.</div>
    <div class="impact">
      ${
				extra.length
					? `<div>Also permanently deletes <b>${extra.length}</b> dependent record${extra.length > 1 ? "s" : ""}:</div>
        <ul>${extra.map((n) => `<li class="del">${esc(NODE_TYPES[n.type].label)} — ${esc(n.name)}</li>`).join("")}</ul>`
					: '<div class="dim">No dependent records.</div>'
			}
      ${
				sever.length
					? `<div>These survive but lose a link:</div>
        <ul>${sever.map((s) => `<li class="keep">${esc(s.node.name)} <span class="mono dim">(${esc(s.via)})</span></li>`).join("")}</ul>`
					: ""
			}
    </div>
    <div class="modal-actions"><div></div><div class="right">
      <button class="btn quiet" data-close>Cancel</button>
      <button class="btn danger" id="delGo">Delete</button></div></div>`);
	o.querySelector("#delGo").onclick = () => {
		const r = deleteNode(id);
		closeOverlay(o);
		if (r.ok) {
			if (parentOverlay) closeOverlay(parentOverlay);
			toast(`Deleted “${root.name}”`);
			if (onSuccess) onSuccess();
		} else toast(r.errs[0], true);
	};
}

/* ---------- reset with impact preview ---------- */
function confirmReset(id, devId, parentOverlay) {
	const root = nodeById(id);
	const link = linkOf(id);
	const o = openOverlay(`
    <h2>Reset ${esc(NODE_TYPES[root.type].label.toLowerCase())} “${esc(root.name)}”?</h2>
    <div class="modal-meta">Restores the port name and clears all configurations. Connections will remain intact.</div>
    <div class="modal-actions"><div></div><div class="right">
      <button class="btn quiet" data-close>Cancel</button>
      <button class="btn danger" id="resetGo">Reset</button></div></div>`);
	o.querySelector("#resetGo").onclick = () => {
		mutate(doc => {
			const iface = doc.nodes.find(x => x.id === id);
			iface.name = iface.attrs.stdName;
			iface.attrs = { portMode: "access", stdName: iface.attrs.stdName };
			pushHistory(iface, "Factory reset");
		});
		closeOverlay(o);
		if (parentOverlay) {
			closeOverlay(parentOverlay);
			portEditor(devId, nodeById(id));
		}
		toast(`Reset “${root.name}”`);
	};
}

/* ---------- unplug with impact preview ---------- */
function confirmUnplug(id, parentOverlay, onSuccess) {
	const root = nodeById(id);
	const link = linkOf(id);
	if (!link) return;
	const o = openOverlay(`
    <h2>Unplug connection from “${esc(root.name)}”?</h2>
    <div class="modal-meta">Removes the cable link at both ends. Port configurations remain intact.</div>
    <div class="impact">
      <div>Permanently removes the connection to: <b>${esc(describeIfaceTarget(peerOf(id)))}</b></div>
    </div>
    <div class="modal-actions"><div></div><div class="right">
      <button class="btn quiet" data-close>Cancel</button>
      <button class="btn danger" id="unplugGo">Unplug</button></div></div>`);
	o.querySelector("#unplugGo").onclick = () => {
		mutate(doc => {
			const eIdx = doc.edges.findIndex(e => e.type === "connected_to" && e.from === link.from && e.to === link.to);
			if (eIdx >= 0) doc.edges.splice(eIdx, 1);
			pushHistory(doc.nodes.find(x => x.id === id), "Unplugged connection");
		});
		closeOverlay(o);
		if (parentOverlay) closeOverlay(parentOverlay);
		toast(`Unplugged “${root.name}”`);
		if (onSuccess) onSuccess();
	};
}

/* ---------- per-type editors ---------- */
function openEditor(id) {
	const n = nodeById(id);
	if (!n) return;
	if (n.type === "device") return deviceEditor(n);
	if (n.type === "interface") return portEditor(ownerOf(n.id), n);
	const F = {
		location: locationEditor,
		rack: rackEditor,
		patch_panel: patchPanelEditor,
		circuit: circuitEditor,
		prefix: prefixEditor,
		ip_address: ipEditor,
		person: personEditor,
	};
	return F[n.type]?.(n);
}
function stdSubmit(type, node, extras) {
	return (vals, o) =>
		mutate((doc) => {
			const attrs = collectAttrs(vals, o);
			let n;
			if (node) {
				n = doc.nodes.find((x) => x.id === node.id);
				const changed = [];
				if (vals.name !== undefined && n.name !== vals.name) {
					changed.push("name");
					n.name = vals.name;
				}
				for (const k of new Set([
					...Object.keys(n.attrs),
					...Object.keys(attrs),
				]))
					if (JSON.stringify(n.attrs[k]) !== JSON.stringify(attrs[k]))
						changed.push(k);
				n.attrs = attrs;
				pushHistory(
					n,
					changed.length
						? `Updated: ${changed.join(", ")}`
						: "Edited (no field changes)",
				);
			} else {
				n = makeNode(type, vals.name, attrs);
				doc.nodes.push(n);
			}
			syncEdges(doc, n.id, vals, vals.rackU);
			if (extras) extras(doc, n, vals);
		});
}
function locationEditor(node) {
	openEditorForm({
		title: node ? `Edit location — ${node.name}` : "Add location",
		meta: node ? node.id : "Locations nest: site → department → room.",
		sections: [
			{
				legend: "Location",
				fields: [
					{
						key: "name",
						label: "Name",
						type: "text",
						required: true,
						value: node?.name,
					},
					attrField("location", "locationType", node, true),
					{
						key: "edge:located_in",
						label: "Inside (parent)",
						type: "select",
						options: locOpts(node?.id),
						value: edgeVal(node, "located_in"),
					},
					{ ...attrField("location", "notes", node, false), full: true },
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("location", node),
		showCustomFields: true,
		node: node,
	});
}
function rackEditor(node) {
	openEditorForm({
		title: node ? `Edit rack — ${node.name}` : "Add rack",
		meta: node ? node.id : "",
		sections: [
			{
				legend: "Rack",
				fields: [
					{
						key: "name",
						label: "Name",
						type: "text",
						required: true,
						value: node?.name,
					},
					{ ...attrField("rack", "heightU", node, true), disabled: !!node },
					{
						key: "edge:located_in",
						label: "Located in",
						type: "select",
						options: locOpts(),
						value: edgeVal(node, "located_in"),
					},
					{ ...attrField("rack", "notes", node, false), full: true },
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("rack", node),
		showCustomFields: true,
		node: node,
	});
}
function patchPanelEditor(node) {
	let o; /* assigned below; onSubmit runs after assignment */
	o = openEditorForm({
		title: node ? `Edit patch panel — ${node.name}` : "Add patch panel",
		meta: node
			? node.id
			: "Passive filler — jacks land here. Cables are documented on the devices they connect.",
		sections: [
			{
				legend: "Patch panel",
				fields: [
					{
						key: "name",
						label: "Name",
						type: "text",
						required: true,
						value: node?.name,
					},
					attrField("patch_panel", "jackCount", node, true),
					{
						key: "edge:located_in",
						label: "Located in",
						type: "select",
						options: locOpts(),
						value: edgeVal(node, "located_in"),
					},
					{ ...attrField("patch_panel", "notes", node, false), full: true },
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (ov) => confirmDelete(node.id, ov) : null,
		onSubmit: (vals, ov) => {
			const rackErr = readRackVals(ov, vals);
			if (rackErr) return rackErr;
			return stdSubmit("patch_panel", node)(vals, ov);
		},
		showCustomFields: true,
		node: node,
	});
	attachRackZone(o, node);
}
function personEditor(node) {
	openEditorForm({
		title: node ? `Edit person — ${node.name}` : "Add person",
		meta: node ? node.id : "",
		sections: [
			{
				legend: "Person",
				fields: [
					{
						key: "name",
						label: "Name",
						type: "text",
						required: true,
						value: node?.name,
					},
					{
						...attrField("person", "department", node, true),
						list: "deptList",
					},
					{
						key: "edge:located_in",
						label: "Located in",
						type: "select",
						options: locOpts(),
						value: edgeVal(node, "located_in"),
					},
				],
				chips: [
					...attrFieldsFor(
						"person",
						node,
						["title", "extension", "did", "email"],
						false,
					),
					{ ...attrField("person", "notes", node, false) },
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("person", node),
		showCustomFields: true,
		node: node,
	});
}
function circuitEditor(node) {
	openEditorForm({
		title: node ? `Edit circuit — ${node.name}` : "Add circuit",
		meta: node ? node.id : "A WAN/voice service delivered by a provider.",
		sections: [
			{
				legend: "Circuit",
				cols: 3,
				fields: [
					{
						key: "name",
						label: "Name",
						type: "text",
						required: true,
						value: node?.name,
					},
					attrField("circuit", "provider", node, true),
					attrField("circuit", "circuitType", node, true),
					{
						key: "edge:terminated_at",
						label: "Terminates at port",
						type: "select",
						options: nodesOfType("interface")
							.map((n) => ({ v: n.id, l: describeIfaceTarget(n.id) }))
							.sort((a, b) => a.l.localeCompare(b.l)),
						value: edgeVal(node, "terminated_at"),
					},
				],
				chips: [
					...attrFieldsFor(
						"circuit",
						node,
						["bandwidth", "circuitId", "wanIp", "staticBlock", "ispGateway"],
						false,
					),
					{ ...attrField("circuit", "notes", node, false) },
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("circuit", node),
		showCustomFields: true,
		node: node,
	});
}
function prefixEditor(node) {
	openEditorForm({
		title: node ? `Edit prefix — ${node.name}` : "Add prefix",
		meta: "Network address — host bits must be zero (10.0.10.0/24, not .1/24).",
		sections: [
			{
				legend: "Network",
				cols: 3,
				fields: [
					{
						key: "name",
						label: "Network (CIDR)",
						type: "text",
						required: true,
						value: node?.name,
					},
					attrField("prefix", "description", node, false),
					attrField("prefix", "vlanId", node, false),
				],
				chips: attrFieldsFor(
					"prefix",
					node,
					["gatewayIp", "dhcpStart", "dhcpEnd"],
					false,
				),
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("prefix", node),
		showCustomFields: true,
		node: node,
	});
}
function ipEditor(node) {
	openEditorForm({
		title: `Edit IP — ${node.name}`,
		meta: "Every IP belongs to exactly one prefix; targets must be static / dhcp-reservation.",
		sections: [
			{
				legend: "IP address",
				fields: [
					{
						key: "name",
						label: "IPv4 address",
						type: "text",
						required: true,
						value: node?.name,
					},
					{
						key: "edge:member_of",
						label: "Prefix",
						type: "select",
						required: true,
						options: selOpts("prefix"),
						value: edgeVal(node, "member_of"),
					},
					{
						key: "edge:assigned_to",
						label: "Assigned to",
						type: "select",
						options: assignTargetOpts(),
						value: edgeVal(node, "assigned_to"),
					},
					{
						...attrField("ip_address", "description", node, false),
						full: true,
					},
				],
			},
		],
		historyOf: node?.id,
		onDelete: node ? (o) => confirmDelete(node.id, o) : null,
		onSubmit: stdSubmit("ip_address", node),
		showCustomFields: true,
		node: node,
	});
}
function portEditor(devId, iface) {
	const dev = nodeById(devId);
	const infra = INFRA_ROLES.has(dev.attrs.role);
	const isStdPort = !!iface?.attrs?.stdName;
	const vopts = vlanChoices().map((v) => ({ v: String(v), l: "VLAN " + v }));
	const vlanField = (k) => {
		const base = attrField("interface", k, iface, false);
		return vopts.length
			? {
					...base,
					type: "select",
					numeric: true,
					options: vopts,
					value:
						iface && iface.attrs[k] !== undefined
							? String(iface.attrs[k])
							: undefined,
					help: "known VLANs — from IPAM prefixes and ports in use",
				}
			: {
					...base,
					help: "no VLANs known yet — set a VLAN id on a prefix in IPAM",
				};
	};
	const avl = vlanChoices();
	const avlField = {
		...attrField("interface", "allowedVlans", iface, false),
		list: "avlList",
		placeholder: avl.join(","),
		help: "comma-separated VLAN ids — suggestions from IPAM",
	};
	const fields = [
		{
			key: "name",
			label: "Port name",
			type: "text",
			required: true,
			value: iface?.name,
		},
	];
	if (infra)
		fields.push({
			...attrField("interface", "portMode", iface, true),
			value: iface ? iface.attrs.portMode : "access",
		});
	fields.push(attrField("interface", "media", iface, false));
	const chips = infra
		? [
				vlanField("accessVlan"),
				vlanField("nativeVlan"),
				avlField,
				{ ...attrField("interface", "notes", iface, false) },
			]
		: [{ ...attrField("interface", "notes", iface, false) }];
	const link = iface ? linkOf(iface.id) : null;
	const peer = iface ? peerOf(iface.id) : null;
	const sections = [{ legend: "Port", cols: 3, fields, chips }];
	const o = openEditorForm({
		title: iface
			? `Edit port — ${describeIfaceTarget(iface.id)}`
			: `Add port on ${nodeById(devId).name}`,
		meta: [
			iface?.id,
			infra
				? ""
				: "Endpoint NIC — VLANs are configured on the switch port it plugs into, not here.",
		]
			.filter(Boolean)
			.join(" · "),
		sections,
		deleteLabel: isStdPort ? "Reset" : "Delete",
		historyOf: iface?.id,
		onDelete: iface ? (o2) => isStdPort ? confirmReset(iface.id, devId, o2) : confirmDelete(iface.id, o2, () => {
			if (ifacesOf(devId).length === 0 && !PORT_GEN_ROLES.includes(nodeById(devId).attrs.role)) {
				mutate(doc => ensurePortIn(doc, devId, "eth0", { portMode: "access", stdName: "eth0" }));
			}
		}) : null,
		onSubmit: (vals, ov) =>
			mutate((doc) => {
				const attrs = collectAttrs(vals, ov);
				if (!infra) {
					attrs.portMode =
						iface?.attrs.portMode ||
						"access"; /* schema requires it; endpoints are access */
					for (const k of [
						"accessVlan",
						"nativeVlan",
						"allowedVlans",
					] /* never silently drop old data */)
						if (iface?.attrs[k] !== undefined && attrs[k] === undefined)
							attrs[k] = iface.attrs[k];
				}
				if (iface) {
					const n = doc.nodes.find((x) => x.id === iface.id);
					const renamed = n.name !== vals.name;
					n.name = vals.name;
					if (n.attrs.stdName) attrs.stdName = n.attrs.stdName;
					n.attrs = attrs;
					pushHistory(n, renamed ? "Renamed & updated" : "Updated");
				} else {
					const existing = findPortIn(doc, devId, vals.name);
					if (existing)
						throw new Error(
							`${nodeById(devId).name} already has a port named "${existing.name}" — edit it from the ports list instead.`,
						);
					const p = ensurePortIn(doc, devId, vals.name, attrs);
					p.attrs = attrs;
					pushHistory(
						doc.nodes.find((x) => x.id === devId),
						`Added port ${vals.name}`,
					);
				}
			}),
		showCustomFields: true,
		node: iface,
	});
	if (infra && avl.length) {
		const combos = [avl.join(","), ...avl.map(String)];
		o.querySelector(".modal").insertAdjacentHTML(
			"beforeend",
			`<datalist id="avlList">${combos.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`,
		);
	}
	if (link) {
		const peerField = o.querySelector('[data-k="cbl:peer"]');
		peerField.disabled = true;
		const legend = peerField.closest("fieldset").querySelector("legend");
		legend.insertAdjacentHTML(
			"beforeend",
			' <button type="button" class="legend-x unplug-x" title="Removes this cable — both ports become free (undoable)">remove</button>',
		);
		legend.querySelector(".unplug-x").onclick = () => {
			const r = mutate((doc) => {
				const idx = doc.edges.findIndex(
					(x) =>
						x.type === "connected_to" &&
						((x.from === iface.id && x.to === peer) ||
							(x.from === peer && x.to === iface.id)),
				);
				if (idx < 0)
					throw new Error(
						"Cable not found — it may already be unplugged in another panel.",
					);
				doc.edges.splice(idx, 1);
				for (const id of [iface.id, peer]) {
					const d = doc.nodes.find((x) => x.id === ownerOf(id));
					if (d) pushHistory(d, `Unplugged ${nodeById(id).name}`);
				}
			});
			if (r.ok) {
				closeOverlay(o);
				toast("Unplugged — both ports are free");
			} else toast(r.errs[0], true);
		};
	}
}
const freePortsOf = (devId) =>
	ifacesOf(devId)
		.filter((p) => !linkOf(p.id))
		.toSorted((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true }),
		);
const portOpt = (p) =>
	`<option value="${p.id}">${esc(p.name)}${p.attrs.accessVlan ? ` · v${p.attrs.accessVlan}` : ""}${p.attrs.portMode === "trunk" ? " · trunk" : ""}</option>`;

function flipConnection(ifId) {
	const r = mutate((doc) => {
		const ed = doc.edges.find(
			(x) => x.type === "connected_to" && (x.from === ifId || x.to === ifId),
		);
		if (!ed) throw new Error("Cable not found — it may have been unplugged.");
		const f = ed.from;
		ed.from = ed.to;
		ed.to = f; /* undirected: pure display preference */
	});
	if (!r.ok) toast(r.errs[0], true);
}
function connectionEditor(ifId) {
	const e0 = store.doc.edges.find(
		(x) => x.type === "connected_to" && (x.from === ifId || x.to === ifId),
	);
	if (!e0) return;
	const endA = e0.from,
		endB = e0.to;
	const liveEdge = (doc) =>
		(doc || store.doc).edges.find(
			(x) =>
				x.type === "connected_to" &&
				((x.from === endA && x.to === endB) ||
					(x.from === endB && x.to === endA)),
		);
	const o = openEditorForm({
		title: "Edit connection",
		meta: `${describeIfaceTarget(endA)} ↔ ${describeIfaceTarget(endB)}`,
		sections: [
			{
				legend: "Cable",
				cols: 3,
				fields: [],
				chips: [
					{
						key: "cbl:category",
						label: "category",
						type: "text",
						list: "cableCatList",
						value: e0.attrs?.category,
					},
					{
						key: "cbl:jack",
						label: "Jack",
						type: "text",
						value: e0.attrs?.jack,
					},
					{
						key: "cbl:cableColor",
						label: "cable color",
						type: "text",
						value: e0.attrs?.cableColor,
					},
					{
						key: "cbl:length",
						label: "cable length",
						type: "text",
						value: e0.attrs?.length,
					},
				],
			},
		],
		onSubmit: (vals) =>
			mutate((doc) => {
				const ed = liveEdge(doc);
				if (!ed)
					throw new Error(
						"Cable not found — it may have been unplugged in another panel.",
					);
				const cattrs = {};
				if (ed.attrs?.notes) cattrs.notes = ed.attrs.notes;
				for (const [vk, ak] of [
					["cbl:category", "category"],
					["cbl:jack", "jack"],
					["cbl:cableColor", "cableColor"],
					["cbl:length", "length"],
				])
					if (vals[vk] !== undefined) cattrs[ak] = vals[vk];
				if (Object.keys(cattrs).length) ed.attrs = cattrs;
				else delete ed.attrs;
				ed.updatedAt = nowISO();
			}),
		onDelete: (ov) => {
			const r = mutate((doc) => {
				const idx = doc.edges.findIndex(
					(x) =>
						x.type === "connected_to" &&
						((x.from === endA && x.to === endB) ||
							(x.from === endB && x.to === endA)),
				);
				if (idx < 0)
					throw new Error(
						"Cable not found — it may already be unplugged in another panel.",
					);
				doc.edges.splice(idx, 1);
				for (const id of [endA, endB]) {
					const d = doc.nodes.find((x) => x.id === ownerOf(id));
					if (d) pushHistory(d, `Unplugged ${nodeById(id).name}`);
				}
			});
			if (r.ok) {
				closeOverlay(ov);
				toast("Connection deleted — both ports are free");
			} else toast(r.errs[0], true);
		},
	});
	/* the two ports, flippable, each one click from its own editor */
	const fs = document.createElement("fieldset");
	fs.className = "fieldset";
	const renderEnds = () => {
		const live = liveEdge();
		if (!live) {
			fs.innerHTML =
				'<legend>Ports</legend><div class="dim ports-empty">Unplugged.</div>';
			return;
		}
		const end = (id) => {
			const i = nodeById(id),
				dv = nodeById(ownerOf(id));
			return `<div class="port-row"><div class="who"><span class="mono"><b>${esc(dv?.name || "?")}</b> · ${esc(i.name)}</span>
        <span class="pill">${esc(i.attrs.portMode)}${i.attrs.accessVlan ? ` v${i.attrs.accessVlan}` : ""}</span></div>
        <button class="mini" data-pedit="${id}">edit port</button></div>`;
		};
		fs.innerHTML = `<legend>Ports</legend><div class="subrows">
      ${end(live.from)}
      <div class="flip-row"><button type="button" class="mini flip" data-cflip>⇅ flip order</button></div>
      ${end(live.to)}</div>`;
		fs.querySelectorAll("[data-pedit]").forEach(
			(b) =>
				(b.onclick = () =>
					portEditor(ownerOf(b.dataset.pedit), nodeById(b.dataset.pedit))),
		);
		fs.querySelector("[data-cflip]").onclick = () => flipConnection(endA);
	};
	renderEnds();
	o.querySelector(".modal-actions").before(fs);
	o._refresh = renderEnds;
}
function connectForm(fixedA, preDevId = null) {
	const fixedDev = fixedA ? nodeById(ownerOf(fixedA)) : null;
	const o = openEditorForm({
		title: "New connection",
		meta: "Pick each device, then one of its free ports. One cable per port.",
		submitLabel: "Connect",
		sections: [
			{
				legend: "Link",
				cols: 2,
				fields: fixedA
					? [
							{
								key: "dA",
								label: "Device",
								type: "text",
								value: fixedDev.name,
							},
							{
								key: "pA",
								label: "Port",
								type: "text",
								value: nodeById(fixedA).name,
							},
							{
								key: "dB",
								label: "Connects to device",
								type: "select",
								required: true,
								options: [],
							},
							{
								key: "pB",
								label: "Port",
								type: "select",
								required: true,
								options: [],
							},
						]
					: [
							{
								key: "dA",
								label: "Device",
								type: "select",
								required: true,
								options: [],
							},
							{
								key: "pA",
								label: "Port",
								type: "select",
								required: true,
								options: [],
							},
							{
								key: "dB",
								label: "Connects to device",
								type: "select",
								required: true,
								options: [],
							},
							{
								key: "pB",
								label: "Port",
								type: "select",
								required: true,
								options: [],
							},
						],
				chips: [
					{
						key: "cbl:category",
						label: "category",
						type: "text",
						list: "cableCatList",
					},
					{ key: "cbl:jack", label: "jack", type: "text" },
					{ key: "cbl:cableColor", label: "cable color", type: "text" },
					{ key: "cbl:length", label: "cable length", type: "text" },
				],
			},
		],
		onSubmit: (vals) => {
			const a = fixedA || o.querySelector('[data-k="pA"]').value;
			const b = o.querySelector('[data-k="pB"]').value;
			if (!a || !b)
				return {
					ok: false,
					errs: ["Pick a device and one of its free ports on both sides."],
				};
			const attrs = {};
			for (const [vk, ak] of [
				["cbl:category", "category"],
				["cbl:jack", "jack"],
				["cbl:cableColor", "cableColor"],
				["cbl:length", "length"],
			])
				if (vals[vk] !== undefined) attrs[ak] = vals[vk];
			return mutate((doc) => {
				const e = { from: a, type: "connected_to", to: b, updatedAt: nowISO() };
				if (Object.keys(attrs).length) e.attrs = attrs;
				doc.edges.push(e);
				for (const id of [a, b]) {
					const d = doc.nodes.find((x) => x.id === ownerOf(id));
					if (d)
						pushHistory(
							d,
							`Connected ${nodeById(id).name} ↔ ${describeIfaceTarget(id === a ? b : a)}`,
						);
				}
			});
		},
	});

	/* cascading wiring: device drives port; side B never offers side A's device */
	const dASel = fixedA ? null : o.querySelector('[data-k="dA"]');
	const pASel = fixedA ? null : o.querySelector('[data-k="pA"]');
	const dBSel = o.querySelector('[data-k="dB"]');
	const pBSel = o.querySelector('[data-k="pB"]');
	const connectables = (exclude) =>
		store.doc.nodes
			.filter(
				(n) =>
					n.type === "device" && n.id !== exclude && freePortsOf(n.id).length,
			)
			.toSorted((a, b) => a.name.localeCompare(b.name));
	const devOpts = (exclude, sel = null) =>
		'<option value="">— select device —</option>' +
		connectables(exclude)
			.map(
				(d) =>
					`<option value="${d.id}"${d.id === sel ? " selected" : ""}>${esc(d.name)}</option>`,
			)
			.join("");
	const fillPorts = (devId, portSel) => {
		if (!devId) {
			portSel.innerHTML = '<option value="">— pick a device first —</option>';
			return;
		}
		const ports = freePortsOf(devId);
		if (!ports.length) {
			portSel.innerHTML = '<option value="">— no free ports —</option>';
			return;
		}
		portSel.innerHTML =
			(ports.length > 1 ? '<option value="">— select port —</option>' : "") +
			ports.map(portOpt).join("");
	};
	const aDev = () => (fixedA ? fixedDev.id : dASel.value);
	const refreshB = () => {
		const keep = dBSel.value;
		dBSel.innerHTML = devOpts(aDev());
		if (keep && keep !== aDev()) dBSel.value = keep;
		fillPorts(dBSel.value, pBSel);
	};
	if (dASel) {
		dASel.innerHTML = devOpts(null, preDevId);
		fillPorts(preDevId || "", pASel);
		dASel.onchange = () => {
			fillPorts(dASel.value, pASel);
			refreshB();
		};
	} else {
		for (const k of ["dA", "pA"])
			o.querySelector(`[data-k="${k}"]`).disabled = true;
	}
	dBSel.onchange = () => fillPorts(dBSel.value, pBSel);
	refreshB();
}
/* ---- conditional rack mounting, shared by devices and patch panels ----
   "+ rack" chip appears only when the chosen room has racks; picking one reveals
   "mounted in rack" + "rack unit (U)" (open slots only). The editor's onSubmit reads
   [data-k="edge:mounted_in"] and [data-k="rackU"] from the DOM. */
function attachRackZone(o, node) {
	const mountEdge = node ? outE(node.id, "mounted_in")[0] : null;
	const locSel = o.querySelector('[data-k="edge:located_in"]');
	const placementGrid = locSel.closest(".form-grid");
	const getRackZone = () => {
		let zone = placementGrid.nextElementSibling?.classList.contains("addfield-chips") 
			? placementGrid.nextElementSibling 
			: null;
		if (!zone) {
			zone = document.createElement("div");
			zone.className = "addfield-menu addfield-chips";
			placementGrid.after(zone);
		}
		return zone;
	};
	getRackZone(); // Ensure it exists initially
	const sortRackZone = () => {
		const zone = getRackZone();
		const chips = Array.from(zone.querySelectorAll(".chip-add"));
		chips.sort((a, b) => (a.getAttribute("label") || a.textContent).localeCompare(b.getAttribute("label") || b.textContent));
		chips.forEach((c) => zone.appendChild(c));
	};
	let rackOpen = !!mountEdge;
	const removeRackFields = () => {
		placementGrid.querySelector('[data-fw="edge:mounted_in"]')?.remove();
		placementGrid.querySelector('[data-fw="rackU"]')?.remove();
	};
	const origLoc =
		locSel.value; /* rack depends on location: mount survives only while this is unchanged */
	const racksInLoc = (locId) => {
		const list = locId
			? store.doc.nodes.filter(
					(n) => n.type === "rack" && outE(n.id, "located_in")[0]?.to === locId,
				)
			: [];
		if (
			locId &&
			locId === origLoc &&
			mountEdge &&
			!list.some((r) => r.id === mountEdge.to)
		) {
			const cur = nodeById(mountEdge.to);
			if (cur) list.unshift(cur); /* keep a drifted mount editable in place */
		}
		return list;
	};
	const fillU = () => {
		const rackSel = placementGrid.querySelector('[data-k="edge:mounted_in"]');
		const uSel = placementGrid.querySelector('[data-k="rackU"]');
		if (!rackSel || !uSel) return;
		const r = nodeById(rackSel.value);
		if (!r) {
			uSel.innerHTML = "";
			return;
		}
		const occupied = new Set(
			store.doc.edges
				.filter(
					(e) =>
						e.type === "mounted_in" &&
						e.to === r.id &&
						(!node || e.from !== node.id),
				)
				.map((e) => (e.attrs || {}).rackU)
				.filter((u) => u !== undefined),
		);
		const cur =
			node && mountEdge && mountEdge.to === r.id && locSel.value === origLoc
				? (mountEdge.attrs || {}).rackU
				: undefined;
		let opts = "";
		for (let u = r.attrs.heightU; u >= 1; u--) {
			if (occupied.has(u) && u !== cur) continue;
			opts += `<option value="${u}"${u === cur ? " selected" : ""}>U${u}</option>`;
		}
		uSel.innerHTML = opts || '<option value="">— rack full —</option>';
	};
	const renderRackZone = () => {
		const racks = racksInLoc(locSel.value);
		const zone = getRackZone();
		if (!racks.length) {
			zone.querySelector(".rack-chip")?.remove();
			removeRackFields();
			rackOpen = false;
			return;
		}
		if (!rackOpen) {
			removeRackFields();
			if (!zone.querySelector(".rack-chip")) {
				zone.insertAdjacentHTML("afterbegin", '<sg-chip class="chip-add rack-chip" label="rack"></sg-chip>');
				zone.querySelector(".rack-chip").onclick = () => {
					rackOpen = true;
					renderRackZone();
				};
			}
			sortRackZone();
			return;
		}
		zone.querySelector(".rack-chip")?.remove();
		removeRackFields();
		placementGrid.insertAdjacentHTML(
			"beforeend",
			`
      <div class="field" data-fw="edge:mounted_in"><label>mounted in rack<button type="button" class="field-x rack-x">remove</button></label>
        <select data-k="edge:mounted_in">${racks
					.map(
						(r) =>
							`<option value="${r.id}"${locSel.value === origLoc && mountEdge && mountEdge.to === r.id ? " selected" : ""}>${esc(r.name)} (${r.attrs.heightU}U)</option>`,
					)
					.join("")}</select></div>
      <div class="field" data-fw="rackU"><label>rack unit (U)</label><select data-k="rackU"></select>
        <div class="hint">open slots only</div></div>`,
		);
		placementGrid.querySelector('[data-k="edge:mounted_in"]').onchange = fillU;
		placementGrid.querySelector(".rack-x").onclick = () => {
			rackOpen = false;
			renderRackZone();
		};
		fillU();
	};
	locSel.addEventListener("change", () => {
		rackOpen =
			locSel.value === origLoc &&
			!!mountEdge; /* back to original → mount restored */
		removeRackFields();
		renderRackZone();
	});
	renderRackZone();
}
/* reads the DOM-injected rack fields into vals; returns an error result or null */
function readRackVals(o, vals) {
	const rackSel = o.querySelector('[data-k="edge:mounted_in"]');
	const uSel = o.querySelector('[data-k="rackU"]');
	vals["edge:mounted_in"] = rackSel ? rackSel.value : "";
	vals.rackU = uSel && uSel.value !== "" ? Number(uSel.value) : undefined;
	if (vals["edge:mounted_in"] && vals.rackU === undefined)
		return {
			ok: false,
			errs: ["Pick a rack unit — that rack has no open slots."],
		};
	return null;
}

/* ---------- device editor: quick connect + ports manager ---------- */
function deviceEditor(node, presetLoc, presetClone) {
	const isNew = !node;
	const dataSrc = node || presetClone;
	const sections = [
		{
			legend: "Identity",
			cols: 3,
			fields: [
				{
					key: "name",
					label: "Display name",
					type: "text",
					required: true,
					value: dataSrc?.name,
				},
				attrField("device", "role", dataSrc, true),
				{
					...attrField("device", "ipAssignment", dataSrc, true),
					value: dataSrc ? dataSrc.attrs.ipAssignment : "none",
				},
			],
			chips: attrFieldsFor(
				"device",
				dataSrc,
				["hostname", "mac", "department", "poe"],
				false,
			).map((f) =>
				f.key === "attr:department" ? { ...f, list: "deptList" } : f,
			),
		},
		{
			legend: "Hardware & Lifecycle",
			adder: true,
			cols: 3,
			fields: attrFieldsFor(
				"device",
				dataSrc,
				["manufacturer", "model", "serial", "assetTag", "dmsId"],
				false,
			),
		},
		{
			legend: "Placement",
			cols: 3,
			fields: [
				{
					key: "edge:located_in",
					label: "Located in",
					type: "select",
					options: locOpts(),
					value: node ? edgeVal(node, "located_in") : presetLoc || "",
				},
			],
			chips: [
				{
					key: "edge:used_by",
					label: "person",
					type: "select",
					options: selOpts("person"),
					value: edgeVal(node, "used_by"),
				},
			],
		},
	];

	sections.push({
		legend: "Notes",
		fields: [{ ...attrField("device", "notes", dataSrc, false), full: true }],
	});

	let o; /* assigned below; safe — handlers run after assignment */
	o = openEditorForm({
		title: isNew ? "Add device" : `Edit device — ${node.name}`,
		meta: node
			? node.id
			: "A port and cable can be created right here — interface records are handled for you.",
		wide: true,
		sections,
		historyOf: node?.id,
		onDelete: node ? (ov) => confirmDelete(node.id, ov) : null,
		showCustomFields: true,
		node: node,
		onDuplicate: node
			? (ov) => {
					const attrs = clone(node.attrs);
					for (const k of ["serial", "mac", "assetTag", "dmsId", "hostname"])
						delete attrs[k];
					closeOverlay(ov);
					deviceEditor(null, outE(node.id, "located_in")[0]?.to, { name: node.name + " copy", attrs });
				}
			: null,
		onSubmit: (vals, ov) => {
			/* -- validation pipeline: rack → ports → IP, each early-returns on error -- */
			const rackErr = readRackVals(o, vals);
			if (rackErr) return rackErr;
			/* switch port generation */
			const readNum = (k) => {
				const el = o.querySelector(`[data-k="${k}"]`);
				return el && el.value !== "" ? Number(el.value) : undefined;
			};
			const genPorts = readNum("genPorts"),
				genSfp = readNum("genSfp");
			if (isNew && PORT_GEN_ROLES.includes(vals["attr:role"])) {
				if (
					genPorts === undefined ||
					!Number.isInteger(genPorts) ||
					genPorts < 1 ||
					genPorts > 96
				)
					return {
						ok: false,
						errs: [
							"Port count (1–96) is required for switches — it generates the port records.",
						],
					};
				if (
					genSfp !== undefined &&
					(!Number.isInteger(genSfp) || genSfp < 1 || genSfp > 32)
				)
					return {
						ok: false,
						errs: ["SFP port count must be between 1 and 32."],
					};
			}
			/* static / dhcp-reservation IPs */
			const newIps = Array.from(o.querySelectorAll('[data-k="newIp"]'))
				.map((el) => el.value.trim())
				.filter(Boolean);
			const ipPrefixes = [];
			for (const nip of newIps) {
				if (!isIp4(nip))
					return {
						ok: false,
						errs: [`"${nip}" is not a valid IPv4 address.`],
					};
				const pfx = store.doc.nodes.find(
					(x) => x.type === "prefix" && cidrHasHost(parseCidr(x.name), ip4ToInt(nip)),
				);
				if (!pfx)
					return {
						ok: false,
						errs: [`No prefix contains ${nip}. Add the network in IPAM first — every IP belongs to a prefix.`],
					};
				ipPrefixes.push({ ip: nip, pfx: pfx });
			}
			/* dhcp network comes from the prefix dropdown, never free text */
			const dhcpNetEl = o.querySelector('[data-k="dhcpNet"]');
			if (dhcpNetEl && dhcpNetEl.value)
				vals["attr:dhcpNetwork"] = dhcpNetEl.value;
			return mutate((doc) => {
				const attrs = collectAttrs(vals, ov);
				let n;
				if (node) {
					n = doc.nodes.find((x) => x.id === node.id);
					const changed = [];
					if (n.name !== vals.name) {
						changed.push("name");
						n.name = vals.name;
					}
					for (const k of new Set([
						...Object.keys(n.attrs),
						...Object.keys(attrs),
					]))
						if (JSON.stringify(n.attrs[k]) !== JSON.stringify(attrs[k]))
							changed.push(k);
					n.attrs = attrs;
					pushHistory(
						n,
						changed.length
							? `Updated: ${changed.join(", ")}`
							: "Edited (no field changes)",
					);
				} else {
					n = makeNode("device", vals.name, attrs);
					doc.nodes.push(n);
				}
				syncEdges(doc, n.id, vals, vals.rackU);

				const oldIps = existingIps.map((x) => x.name);
				const toRemove = existingIps.filter((x) => !newIps.includes(x.name));
				const toAdd = newIps.filter((x) => !oldIps.includes(x));
				
				for (const rm of toRemove) {
					doc.nodes = doc.nodes.filter((x) => x.id !== rm.id);
					doc.edges = doc.edges.filter(
						(e) => e.from !== rm.id && e.to !== rm.id,
					);
					pushHistory(n, `Removed IP ${rm.name}`);
				}
				for (const add of toAdd) {
					const ipMap = ipPrefixes.find(x => x.ip === add);
					const ip = makeNode("ip_address", add, {});
					doc.nodes.push(ip);
					doc.edges.push({ from: ip.id, type: "member_of", to: ipMap.pfx.id });
					doc.edges.push({ from: ip.id, type: "assigned_to", to: n.id });
					pushHistory(n, `Assigned IP ${add}`);
				}
				/* generate switch ports FIRST so a numeric quick-connect port ("24" → p24) matches
           a generated port instead of creating a phantom port beside it */
				if (isNew && PORT_GEN_ROLES.includes(attrs.role) && genPorts) {
					for (let i = 1; i <= genPorts; i++)
						ensurePortIn(doc, n.id, `p${i}`, {
							portMode: "access",
							media: "copper",
							stdName: `p${i}`
						});
					for (let i = 1; i <= (genSfp || 0); i++)
						ensurePortIn(doc, n.id, `SFP${i}`, {
							portMode: "access",
							media: "sfp"
						});
					pushHistory(
						n,
						`Generated ${genPorts} ports${genSfp ? ` + ${genSfp} SFP` : ""}`,
					);
				}


				/* endpoints always carry at least one NIC — infra devices manage ports explicitly */
				if (
					isNew &&
					!INFRA_ROLES.has(attrs.role) &&
					!doc.edges.some((e) => e.type === "has_interface" && e.from === n.id)
				)
					ensurePortIn(doc, n.id, "eth0", { portMode: "access", stdName: "eth0" });
			});
		},
	});

	/* ---- conditional rack mounting: chip appears only when the chosen room has racks ---- */
	attachRackZone(o, node);

	/* ---- quick connect: target device drives the free-port list ---- */
	const qcDev = o.querySelector('[data-k="qc:dev"]');
	if (qcDev) {
		const qcPort = o.querySelector('[data-k="qc:theirPort"]');
		const fillQcPorts = () => {
			if (!qcDev.value) {
				qcPort.innerHTML = '<option value="">— pick a device first —</option>';
				return;
			}
			const ports = freePortsOf(qcDev.value);
			if (!ports.length) {
				qcPort.innerHTML = '<option value="">— no free ports —</option>';
				return;
			}
			qcPort.innerHTML =
				(ports.length > 1 ? '<option value="">— select port —</option>' : "") +
				ports.map(portOpt).join("");
		};
		qcDev.addEventListener("change", fillQcPorts);
		fillQcPorts();
	}

	/* ---- IP assignment consequences: chips appear only when the mode calls for them ---- */
	const ipSel = o.querySelector('[data-k="attr:ipAssignment"]');
	const idGrid = ipSel.closest(".form-grid");
	const getChipsZone = () => {
		let zone = idGrid.nextElementSibling?.classList.contains("addfield-chips") 
			? idGrid.nextElementSibling 
			: null;
		if (!zone) {
			zone = document.createElement("div");
			zone.className = "addfield-menu addfield-chips";
			idGrid.after(zone);
		}
		return zone;
	};
	getChipsZone(); // Ensure it exists initially
	const existingIps = node ? ipsOf(node.id).map(x => x.ip) : [];
	let workingIps = existingIps.length ? existingIps.map(x => x.name) : [];
	let ipChipOpen = workingIps.length > 0,
		dhcpOpen = !!(node && node.attrs.dhcpNetwork);
	const sortChips = () => {
		const zone = getChipsZone();
		Array.from(zone.children)
			.sort((a, b) => (a.getAttribute("label") || a.textContent).replace(/[^a-zA-Z]/g, "").localeCompare((b.getAttribute("label") || b.textContent).replace(/[^a-zA-Z]/g, "")))
			.forEach((c) => zone.appendChild(c));
	};
	const renderNetZone = () => {
		const mode = ipSel.value;
		const zone = getChipsZone();
		zone.querySelector(".net-ip-chip")?.remove();
		zone.querySelector(".net-dhcp-chip")?.remove();
		zone.querySelector(".net-hint")?.remove();
		
		if (mode === "static" || mode === "dhcp-reservation") {
			idGrid.querySelector('[data-fw="dhcpNet"]')?.remove();
			dhcpOpen = false;
			idGrid.querySelectorAll('[data-fw="newIp"]').forEach((el) => el.remove());
			
			if (!ipChipOpen) {
				zone.insertAdjacentHTML("afterbegin", '<sg-chip class="chip-add net-ip-chip" label="IP address"></sg-chip>');
				zone.querySelector(".net-ip-chip").onclick = () => {
					ipChipOpen = true;
					workingIps = [""];
					renderNetZone();
				};
			} else {
				const roleSel = o.querySelector('[data-k="attr:role"]');
				const role = roleSel ? roleSel.value : (node ? node.attrs.role : "");
				const isInfra = INFRA_ROLES.has(role);
				
				let html = "";
				workingIps.forEach((ipStr, idx) => {
					const lbl = (isInfra && idx === 0) ? "management ip" : (isInfra ? "additional ip" : "ip address");
					html += `<div class="field" data-fw="newIp">
          <label>${lbl}<button type="button" class="field-x net-ip-x" data-idx="${idx}">remove</button></label>
          <input data-k="newIp" value="${esc(ipStr)}"></div>`;
				});
				idGrid.querySelector('[data-fw="attr:ipAssignment"]').insertAdjacentHTML("afterend", html);
				
				idGrid.querySelectorAll(".net-ip-x").forEach(btn => {
					btn.onclick = (e) => {
						workingIps = Array.from(idGrid.querySelectorAll('[data-k="newIp"]')).map(el => el.value);
						const idx = parseInt(e.target.dataset.idx);
						workingIps.splice(idx, 1);
						if (workingIps.length === 0) ipChipOpen = false;
						renderNetZone();
					};
				});
				
				zone.insertAdjacentHTML("afterbegin", '<sg-chip class="chip-add net-ip-chip" label="IP address"></sg-chip>');
				zone.querySelector(".net-ip-chip").onclick = () => {
					workingIps = Array.from(idGrid.querySelectorAll('[data-k="newIp"]')).map(el => el.value);
					workingIps.push("");
					renderNetZone();
				};
			}
		} else if (mode === "dhcp") {
			idGrid.querySelectorAll('[data-fw="newIp"]').forEach((el) => el.remove());
			ipChipOpen = false;
			const prefixes = nodesOfType("prefix");
			if (!prefixes.length) {
				idGrid.querySelector('[data-fw="dhcpNet"]')?.remove();
				zone.insertAdjacentHTML("afterbegin", '<span class="hint net-hint">no networks yet — define prefixes in IPAM</span>');
				return;
			}
			if (!dhcpOpen) {
				idGrid.querySelector('[data-fw="dhcpNet"]')?.remove();
				zone.insertAdjacentHTML("afterbegin", '<sg-chip class="chip-add net-dhcp-chip" label="dhcp network"></sg-chip>');
				zone.querySelector(".net-dhcp-chip").onclick = () => {
					dhcpOpen = true;
					renderNetZone();
				};
			} else if (!idGrid.querySelector('[data-fw="dhcpNet"]')) {
				const cur = node?.attrs.dhcpNetwork;
				idGrid
					.querySelector('[data-fw="attr:ipAssignment"]')
					.insertAdjacentHTML(
						"afterend",
						`<div class="field" data-fw="dhcpNet">
          <label>dhcp network<button type="button" class="field-x net-dhcp-x">remove</button></label>
          <select data-k="dhcpNet"><option value="">— select —</option>${prefixes
						.map(
							(p) =>
								`<option value="${esc(p.name)}"${p.name === cur ? " selected" : ""}>${esc(p.name)}${p.attrs.vlanId ? ` · v${p.attrs.vlanId}` : ""}${p.attrs.description ? ` — ${esc(p.attrs.description)}` : ""}</option>`,
						)
						.join("")}</select></div>`,
					);
				idGrid.querySelector(".net-dhcp-x").onclick = () => {
					dhcpOpen = false;
					renderNetZone();
				};
			}
		} else {
			/* none */
			idGrid.querySelectorAll('[data-fw="newIp"]').forEach((el) => el.remove());
			idGrid.querySelector('[data-fw="dhcpNet"]')?.remove();
			ipChipOpen = dhcpOpen = false;
		}
		sortChips();
	};
	ipSel.addEventListener("change", renderNetZone);
	renderNetZone();

	/* ---- switches declare a port count; interfaces are generated from it ---- */
	if (isNew) {
		const roleSel = o.querySelector('[data-k="attr:role"]');
		let sfpOpen = false;
		const renderSwZone = () => {
			chipsZone.querySelector(".sw-sfp-chip")?.remove();
			if (!PORT_GEN_ROLES.includes(roleSel.value)) {
				idGrid.querySelector('[data-fw="genPorts"]')?.remove();
				idGrid.querySelector('[data-fw="genSfp"]')?.remove();
				sfpOpen = false;
				return;
			}
			if (!idGrid.querySelector('[data-fw="genPorts"]'))
				idGrid.insertAdjacentHTML(
					"beforeend",
					`<div class="field" data-fw="genPorts">
          <label>standard port count</label><input data-k="genPorts" type="number" step="1" min="1" max="96" required>
          <div class="hint">required</div></div>`,
				);
			if (sfpOpen) {
				if (!idGrid.querySelector('[data-fw="genSfp"]')) {
					idGrid.insertAdjacentHTML(
						"beforeend",
						`<div class="field" data-fw="genSfp">
            <label>sfp ports<button type="button" class="field-x sw-sfp-x">remove</button></label>
            <input data-k="genSfp" type="number" step="1" min="1" max="32"></div>`,
					);
					idGrid.querySelector(".sw-sfp-x").onclick = () => {
						sfpOpen = false;
						renderSwZone();
					};
				}
			} else {
				idGrid.querySelector('[data-fw="genSfp"]')?.remove();
				chipsZone.insertAdjacentHTML("afterbegin", '<sg-chip class="chip-add sw-sfp-chip" label="sfp ports"></sg-chip>');
				chipsZone.querySelector(".sw-sfp-chip").onclick = () => {
					sfpOpen = true;
					renderSwZone();
				};
			}
			sortChips();
		};
		roleSel.addEventListener("change", () => {
			/* picking a role re-defaults ip assignment (new devices only) — still freely changeable */
			const def = IP_DEFAULT_BY_ROLE[roleSel.value];
			if (def && ipSel.value !== def) {
				ipSel.value = def;
				renderNetZone();
			}
			renderSwZone();
		});
		renderSwZone();
	}

	/* ---- ports manager (edit mode): stays live via the overlay refresh registry ---- */
	if (!isNew) {
		const grid = document.createElement("fieldset");
		grid.className = "fieldset";
		const renderPorts = () => {
			const live = nodeById(node.id);
			if (!live) {
				grid.remove();
				return;
			}
			const rawIfs = ifacesOf(node.id);
			const isSwitch = PORT_GEN_ROLES.includes(node.attrs.role);
			let title = `Ports (${rawIfs.length})`;
			if (isSwitch) {
				const stdCount = rawIfs.filter(i => !!i.attrs.stdName && /^p\d+$/i.test(i.attrs.stdName)).length;
				title += ` Standard Ports (${stdCount})`;
			}
			
			const sortVal = (i) => {
				const sn = i.attrs.stdName;
				if (sn) {
					const pMatch = sn.match(/^p(\d+)$/i);
					if (pMatch) return { type: 1, num: parseInt(pMatch[1], 10), str: sn };
					if (sn === "eth0") return { type: 1, num: 0, str: sn };
				}
				return { type: 2, num: 0, str: i.name };
			};
			
			const ifs = [...rawIfs].sort((a, b) => {
				const sA = sortVal(a);
				const sB = sortVal(b);
				if (sA.type !== sB.type) return sA.type - sB.type;
				if (sA.type === 1) return sA.num - sB.num;
				return sA.str.localeCompare(sB.str, undefined, { numeric: true });
			});
			
			grid.innerHTML = `<legend>${title}</legend>
        <div class="subrows">${
					ifs
						.map((i) => {
							const p = peerOf(i.id);
							const link = linkOf(i.id);
							const isUneditedStdPort = !!i.attrs.stdName && i.name === i.attrs.stdName;
							const nameDisplay = isUneditedStdPort ? `<span class="mono dim"><b>${esc(i.name)}</b></span>` : `<span class="mono"><b>${esc(i.name)}</b></span>`;
							return `<div class="port-row"><div class="who">${nameDisplay}
            <span class="pill">${esc(i.attrs.portMode)}${i.attrs.accessVlan ? ` v${i.attrs.accessVlan}` : ""}</span>
            <div class="peer">${p ? "↔ " + esc(describeIfaceTarget(p)) + (link?.attrs?.jack ? ` · jack ${esc(link.attrs.jack)}` : "") + (link?.attrs?.cableColor ? ` · ${esc(link.attrs.cableColor)} cable` : "") : "unconnected"}</div></div>
            ${p ? `<button class="mini" data-unplug="${i.id}">unplug</button>` : `<button class="mini" data-plug="${i.id}">connect</button>`}
            <button class="mini" data-editp="${i.id}">edit</button></div>`;
						})
						.join("") || '<div class="dim ports-empty">No ports yet.</div>'
				}</div>
        <div class="addfield-menu addfield-chips">
          ${ifs.some(i => !peerOf(i.id)) ? `<sg-chip class="chip-add add-conn ports-action-btn" label="connection"></sg-chip>` : ""}
          <sg-chip class="chip-add add-port ports-action-btn" label="port"></sg-chip>
        </div>`;
			grid.querySelector(".add-port").onclick = () => portEditor(node.id);
			const addConnBtn = grid.querySelector(".add-conn");
			if (addConnBtn) addConnBtn.onclick = () => connectForm(null, node.id);
			grid
				.querySelectorAll("[data-plug]")
				.forEach((b) => (b.onclick = () => connectForm(b.dataset.plug)));
			grid
				.querySelectorAll("[data-unplug]")
				.forEach((b) => (b.onclick = () => confirmUnplug(b.dataset.unplug)));
			grid
				.querySelectorAll("[data-editp]")
				.forEach(
					(b) =>
						(b.onclick = () => portEditor(node.id, nodeById(b.dataset.editp))),
				);
		};
		renderPorts();
		o.querySelector(".modal-actions").before(grid);
		o._refresh =
			renderPorts; /* afterMutate re-renders every open overlay that registers */
	}
}

function editSiteMeta() {
	const s = store.doc.meta.site;
	const o = openOverlay(`
    <h2>Site</h2><div class="modal-meta">High-level details that identify this location.</div>
    <div class="form-grid">
      <div class="field full"><label>Site name</label><input id="sm-name" value="${esc(s.name)}"></div>
      <div class="field full"><label>Address</label><input id="sm-addr" value="${esc(s.address || "")}"></div>
      <div class="field full"><label>Notes</label><textarea id="sm-notes">${esc(s.notes || "")}</textarea></div>
    </div>
    <div class="modal-actions"><div></div><div class="right">
      <button class="btn quiet" data-close>Cancel</button>
      <button class="btn primary" id="sm-go">Save site</button></div></div>`);
	o.querySelector("#sm-go").onclick = () => {
		const name = o.querySelector("#sm-name").value.trim();
		if (!name) return;
		const r = mutate((doc) => {
			doc.meta.site.name = name;
			doc.meta.site.address = o.querySelector("#sm-addr").value.trim();
			doc.meta.site.notes = o.querySelector("#sm-notes").value.trim();
			pushLog("Site details updated");
		});
		if (r.ok) closeOverlay(o);
		else toast(r.errs[0], true);
	};
}

/* ================================================================
   CHECK (hygiene report) & EXPORTS
   ================================================================ */
function runHygiene() {
	const issues = [];
	const devs = nodesOfType("device");
	const dupes = {};
	const add = (kind, key, n) => {
		key = (key || "").trim();
		if (!key) return;
		const k = kind + "|" + key.toLowerCase();
		(dupes[k] = dupes[k] || { kind, key, nodes: [] }).nodes.push(n);
	};
	for (const d of devs) {
		add("Duplicate hostname", d.attrs.hostname, d);
		add("Duplicate MAC", d.attrs.mac, d);
	}
	for (const g of Object.values(dupes))
		if (g.nodes.length > 1)
			issues.push({
				msg: `${g.kind} “${g.key}”: ${g.nodes.map((x) => x.name).join(", ")}`,
				id: g.nodes[0].id,
			});
	/* duplicate names — allowed at write time (real fleets have them), but every one deserves a look */
	const nameGroups = {};
	for (const t of [
		"device",
		"location",
		"rack",
		"patch_panel",
		"person",
		"circuit",
	])
		for (const n of nodesOfType(t)) {
			const k = t + "|" + n.name.trim().toLowerCase();
			(nameGroups[k] = nameGroups[k] || []).push(n);
		}
	for (const g of Object.values(nameGroups))
		if (g.length > 1) {
			const what =
				g[0].type === "person"
					? "people"
					: NODE_TYPES[g[0].type].label.toLowerCase() + "s";
			issues.push({
				msg: `${g.length} ${what} share the name “${g[0].name}” — rename or delete the extras`,
				id: g[0].id,
			});
		}
	for (const d of devs) {
		if (isUnplaced(d.id))
			issues.push({
				msg: `${d.name} is unplaced — no location or rack`,
				id: d.id,
			});
		if (isUnconnected(d.id) && d.attrs.role !== "other")
			/* 'other' appliances legitimately stand alone — advisory only */
			issues.push({ msg: `${d.name} has no documented connection`, id: d.id });
		if (
			["static", "dhcp-reservation"].includes(d.attrs.ipAssignment) &&
			!ipsOf(d.id).length
		)
			issues.push({
				msg: `${d.name} is ${d.attrs.ipAssignment} but has no IP on record`,
				id: d.id,
			});
		if (IP_EXPECTED_ROLES.has(d.attrs.role) && d.attrs.ipAssignment === "none")
			issues.push({
				msg: `${d.name} is a ${d.attrs.role} with ip assignment "none" — its management IP should be documented`,
				id: d.id,
			});
	}
	for (const p of nodesOfType("patch_panel"))
		if (isUnplaced(p.id))
			issues.push({
				msg: `Patch panel ${p.name} is unplaced — placement is its whole job`,
				id: p.id,
			});
	for (const c of nodesOfType("circuit"))
		if (!outE(c.id, "terminated_at").length)
			issues.push({ msg: `Circuit ${c.name} is unterminated`, id: c.id });
	for (const ip of nodesOfType("ip_address"))
		if (!assignmentOfIp(ip.id))
			issues.push({ msg: `IP ${ip.name} is unassigned`, id: ip.id });
	for (const p of nodesOfType("prefix")) {
		if (!p.attrs.gatewayIp)
			issues.push({
				msg: `Prefix ${p.name} has no gateway documented`,
				id: p.id,
			});
		if (
			p.attrs.gatewayIp &&
			!store.doc.nodes.some(
				(n) => n.type === "ip_address" && n.name === p.attrs.gatewayIp,
			)
		)
			issues.push({
				msg: `Gateway ${p.attrs.gatewayIp} of ${p.name} is not on the IP ledger`,
				id: p.id,
			});
	}
	return issues;
}
function showHygiene() {
	const issues = runHygiene();
	const o = openOverlay(`
    <h2>Integrity check</h2>
    <div class="modal-meta">${issues.length ? issues.length + " advisory issue(s) — click one to open the record. Hard rules (duplicate IPs, double-patched ports, orphan records) are impossible states here: the schema rejects them at write time." : "No advisories. Hard rules are enforced at write time, so the document is consistent by construction."}</div>
    <ul class="history-list">${issues.map((i) => `<li class="history-item history-item--link" data-goto="${esc(i.id)}"><div class="history-summary">${esc(i.msg)}</div></li>`).join("") || '<li class="history-item dim">Nothing to report.</li>'}</ul>
    <div class="modal-actions"><div></div><div class="right"><button class="btn quiet" data-close>Close</button></div></div>`);
	o.querySelectorAll("[data-goto]").forEach(
		(li) =>
			(li.onclick = () => {
				closeOverlay(o);
				openEditor(li.dataset.goto);
			}),
	);
}

function downloadText(text, name, mime) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(
		new Blob([text], { type: mime || "text/plain" }),
	);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safeSiteName = () => slugify(store.doc.meta.site.name);
function exportCsv() {
	const esc2 = (v) => {
		v = String(v ?? "");
		return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
	};
	let cols, rows, name;
	if (currentTab === "ipam") {
		cols = COLS.ips;
		rows = nodesOfType("ip_address");
		name = "ips";
	} else if (currentTab === "locations") {
		cols = [
			{ label: "Name", get: (n) => n.name },
			{ label: "Kind", get: (n) => n.type },
			{ label: "Type", get: (n) => nodeKindLabel(n) },
			{ label: "Inside", get: (n) => locPath(n.id).join(" › ") },
		];
		rows = store.doc.nodes.filter(
			(n) =>
				n.type === "location" || n.type === "rack" || n.type === "patch_panel",
		);
		name = "locations";
	} else if (currentTab === "connections") {
		cols = [
			{ label: "Device A", get: (e) => nodeById(ownerOf(e.from))?.name },
			{ label: "Port A", get: (e) => nodeById(e.from).name },
			{ label: "Device B", get: (e) => nodeById(ownerOf(e.to))?.name },
			{ label: "Port B", get: (e) => nodeById(e.to).name },
			{ label: "Jack", get: (e) => e.attrs?.jack || "" },
			{ label: "Cable", get: (e) => e.attrs?.cableColor || "" },
			{ label: "Length", get: (e) => e.attrs?.length || "" },
		];
		rows = store.doc.edges.filter((e) => e.type === "connected_to");
		name = "connections";
	} else {
		const map = {
			devices: ["devices", "device", visCols("devices", COLS.devices)],
			people: ["people", "person", visCols("people", COLS.people)],
		};
		const m = map[currentTab] || map.devices;
		name = m[0];
		rows = store.doc.nodes.filter((n) => n.type === m[1]);
		cols = m[2];
	}
	const getText = (c, r) => {
		const v = c.get(r);
		return typeof v === "number" && (c.key === "ip" || c.key === "name")
			? (r.name ?? v)
			: v;
	};
	const lines = [cols.map((c) => esc2(c.label)).join(",")];
	for (const r of rows)
		lines.push(cols.map((c) => esc2(getText(c, r))).join(","));
	downloadText(lines.join("\n"), `${safeSiteName()}-${name}.csv`, "text/csv");
}
function exportCypher() {
	const L = ["// SiteGraph export — schema v3 — " + nowISO(), "// Nodes"];
	const label = (t) =>
		({
			location: "Location",
			rack: "Rack",
			patch_panel: "PatchPanel",
			device: "Device",
			interface: "Interface",
			circuit: "Circuit",
			prefix: "Prefix",
			ip_address: "IpAddress",
			person: "Person",
		})[t];
	const lit = (v) =>
		typeof v === "boolean" || typeof v === "number"
			? String(v)
			: `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
	for (const n of store.doc.nodes) {
		const props = {
			id: n.id,
			name: n.name,
			updatedAt: n.updatedAt,
			...n.attrs,
		};
		L.push(
			`CREATE (:${label(n.type)} {${Object.entries(props)
				.map(([k, v]) => `${k}: ${lit(v)}`)
				.join(", ")}});`,
		);
	}
	L.push("", "// Relationships");
	for (const e of store.doc.edges) {
		const props =
			e.attrs && Object.keys(e.attrs).length
				? ` {${Object.entries(e.attrs)
						.map(([k, v]) => `${k}: ${lit(v)}`)
						.join(", ")}}`
				: "";
		L.push(
			`MATCH (a {id: ${lit(e.from)}}), (b {id: ${lit(e.to)}}) CREATE (a)-[:${e.type.toUpperCase()}${props}]->(b);`,
		);
	}
	downloadText(L.join("\n"), safeSiteName() + ".cypher", "text/plain");
}
function exportDigest() {
	const site = store.doc.meta.site;
	const L = [
		`# Network Documentation Digest: ${site.name}`,
		"",
		`**Generated:** ${nowISO()}`,
		`**Schema Version:** ${SCHEMA_VERSION}`,
		`**Address:** ${site.address || "N/A"}`,
		"",
		`> This document is intended for LLM/Agent consumption. It provides a complete map of the site's network infrastructure.`,
		""
	];
	const rel = [];
	for (const e of store.doc.edges) {
		const a = nodeById(e.from), b = nodeById(e.to);
		if (!a || !b) continue;
		const extra = e.attrs && Object.keys(e.attrs).length
				? ` (${Object.entries(e.attrs).map(([k, v]) => `${k}="${v}"`).join(" ")})`
				: "";
		rel.push(`- \`${a.id}\` (${a.type}) --[ ${e.type}${extra} ]--> \`${b.id}\` (${b.type})`);
	}
	for (const [type, T] of Object.entries(NODE_TYPES)) {
		const list = store.doc.nodes.filter((n) => n.type === type);
		if (!list.length) continue;
		L.push(`## ${T.label}s`, "");
		for (const n of list) {
			const attrs = Object.entries(n.attrs).map(([k, v]) => `**${k}**: \`${v}\``).join(" | ");
			const wh = locPath(n.id);
			L.push(`### ${n.name}`);
			L.push(`- **ID**: \`${n.id}\``);
			if (wh.length) L.push(`- **Location**: ${wh.join(" › ")}`);
			if (attrs) L.push(`- **Attributes**: ${attrs}`);
			L.push("");
		}
	}
	L.push("## Relationship Triples", "", ...rel, "");
	downloadText(
		L.join("\n"),
		safeSiteName() + "-llm-digest.md",
		"text/markdown",
	);
}

export { deviceEditor, locationEditor, rackEditor, patchPanelEditor, personEditor, circuitEditor, prefixEditor, ipEditor, portEditor, connectForm, openEditor, flipConnection, connectionEditor, editSiteMeta, showHygiene, exportCsv, exportCypher, exportDigest, readRackVals, attachRackZone, showHistory, showActivity, confirmDelete, confirmReset, confirmUnplug, downloadText };
