# llm-corpus — User Guide

This guide is for the person using llm-corpus, not the person developing it. If you want the developer / architecture material, start at `WHITEPAPER-FINAL.md` and `ARCHITECTURE-FINAL.md`.

## What llm-corpus is, in one paragraph

llm-corpus is a local knowledge substrate. You drop files (Markdown, plain text, PDF, CSV, XLSX, PPTX, HTML) into an inbox folder on your laptop. A background daemon picks them up, normalizes them to Markdown, asks a local LLM to classify them (assign a domain like "engineering" and a type like "spec"), embeds them for semantic search, and indexes them in a local SQLite database. Then any AI agent that speaks MCP — including Claude Code — can ask questions and get back ranked passages from your own documents. Nothing leaves your machine; everything runs against a local Ollama instance.

## How it's installed on your machine

After the 2026-05-14 install, the layout on pai-node01 is:

| What | Where |
|---|---|
| The `corpus` command | `~/.local/bin/corpus` |
| Where you drop files | `~/.local/share/llm-corpus/docs/inbox/` |
| Where the daemon moves them after processing | `~/.local/share/llm-corpus/docs/processed/` |
| Where it puts things that failed | `~/.local/share/llm-corpus/docs/failed/` |
| The SQLite index | `~/.local/share/llm-corpus/index.db` |
| The daemon's event log | `~/.local/state/llm-corpus/telemetry.jsonl` |
| The systemd service file | `~/.config/systemd/user/corpus.service` |
| The MCP registration | `~/.claude.json` (corpus entry) |
| The source code (dev only) | `~/Projects/llm-corpus/` |

The dev repo is for changing the code. The other paths are where the running system lives.

## Day-to-day use

### Add a document

```bash
cp ~/Downloads/some-paper.pdf ~/.local/share/llm-corpus/docs/inbox/
```

That's it. The daemon will:
1. See the file (within a couple of seconds)
2. Hash it (to detect duplicates)
3. Normalize it to Markdown
4. Move it from `inbox/` to `processed/`
5. Add a row to `index.db`
6. Ask Ollama to classify it (~30 seconds for the qwen3.5:9b model)
7. Ask Ollama to embed it for semantic search
8. Index it for both keyword and semantic queries

You can drop as many files as you want; the daemon processes them one at a time.

### Query from a Claude Code session

Open a fresh `claude` session. In your prompt, ask any question that would benefit from your own documents. Behind the scenes, Claude calls the `corpus.find` MCP tool, gets back ranked passages, and weaves them into the answer. There's no special command — you just ask, and corpus is one of the tools Claude can reach for.

You can also explicitly ask Claude to consult corpus: *"check my corpus for what I've written about X."*

### Check what's in there

```bash
# count of documents successfully indexed:
sqlite3 ~/.local/share/llm-corpus/index.db "SELECT count(*) FROM documents WHERE status='success';"

# what got tagged with what:
sqlite3 ~/.local/share/llm-corpus/index.db "SELECT facet_domain, facet_type, count(*) FROM documents GROUP BY facet_domain, facet_type;"

# anything stuck unclassified:
sqlite3 ~/.local/share/llm-corpus/index.db "SELECT id, title FROM documents WHERE facet_type='unclassified';"
```

### Check what's failed

```bash
ls ~/.local/share/llm-corpus/docs/failed/
```

Each failed document gets a `<doc-id>.error.json` sidecar explaining why. You can also ask Claude to read `corpus://failures` — that's an MCP resource that returns the same information in a structured form.

### Daemon controls

```bash
systemctl --user status  corpus.service   # is it running?
systemctl --user restart corpus.service   # restart it
systemctl --user stop    corpus.service   # stop it
systemctl --user start   corpus.service   # start it
journalctl --user -u corpus.service -f    # tail the daemon's log
tail -f ~/.local/state/llm-corpus/telemetry.jsonl   # tail the structured event log
```

The daemon is set to auto-restart on failure and auto-start on boot. `loginctl` linger is on so it keeps running even when you log out.

## What can go wrong, and what to do

### "I dropped a file but it's still in the inbox"

The daemon may be stopped. Check:
```bash
systemctl --user is-active corpus.service
```
If it says anything other than `active`, run `systemctl --user start corpus.service` and look at `journalctl --user -u corpus.service -n 100` for the cause.

### "Documents are stuck at facet_type='unclassified'"

**This is the current biggest cold-start gotcha.** On a fresh install, the approved-terms list (the "established vocabulary") is empty. The first document the classifier sees will propose a term that isn't on the list yet, and the system will mark the document as `unclassified` until that term gets approved. Right now there's no CLI to approve terms, so the document just waits.

Workarounds while this is being fixed:

**A. Seed the vocabulary manually.** Pick a handful of domains and types you care about and insert them directly:
```bash
sqlite3 ~/.local/share/llm-corpus/index.db <<'SQL'
INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
  ('domain', 'engineering',      'established', datetime('now')),
  ('domain', 'personal-finance', 'established', datetime('now')),
  ('domain', 'health',           'established', datetime('now')),
  ('domain', 'writing',          'established', datetime('now')),
  ('domain', 'reference',        'established', datetime('now')),
  ('type',   'article',          'established', datetime('now')),
  ('type',   'spec',             'established', datetime('now')),
  ('type',   'reference',        'established', datetime('now')),
  ('type',   'note',             'established', datetime('now')),
  ('type',   'invoice',          'established', datetime('now')),
  ('type',   'report',           'established', datetime('now'));
SQL
```
Then reprocess any stuck documents:
```bash
corpus reenrich
```

**B. Drop a small batch of documents that span the topics you care about.** Even though they'll all get marked `unclassified` on first pass, the proposed-terms table fills up as a side effect, and once enough distinct terms accumulate the system has something to work with.

**Caveat (observed 2026-05-15):** seeding 22 starter terms (11 domains + 11 types) makes the grammar large enough that `qwen3.5:9b` constrained-decoding routinely exceeds the 60s `perDocClassifyTimeoutMs` in `interactivePolicy`. The reenrich command will report `classify_aborted` for the stuck docs. Two ways forward: (1) seed FEWER terms (say 5 domains + 5 types so the grammar is smaller), or (2) use the slower-but-bigger-budget batch policy by raising `interactivePolicy.perDocClassifyTimeoutMs` in `packages/pipeline/src/policies.ts` from 60_000 to ~180_000. Both are workarounds; the proper fix is on the polish backlog.

### "Ollama isn't responding"

Classification and embedding both depend on Ollama running locally:
```bash
systemctl is-active ollama
ollama list      # should show qwen3.5:9b (or gemma3:4b) AND nomic-embed-text
```
If a model is missing:
```bash
ollama pull qwen3.5:9b       # classifier
ollama pull nomic-embed-text  # embedder
```

### "I want to wipe everything and start over"

```bash
systemctl --user stop corpus.service
rm -rf ~/.local/share/llm-corpus/
rm -rf ~/.local/state/llm-corpus/
mkdir -p ~/.local/share/llm-corpus/docs/{inbox,pending,processed,failed,store,trash}
systemctl --user start corpus.service
```

The daemon will recreate the SQLite index from empty on next start.

### "Something else looks wrong"

Tail the daemon's structured event log:
```bash
tail -f ~/.local/state/llm-corpus/telemetry.jsonl
```
Every stage emits structured events. `severity: warn` or `severity: error` lines are where to look. The dev repo's `~/Projects/llm-corpus/specs/006-hardening/` directory has the schema for every event class.

## What the daemon does, in eight stages

If you ever look at telemetry events and want to know what stage a document is in, this is the pipeline:

1. **inbox.allowlist_hit** — file arrived, MIME type accepted
2. **ingest** — hash, dedup-check, normalize to Markdown, move from `inbox/` to `processed/`, write SQL row
3. **classify** — call Ollama (qwen3.5:9b), get back domain + type + tags + summary, validate against the approved-terms vocabulary
4. **embed** — call Ollama (nomic-embed-text), get back a 768-dim vector
5. **index** — write to `documents_fts` (BM25 keyword search) + `documents_vec` (semantic search)
6. **edges-build** — find related documents via tag overlap + content similarity
7. (optional) **edges_pruning** — drop weak edges
8. **search.completed** — happens on every query; not part of ingest

On clean shutdown all eight emit `*.completed`. On `kill -9` mid-pipeline, the daemon detects the orphaned work on next startup and re-queues it (that's the SP-006 recovery scanner).

## Where the source-of-truth lives for the running system

When this guide and the dev repo's CLAUDE.md disagree about what the running system does, trust the running system. Useful one-liners:

```bash
# version of the binary on PATH:
corpus --help | head -1

# what the daemon thinks the paths are (works while service is running):
journalctl --user -u corpus.service | grep -i 'paths' | head -5

# what the schema actually looks like:
sqlite3 ~/.local/share/llm-corpus/index.db ".schema documents"
sqlite3 ~/.local/share/llm-corpus/index.db ".schema taxonomy_terms"
```

## What's documented elsewhere

| For | Read |
|---|---|
| How agents (Claude, etc.) consume corpus | `docs/PALLAS-INTEGRATION.md` (TODO — being written next) |
| What's currently broken / on the polish backlog | `docs/SESSION_STATE.md` |
| Architecture and why | `WHITEPAPER-FINAL.md`, `ARCHITECTURE-FINAL.md` |
| Per-sprint design decisions | `specs/00{1..6}-*/` |
| Code conventions for contributors | `CLAUDE.md` |
