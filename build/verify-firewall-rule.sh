#!/usr/bin/env bash
#
# T051 — Manual firewall-rule install/verify rig (NFR-002b, ADR-001 §Decision.2).
#
# Used by SP-001 verification (SC-004). SP-007 will replace this with the
# automated install plumbing.
#
# Usage:
#     sudo build/verify-firewall-rule.sh install   # install the rule
#     sudo build/verify-firewall-rule.sh verify    # verify the rule is active
#     sudo build/verify-firewall-rule.sh remove    # remove the rule
#
# The rule rejects outbound TCP/UDP from the corpus UID. SP-001's
# child-process-firewall integration test installs a NARROWER rule (specific
# dst/port) for safety; this script ships the SP-001-canonical full rule
# matching ADR-001's shape.
#
# Platform: Fedora/RHEL (iptables). macOS pf path documented in comments
# only — SP-007 will land it.

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "ERROR: this script must run under sudo (iptables requires CAP_NET_ADMIN)" >&2
    exit 2
fi

# UID under which the corpus runs. v1 is single-user; default to the invoking
# user's UID (SUDO_UID) so the rule scopes to the user, not root.
CORPUS_UID="${CORPUS_UID:-${SUDO_UID:-$(id -u)}}"

# Loopback exclusions — matches the in-process hook's loopback policy so the
# OS layer doesn't interfere with stdio MCP clients on 127/8 or future Ollama
# integrations on localhost:11434.
LOOPBACK_V4="127.0.0.0/8"
LOOPBACK_V6="::1/128"

usage() {
    cat <<EOF
Usage: $0 {install|verify|remove}

Installs/verifies/removes UID-scoped iptables rules that reject outbound
non-loopback TCP/UDP from UID=${CORPUS_UID}.

Environment:
  CORPUS_UID    Override the UID (default: ${CORPUS_UID})

This rig is the SP-001 manual stand-in for the SP-007 install side effect.
EOF
}

cmd="${1:-}"

case "${cmd}" in
    install)
        echo "Installing iptables OUTPUT rules for UID=${CORPUS_UID}..."
        # IPv4 — allow loopback first, then reject everything from this UID.
        iptables -I OUTPUT 1 -m owner --uid-owner "${CORPUS_UID}" -d "${LOOPBACK_V4}" -j ACCEPT
        iptables -I OUTPUT 2 -m owner --uid-owner "${CORPUS_UID}" -j REJECT
        # IPv6 — same shape if ip6tables is available.
        if command -v ip6tables >/dev/null 2>&1; then
            ip6tables -I OUTPUT 1 -m owner --uid-owner "${CORPUS_UID}" -d "${LOOPBACK_V6}" -j ACCEPT
            ip6tables -I OUTPUT 2 -m owner --uid-owner "${CORPUS_UID}" -j REJECT
        fi
        echo "Done. Run '$0 verify' to confirm."
        ;;

    verify)
        echo "Verifying iptables rules for UID=${CORPUS_UID}..."
        # Probe with curl to a non-loopback target as the corpus UID; expect failure.
        if su -s /bin/bash -c 'curl -sf --max-time 3 https://example.com >/dev/null' \
            "$(getent passwd "${CORPUS_UID}" | cut -d: -f1)" 2>/dev/null; then
            echo "FAIL: outbound non-loopback succeeded — rule is NOT effective" >&2
            exit 1
        fi
        # Probe loopback to confirm we didn't break local IPC.
        if ! su -s /bin/bash -c 'curl -sf --max-time 1 http://127.0.0.1:1 >/dev/null 2>&1 || [[ $? -eq 7 ]]' \
            "$(getent passwd "${CORPUS_UID}" | cut -d: -f1)" 2>/dev/null; then
            echo "FAIL: loopback connection unexpectedly affected" >&2
            exit 1
        fi
        echo "OK: outbound non-loopback rejected; loopback unaffected."
        ;;

    remove)
        echo "Removing iptables OUTPUT rules for UID=${CORPUS_UID}..."
        # -D removes the first matching rule; run twice to remove both lines.
        iptables -D OUTPUT -m owner --uid-owner "${CORPUS_UID}" -j REJECT 2>/dev/null || true
        iptables -D OUTPUT -m owner --uid-owner "${CORPUS_UID}" -d "${LOOPBACK_V4}" -j ACCEPT 2>/dev/null || true
        if command -v ip6tables >/dev/null 2>&1; then
            ip6tables -D OUTPUT -m owner --uid-owner "${CORPUS_UID}" -j REJECT 2>/dev/null || true
            ip6tables -D OUTPUT -m owner --uid-owner "${CORPUS_UID}" -d "${LOOPBACK_V6}" -j ACCEPT 2>/dev/null || true
        fi
        echo "Done."
        ;;

    *)
        usage
        exit 1
        ;;
esac

# macOS pf shape (NOT IMPLEMENTED in this script; SP-007 will land the
# cross-platform installer):
#
#     # /etc/pf.anchors/llm-corpus
#     block out proto {tcp, udp} from any to any user <corpus-uid>
#     pass out proto {tcp, udp} from any to 127.0.0.0/8
#     pass out proto {tcp, udp} from any to ::1
#
#     pfctl -a llm-corpus -f /etc/pf.anchors/llm-corpus
#     pfctl -E
