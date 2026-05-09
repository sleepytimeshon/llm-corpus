-- T029 — 5 successful + 5 failure-lane rows for SC-006 (failure-lane exclusion).
--
-- corpus://recent MUST exclude status='failed' rows. Tests assert the failure
-- ids do not appear in the response.

INSERT INTO documents
(id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
VALUES
-- Successful ingests
('doc-aa000001', 'Success 1', 'doc-aa000001.md', '/inbox/s1.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
('doc-aa000002', 'Success 2', 'doc-aa000002.md', '/inbox/s2.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:25:00Z', 'success'),
('doc-aa000003', 'Success 3', 'doc-aa000003.md', '/inbox/s3.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:20:00Z', 'success'),
('doc-aa000004', 'Success 4', 'doc-aa000004.md', '/inbox/s4.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:15:00Z', 'success'),
('doc-aa000005', 'Success 5', 'doc-aa000005.md', '/inbox/s5.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:10:00Z', 'success'),
-- Failure-lane (status='failed') — MUST NOT appear in corpus://recent
('doc-ff000001', 'Failed 1', 'doc-ff000001.md', '/inbox/f1.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T15:00:00Z', 'failed'),
('doc-ff000002', 'Failed 2', 'doc-ff000002.md', '/inbox/f2.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:55:00Z', 'failed'),
('doc-ff000003', 'Failed 3', 'doc-ff000003.md', '/inbox/f3.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:50:00Z', 'failed'),
('doc-ff000004', 'Failed 4', 'doc-ff000004.md', '/inbox/f4.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:45:00Z', 'failed'),
('doc-ff000005', 'Failed 5', 'doc-ff000005.md', '/inbox/f5.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:40:00Z', 'failed');
