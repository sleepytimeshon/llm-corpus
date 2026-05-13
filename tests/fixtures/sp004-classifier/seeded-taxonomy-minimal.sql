-- SP-004 classifier minimal seed taxonomy.
--
-- 2 established domains + 5 established tags + 7 type axis entries.
-- Loaded before integration tests that exercise classify-stage against
-- a constrained established set (proposed-term routing, vocabulary
-- violation, etc.).
--
-- All rows use state='established' (the SP-004 test setup is the ONLY way
-- to land such rows; SP-004 itself NEVER inserts established-state rows
-- per Principle XV / FR-CLASSIFY-007).

INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
  ('domain', 'agent-systems',       'established', '2026-05-01T00:00:00Z'),
  ('domain', 'distributed-systems', 'established', '2026-05-01T00:00:00Z'),
  ('tag',    'memory',              'established', '2026-05-01T00:00:00Z'),
  ('tag',    'retrieval',           'established', '2026-05-01T00:00:00Z'),
  ('tag',    'tutorial',            'established', '2026-05-01T00:00:00Z'),
  ('tag',    'paper',               'established', '2026-05-01T00:00:00Z'),
  ('tag',    'reference',           'established', '2026-05-01T00:00:00Z'),
  ('type',   'entity',              'established', '2026-05-01T00:00:00Z'),
  ('type',   'concept',             'established', '2026-05-01T00:00:00Z'),
  ('type',   'tutorial',            'established', '2026-05-01T00:00:00Z'),
  ('type',   'analysis',            'established', '2026-05-01T00:00:00Z'),
  ('type',   'reference',           'established', '2026-05-01T00:00:00Z'),
  ('type',   'synthesis',           'established', '2026-05-01T00:00:00Z'),
  ('type',   'cheat-sheet',         'established', '2026-05-01T00:00:00Z')
ON CONFLICT(axis, term) DO NOTHING;
