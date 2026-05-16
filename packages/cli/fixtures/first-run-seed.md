---
title: SP-007 First-Run Seed Document
domain: engineering
type: reference
tags:
  - documentation
  - infrastructure
source_type: internal-note
---

This deterministic first-run seed document exercises the SP-007 `corpus init
--smoke` step-12 harness. The C-046 end-to-end smoke harness drops this
document into the freshly-installed corpus inbox, waits for the ingest
pipeline to classify, embed, and index it, then issues a `corpus.find` MCP
tool call over the production stdio transport with the deterministic query
"SP-007 first-run seed document". The smoke harness asserts that the search
response contains at least one SearchHit pointing at this body, which proves
the install completed an end-to-end retrieval round-trip and that the
operator can now reach the corpus through their MCP client.
