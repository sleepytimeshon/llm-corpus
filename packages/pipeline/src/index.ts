// @llm-corpus/pipeline — SP-003 ingest pipeline core.
//
// Previously a stub; SP-003 grows it into the functional pipeline producing
// `documents` rows from inbox files via watcher → validation → hash →
// normalize → persist with drain-lock serialization.

export * from './pilot-harness/index.js';
export * from './validation-gate.js';
export * from './hasher.js';
export * from './persister.js';
export * from './failure-lane.js';
export * from './drain-lock.js';
export * from './inbox-watcher.js';
export * from './policies.js';
export * from './drain-orchestrator.js';
