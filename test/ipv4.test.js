import { describe, it, expect } from 'vitest';
import { ip4ToInt, isIp4, intToIp4, parseCidr, cidrHasHost } from '../src/js/ipv4.js';

describe('IPv4 Math module', () => {
	describe('ip4ToInt and intToIp4', () => {
		it('should convert valid IPv4 strings to integers', () => {
			expect(ip4ToInt('0.0.0.0')).toBe(0);
			expect(ip4ToInt('192.168.1.1')).toBe(3232235777);
			expect(ip4ToInt('255.255.255.255')).toBe(4294967295);
		});

		it('should convert integers to valid IPv4 strings', () => {
			expect(intToIp4(0)).toBe('0.0.0.0');
			expect(intToIp4(3232235777)).toBe('192.168.1.1');
			expect(intToIp4(4294967295)).toBe('255.255.255.255');
		});

		it('should correctly handle leading zeros by returning null', () => {
			expect(ip4ToInt('192.168.01.1')).toBeNull();
		});

		it('should return null for out of bounds segments', () => {
			expect(ip4ToInt('256.0.0.1')).toBeNull();
		});

		it('should return null for malformed strings', () => {
			expect(ip4ToInt('192.168.1')).toBeNull();
			expect(ip4ToInt('not.an.ip')).toBeNull();
		});
	});

	describe('parseCidr', () => {
		it('should correctly parse a valid CIDR', () => {
			const parsed = parseCidr('192.168.1.0/24');
			expect(parsed).not.toBeNull();
			expect(parsed.ip).toBe(3232235776);
			expect(parsed.bits).toBe(24);
			expect(parsed.net).toBe(3232235776);
			expect(parsed.bcast).toBe(3232236031);
			expect(parsed.size).toBe(256);
			expect(parsed.isNetworkAddr).toBe(true);
		});

		it('should reject invalid CIDRs', () => {
			expect(parseCidr('192.168.1.1')).toBeNull();
			expect(parseCidr('192.168.1.0/33')).toBeNull();
			expect(parseCidr('invalid/24')).toBeNull();
		});
	});

	describe('cidrHasHost', () => {
		it('should correctly exclude network and broadcast addresses for CIDR < 31', () => {
			const c = parseCidr('192.168.1.0/24');
			expect(cidrHasHost(c, ip4ToInt('192.168.1.0'))).toBe(false); // Network
			expect(cidrHasHost(c, ip4ToInt('192.168.1.255'))).toBe(false); // Broadcast
			expect(cidrHasHost(c, ip4ToInt('192.168.1.1'))).toBe(true); // Host
		});

		it('should include network and broadcast addresses for CIDR >= 31', () => {
			const c31 = parseCidr('10.0.0.0/31');
			expect(cidrHasHost(c31, ip4ToInt('10.0.0.0'))).toBe(true);
			expect(cidrHasHost(c31, ip4ToInt('10.0.0.1'))).toBe(true);
			
			const c32 = parseCidr('10.0.0.0/32');
			expect(cidrHasHost(c32, ip4ToInt('10.0.0.0'))).toBe(true);
		});
	});
});
