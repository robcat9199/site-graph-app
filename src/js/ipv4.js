/* ============================== IPv4 math ============================== */
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function ip4ToInt(s) {
	const m = IP_RE.exec(String(s).trim());
	if (!m) return null;
	let v = 0;
	for (let i = 1; i <= 4; i++) {
		const o = Number(m[i]);
		if (o > 255 || (m[i].length > 1 && m[i][0] === "0")) return null;
		v = v * 256 + o;
	}
	return v;
}
export const isIp4 = (s) => ip4ToInt(s) !== null;
export function intToIp4(v) {
	return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(
		".",
	);
}
export function parseCidr(s) {
	const m = /^([\d.]+)\/(\d{1,2})$/.exec(String(s).trim());
	if (!m) return null;
	const ip = ip4ToInt(m[1]);
	const bits = Number(m[2]);
	if (ip === null || bits < 0 || bits > 32) return null;
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	const net = (ip & mask) >>> 0;
	const bcast = (net | (~mask >>> 0)) >>> 0;
	return {
		cidr: s.trim(),
		ip,
		bits,
		net,
		bcast,
		size: bcast - net + 1,
		isNetworkAddr: ip === net,
	};
}
/* host addresses usable inside a prefix (network/broadcast excluded when bits<31) */
export function cidrHasHost(c, ipInt) {
	if (ipInt === null) return false;
	if (c.bits >= 31) return ipInt >= c.net && ipInt <= c.bcast;
	return ipInt > c.net && ipInt < c.bcast;
}
