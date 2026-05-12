// @llm-corpus/extract — per-MIME normalizers + dispatcher.
//
// SP-003 grows this package from empty stub to functional. Per-MIME modules
// each return Result<NormalizedDoc, NormalizeError>; the dispatcher routes
// based on MIME type.

export * from './normalize-markdown.js';
export * from './normalize-text.js';
export * from './normalize-html.js';
export * from './normalize-pdf.js';
export * from './normalize.js';
