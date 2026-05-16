# ADR-013 — OS Firewall Provisioning at Install: `pfctl` (macOS) + `iptables` (Linux), UID-Scoped, Tag-Keyed, Reversible

**Feature**: 007-install-first-run
**Date**: 2026-05-15
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-001 (path (b) — referenced verbatim, NOT amended); ADR-009 (no-shell-string-exec lint); ADR-012 (install/uninstall surface)

## Context

ADR-001 §2 path (b) commits the project to provisioning an OS-level firewall rule as a required install side-effect: "the firewall rule is installed automatically by TR-001 as a required install side-effect, not merely documented. The install script provisions a UID-scoped rule (`block out proto {tcp, udp} from any to any user <corpus-uid>` on macOS pf; `OUTPUT -m owner --uid-owner <corpus-uid> -j REJECT` on Linux iptables) and SP-007 exit criterion verifies the rule is active post-install. Uninstall (TR-002) reverses the firewall rule."

Without ADR-013:

- The exact `runTool()` invocation pattern is unspecified.
- Idempotency on re-install is unspecified.
- Reverse-command capture for `corpus uninstall` is unspecified.
- Sudo-handling on non-root install is unspecified.
- Conflict handling when the rule already exists (re-install) is unspecified.

This ADR operationalizes ADR-001 path (b) for SP-007 without superseding or weakening ADR-001's commitment.

## Decision

**Provisioning invocation** (per Constitution XII subprocess hygiene + ADR-009 lint):

- **macOS**: `runTool('pfctl', ['-a', 'corpus', '-f', '-'], {stdin: '<rule-text>', signal, timeoutMs: 5000})`. The `<rule-text>` is constructed in JS:

  ```
  block drop out quick proto {tcp,udp} from any to any user <UID>
  ```

  where `<UID>` is the literal `os.userInfo().uid` value (numeric). The anchor `corpus` isolates the rule from the operator's main `pf.conf`. On non-root, prepend `sudo` to the runTool invocation: `runTool('sudo', ['pfctl', '-a', 'corpus', '-f', '-'], {stdin: ..., signal, inheritStdio: true, timeoutMs: 30000})` so the operator enters the sudo password once with the password prompt visible.

- **Linux**: `runTool('iptables', ['-A', 'OUTPUT', '-m', 'owner', '--uid-owner', '<UID>', '!', '-d', '127.0.0.1/8', '-j', 'REJECT', '-m', 'comment', '--comment', 'llm-corpus'], {signal, timeoutMs: 5000})`. The `<UID>` is the literal `os.userInfo().uid` value (numeric, NOT shell-interpolated). The `--comment` flag tags the rule for clean reversal. On non-root, prepend `sudo`: `runTool('sudo', ['iptables', '-A', 'OUTPUT', ...], {signal, inheritStdio: true, timeoutMs: 30000})`.

**Idempotency** (Constitution X):

- **macOS**: Before provisioning, invoke `runTool('pfctl', ['-a', 'corpus', '-sr'], {timeoutMs: 5000})` and grep the output for `user <UID>`. If the rule is present, skip provisioning and emit `install.step_completed` with `step: 'firewall_provision', skipped: true, reason: 'already_provisioned'`.
- **Linux**: Before provisioning, invoke `runTool('iptables', ['-C', 'OUTPUT', '-m', 'owner', '--uid-owner', '<UID>', '!', '-d', '127.0.0.1/8', '-j', 'REJECT', '-m', 'comment', '--comment', 'llm-corpus'], {timeoutMs: 5000})`. The `-C` (check) flag returns exit-0 if the rule exists; exit-1 otherwise. If exit-0, skip provisioning.

**Reverse-command capture**:

- **macOS**: Reverse-command is `{cmd: 'pfctl', args: ['-a', 'corpus', '-F', 'all']}`. `-F all` flushes the entire `corpus` anchor (which contains only the corpus rule); the operator's main `pf.conf` is untouched.
- **Linux**: Reverse-command is `{cmd: 'iptables', args: ['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', '<UID>', '!', '-d', '127.0.0.1/8', '-j', 'REJECT', '-m', 'comment', '--comment', 'llm-corpus']}`. The `-D` (delete) flag uses the same rule body as `-A`; the comment match (`-m comment --comment llm-corpus`) ensures the operator's other UID-scoped rules are NOT affected.

The reverse-command is RECORDED VERBATIM in the install-receipt's `firewall_rules[]` array so `corpus uninstall` invokes it via `runTool(receipt.firewall_rules[0].reverse_command.cmd, receipt.firewall_rules[0].reverse_command.args)` without re-deriving from the platform — protecting against platform-version drift between install and uninstall.

**Sudo handling**:

- The install detects root at preflight: `process.getuid() === 0`. If root, no sudo prefix; the runTool invocation is direct.
- If not root + `sudo` is on PATH (`runTool('which', ['sudo'], {timeoutMs: 2000})` returns exit-0): the install prepends `sudo` to the runTool invocation. The runTool helper passes `inheritStdio: true` so the operator's terminal stdin/stderr is connected to the sudo prompt; the operator types the password once. The password is NEVER captured in telemetry (Constitution I + the SP-007 telemetry-or-die contract).
- If not root + sudo unavailable: the install exits non-zero with a clear-remediation message naming the manual command:

  ```
  ERROR: OS firewall provisioning requires root or sudo, but sudo is not available.
  Run this command as root:
    pfctl -a corpus -f -          # (macOS, with rule text piped to stdin)
    iptables -A OUTPUT -m owner --uid-owner <UID> ! -d 127.0.0.1/8 -j REJECT  # (Linux)
  Then re-run: corpus init
  ```

**Reversibility verification** (SP-007 SC-007-015):

After uninstall reverses the firewall rule, the post-uninstall verification step runs:

- **macOS**: `runTool('pfctl', ['-a', 'corpus', '-sr'], {timeoutMs: 5000})` + assert empty stdout OR exit-1 (no anchor / no rules).
- **Linux**: `runTool('iptables', ['-L', 'OUTPUT', '-n', '-v'], {timeoutMs: 5000})` + grep for `--uid-owner <UID>` + `--comment llm-corpus` + assert empty match.

**Missing binary** (`pfctl` or `iptables` not on PATH):

The install exits non-zero at the preflight step (extended preflight: not in FR-INSTALL-003's enumerated checks but added in the firewall-provisioner step's defensive check). Clear-remediation message names the missing binary and the distro-appropriate install command.

## Consequences

**Positive**:

- Closes ADR-001 path (b) verbatim — the OS firewall rule is provisioned at install, blocks outbound non-loopback for the corpus UID, reversed at uninstall.
- Idempotent on re-install — re-running `corpus init` does not duplicate the rule.
- Tag-keyed (anchor `corpus` on macOS; comment `llm-corpus` on Linux) — operator's other firewall state is preserved.
- Defense-in-depth alongside SP-001 in-process JS-land egress hook (ADR-001 §"the in-process Node hook").

**Negative**:

- Requires root or sudo at install time. On non-admin user accounts, install fails with clear-remediation. This is acceptable per ADR-001's "trigger to revisit" provision (the original ADR contemplated this); the alternative (no firewall) is FORBIDDEN.
- The interactive sudo password prompt during install adds latency to the 90-second budget (typically 2-5 s for password entry). The budget accommodates this.
- Platform-specific reverse-command capture in the install-receipt — if the firewall binary's CLI surface changes between install and uninstall (rare; pfctl + iptables have been stable for years), the reverse may fail. Mitigation: receipt's `os_version` lets the operator detect the mismatch.
- Linux iptables vs nftables migration is deferred to a future ADR — for v1 Fedora baseline, `iptables` (legacy or nft-backed front-end) is the choice per ADR-001 verbatim.

**Neutral**:

- Tag-keyed isolation (anchor + comment) means the operator can hand-edit other firewall state without interference; the corpus rule is recognizable and self-contained.

## Alternatives considered

- **No firewall (rely on JS-land egress hook only)**: REJECTED by ADR-001 § "Consequences" — child_process and native-addon exclusions require the OS-level layer for defense-in-depth.
- **`nft` (nftables) on Linux instead of `iptables`**: REJECTED for v1; future-horizon if Fedora deprecates the `iptables` front-end.
- **`firewalld` on Linux**: REJECTED — operates at zone level; UID-scoped rules are awkward; direct iptables is ADR-001-verbatim.
- **Process-scoped rule (rather than UID-scoped)**: REJECTED — daemon restart would bypass; UID is the principal per Constitution IV.
- **PID-scoped rule**: REJECTED — same daemon-restart bypass concern.
- **No idempotency check (always provision; rely on duplicate-rule silently)**: REJECTED — duplicate rules on macOS pf can produce policy-shadow issues; clean idempotency is the right path.

## Compliance / verification

- **Tests**: `tests/unit/install-firewall-provisioner.test.ts` (runTool args for pfctl + iptables; idempotency check; reverse-command capture); `tests/integration/install-end-to-end.test.ts` (asserts the rule is active post-install when run on a fixture HOME with root or stubbed sudo); `tests/integration/uninstall-end-to-end.test.ts` (asserts the rule is gone post-uninstall + post-uninstall firewall query returns empty).
- **Lint**: `no-shell-string-exec` (ADR-009) over the firewall-provisioner source.
- **Telemetry**: the `install.step_failed` event with `step: 'firewall_provision'` captures all firewall errors.
- **Trigger to revisit**: a Fedora release that deprecates the `iptables` front-end (would require `nft`-fallback), or a macOS release that removes pfctl anchor support (would require `pf.conf` direct edit — strongly avoided), or operator demand for a `--no-firewall` flag (would require ADR-001 superseder).
