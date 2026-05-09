// T005 — SP-002 schema + taxonomy version constants.
//
// These constants are referenced by the manifest adapter (contracts/resource-manifest.md)
// and by future SP-003+ schema migrations. SP-002 ships v1.0.0 for both;
// updates accompany schema/taxonomy registry migrations in later features.
//
// See contracts/resource-manifest.md §"Field semantics" — schema_version /
// taxonomy_version are the active versions exposed to MCP clients.

/**
 * The active frontmatter schema version. Hardcoded for SP-002.
 * SP-004 may bump this when promoted-classification frontmatter fields land.
 */
export const SCHEMA_VERSION = 'v1.0.0' as const;

/**
 * The active taxonomy registry version. Hardcoded for SP-002.
 * SP-004 may bump this when the proposed→established state machine ships.
 */
export const TAXONOMY_VERSION = 'v1.0.0' as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type TaxonomyVersion = typeof TAXONOMY_VERSION;
