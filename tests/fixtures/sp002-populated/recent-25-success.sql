-- T029 — 25 successful ingests in descending ingest_timestamp order.
--
-- Used by US3 N-window tests: default N=10 returns the first 10 here.
-- Column order MUST match DOCUMENTS_COLUMN_LIST (R6).

INSERT INTO documents
(id, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
VALUES
('doc-00000001', 'Doc 01', 'doc-00000001.md', '/inbox/01.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '3285ce623d5a5bb2d46558e93f455343105faf06839d14f2229890824aa833de', '2026-05-15T14:30:00Z', 'success'),
('doc-00000002', 'Doc 02', 'doc-00000002.md', '/inbox/02.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '94885c6e4d877f5ef2f12fea4f7c0400c3c1a0da2996c6106e3d457d4116185d', '2026-05-15T14:29:00Z', 'success'),
('doc-00000003', 'Doc 03', 'doc-00000003.md', '/inbox/03.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '21c59be05063fb8d6be0fe6ff685dffc3f07c2a87de41886c527ca50cea4e0c6', '2026-05-15T14:28:00Z', 'success'),
('doc-00000004', 'Doc 04', 'doc-00000004.md', '/inbox/04.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'f4421f45e36847da62eb91de91113c67ff192da700a1b3cb7f714238fdbfa68f', '2026-05-15T14:27:00Z', 'success'),
('doc-00000005', 'Doc 05', 'doc-00000005.md', '/inbox/05.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'a0bda7257c20527440df0fe58c7b4b5b230890c72af93da5fe65c2b09f88eeb6', '2026-05-15T14:26:00Z', 'success'),
('doc-00000006', 'Doc 06', 'doc-00000006.md', '/inbox/06.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '46a16513c26f4725a4fb251126c4443f7269d31e2e5c1025c3ce65dbe5452f7b', '2026-05-15T14:25:00Z', 'success'),
('doc-00000007', 'Doc 07', 'doc-00000007.md', '/inbox/07.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '72da6cbb67b841e854f7118e47cb80dc728aa00d5ee254d9b8277549ba4b645e', '2026-05-15T14:24:00Z', 'success'),
('doc-00000008', 'Doc 08', 'doc-00000008.md', '/inbox/08.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '5d37fc44218ab2c5c27a6fa4088fdfe45909b4a39980fe68abe8f4a7cfaf202e', '2026-05-15T14:23:00Z', 'success'),
('doc-00000009', 'Doc 09', 'doc-00000009.md', '/inbox/09.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '9eec4c0d7aa2d8317902e0bd1b651299c5f5f13138c00ad7a02d9694c92ddb09', '2026-05-15T14:22:00Z', 'success'),
('doc-0000000a', 'Doc 10', 'doc-0000000a.md', '/inbox/10.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '47366972c3a210ec416be9aef43229aaac908f80bc62cb8bcc5841a3987363f4', '2026-05-15T14:21:00Z', 'success'),
('doc-0000000b', 'Doc 11', 'doc-0000000b.md', '/inbox/11.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '78c56a19fd883fe747ad0fa555337c8c60445b587f66c63d1d2d9e9bc2054bfc', '2026-05-15T14:20:00Z', 'success'),
('doc-0000000c', 'Doc 12', 'doc-0000000c.md', '/inbox/12.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'c72c98c0edd042bb064cac7620b7cf0c0ee2d11c5d7abda1a3c89d2fee113efe', '2026-05-15T14:19:00Z', 'success'),
('doc-0000000d', 'Doc 13', 'doc-0000000d.md', '/inbox/13.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '0c32d3dab1b58897ee51024a637672de24a2bb058f772f57849d6eedaa8d40d0', '2026-05-15T14:18:00Z', 'success'),
('doc-0000000e', 'Doc 14', 'doc-0000000e.md', '/inbox/14.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '7e40d8abf5359a167cd935908a3395cb0af802872e63fdaa97fad7aadf04243e', '2026-05-15T14:17:00Z', 'success'),
('doc-0000000f', 'Doc 15', 'doc-0000000f.md', '/inbox/15.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'c72d94291b114e59301ef98c6779d8ea940079f69210e5a66d16546b568374be', '2026-05-15T14:16:00Z', 'success'),
('doc-00000010', 'Doc 16', 'doc-00000010.md', '/inbox/16.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '054ec3d2998dcdfcfa3e5e00c6e51e3dac986ecbf9338aebea86e670321d401e', '2026-05-15T14:15:00Z', 'success'),
('doc-00000011', 'Doc 17', 'doc-00000011.md', '/inbox/17.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '34d7df0b9711a7123d31c07c288812f7304750b1a65d056717b37ca6449bc7f5', '2026-05-15T14:14:00Z', 'success'),
('doc-00000012', 'Doc 18', 'doc-00000012.md', '/inbox/18.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '8d8510e7343bbbfd5328b4b4fc835f52d2e2a70ce8f722983c6233a1800878a9', '2026-05-15T14:13:00Z', 'success'),
('doc-00000013', 'Doc 19', 'doc-00000013.md', '/inbox/19.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'fa635f2e24e8c40ba36571a8cfac8878a1d400d212ee029047f4626840705042', '2026-05-15T14:12:00Z', 'success'),
('doc-00000014', 'Doc 20', 'doc-00000014.md', '/inbox/20.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e0ad214a43d452942793961816158a2ec9ba46407af7f2fa7b9242e1c7896248', '2026-05-15T14:11:00Z', 'success'),
('doc-00000015', 'Doc 21', 'doc-00000015.md', '/inbox/21.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '68ffcbe078683e86591a02d2096266fcb80c0b485dfb6bcb983e93c6bb702bd8', '2026-05-15T14:10:00Z', 'success'),
('doc-00000016', 'Doc 22', 'doc-00000016.md', '/inbox/22.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', '89c79a518353a281074ceddf811181022123862904f261ce8230af13fd7006da', '2026-05-15T14:09:00Z', 'success'),
('doc-00000017', 'Doc 23', 'doc-00000017.md', '/inbox/23.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'e839f574e83a641b9f48e46c0fe5bc86266df2f7ec826e223714eead4f0ede49', '2026-05-15T14:08:00Z', 'success'),
('doc-00000018', 'Doc 24', 'doc-00000018.md', '/inbox/24.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'f94ee909bf2eda8a418c1dad45dd228660ec759abed89477547bd615aebb9298', '2026-05-15T14:07:00Z', 'success'),
('doc-00000019', 'Doc 25', 'doc-00000019.md', '/inbox/25.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown', 'a4f9fe0084b4adffb1e4ad1ec7b79da97d563a3996848e806e05b5d10894a9b4', '2026-05-15T14:06:00Z', 'success');
