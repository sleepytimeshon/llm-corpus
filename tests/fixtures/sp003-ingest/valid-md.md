---
title: Sample Markdown for SP-003 ingest happy-path
author: sp003 test fixture
---

# Sample Markdown

This is a small fixture used by the SP-003 ingest-pipeline tests for the
happy-path Markdown normalization check.

## Section one

Markdown body content is passed through verbatim by `normalize-markdown.ts`;
the test asserts byte-identical passthrough of this body after the
frontmatter is replaced with the FR-008 minimum surface.

## Section two

- list item
- another list item

```
fenced code block — preserved as-is.
```

End of fixture.
