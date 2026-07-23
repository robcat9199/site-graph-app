# SiteGraph

A strict graph-based network source of truth stored in a single site JSON document, designed for both IT operations and on-site technicians.

🔗 **Live App:** [https://robcat9199.github.io/site-graph-app/](https://robcat9199.github.io/site-graph-app/)

---

## Overview

SiteGraph is a highly portable, single-file web application that tracks and maps IT infrastructure. Rather than treating IT assets as flat inventory lists, SiteGraph uses a semantic node-edge database to map the exact relationships between hardware, logical addresses, cabling, and physical locations. 

For operations teams, this structural mapping makes it possible to engineer out bottlenecks by clearly visualizing dependencies across the ecosystem. For on-site technicians, it provides a fast, offline-first interface that safely enforces data integrity in the field.

## Model Philosophy

SiteGraph relies on a strict typed graph model wrapped in a portable JSON envelope. This architecture ensures the documentation resists the data drift typically found in spreadsheets and wikis.

- **Graph Topology over Flat Tables:** Devices, interfaces, cables, and prefixes are strongly typed nodes and edges. It is impossible to connect two devices without explicit interface endpoints, ensuring the physical topology is accurately represented.
- **Invariants and Hard Rules:** The system refuses to save corrupt states. Anomalies like duplicate IP assignments, unknown attributes, invalid CIDR masks, and cyclic rack containment are strictly blocked by the validator.
- **Advisory Checks vs. Hard Blocks:** While structural data integrity is heavily enforced, operational reality is respected. Issues like duplicate hostnames or unplaced devices trigger *Advisory Checks* rather than blocking the workflow, acknowledging that real-world fleets often contain legacy duplication.
- **Single-File Boundary:** The entire graph lives in a single JSON document. This ensures that backing up, branching, or auditing the network state is as simple as managing a text file.

## Security & Compliance

SiteGraph operates with a zero-trust, serverless architecture that natively satisfies strict security and compliance requirements.

- No backend databases, telemetry, or cloud synchronization mechanisms exist.
- Network infrastructure data never leaves the local browser environment unless the user explicitly exports the file.
- The application can be cached via Service Worker and used entirely offline in restricted environments (e.g., secure server closets or dead zones).

## Core Capabilities

- **Unified Infrastructure Tracking:** Document devices, racks, patch panels, interface cabling, and circuits in a highly structured schema.
- **Intelligent Port Management:** Auto-generate standard infrastructure ports for switches. Robust connection states allow non-destructive port factory resets and safe logical tracking.
- **Visual Topology Mapping:** Automatically generate interactive, drag-and-drop network topology maps based on cabling records.
- **Built-in IPAM:** Track prefixes, VLANs, gateways, and DHCP ranges. IP addresses are automatically validated against CIDR boundaries and checked for duplicates.
- **Zero-Dependency Portability:** Each site's entire state is stored in a single `.json` file that you own, open, edit, and export.
- **Rich Export Options:** Export your site directly to Spreadsheet (.xlsx), Neo4j Cypher scripts (.cypher), LLM Digest (.md) for AI consumption, or CSV tables.

## How to Use It

1. **Access the Tool:** Open the [live app link](https://robcat9199.github.io/site-graph-app/). (Or install it to your home screen via your browser menu for offline access).
2. **Start Documenting:** 
   - Click **New Site** to start from scratch.
   - Click **Load sample site** to explore a pre-populated network.
   - Click **Open data.json...** to resume work on an existing site file.
3. **Save & Export:** As you work, the app autosaves your progress to the browser's local storage. When finished, click **Export** to download the canonical `.json` file for safe keeping, version control, or team sharing. You can also generate multi-tab Spreadsheets (.xlsx), Cypher graphs, and LLM text digests.

---

### Development

SiteGraph's source code is modularized in the `src/` directory.

To compile the application from source, make sure you have Node.js installed, then run:
```bash
npm install
npm run build
```
This uses Vite to minify assets and compile a single, portable `/dist/index.html` file along with the necessary Service Worker for offline capability.

To run the local development server with hot-reloading:
```bash
npm run dev
```

## License
All Rights Reserved. Copyright © 2026 KAG.
