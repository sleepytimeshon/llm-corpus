---
title: Architectural Decision Records — local-only knowledge substrate
facet_domain: engineering
facet_type: reference
tags:
  - architecture
  - decisions
source_type: internal-doc
---

# Architectural Decision Records

This document lists the architectural decision records (ADRs) for the
local-only knowledge substrate. Each ADR captures the context, decision, and
consequences of a single architecturally significant choice.

## ADR-001 — Local-only egress enforcement

The substrate enforces a strict no-non-loopback-egress policy via an
in-process hook on Node's networking primitives. Any non-loopback connection
attempt synchronously throws `EgressBlockedError` and emits a telemetry
record describing the violation.

## ADR-002 — Append-atomic NDJSON telemetry

All telemetry events flow through `emitTelemetry()` which writes one
NDJSON-per-line record via `fs.appendFile` with `O_APPEND`. Each record is
capped at 4 KB so the POSIX kernel guarantees the write is atomic.
