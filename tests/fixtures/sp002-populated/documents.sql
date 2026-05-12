-- T029 — Standard fixture: 5 successful documents.
--
-- Column order MUST match DOCUMENTS_COLUMN_LIST in
-- packages/storage/src/schema-migration.ts. Drift = fixture-load failure (R6).
--
-- Columns (in order): id, title, body_path, source_path, facet_domain,
--   tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp,
--   status

INSERT INTO documents
(id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
VALUES
('doc-ab12cd34', 'Hybrid Search with FTS5 and sqlite-vec', 'doc-ab12cd34.md', '/inbox/hybrid-search.md', 'devops', '["sqlite","search","fts5"]', 'tutorial', 'article', 'text/markdown', 'ba85d91e7a14fba88d2fc3a876a73f689da1b4888c1cfbcb655ffd8148713b21', '2026-05-15T14:30:00Z', 'success'),
('doc-cd34ef56', 'Ansible Playbook Patterns', 'doc-cd34ef56.md', '/inbox/ansible.md', 'devops', '["ansible","rhel-9"]', 'reference', 'manual', 'text/markdown', 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', '2026-05-15T14:25:00Z', 'success'),
('doc-ef567890', 'Systemd Unit File Reference', 'doc-ef567890.md', '/inbox/systemd.md', 'linux', '["systemd","rhel-9"]', 'reference', 'manual', 'text/markdown', '60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752', '2026-05-15T14:20:00Z', 'success'),
('doc-12345678', 'Buddhist Meditation Guide', 'doc-12345678.md', '/inbox/meditation.md', 'writing', '["buddhism"]', 'tutorial', 'book', 'text/markdown', '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9', '2026-05-15T14:15:00Z', 'success'),
('doc-87654321', 'NFS Tuning on RHEL 9', 'doc-87654321.md', '/inbox/nfs.md', 'linux', '["nfs","rhel-9"]', 'analysis', 'article', 'text/markdown', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b', '2026-05-15T14:10:00Z', 'success');
