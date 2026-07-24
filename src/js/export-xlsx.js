import * as XLSX from 'xlsx';

/**
 * Denormalizes a SiteGraph JSON document into structured plain-text rows for spreadsheet sheets.
 * @param {Object} doc The full SiteGraph JSON document
 * @returns {Object} A map of sheet names to arrays of row objects
 */
function denormalizeSiteGraph(doc) {
	const nodes = doc.nodes || [];
	const edges = doc.edges || [];

	// Build lookups
	const nodeById = new Map();
	nodes.forEach(n => nodeById.set(n.id, n));

	const edgesByType = new Map();
	edges.forEach(e => {
		if (!edgesByType.has(e.type)) edgesByType.set(e.type, []);
		edgesByType.get(e.type).push(e);
	});

	// Helper to find all edges of a type originating from a specific node
	const getEdgesFrom = (nodeId, edgeType) => (edgesByType.get(edgeType) || []).filter(e => e.from === nodeId);
	
	// Helper to find all edges of a type pointing to a specific node
	const getEdgesTo = (nodeId, edgeType) => (edgesByType.get(edgeType) || []).filter(e => e.to === nodeId);

	// Reverse lookup for interfaces to devices
	const interfaceToDevice = new Map();
	(edgesByType.get('has_interface') || []).forEach(e => {
		interfaceToDevice.set(e.to, nodeById.get(e.from));
	});

	// Reverse lookup for devices to people
	const deviceToPerson = new Map();
	(edgesByType.get('used_by') || []).forEach(e => {
		deviceToPerson.set(e.from, nodeById.get(e.to));
	});

	// Reverse lookup for IPs to prefixes
	const ipToPrefix = new Map();
	(edgesByType.get('member_of') || []).forEach(e => {
		ipToPrefix.set(e.from, nodeById.get(e.to));
	});

	// Reverse lookup for IPs to devices
	const deviceToIp = new Map();
	(edgesByType.get('assigned_to') || []).forEach(e => {
		deviceToIp.set(e.to, nodeById.get(e.from)); // to=device, from=ip
	});

	const sheets = {
		Meta: [],
		Devices: [],
		Locations: [],
		Connections: [],
		IPAM: [],
		People: []
	};

	// 1. Meta Sheet
	const meta = doc.meta || {};
	const site = meta.site || {};
	sheets.Meta.push(
		{ Attribute: 'Site Name', Value: site.name || '' },
		{ Attribute: 'Address', Value: site.address || '' },
		{ Attribute: 'Notes', Value: site.notes || '' },
		{ Attribute: 'Schema Version', Value: meta.schemaVersion || 3 }
	);

	// 2. Devices Sheet
	const devices = nodes.filter(n => n.type === 'device');
	devices.forEach(d => {
		const locEdge = getEdgesFrom(d.id, 'located_in')[0];
		const location = locEdge ? nodeById.get(locEdge.to) : null;
		
		const rackEdge = getEdgesFrom(d.id, 'mounted_in')[0];
		const rack = rackEdge ? nodeById.get(rackEdge.to) : null;
		const rackU = rackEdge?.attrs?.rackU || '';

		const assignedIp = deviceToIp.get(d.id);
		const assignedUser = deviceToPerson.get(d.id);

		sheets.Devices.push({
			'ID': d.id,
			'Name': d.name,
			'Hostname': d.attrs?.hostname || '',
			'Department': d.attrs?.department || '',
			'Role': d.attrs?.role || '',
			'IP Assignment': d.attrs?.ipAssignment || '',
			'Primary IP': assignedIp ? assignedIp.name : '',
			'DHCP Network': d.attrs?.dhcpNetwork || '',
			'MAC Address': d.attrs?.mac || '',
			'Manufacturer': d.attrs?.manufacturer || '',
			'Model': d.attrs?.model || '',
			'Serial Number': d.attrs?.serial || '',
			'Asset Tag': d.attrs?.assetTag || '',
			'DMS ID': d.attrs?.dmsId || '',
			'PoE Support': d.attrs?.poe !== undefined ? String(d.attrs.poe) : '',
			'Location': location ? location.name : '',
			'Rack Placement': rack ? `${rack.name} (U${rackU})` : '',
			'Assigned User': assignedUser ? assignedUser.name : '',
			'Notes': d.attrs?.notes || '',
			'Custom JSON': d.attrs?.custom ? JSON.stringify(d.attrs.custom) : ''
		});
	});

	// 3. Locations Sheet
	const locations = nodes.filter(n => ['location', 'rack', 'patch_panel'].includes(n.type));
	locations.forEach(loc => {
		const locEdge = getEdgesFrom(loc.id, 'located_in')[0];
		const parentLoc = locEdge ? nodeById.get(locEdge.to) : null;

		const rackEdge = getEdgesFrom(loc.id, 'mounted_in')[0];
		const parentRack = rackEdge ? nodeById.get(rackEdge.to) : null;
		const rackU = rackEdge?.attrs?.rackU || '';

		sheets.Locations.push({
			'ID': loc.id,
			'Type': loc.type,
			'Location Type': loc.attrs?.locationType || '',
			'Name': loc.name,
			'Parent Location': parentLoc ? parentLoc.name : '',
			'Rack Location': parentRack ? `${parentRack.name} (U${rackU})` : '',
			'Rack Height (U)': loc.attrs?.heightU || '',
			'Panel Jack Count': loc.attrs?.jackCount || '',
			'Notes': loc.attrs?.notes || ''
		});
	});

	// 4. Connections Sheet
	const connections = edgesByType.get('connected_to') || [];
	// Create a unique set of connections to avoid double counting undirected edges
	const seenConnections = new Set();
	connections.forEach(conn => {
		// Sort IDs to ensure undirected deduplication
		const pair = [conn.from, conn.to].sort().join('--');
		if (seenConnections.has(pair)) return;
		seenConnections.add(pair);

		const ifaceA = nodeById.get(conn.from);
		const ifaceB = nodeById.get(conn.to);
		if (!ifaceA || !ifaceB) return;

		const devA = interfaceToDevice.get(ifaceA.id);
		const devB = interfaceToDevice.get(ifaceB.id);

		sheets.Connections.push({
			'Device A': devA ? devA.name : 'Unknown',
			'Port A': ifaceA.name,
			'Port A Mode': ifaceA.attrs?.portMode || '',
			'Port A PoE Support': ifaceA.attrs?.poe || '',
			'Device B': devB ? devB.name : 'Unknown',
			'Port B': ifaceB.name,
			'Port B Mode': ifaceB.attrs?.portMode || '',
			'Port B PoE Support': ifaceB.attrs?.poe || '',
			'Cable Category': conn.attrs?.category || '',
			'Cable Color': conn.attrs?.cableColor || '',
			'Cable Length': conn.attrs?.length || '',
			'Jack': conn.attrs?.jack || '',
			'Notes': conn.attrs?.notes || ''
		});
	});

	// 5. IPAM Sheet
	const ipamNodes = nodes.filter(n => ['prefix', 'ip_address'].includes(n.type));
	ipamNodes.forEach(node => {
		const parentPrefix = ipToPrefix.get(node.id);
		let assignedTo = '';
		if (node.type === 'ip_address') {
			const assignedEdge = getEdgesFrom(node.id, 'assigned_to')[0];
			if (assignedEdge) {
				const assignedNode = nodeById.get(assignedEdge.to);
				if (assignedNode) {
					assignedTo = assignedNode.name;
					// If it's an interface, try to prefix with device name
					if (assignedNode.type === 'interface') {
						const dev = interfaceToDevice.get(assignedNode.id);
						assignedTo = dev ? `${dev.name} (${assignedNode.name})` : assignedNode.name;
					}
				}
			}
		}

		sheets.IPAM.push({
			'Entry Type': node.type,
			'IP / Network CIDR': node.name,
			'Description': node.attrs?.description || '',
			'VLAN ID': node.attrs?.vlanId || '',
			'Gateway IP': node.attrs?.gatewayIp || '',
			'DHCP Start': node.attrs?.dhcpStart || '',
			'DHCP End': node.attrs?.dhcpEnd || '',
			'Subnet Membership': parentPrefix ? parentPrefix.name : '',
			'Assigned Device': assignedTo,
			'Notes': node.attrs?.notes || ''
		});
	});

	// 6. People Sheet
	const people = nodes.filter(n => n.type === 'person');
	people.forEach(person => {
		const usedByEdges = getEdgesTo(person.id, 'used_by');
		const assignedDevices = usedByEdges.map(e => nodeById.get(e.from)?.name).filter(Boolean).join(', ');

		const locEdge = getEdgesFrom(person.id, 'located_in')[0];
		const location = locEdge ? nodeById.get(locEdge.to) : null;

		sheets.People.push({
			'ID': person.id,
			'Full Name': person.name,
			'Department': person.attrs?.department || '',
			'Title': person.attrs?.title || '',
			'Email': person.attrs?.email || '',
			'Extension': person.attrs?.extension || '',
			'DID Phone': person.attrs?.did || '',
			'Assigned Devices': assignedDevices,
			'Location': location ? location.name : '',
			'Notes': person.attrs?.notes || ''
		});
	});

	return sheets;
}

/**
 * Generates an XLSX file blob from the SiteGraph document.
 * @param {Object} doc The full SiteGraph JSON document
 * @returns {Blob} The XLSX file as a blob
 */
export function generateXlsxBlob(doc) {
	const sheetsData = denormalizeSiteGraph(doc);
	const workbook = XLSX.utils.book_new();

	for (const [sheetName, rows] of Object.entries(sheetsData)) {
		const worksheet = XLSX.utils.json_to_sheet(rows);
		
		// Enforce all cells (except headers maybe) to string type to prevent Google Sheets 
		// from auto-converting IPs, MACs, dates, and numbers.
		const range = XLSX.utils.decode_range(worksheet['!ref']);
		for (let R = range.s.r + 1; R <= range.e.r; ++R) { // Skip header row (0)
			for (let C = range.s.c; C <= range.e.c; ++C) {
				const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
				const cell = worksheet[cellAddress];
				if (cell && cell.t !== 's' && cell.v != null) {
					// Convert to string and set type 's'
					cell.t = 's';
					cell.v = String(cell.v);
				}
			}
		}

		XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
	}

	// Write workbook to a binary array and then to a Blob
	const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
	return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
