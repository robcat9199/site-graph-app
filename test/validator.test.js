import { describe, it, expect } from 'vitest';
import { validateDoc } from '../src/js/validator.js';
import { SCHEMA_VERSION } from '../src/js/schema.js';

describe('Validator module', () => {
	const validMeta = {
		schemaVersion: SCHEMA_VERSION,
		site: { name: 'Test Site' },
		log: []
	};

	it('should accept a valid blank document', () => {
		const doc = {
			meta: validMeta,
			nodes: [],
			edges: []
		};
		const errors = validateDoc(doc);
		expect(errors).toEqual([]);
	});

	it('should reject non-object root', () => {
		expect(validateDoc(null)).toContain('Root: document must be a JSON object');
		expect(validateDoc('string')).toContain('Root: document must be a JSON object');
	});

	it('should reject invalid meta schema version', () => {
		const doc = {
			meta: { ...validMeta, schemaVersion: 999 },
			nodes: [],
			edges: []
		};
		const errors = validateDoc(doc);
		expect(errors[0]).toMatch(/meta\.schemaVersion must be/);
	});

	it('should reject missing site name', () => {
		const doc = {
			meta: { ...validMeta, site: { name: '' } },
			nodes: [],
			edges: []
		};
		expect(validateDoc(doc)).toContain('meta.site.name is required (non-empty string)');
	});

	it('should reject duplicate node IDs', () => {
		const doc = {
			meta: validMeta,
			nodes: [
				{ id: 'node-1', type: 'device', name: 'Dev 1', updatedAt: new Date().toISOString(), attrs: {} },
				{ id: 'node-1', type: 'device', name: 'Dev 2', updatedAt: new Date().toISOString(), attrs: {} }
			],
			edges: []
		};
		const errors = validateDoc(doc);
		expect(errors.some(e => e.includes('duplicate id "node-1"'))).toBe(true);
	});

	it('should reject location containment cycles', () => {
		const doc = {
			meta: validMeta,
			nodes: [
				{ id: 'loc-1', type: 'location', name: 'Loc 1', updatedAt: new Date().toISOString(), attrs: {} },
				{ id: 'loc-2', type: 'location', name: 'Loc 2', updatedAt: new Date().toISOString(), attrs: {} }
			],
			edges: [
				{ from: 'loc-1', type: 'located_in', to: 'loc-2' },
				{ from: 'loc-2', type: 'located_in', to: 'loc-1' }
			]
		};
		const errors = validateDoc(doc);
		expect(errors.some(e => e.includes('Location containment cycle detected'))).toBe(true);
	});

	it('should validate interface ownership', () => {
		const doc = {
			meta: validMeta,
			nodes: [
				{ id: 'iface-1', type: 'interface', name: 'eth0', updatedAt: new Date().toISOString(), attrs: {} }
			],
			edges: []
		};
		const errors = validateDoc(doc);
		expect(errors.some(e => e.includes('must have exactly 1 owner device (has 0)'))).toBe(true);
	});

	it('should reject an IP host address outside its CIDR prefix', () => {
		const doc = {
			meta: validMeta,
			nodes: [
				{ id: 'ip-1', type: 'ip_address', name: '192.168.1.100', updatedAt: new Date().toISOString(), attrs: {} },
				{ id: 'prefix-1', type: 'prefix', name: '10.0.0.0/24', updatedAt: new Date().toISOString(), attrs: {} }
			],
			edges: [
				{ from: 'ip-1', type: 'member_of', to: 'prefix-1' }
			]
		};
		const errors = validateDoc(doc);
		expect(errors.some(e => e.includes('is not a usable host address inside'))).toBe(true);
	});
});
