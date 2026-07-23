class IdentityChip extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	connectedCallback() {
		const label = this.getAttribute("label") || "chip";
		
		this.shadowRoot.innerHTML = `
			<style>
				button {
					border: 1px dashed var(--hair-strong, #ccc);
					background: none;
					border-radius: 0.75rem;
					padding: 0.1875rem 0.6875rem;
					font-size: var(--fs-small, 12px);
					color: var(--dim, #666);
					cursor: pointer;
					white-space: nowrap;
					display: inline-flex;
					align-items: center;
					font-family: inherit;
					text-transform: lowercase;
				}
				button:disabled {
					opacity: 0.35;
					cursor: not-allowed;
					pointer-events: none;
				}
				@media (hover: hover) {
					button:hover {
						color: var(--blue, #007aff);
						border-color: var(--blue, #007aff);
					}
				}
			</style>
			<button type="button" ${this.hasAttribute('disabled') ? 'disabled' : ''}>+ ${label}</button>
		`;
	}
}

customElements.define("sg-chip", IdentityChip);
