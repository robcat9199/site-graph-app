# SiteGraph data schema — v3

Reference for the JSON document SiteGraph reads and writes (one file per site).
Matches the validator in `index.html` as of 2026-07-18. Every rule listed under
**Hard rules** is enforced at write time inside the app *and* on file load —
a file that violates any of them is rejected with a full error report (and an
invalid browser working copy is quarantined, never silently deleted).

## Document envelope

```json
{
  "meta": {
    "schemaVersion": 3,
    "site": { "name": "…", "address": "…", "notes": "…" },
    "log":  [ { "ts": "ISO-8601", "summary": "…" } ]
  },
  "nodes": [ … ],
  "edges": [ … ]
}
```

| Field | Rule |
|---|---|
| `meta.schemaVersion` | Must equal `3`. |
| `meta.site.name` | Required, non-empty string. `address` / `notes` free text. |
| `meta.log` | Site-level activity (deletions, site edits). Array of `{ts, summary}`, capped at **100** entries. |


## Conceptual Architecture

The SiteGraph data schema defines a strict, bounded domain model for physical and logical network infrastructure.

- **Site as Aggregate Root:** The single JSON document acts as the aggregate root boundary. All nodes and edges only have meaning within the context of the site file.
- **Identities:** Every node is uniquely identified by a globally unique ID (e.g., `dev-fw-edge-01`). For logical resources like IPs and prefixes, the identity *is* the value (e.g., `ip-192.168.1.1` and `pfx-192.168.1.0/24`), ensuring mathematically impossible duplication of logical addresses.
- **Ownership & Containment:** The model enforces strict hierarchical ownership where it matters: an interface is owned by exactly one device, and location containment (`located_in`) must be strictly acyclic to prevent impossible physical loops. 
- **Addressing & Connectivity:** The graph enforces referential discipline. An IP assignment (`assigned_to`) relies on valid prefix membership (`member_of`), and physical connections (`connected_to`) are constrained to exactly one cable per port interface, eliminating the common spreadsheet issue of orphaned links or overloaded jacks.
- **Audit History:** Every node encapsulates a lifecycle changelog (`history`). The model captures not just the current state of the graph, but the operational traceability of how it evolved within the aggregate boundary.

## Node shape (all types)

```json
{ "id": "dev-fw-edge-01", "type": "device", "name": "FW-EDGE-01",
  "updatedAt": "ISO-8601",
  "history": [ { "ts": "ISO-8601", "summary": "Created" } ],
  "attrs": { … } }
```

| Field | Rule |
|---|---|
| `id` | Lowercase slug (`^[a-z0-9][a-z0-9-]*$`), **globally unique**. By convention: type prefix + slugified name (see prefixes below). |
| `type` | One of the node types below. Unknown types are rejected. |
| `name` | Non-empty string. Display identity. `prefix` and `ip_address` names carry extra rules (below). |
| `updatedAt` | ISO-8601 timestamp. |
| `history` | Per-record changelog, `{ts, summary}`, capped at **30** entries. |
| `attrs` | Object. Required attrs must be present; **unknown attr keys are rejected**; every value is type-checked. |

## Node types

| Type | ID prefix | Required attrs | Optional attrs |
|---|---|---|---|
| `location` | `loc-` | `locationType` (enum) | `notes`, `custom` (object) |
| `rack` | `rack-` | `heightU` (int 1–100) | `notes`, `custom` (object) |
| `patch_panel` | `pp-` | `jackCount` (int 1–999) | `notes`, `custom` (object) |
| `device` | `dev-` | `role` (enum), `ipAssignment` (enum) | `hostname`, `mac`, `department`, `dhcpNetwork`, `assetTag`, `dmsId`, `manufacturer`, `model`, `serial`, `poe` (bool), `notes`, `custom` (object) |
| `interface` | `if-` | `portMode` (enum) | `stdName` (text), `accessVlan` (int 1–4094), `nativeVlan` (int 1–4094), `allowedVlans` (text), `media` (enum), `notes`, `custom` (object) |
| `circuit` | `ckt-` | `provider` (text), `circuitType` (enum) | `bandwidth`, `circuitId`, `wanIp`, `staticBlock`, `ispGateway`, `notes`, `custom` (object) |
| `prefix` | `pfx-` | — | `description`, `vlanId` (int 1–4094), `gatewayIp` (ip), `dhcpStart` (ip), `dhcpEnd` (ip), `custom` (object) |
| `ip_address` | `ip-` | — | `description`, `custom` (object) |
| `person` | `per-` | `department` (text) | `title`, `extension`, `did`, `email`, `notes`, `custom` (object) |

### Name rules for identity-typed nodes

- **`prefix`** — the *name* is the network in CIDR (`10.20.10.0/24`). Host bits must be
  zero (the validator tells you the correct network address if not). `gatewayIp`,
  `dhcpStart`, `dhcpEnd` must fall inside the prefix, and `dhcpStart ≤ dhcpEnd`.
  Prefix names are unique within the document.
- **`ip_address`** — the *name* is the IPv4 address. Must be valid dotted-quad
  (no leading zeros). IP names are unique within the document ("duplicate ip address"
  is a hard error).

### Design notes

- **`patch_panel` is not a device.** It is a passive location-subset — "essentially
  filler." It has no role, no IP, no hostname, no ports, no interfaces, and cannot be a
  cable endpoint. Cables are documented on the devices they connect; the jack number
  rides on the `connected_to` edge (`attrs.jack`). A panel records only that it exists,
  where it is (room and/or rack + U), and how many jacks it has.
- **`interface`** records are owned by exactly one device (via `has_interface`) and are
  where a cable lands. Endpoint NICs are `portMode: "access"` always — VLANs are
  configured on the switch side only.

## Enums

| Enum | Values |
|---|---|
| `locationType` | `MDF`, `IDF`, `building`, `department`, `office`, `room`, `closet`, `showfloor`, `outdoor`, `other` |
| `role` | `firewall`, `router`, `modem`, `core-switch`, `switch`, `server`, `pbx`, `nvr`, `ap`, `ups`, `desktop`, `laptop`, `phone`, `printer`, `mfp`, `camera`, `tablet`, `tv`, `other` — *(`patch-panel` was removed in July 2026; panels are their own node type)* |
| `ipAssignment` | `static`, `dhcp`, `dhcp-reservation`, `none` |
| `portMode` | `access`, `trunk` |
| `media` | `copper`, `fiber`, `sfp`, `sfp+`, `wireless`, `other` |
| `circuitType` | `internet`, `mpls`, `p2p`, `sip`, `pots`, `other` |

### Role groupings (behavioral, not stored)

- **`INFRA_ROLES`** — quick-connect targets (things you plug endpoints into):
  `firewall`, `router`, `modem`, `core-switch`, `switch`, `server`, `pbx`, `nvr`.
  Everything else is an endpoint and automatically carries one `eth0` NIC at creation.
- **`PORT_GEN_ROLES`** — `core-switch`, `switch`. Creating one requires a port count
  (1–96) and bulk-generates interfaces named **`p1`…`pN`** (brand-neutral, plus
  optional `SFP1`…`SFPn` uplinks). Bare numbers typed in port fields resolve to the
  generated port (`24` → `p24`).
- **`IP_EXPECTED_ROLES`** — `firewall`, `router`, `core-switch`, `switch`, `server`,
  `pbx`, `nvr`. These left at `ipAssignment: "none"` draw a Check advisory: their
  management IP should be documented.
- New-device `ipAssignment` defaults by role (static for infra, `dhcp-reservation`
  for `ap`/`ups`, `dhcp` for endpoints, `none` for `modem`/`other`) — a starting
  value only, freely changeable.

## Edge shape

```json
{ "from": "<node id>", "type": "<edge type>", "to": "<node id>", "attrs": { … } }
```

`connected_to` edges additionally carry `updatedAt`. `attrs` is optional and, when
present, type-checked against the edge type's spec (unknown keys rejected).

## Edge types

| Type | From → To | Cardinality | Edge attrs |
|---|---|---|---|
| `located_in` | `rack`, `device`, `person`, `location`, `patch_panel` → `location` | max 1 per source | — |
| `mounted_in` | `device`, `patch_panel` → `rack` | max 1 per source | `rackU` (int 1–100) |
| `has_interface` | `device` → `interface` | interface has **exactly 1** owner | — |
| `connected_to` | `interface` ↔ `interface` (undirected) | **max 1 cable per interface** | `category`, `cableColor`, `length`, `jack`, `notes` |
| `terminated_at` | `circuit` → `interface` | max 1 per circuit | — |
| `member_of` | `ip_address` → `prefix` | **exactly 1** per IP | — |
| `assigned_to` | `ip_address` → `device` or `interface` | max 1 per IP | — |
| `used_by` | `device` → `person` | max 1 per device | — |

## Hard rules (rejected at write time and on load)

1. Node `id`s are globally unique lowercase slugs.
2. Unknown node types, edge types, or attr keys are rejected; all attr values type-checked.
3. Required attrs must be present (`role` + `ipAssignment` on every device, `portMode` on every interface, `jackCount` on every panel, …).
4. Prefix names are valid CIDR **network addresses**; gateway/DHCP attrs fall inside the prefix; `dhcpStart ≤ dhcpEnd`.
5. IP names are valid IPv4; **duplicate IPs are impossible**; every IP belongs to exactly one prefix and must be a usable host address inside it (network/broadcast excluded below /31).
6. An IP can only be assigned to a device set to `static` or `dhcp-reservation` (directly or via one of its interfaces).
7. Edge endpoints must exist and be of the allowed types; no self-edges; no duplicate edges (undirected dedup for `connected_to`).
8. **One cable per port** — an interface can appear in at most one `connected_to` edge.
9. Every interface has exactly one owner device.
10. **Port names are unique per device** (case-insensitive) — one physical port, one record.
11. Location containment (`located_in` between locations) must be acyclic.
12. History/log arrays respect their caps (30 per record, 100 site log) and entry shape.

## Advisory checks (the Check button — allowed, but flagged)

- Duplicate node names within a type (devices, locations, racks, patch panels, people, circuits) — legal because real fleets have them, but every one deserves a look.
- Duplicate device hostname or MAC.
- Device unplaced (no location or rack) / device with no documented connection.
- Device set `static`/`dhcp-reservation` with no IP on record.
- Infra-role device (`IP_EXPECTED_ROLES`) left at `ipAssignment: "none"`.
- Patch panel unplaced — placement is its whole job.
- Circuit not terminated at a port.
- IP on the ledger but assigned to nothing.
- Prefix with no gateway documented; prefix gateway that is not on the IP ledger.

## Conventions

- **IDs**: `<type prefix>-<slugified name>`, `-2`, `-3`… appended on collision.
- **Switch ports**: generated `p1`…`pN` + `SFP1`…`SFPn`; endpoint NICs are `eth0`.
  Free-text port names (e.g. `X1 (WAN)`, `LAN1`) are fine — uniqueness per device is
  the only constraint.
- **Jacks**: wall-jack labels live on the `connected_to` edge (`attrs.jack`); patch panels document capacity
  (`jackCount`), not individual jacks.
- **VLANs**: declared on prefixes (`vlanId`) and referenced on switch-side ports
  (`accessVlan` / `nativeVlan` / `allowedVlans`). Endpoint NICs never carry VLANs.
- **Caps** (runtime): 25-step undo/redo; table views cap at their row limit with a
  "show all" note.

## Worked Examples

The following examples demonstrate the invariants of the schema in motion through isolated JSON snippets.

### 1. Switch and Interface Ownership
A device node owns its interfaces. Creating an interface requires it to be explicitly linked back to the device to prevent orphaned ports.

```json
{
  "id": "dev-sw-core",
  "type": "device",
  "name": "Core-Switch-01",
  "attrs": { "role": "core-switch", "ipAssignment": "static" }
}
```
*The interface belongs to the switch via the `has_interface` edge:*
```json
{
  "id": "if-sw-core-p1",
  "type": "interface",
  "name": "p1",
  "attrs": { "portMode": "access" }
}
```
```json
{
  "from": "dev-sw-core",
  "type": "has_interface",
  "to": "if-sw-core-p1"
}
```

### 2. Strictly Constrained Cabling
Cabling is represented as an undirected edge between two interfaces. The schema enforces a strict cardinality of **max 1 cable per interface**. 

```json
{
  "from": "if-sw-core-p1",
  "type": "connected_to",
  "to": "if-fw-edge-lan1",
  "attrs": { "category": "Cat6", "cableColor": "Blue" }
}
```
*If a user attempts to connect `if-sw-core-p1` to another interface, the validator rejects the document entirely, ensuring physical reality is respected in the data.*

### 3. IPAM Invariants
Prefixes and IP addresses use their explicit values as their identities to prevent duplicates. An IP must explicitly declare membership to its parent prefix.

```json
{
  "id": "pfx-10.0.0.0/24",
  "type": "prefix",
  "name": "10.0.0.0/24",
  "attrs": { "description": "Core Management" }
}
```
```json
{
  "id": "ip-10.0.0.1",
  "type": "ip_address",
  "name": "10.0.0.1",
  "attrs": {}
}
```
*The membership edge enforces CIDR bounds. If `10.0.0.1` was not a valid host inside `10.0.0.0/24`, the schema validator would reject the edge:*
```json
{
  "from": "ip-10.0.0.1",
  "type": "member_of",
  "to": "pfx-10.0.0.0/24"
}
```
