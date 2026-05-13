---
title: A Survey of Quantum Cryptography Protocols
source_path: /home/shonrs/inbox/novel-quantum.md
ingest_timestamp: 2026-05-13T10:00:00.000Z
mime_type: text/markdown
hash: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
id: doc-aabbccdd
---

# A Survey of Quantum Cryptography Protocols

This survey covers the major quantum cryptographic protocols used in
present-day secure-communications research. We focus on BB84, E91, and
the family of decoy-state protocols that have proven practical at
metro-area distances.

## BB84

The BB84 protocol, due to Bennett and Brassard, was the first practical
quantum key distribution (QKD) protocol. It uses polarized photons in
two non-orthogonal bases.

## E91

Ekert's E91 protocol exploits entangled photon pairs and Bell
inequalities to detect eavesdropping in a more theoretically pleasing
way than BB84.

## Decoy-state protocols

To defend against photon-number-splitting attacks against BB84
implementations using weak coherent pulses, decoy-state protocols
introduce pulses of varying intensity. The receiver can detect
adversarial post-selection by comparing the observed yields on each
intensity class.

The subject matter here — quantum cryptography — does NOT fit either
`agent-systems` or `distributed-systems` (the only established domains
in the seeded taxonomy). The classifier should pick the closest fit
for `facet_domain` AND propose `quantum-cryptography` via
`facet_domain_proposed`.
