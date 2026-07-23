/* ============================== utils ============================== */
export const nowISO = () => new Date().toISOString();
export const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
export class SafeString {
	constructor(val) { this.val = val; this._isSafe = true; }
	toString() { return String(this.val); }
}

export const safe = (val) => new SafeString(val);

export const html = (strings, ...values) => {
	const out = strings.reduce((acc, str, i) => {
		let val = values[i];
		if (val === undefined || val === null) val = '';
		else if (Array.isArray(val)) val = val.map(v => v?._isSafe ? v.val : esc(v)).join('');
		else if (val?._isSafe) val = val.val;
		else val = esc(val);
		return acc + str + val;
	}, '');
	return new SafeString(out);
};
export const clone =
	typeof structuredClone === "function"
		? structuredClone
		: (o) => JSON.parse(JSON.stringify(o));
export const fmtDate = (iso) => {
	const d = new Date(iso);
	return isNaN(d)
		? String(iso)
		: d.toLocaleString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
};
export const slugify = (s) =>
	String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "x";
export const ISO_RE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const isPlainObj = (o) =>
	o !== null && typeof o === "object" && !Array.isArray(o);
