/* ============================== schema ============================== */
/**
 * @typedef {Object} HistoryEntry
 * @property {string} ts - ISO-8601 timestamp
 * @property {string} summary - Human-readable summary of the mutation
 */

/**
 * @typedef {Object} Node
 * @property {string} id - Globally unique lowercase slug
 * @property {string} type - Node type (e.g., 'device', 'location')
 * @property {string} name - Human-readable label or identity (e.g., CIDR, IPv4)
 * @property {string} updatedAt - ISO-8601 timestamp
 * @property {Object.<string, any>} attrs - Type-specific attributes
 * @property {HistoryEntry[]} [history] - Audit log for this node
 */

/**
 * @typedef {Object} Edge
 * @property {string} from - Source Node ID
 * @property {string} type - Edge type (e.g., 'connected_to')
 * @property {string} to - Target Node ID
 * @property {Object.<string, any>} [attrs] - Edge-specific attributes
 */

/**
 * @typedef {Object} DocumentMeta
 * @property {number} schemaVersion - Schema version integer
 * @property {{name: string}} site - Site metadata
 * @property {HistoryEntry[]} log - Global activity log
 */

/**
 * @typedef {Object} SiteGraphDocument
 * @property {DocumentMeta} meta - Document metadata and global log
 * @property {Node[]} nodes - Array of graph nodes
 * @property {Edge[]} edges - Array of graph edges
 */
export const ENUMS = {
	locationType: [
		"MDF",
		"IDF",
		"building",
		"department",
		"office",
		"room",
		"closet",
		"showroom",
		"outdoor",
		"other",
	],
	poeType: ["PoE", "PoE+", "PoE++"],
	role: [
		"firewall",
		"router",
		"modem",
		"core-switch",
		"switch",
		"server",
		"pbx",
		"nvr",
		"ap",
		"ups",
		"desktop",
		"laptop",
		"phone",
		"printer",
		"mfp",
		"camera",
		"tablet",
		"tv",
		"other",
	],
	ipAssignment: ["static", "dhcp", "dhcp-reservation", "none"],
	portMode: ["access", "trunk"],
	media: ["copper", "fiber", "sfp", "sfp+", "wireless", "other"],
	circuitType: ["internet", "mpls", "p2p", "sip", "pots", "other"],
};
export const GATEWAY_ROLES = ["firewall", "router"];
export const SWITCH_ROLES = ["core-switch", "switch"];
/* roles whose ports are bulk-generated at creation (p1…pN) — port count is required for these */
export const PORT_GEN_ROLES = ["core-switch", "switch"];
/* new-device default for ip assignment, by role — just a starting value, freely changeable */
export const IP_DEFAULT_BY_ROLE = {
	firewall: "static",
	router: "static",
	"core-switch": "static",
	switch: "static",
	server: "static",
	pbx: "static",
	nvr: "static",
	ap: "dhcp-reservation",
	ups: "dhcp-reservation",
	modem: "none",
	other: "none",
	desktop: "dhcp",
	laptop: "dhcp",
	phone: "dhcp",
	printer: "dhcp",
	mfp: "dhcp",
	camera: "dhcp",
	tablet: "dhcp",
	tv: "dhcp",
};
/* roles where ip assignment "none" is almost certainly an oversight — surfaced by Check */
export const IP_EXPECTED_ROLES = new Set([
	"firewall",
	"router",
	"core-switch",
	"switch",
	"server",
	"pbx",
	"nvr",
]);
/* roles you plug endpoints INTO — targets of quick connect; all other roles are endpoints */
export const INFRA_ROLES = new Set([
	"firewall",
	"router",
	"modem",
	"core-switch",
	"switch",
	"server",
	"pbx",
	"nvr",
]);

/* attr spec: t = text|int|bool|enum|ip ; e = enum name ; min/max for ints */
export const NODE_TYPES = {
	location: {
		label: "Location",
		idp: "loc",
		required: { locationType: { t: "enum", e: "locationType" } },
		optional: { notes: { t: "text", area: true }, custom: { t: "object" } },
	},
	rack: {
		label: "Rack",
		idp: "rack",
		required: { heightU: { t: "int", min: 1, max: 100 } },
		optional: { notes: { t: "text", area: true }, custom: { t: "object" } },
	},
	/* passive location-subset, not a device: jacks land here, the panel itself is documentation */
	patch_panel: {
		label: "Patch panel",
		idp: "pp",
		required: { jackCount: { t: "int", min: 1, max: 999 } },
		optional: { notes: { t: "text", area: true }, custom: { t: "object" } },
	},
	device: {
		label: "Device",
		idp: "dev",
		required: {
			role: { t: "enum", e: "role" },
			ipAssignment: { t: "enum", e: "ipAssignment" },
		},
		optional: {
			hostname: { t: "text" },
			mac: { t: "text" },
			department: { t: "text" },
			dhcpNetwork: { t: "text" },
			assetTag: { t: "text" },
			dmsId: { t: "text" },
			manufacturer: { t: "text" },
			model: { t: "text" },
			serial: { t: "text" },
			poe: { t: "enum", e: "poeType" },
			notes: { t: "text", area: true },
			custom: { t: "object" },
		},
	},
	interface: {
		label: "Interface",
		idp: "if",
		required: { portMode: { t: "enum", e: "portMode" } },
		optional: {
			stdName: { t: "text" },
			accessVlan: { t: "int", min: 1, max: 4094 },
			nativeVlan: { t: "int", min: 1, max: 4094 },
			allowedVlans: { t: "text" },
			media: { t: "enum", e: "media" },
			poe: { t: "enum", e: "poeType" },
			notes: { t: "text", area: true },
			custom: { t: "object" },
		},
	},
	circuit: {
		label: "Circuit",
		idp: "ckt",
		required: {
			provider: { t: "text" },
			circuitType: { t: "enum", e: "circuitType" },
		},
		optional: {
			bandwidth: { t: "text" },
			circuitId: { t: "text" },
			wanIp: { t: "text" },
			staticBlock: { t: "text" },
			ispGateway: { t: "text" },
			notes: { t: "text", area: true },
			custom: { t: "object" },
		},
	},
	prefix: {
		label: "Prefix",
		idp: "pfx",
		nameRule: "cidr",
		required: {},
		optional: {
			description: { t: "text" },
			vlanId: { t: "int", min: 1, max: 4094 },
			gatewayIp: { t: "ip" },
			dhcpRanges: { t: "array" },
			notes: { t: "text", area: true },
			custom: { t: "object" },
		},
	},
	ip_address: {
		label: "IP address",
		idp: "ip",
		nameRule: "ipv4",
		required: {},
		optional: { description: { t: "text" }, notes: { t: "text", area: true }, custom: { t: "object" } },
	},
	person: {
		label: "Person",
		idp: "per",
		required: { department: { t: "text" } },
		optional: {
			title: { t: "text" },
			extension: { t: "text" },
			did: { t: "text" },
			email: { t: "text" },
			notes: { t: "text", area: true },
			custom: { t: "object" },
		},
	},
};

export const EDGE_TYPES = {
	located_in: {
		from: ["rack", "device", "person", "location", "patch_panel"],
		to: ["location"],
		maxPerFrom: 1,
		attrs: {},
	},
	mounted_in: {
		from: ["device", "patch_panel"],
		to: ["rack"],
		maxPerFrom: 1,
		attrs: { rackU: { t: "int", min: 1, max: 100 } },
	},
	has_interface: {
		from: ["device"],
		to: ["interface"],
		attrs: {},
	} /* + exactly-one-owner rule */,
	connected_to: {
		from: ["interface"],
		to: ["interface"],
		undirected: true,
		attrs: {
			category: { t: "text" },
			cableColor: { t: "text" },
			length: { t: "text" },
			jack: { t: "text" },
			notes: { t: "text" },
		},
	},
	terminated_at: {
		from: ["circuit"],
		to: ["interface"],
		maxPerFrom: 1,
		attrs: {},
	},
	member_of: {
		from: ["ip_address"],
		to: ["prefix"],
		maxPerFrom: 1,
		attrs: {},
	} /* + exactly-one rule */,
	assigned_to: {
		from: ["ip_address"],
		to: ["device", "interface"],
		maxPerFrom: 1,
		attrs: {},
	},
	used_by: { from: ["device"], to: ["person"], maxPerFrom: 1, attrs: {} },
};
export const HISTORY_CAP = 30,
	LOG_CAP = 100,
	SCHEMA_VERSION = 3;
