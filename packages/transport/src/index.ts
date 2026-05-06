// T034 / T048 — @llm-corpus/transport entry point.
// Bootstrap ordering contract per contracts/egress-hook-api.md
// §"Bootstrap ordering contract":
//
//   1. Egress hook installation is the FIRST import-time side effect.
//      `./egress-hook-bootstrap` calls installEgressHook() at module load.
//   2. THEN the MCP server module is imported.
//   3. THEN startMcpServer() runs.
//
// Tests `tests/integration/bootstrap-order.test.ts` (T040) assert hook
// installation banners appear before any pipeline-package banner.

import './egress-hook-bootstrap.js'; // T048 — must be FIRST import

export { startMcpServer, buildMcpServer, SERVER_INITIALIZING_CODE } from './mcp-server.js';
export { emitFindCheckpoint } from './mcp-checkpoint.js';
export type { BuildMcpServerOptions, BuiltMcpServer } from './mcp-server.js';
export { corpusFindHandler } from './corpus-find-tool.js';
export type { CorpusFindHandler } from './corpus-find-tool.js';
export {
  CorpusFindInput,
  CorpusFindOutput,
  SearchFilter,
  SearchHit,
  inputJsonSchema,
  outputJsonSchema,
} from './schemas.js';
export type {
  CorpusFindInputType,
  CorpusFindOutputType,
  SearchFilterType,
  SearchHitType,
} from './schemas.js';
