// SP-008 T041 — JSON renderer for `corpus engagement-proxy report --format=json`.
//
// Writes `JSON.stringify(payload, null, 2) + '\n'` to stdout. The payload
// is assumed Zod-validated by the caller (engagement-proxy-command.ts).
//
// References:
//   - specs/008-user-acceptance/tasks.md T041
//   - specs/008-user-acceptance/data-model.md Entity 5
//   - Constitution Principle V

import type { EngagementProxyReport } from '@llm-corpus/contracts';

export interface WritableStream {
  write(data: string): boolean;
}

export function renderReportJson(
  payload: EngagementProxyReport,
  stdout: WritableStream,
): void {
  stdout.write(JSON.stringify(payload, null, 2) + '\n');
}
