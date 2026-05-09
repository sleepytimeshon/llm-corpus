-- T029 — 25 successful ingests in descending ingest_timestamp order.
--
-- Used by US3 N-window tests: default N=10 returns the first 10 here.
-- Column order MUST match DOCUMENTS_COLUMN_LIST (R6).

INSERT INTO documents
(id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
VALUES
('doc-00000001', 'Doc 01', 'doc-00000001.md', '/inbox/01.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:30:00Z', 'success'),
('doc-00000002', 'Doc 02', 'doc-00000002.md', '/inbox/02.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:29:00Z', 'success'),
('doc-00000003', 'Doc 03', 'doc-00000003.md', '/inbox/03.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:28:00Z', 'success'),
('doc-00000004', 'Doc 04', 'doc-00000004.md', '/inbox/04.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:27:00Z', 'success'),
('doc-00000005', 'Doc 05', 'doc-00000005.md', '/inbox/05.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:26:00Z', 'success'),
('doc-00000006', 'Doc 06', 'doc-00000006.md', '/inbox/06.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:25:00Z', 'success'),
('doc-00000007', 'Doc 07', 'doc-00000007.md', '/inbox/07.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:24:00Z', 'success'),
('doc-00000008', 'Doc 08', 'doc-00000008.md', '/inbox/08.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:23:00Z', 'success'),
('doc-00000009', 'Doc 09', 'doc-00000009.md', '/inbox/09.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:22:00Z', 'success'),
('doc-0000000a', 'Doc 10', 'doc-0000000a.md', '/inbox/10.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:21:00Z', 'success'),
('doc-0000000b', 'Doc 11', 'doc-0000000b.md', '/inbox/11.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:20:00Z', 'success'),
('doc-0000000c', 'Doc 12', 'doc-0000000c.md', '/inbox/12.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:19:00Z', 'success'),
('doc-0000000d', 'Doc 13', 'doc-0000000d.md', '/inbox/13.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:18:00Z', 'success'),
('doc-0000000e', 'Doc 14', 'doc-0000000e.md', '/inbox/14.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:17:00Z', 'success'),
('doc-0000000f', 'Doc 15', 'doc-0000000f.md', '/inbox/15.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:16:00Z', 'success'),
('doc-00000010', 'Doc 16', 'doc-00000010.md', '/inbox/16.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:15:00Z', 'success'),
('doc-00000011', 'Doc 17', 'doc-00000011.md', '/inbox/17.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:14:00Z', 'success'),
('doc-00000012', 'Doc 18', 'doc-00000012.md', '/inbox/18.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:13:00Z', 'success'),
('doc-00000013', 'Doc 19', 'doc-00000013.md', '/inbox/19.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:12:00Z', 'success'),
('doc-00000014', 'Doc 20', 'doc-00000014.md', '/inbox/20.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:11:00Z', 'success'),
('doc-00000015', 'Doc 21', 'doc-00000015.md', '/inbox/21.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:10:00Z', 'success'),
('doc-00000016', 'Doc 22', 'doc-00000016.md', '/inbox/22.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:09:00Z', 'success'),
('doc-00000017', 'Doc 23', 'doc-00000017.md', '/inbox/23.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:08:00Z', 'success'),
('doc-00000018', 'Doc 24', 'doc-00000018.md', '/inbox/24.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:07:00Z', 'success'),
('doc-00000019', 'Doc 25', 'doc-00000019.md', '/inbox/25.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:06:00Z', 'success');
