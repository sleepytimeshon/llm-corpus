-- T029 — 5 successful + 5 failure-lane rows for SC-006 (failure-lane exclusion).
--
-- corpus://recent MUST exclude status='failed' rows. Tests assert the failure
-- ids do not appear in the response.

INSERT INTO documents
(id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
VALUES
-- Successful ingests
('doc-aa000001', 'Success 1', 'doc-aa000001.md', '/inbox/s1.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '02ccd9ef3784768cb60963a40e4a45f499bea1abf4925a656f02b734e8d67096', '2026-05-15T14:30:00Z', 'success'),
('doc-aa000002', 'Success 2', 'doc-aa000002.md', '/inbox/s2.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '9996229af2dd45c1fb7cd416fb1b4d0bb5c572d0aeb0e56592380019e1f23f3c', '2026-05-15T14:25:00Z', 'success'),
('doc-aa000003', 'Success 3', 'doc-aa000003.md', '/inbox/s3.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '81a8430cd69d665f89c8eebdbd668ebc933713f7a98984747bf49ec361501d29', '2026-05-15T14:20:00Z', 'success'),
('doc-aa000004', 'Success 4', 'doc-aa000004.md', '/inbox/s4.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'bbc5ae08ca755063553f5e92a2c4f275879047b9393629b9a7bf0215af612c7c', '2026-05-15T14:15:00Z', 'success'),
('doc-aa000005', 'Success 5', 'doc-aa000005.md', '/inbox/s5.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'd2f6bf8184bf8e2c890300a351010cdebaadb7e512114e989e886a254faa5500', '2026-05-15T14:10:00Z', 'success'),
-- Failure-lane (status='failed') — MUST NOT appear in corpus://recent
('doc-ff000001', 'Failed 1', 'doc-ff000001.md', '/inbox/f1.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '92f7e4437643060698d64a10d70ce4352d19eb6fb9513e7c9b57058292521f88', '2026-05-15T15:00:00Z', 'failed'),
('doc-ff000002', 'Failed 2', 'doc-ff000002.md', '/inbox/f2.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '7ee240f6ebd167bc0b7b49d5f6083c16db892b3c3b7acec6596a6473af3c591a', '2026-05-15T14:55:00Z', 'failed'),
('doc-ff000003', 'Failed 3', 'doc-ff000003.md', '/inbox/f3.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '2df26c55839e5ab2a04d985067b829743a970b9400206529ac2a8a46e9637ab1', '2026-05-15T14:50:00Z', 'failed'),
('doc-ff000004', 'Failed 4', 'doc-ff000004.md', '/inbox/f4.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'bdbf8b3216af004d081de2136c40a7c28bdd2e81eeeab0d0f5ecdcfbbe55db08', '2026-05-15T14:45:00Z', 'failed'),
('doc-ff000005', 'Failed 5', 'doc-ff000005.md', '/inbox/f5.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '654160ba147dc41af6725b3334079e10f7459171d8fc6643915529bcea28dfe8', '2026-05-15T14:40:00Z', 'failed');
