/* ============================== validator ============================== */
import { isPlainObj, ISO_RE } from './utils.js';
import { parseCidr, isIp4, ip4ToInt, intToIp4, cidrHasHost } from './ipv4.js';
import { ENUMS, NODE_TYPES, EDGE_TYPES, SCHEMA_VERSION, LOG_CAP, HISTORY_CAP } from './schema.js';

function checkAttrVal(spec, v) {
	switch (spec.t) {
		case "text":
			return typeof v === "string" ? null : "must be a string";
		case "bool":
			return typeof v === "boolean" ? null : "must be true/false";
		case "int":
			if (typeof v !== "number" || !Number.isInteger(v))
				return "must be an integer";
			if (spec.min !== undefined && v < spec.min)
				return `must be ≥ ${spec.min}`;
			if (spec.max !== undefined && v > spec.max)
				return `must be ≤ ${spec.max}`;
			return null;
		case "enum":
			return ENUMS[spec.e].includes(v)
				? null
				: `must be one of: ${ENUMS[spec.e].join(", ")}`;
		case "ip":
			return isIp4(v) ? null : "must be a valid IPv4 address";
		case "object":
			if (!isPlainObj(v)) return "must be an object";
			for (const [ck, cv] of Object.entries(v)) {
				if (
					typeof cv !== "string" &&
					typeof cv !== "number" &&
					typeof cv !== "boolean"
				)
					return `custom attribute "${ck}" must be a string, number, or boolean`;
			}
			return null;
		default:
			return "unknown spec";
	}
}
function checkAttrs(where, attrs, req, opt, errs) {
	if (!isPlainObj(attrs)) {
		errs.push(`${where}: "attrs" must be an object`);
		return;
	}
	for (const [k, spec] of Object.entries(req)) {
		if (!(k in attrs)) {
			errs.push(`${where}: missing required attr "${k}"`);
			continue;
		}
		const e = checkAttrVal(spec, attrs[k]);
		if (e) errs.push(`${where}: attr "${k}" ${e}`);
	}
	for (const [k, v] of Object.entries(attrs)) {
		if (k in req) continue;
		if (!(k in opt)) {
			errs.push(`${where}: unknown attr "${k}"`);
			continue;
		}
		const e = checkAttrVal(opt[k], v);
		if (e) errs.push(`${where}: attr "${k}" ${e}`);
	}
}
function checkLogArray(where, arr, cap, errs) {
	if (!Array.isArray(arr)) {
		errs.push(`${where} must be an array`);
		return;
	}
	if (arr.length > cap)
		errs.push(`${where} exceeds cap of ${cap} entries (${arr.length})`);
	arr.forEach((e, i) => {
		if (
			!isPlainObj(e) ||
			typeof e.ts !== "string" ||
			typeof e.summary !== "string"
		)
			errs.push(`${where}[${i}] must be {ts, summary}`);
		else if (!ISO_RE.test(e.ts)) errs.push(`${where}[${i}].ts is not ISO-8601`);
	});
}

export function validateDoc(doc) {
	const errs = [];
	if (!isPlainObj(doc)) {
		return ["Root: document must be a JSON object"];
	}

	/* --- meta --- */
	if (!isPlainObj(doc.meta)) errs.push('Root: missing "meta" object');
	else {
		if (doc.meta.schemaVersion !== SCHEMA_VERSION)
			errs.push(
				`meta.schemaVersion must be ${SCHEMA_VERSION} (found ${JSON.stringify(doc.meta.schemaVersion)})`,
			);
		if (
			!isPlainObj(doc.meta.site) ||
			typeof doc.meta.site.name !== "string" ||
			!doc.meta.site.name.trim()
		)
			errs.push("meta.site.name is required (non-empty string)");
		checkLogArray("meta.log", doc.meta.log, LOG_CAP, errs);
	}
	if (!Array.isArray(doc.nodes)) errs.push('Root: "nodes" must be an array');
	if (!Array.isArray(doc.edges)) errs.push('Root: "edges" must be an array');
	if (errs.length) return errs; /* structure too broken to continue */

	/* --- nodes --- */
	const byId = new Map();
	const namesByType = new Map();
	doc.nodes.forEach((n, i) => {
		const w = `nodes[${i}]${n && n.id ? ` (${n.id})` : ""}`;
		if (!isPlainObj(n)) {
			errs.push(`${w}: must be an object`);
			return;
		}
		if (typeof n.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(n.id))
			errs.push(`${w}: "id" must be a lowercase slug`);
		else if (byId.has(n.id))
			errs.push(`${w}: duplicate id "${n.id}" — ids are globally unique`);
		else byId.set(n.id, n);
		const T = NODE_TYPES[n.type];
		if (!T) {
			errs.push(`${w}: unknown node type "${n.type}"`);
			return;
		}
		if (typeof n.name !== "string" || !n.name.trim())
			errs.push(`${w}: "name" must be a non-empty string`);
		if (typeof n.updatedAt !== "string" || !ISO_RE.test(n.updatedAt))
			errs.push(`${w}: "updatedAt" must be an ISO-8601 timestamp`);
		checkLogArray(`${w}.history`, n.history, HISTORY_CAP, errs);
		checkAttrs(w, n.attrs, T.required, T.optional, errs);
		/* identity-typed names */
		if (T.nameRule === "cidr") {
			const c = parseCidr(n.name);
			if (!c)
				errs.push(`${w}: prefix name "${n.name}" is not valid CIDR notation`);
			else if (!c.isNetworkAddr)
				errs.push(
					`${w}: "${n.name}" has host bits set — network address is ${intToIp4(c.net)}/${c.bits}`,
				);
			else if (isPlainObj(n.attrs)) {
				for (const k of ["gatewayIp", "dhcpStart", "dhcpEnd"])
					if (
						typeof n.attrs[k] === "string" &&
						isIp4(n.attrs[k]) &&
						!cidrHasHost(c, ip4ToInt(n.attrs[k]))
					)
						errs.push(`${w}: attr "${k}" (${n.attrs[k]}) is outside ${n.name}`);
				if (
					isIp4(n.attrs.dhcpStart) &&
					isIp4(n.attrs.dhcpEnd) &&
					ip4ToInt(n.attrs.dhcpStart) > ip4ToInt(n.attrs.dhcpEnd)
				)
					errs.push(`${w}: dhcpStart is after dhcpEnd`);
			}
		}
		if (T.nameRule === "ipv4" && !isIp4(n.name))
			errs.push(
				`${w}: ip_address name "${n.name}" is not a valid IPv4 address`,
			);
		if (T.nameRule) {
			/* prefix + ip names are identities → unique within type */
			const key = n.type + "|" + String(n.name).trim();
			if (namesByType.has(key))
				errs.push(`${w}: duplicate ${T.label.toLowerCase()} "${n.name}"`);
			namesByType.set(key, true);
		}
	});

	/* --- edges --- */
	const perFrom = new Map(); /* `${from}|${type}` → count */
	const ifaceTouch = new Map(); /* interface id → connected_to count */
	const ifaceOwner = new Map(); /* interface id → owner count */
	const ipMember = new Map(); /* ip id → member_of count */
	const seenEdge = new Map();
	doc.edges.forEach((e, i) => {
		const w = `edges[${i}]`;
		if (!isPlainObj(e)) {
			errs.push(`${w}: must be an object`);
			return;
		}
		const E = EDGE_TYPES[e.type];
		if (!E) {
			errs.push(`${w}: unknown edge type "${e.type}"`);
			return;
		}
		const wf = `${w} (${e.from} -${e.type}→ ${e.to})`;
		const nf = byId.get(e.from),
			nt = byId.get(e.to);
		if (!nf) {
			errs.push(`${wf}: "from" references missing node "${e.from}"`);
			return;
		}
		if (!nt) {
			errs.push(`${wf}: "to" references missing node "${e.to}"`);
			return;
		}
		if (!E.from.includes(nf.type))
			errs.push(
				`${wf}: source type "${nf.type}" not allowed (allowed: ${E.from.join(", ")})`,
			);
		if (!E.to.includes(nt.type))
			errs.push(
				`${wf}: target type "${nt.type}" not allowed (allowed: ${E.to.join(", ")})`,
			);
		if (e.from === e.to) errs.push(`${wf}: self-referencing edge`);
		if ("attrs" in e) checkAttrs(wf, e.attrs, {}, E.attrs, errs);
		const dupKey = E.undirected
			? [e.type, ...[e.from, e.to].sort()].join("|")
			: `${e.from}|${e.type}|${e.to}`;
		if (seenEdge.has(dupKey)) errs.push(`${wf}: duplicate edge`);
		seenEdge.set(dupKey, true);
		const fk = `${e.from}|${e.type}`;
		perFrom.set(fk, (perFrom.get(fk) || 0) + 1);
		if (E.maxPerFrom && perFrom.get(fk) > E.maxPerFrom)
			errs.push(
				`${wf}: "${nf.name}" already has a ${e.type} edge (max ${E.maxPerFrom})`,
			);
		if (e.type === "connected_to") {
			for (const id of [e.from, e.to]) {
				ifaceTouch.set(id, (ifaceTouch.get(id) || 0) + 1);
				if (ifaceTouch.get(id) > 1)
					errs.push(
						`${wf}: interface "${(byId.get(id) || {}).name || id}" already has a connection (max 1 per port)`,
					);
			}
		}
		if (e.type === "has_interface") {
			ifaceOwner.set(e.to, (ifaceOwner.get(e.to) || 0) + 1);
			if (ifaceOwner.get(e.to) > 1)
				errs.push(`${wf}: interface has more than one owner device`);
		}
		if (e.type === "member_of") {
			ipMember.set(e.from, (ipMember.get(e.from) || 0) + 1);
			const c = parseCidr(nt.name);
			if (c && !cidrHasHost(c, ip4ToInt(nf.name)))
				errs.push(
					`${wf}: IP ${nf.name} is not a usable host address inside ${nt.name}`,
				);
		}
		if (e.type === "assigned_to") {
			const dev =
				nt.type === "device"
					? nt
					: byId.get(
							(
								doc.edges.find(
									(x) => x.type === "has_interface" && x.to === e.to,
								) || {}
							).from,
						);
			if (!dev) errs.push(`${wf}: target interface has no owner device`);
			else if (
				!["static", "dhcp-reservation"].includes((dev.attrs || {}).ipAssignment)
			)
				errs.push(
					`${wf}: device "${dev.name}" must be set to static or dhcp-reservation to hold an IP (currently "${(dev.attrs || {}).ipAssignment}")`,
				);
		}
	});

	/* every interface needs exactly one owner; every IP exactly one prefix */
	for (const n of doc.nodes) {
		if (n.type === "interface" && (ifaceOwner.get(n.id) || 0) !== 1)
			errs.push(
				`Interface "${n.name}" (${n.id}) must have exactly 1 owner device (has ${ifaceOwner.get(n.id) || 0})`,
			);
		if (n.type === "ip_address" && (ipMember.get(n.id) || 0) !== 1)
			errs.push(
				`IP ${n.name} (${n.id}) must belong to exactly 1 prefix (has ${ipMember.get(n.id) || 0})`,
			);
	}

	/* one physical port, one record: port names are unique per device (case-insensitive) */
	const portNames = new Map();
	for (const e of doc.edges) {
		if (!isPlainObj(e) || e.type !== "has_interface") continue;
		const p = byId.get(e.to);
		if (!p || p.type !== "interface" || typeof p.name !== "string") continue;
		const k = e.from + "|" + p.name.trim().toLowerCase();
		if (portNames.has(k))
			errs.push(
				`Device "${(byId.get(e.from) || {}).name || e.from}" has two ports named "${p.name}" — port names must be unique per device`,
			);
		else portNames.set(k, true);
	}

	/* location containment cycles */
	const parent = new Map();
	for (const e of doc.edges)
		if (e.type === "located_in" && (byId.get(e.from) || {}).type === "location")
			parent.set(e.from, e.to);
	for (const [start] of parent) {
		const seen = new Set([start]);
		let cur = parent.get(start);
		while (cur) {
			if (seen.has(cur)) {
				errs.push(
					`Location containment cycle detected involving "${(byId.get(start) || {}).name}"`,
				);
				break;
			}
			seen.add(cur);
			cur = parent.get(cur);
		}
	}
	return errs;
}
