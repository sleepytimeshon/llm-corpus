// T022 — Zod payload schemas for the four MCP resources (SP-002).
//
// References: contracts/resource-{manifest,taxonomy,recent,document}.md,
// data-model.md §"Operational entities", Constitution V (schema-enforced).
//
// Every resource handler `safeParse`s its payload through one of these
// schemas BEFORE serializing JSON to the MCP response. Validation failure
// emits a `result: 'error'`, `severity: 'error'` telemetry event and throws
// an MCP `-32603` Internal error.

import { z } from 'zod';

// --- Shared regex constants (single source of truth) ---

export const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const DOC_ID_REGEX = /^doc-[0-9a-f]{8}$/;
export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

// --- ManifestPayload (corpus://manifest) ---

export const ManifestPayload = z.object({
  doc_count: z.number().int().nonnegative(),
  established_domains: z.array(z.string()),
  established_tags: z.array(z.string()),
  last_ingest_timestamp: z.string().regex(ISO_8601_REGEX).nullable(),
  schema_version: z.string(),
  taxonomy_version: z.string(),
});
export type ManifestPayloadType = z.infer<typeof ManifestPayload>;

// --- TaxonomyPayload (corpus://taxonomy) ---

export const TaxonomyTerm = z.object({
  term: z.string(),
  document_count: z.number().int().nonnegative(),
});
export type TaxonomyTermType = z.infer<typeof TaxonomyTerm>;

export const TaxonomyPayload = z.object({
  domains: z.array(TaxonomyTerm),
  tags: z.array(TaxonomyTerm),
  types: z.array(TaxonomyTerm),
  source_types: z.array(TaxonomyTerm),
});
export type TaxonomyPayloadType = z.infer<typeof TaxonomyPayload>;

// --- RecentPayload (corpus://recent) ---

export const RecentEntry = z.object({
  id: z.string().regex(DOC_ID_REGEX),
  title: z.string(),
  domain: z.string(),
  tags: z.array(z.string()),
  ingest_timestamp: z.string().regex(ISO_8601_REGEX),
});
export type RecentEntryType = z.infer<typeof RecentEntry>;

export const RecentPayload = z.object({
  entries: z.array(RecentEntry),
});
export type RecentPayloadType = z.infer<typeof RecentPayload>;

// --- DocumentPayload (corpus://docs/{id}) ---

// .passthrough() — SP-004 will add classification fields (title, summary,
// facet_domain, facet_type, source_type, tags). SP-002 commits to the v1
// minimum and accepts unknown extras without breaking.
export const DocumentFrontmatter = z
  .object({
    id: z.string().regex(DOC_ID_REGEX),
    source_path: z.string(),
    ingest_timestamp: z.string().regex(ISO_8601_REGEX),
    mime_type: z.string(),
    hash: z.string().regex(SHA256_HEX_REGEX),
  })
  .passthrough();
export type DocumentFrontmatterType = z.infer<typeof DocumentFrontmatter>;

export const DocumentPayload = z.object({
  uri: z.string(),
  body: z.string(),
  frontmatter: DocumentFrontmatter,
});
export type DocumentPayloadType = z.infer<typeof DocumentPayload>;
