# Document Library Media Ingestion Spec

## Purpose

This document defines supported media types, rejected media types, and pre-processing triage rules for expanding document-library ingestion.

The goal is not to blindly convert every input into Markdown. The goal is to determine whether an input contains useful textual or semantic content, choose the appropriate extraction method, and avoid producing low-value Markdown artifacts.

This spec focuses on input formats and extraction behavior only. Existing decisions about frontmatter, directory layout, asset storage, and metadata linking are out of scope.

## Core Principle

Every input should pass through an early classification step before conversion.

The pipeline should decide one of the following outcomes:

1. Convert directly to Markdown.
2. Extract text through a specialized parser.
3. Transcribe speech to Markdown.
4. OCR text-bearing images or scanned documents.
5. Extract wisdom into a synthesized Markdown document.
6. Reject the input as unsuitable for Markdown conversion.

Some inputs should not be copied into the corpus verbatim. The pipeline must support a user-selected or system-detected wisdom extraction route. In this route, the input is treated as source material, but the corpus document is a synthesized Markdown artifact containing the durable value of the source: key arguments, findings, lessons, procedures, decisions, reusable ideas, or other extracted knowledge.

This route is appropriate when verbatim conversion would produce a document that is too noisy, too long, too visually dependent, or less useful than a distilled representation. Examples include complex PDFs, slide decks, long web pages, long transcripts, and documents whose value is primarily conceptual rather than textual.

The pipeline should prefer proven, Fedora-compatible, open-source tools and libraries rather than custom extraction logic wherever possible. Fedora compatibility may come through Fedora packages, RPM Fusion where legally appropriate, Python packages, Node.js packages, or source builds that run cleanly on Fedora.

## Format Categories

### High-Confidence Markdown Inputs

These formats generally map cleanly to Markdown and should be supported as direct or near-direct conversions.

| Format | Expected Handling |
|---|---|
| TXT | Direct text ingestion. |
| RTF | Convert formatted text to Markdown. |
| DOCX | Extract document structure, headings, lists, tables, and body text. |
| EPUB | Extract book content and convert chapters/sections to Markdown. |
| MOBI | Convert ebook content to Markdown where feasible. |
| EBOOK | Treat as a generic ebook input; resolve actual subtype before processing. |
| TEX | Convert LaTeX source to Markdown while preserving math where possible. |
| ENEX | Convert Evernote export content to Markdown. |
| Notion Export | Convert exported Markdown, HTML, or CSV-based Notion content as appropriate. |
| VTT | Convert captions/subtitles to readable transcript Markdown. |
| SRT | Convert captions/subtitles to readable transcript Markdown. |

### Conditionally Supported Inputs

These formats require triage before conversion. The file extension alone is not enough to determine whether Markdown conversion is useful.

| Format | Triage Requirement | Possible Outcome |
|---|---|---|
| PDF | Determine whether the PDF has extractable text, scanned pages, complex layout, tables, figures, or mixed content. | Direct text extraction, OCR/document-AI extraction, wisdom synthesis, or rejection if unusable. |
| XLSX | Determine whether the spreadsheet is small and document-like or large/data-heavy. | Convert small readable tables; reject or summarize large datasets rather than forcing into Markdown. |
| CSV | Determine whether the CSV is small and human-readable or primarily a dataset. | Convert small tables; reject or summarize large datasets. |
| PPTX | Determine whether the deck is text-heavy or visually dependent. | Extract slide text, optionally synthesize; reject or retain source if text extraction is insufficient. |
| MP3 | Detect whether human speech is present. | Transcribe speech; reject music/noise/non-speech. |
| MP4 | Detect whether useful speech or captions are present. | Transcribe speech, use subtitles, or reject if primarily visual/non-speech. |
| WAV | Detect whether human speech is present. | Transcribe speech; reject music/noise/non-speech. |
| FLAC | Detect whether human speech is present. | Transcribe speech; reject music/noise/non-speech. |
| M4A | Detect whether human speech is present. | Transcribe speech; reject music/noise/non-speech. |
| PNG | Detect whether the image contains meaningful text. | OCR text-bearing images; reject ordinary photos/art. |
| JPG | Detect whether the image contains meaningful text. | OCR text-bearing images; reject ordinary photos/art. |
| WEBP | Detect whether the image contains meaningful text. | OCR text-bearing images; reject ordinary photos/art. |
| TIFF | Detect whether the image contains meaningful text. | OCR scanned/text-bearing images; reject ordinary images. |
| HEIC | Detect whether the image contains meaningful text. | OCR text-bearing images; reject ordinary photos/art. |
| URL | Fetch with browser-like behavior, extract main content, remove boilerplate, and convert to Markdown. | Markdown article/page extraction, with optional story-relevant media handling. |
| HTML | Treat primarily as an intermediate format from URL ingestion or exported content. | Clean, extract main content, then convert to Markdown. |
| RSS | Parse feed entries and ingest linked articles or feed content. | Convert individual items or linked pages to Markdown. |
| ATOM | Parse feed entries and ingest linked articles or feed content. | Convert individual items or linked pages to Markdown. |
| YouTube Video | Detect captions or speech. | Use captions where available; otherwise transcribe audio. |
| Podcast | Resolve feed and episode media, then detect speech. | Transcribe episodes that contain useful speech. |
| EML | Parse email headers and body. | Convert message body to Markdown. |
| MSG | Parse Outlook message content. | Convert message body to Markdown. |
| MBOX | Split archive into individual email messages or conversation groups. | Convert messages or threads to Markdown. |
| Slack Export | Parse structured export. | Convert channels, threads, or conversations to Markdown. |
| Discord Export | Parse structured export. | Convert channels, threads, or conversations to Markdown. |
| Teams Export | Parse structured export. | Convert channels, threads, or conversations to Markdown. |
| WhatsApp Export | Parse exported chat text. | Convert conversations to Markdown. |
| iMessage Export | Parse exported or extracted messages. | Convert conversations to Markdown. |

### Rejected Inputs

These formats should be rejected at the input or pre-processing stage unless a future product decision explicitly adds support.

| Format | Reason |
|---|---|
| CBR | Comic archive made of sequential images. OCR loses visual narrative, layout, and context. |
| CBZ | Comic archive made of sequential images. OCR loses visual narrative, layout, and context. |
| PY | Source code is intentionally out of scope for this document-library ingestion path. |
| JS | Source code is intentionally out of scope for this document-library ingestion path. |
| CPP | Source code is intentionally out of scope for this document-library ingestion path. |
| JSON | Structured data is intentionally out of scope for this document-library ingestion path. |
| YAML | Structured data is intentionally out of scope for this document-library ingestion path. |
| XML | Structured data is intentionally out of scope for this document-library ingestion path. |

## Pre-Processing Triage Gates

### 1. Extension and MIME-Type Gate

The first gate should classify the input by extension, MIME type, and, where necessary, file signature.

This gate should:

- Reject known unsupported formats immediately.
- Identify formats that can be converted directly.
- Route ambiguous formats to deeper inspection.
- Avoid expensive OCR, transcription, or document-AI processing unless the file has passed cheaper checks first.

Example outcomes:

- `.txt` routes directly to text ingestion.
- `.cbz` is rejected.
- `.pdf` routes to PDF triage.
- `.mp3` routes to speech detection.
- `.jpg` routes to image text detection.

### 2. PDF Triage

PDFs require content-based routing. A PDF may be a clean text document, a scanned document, a complex visual report, a slide-like document, or a hybrid.

The PDF triage step should inspect:

- Whether a usable text layer exists.
- Text density per page.
- Image density per page.
- Presence of scanned pages.
- Presence of tables.
- Presence of multi-column or complex layout.
- Presence of figures, charts, diagrams, or other content that plain text extraction would lose.

Recommended open-source tools:

- PyMuPDF for fast inspection and text/image extraction.
- pdfplumber for layout-aware text and table extraction.
- OCRmyPDF or Tesseract for scanned PDFs.
- Marker for complex PDF-to-Markdown conversion.
- Nougat where academic or scientific document parsing is useful.

Routing rules:

| PDF Type | Route |
|---|---|
| Clean text PDF | Extract directly to Markdown. |
| Scanned text PDF | OCR, then convert to Markdown. |
| Complex layout PDF | Use document-AI extraction. |
| Figure/table-heavy PDF | Extract and synthesize rather than relying only on raw text. |
| Poor-quality or non-textual PDF | Reject or mark as not suitable for Markdown conversion. |

For complex PDFs, the desired output may be synthesized rather than purely converted. This means the system may extract the source content, then generate a concise extracted-wisdom document that captures the document’s key arguments, findings, decisions, procedures, or reusable knowledge. In these cases, the synthesized Markdown may be the primary corpus document rather than a preface to a verbatim conversion.

### 3. Image Triage

Image files should not be treated as inherently convertible to Markdown.

The pipeline should distinguish between:

- Images that are actually text-bearing documents.
- Screenshots containing readable information.
- Photos of whiteboards, notes, receipts, forms, or signs.
- Ordinary photographs, artwork, diagrams without readable text, or visual-only material.

Only the first three categories should be routed to OCR.

Recommended open-source tools:

- Tesseract for OCR.
- EasyOCR or PaddleOCR for stronger OCR coverage.
- OpenCV for pre-processing and text-density heuristics.

Suggested heuristics:

- Detect text regions before full OCR.
- Estimate text density.
- Reject images with no meaningful text regions.
- Prefer OCR only when extracted text is likely to be useful.

A photo of a receipt, whiteboard, or scanned letter is a valid Markdown candidate. A photo of space, a landscape, a person, or an illustration is not.

### 4. Audio and Video Triage

Audio and video files should not be sent directly to transcription without first confirming that they contain meaningful speech.

The pipeline should distinguish between:

- Speech-heavy content such as interviews, lectures, podcasts, meetings, audiobooks, and narrated videos.
- Music.
- Ambient/nature sound.
- Noise.
- Incoherent or low-quality speech.
- Speech requiring translation.
- Video whose value is primarily visual rather than spoken.

Recommended open-source tools:

- FFmpeg for media probing and audio extraction.
- Silero VAD for voice activity detection.
- Whisper or faster-whisper for transcription and translation.

Routing rules:

| Media Type | Route |
|---|---|
| High speech ratio | Transcribe to Markdown. |
| Speech plus known language mismatch | Transcribe and translate if configured. |
| Low speech ratio | Reject or skip transcription. |
| Music/noise/ambient audio | Reject. |
| Video with subtitles | Prefer subtitle ingestion where subtitles are complete. |
| Video with useful speech but no subtitles | Extract audio and transcribe. |
| Video that is primarily visual | Reject or require a separate visual-analysis workflow. |

### 5. Web and URL Triage

URL ingestion should be treated as a browser-rendering and content-extraction problem, not a simple HTTP fetch problem.

Many modern sites reject basic tools such as curl, block non-browser user agents, require JavaScript, lazy-load content, or place meaningful content behind rendered DOM state.

The web ingestion path should:

- Fetch pages using a browser-like open-source tool.
- Execute JavaScript where needed.
- Wait for the page to reach a stable rendered state.
- Extract the main article or page content.
- Remove navigation, ads, banners, sidebars, cookie prompts, and boilerplate.
- Preserve story-relevant images when they are part of the main content.
- Drop decorative, tracking, sidebar, avatar, ad, and layout images.
- Convert the cleaned content to Markdown.

Recommended open-source tools:

- Playwright for browser-based fetching and rendering.
- Crawlee for higher-level crawling, browser automation, retries, and session handling.
- Mozilla Readability for article extraction.
- Trafilatura for robust text extraction from web pages.
- Beautiful Soup or lxml for targeted HTML cleanup where needed.
- Turndown or markdownify for HTML-to-Markdown conversion.

HTML should be treated primarily as an ingestion intermediary. The important product behavior is not “store HTML as Markdown”; it is “extract the meaningful page content from HTML and convert that cleaned content to Markdown.”

## Extraction Method Matrix

| Input Class | Primary Method | Secondary Method | Reject Condition |
|---|---|---|---|
| Plain text | Direct ingestion | Encoding cleanup | Empty or unreadable text. |
| Word-processing docs | Document parser | LibreOffice/Pandoc conversion | Corrupt or unreadable file. |
| Ebooks | Ebook parser/converter | Calibre/Pandoc conversion | DRM, corrupt file, or unsupported subtype. |
| Simple PDFs | Text-layer extraction | Layout-aware extraction | No useful text. |
| Scanned PDFs | OCR | Document-AI extraction | OCR confidence too low. |
| Complex PDFs | Document-AI extraction | Extracted-wisdom synthesis | No useful extractable content. |
| Spreadsheets | Table extraction | Summary/synthesis | Too large or primarily dataset-like. |
| Slide decks | Slide text extraction | Summary/synthesis | Visual-only deck with insufficient text. |
| Images | OCR after text detection | Vision-assisted OCR | No meaningful text. |
| Audio | Speech detection, then transcription | Translation | No meaningful speech. |
| Video | Subtitle extraction or audio transcription | Translation | Primarily visual or no useful speech. |
| URLs | Browser render, article extraction, Markdown conversion | Targeted cleanup | Paywall/block/no meaningful content. |
| HTML | Main-content extraction | Targeted cleanup | Boilerplate-only or no meaningful content. |
| Email | Message parser | Thread grouping | Empty/corrupt message. |
| Chat exports | Export parser | Conversation grouping | Unsupported export shape or no useful content. |
| Feeds | Feed parser | Linked-page ingestion | Empty feed or inaccessible entries. |

## Recommended Fedora-Compatible Open-Source Tooling

The pipeline should rely on established tools where possible. Recommended tools must be compatible with Fedora-based execution environments.

Fedora compatibility requirement:

- Prefer tools available through Fedora repositories when practical.
- Use Python or Node.js packages when the project officially supports Linux and runs on Fedora with normal system dependencies.
- Use RPM Fusion only where Fedora’s default repositories omit media capabilities for legal or codec-policy reasons.
- Treat GPU acceleration as optional unless explicitly required by a chosen model.
- Validate the final toolchain on the target Fedora release as part of implementation.

| Area | Candidate Tools | Fedora Compatibility Path |
|---|---|---|
| Browser rendering and crawling | Playwright, Crawlee | Node.js/Python packages; Linux browser/runtime dependencies. |
| Web article extraction | Mozilla Readability, Trafilatura | Node.js or Python packages. |
| HTML parsing and cleanup | Beautiful Soup, lxml | Python packages and/or Fedora Python packages. |
| HTML-to-Markdown | Turndown, markdownify, Pandoc | Node.js/Python packages; Pandoc is available for Fedora. |
| PDF inspection | PyMuPDF, pdfplumber | Python packages. |
| PDF OCR | OCRmyPDF, Tesseract | Fedora packages available. |
| Complex PDF conversion | Marker | Python package; Fedora-compatible Linux runtime. |
| Office document conversion | Pandoc, LibreOffice | Fedora packages available. |
| Ebook conversion | Calibre, Pandoc | Fedora packages available. |
| OCR | Tesseract, EasyOCR, PaddleOCR | Tesseract via Fedora packages; EasyOCR/PaddleOCR via Python packages. |
| Audio/video probing | FFmpeg | Fedora ffmpeg-free package; RPM Fusion may be needed for broader codec support. |
| Voice activity detection | Silero VAD | Python/PyTorch runtime on Fedora. |
| Transcription and translation | Whisper, faster-whisper | Python packages; CPU operation should be supported, GPU optional. |
| Email parsing | Python email library, mailparser, extract-msg | Standard library or Python packages. |
| Feed parsing | feedparser | Python package. |

Tool choices should remain implementation details. Product behavior should be specified in terms of classification, routing, extraction quality, Fedora compatibility, and rejection behavior.

## Product Requirements

1. The ingestion pipeline must not assume that file extension alone determines extractability.
2. The pipeline must reject formats that are known to produce low-value Markdown.
3. The pipeline must triage ambiguous formats before applying expensive extraction methods.
4. The pipeline must distinguish text-bearing images from ordinary images.
5. The pipeline must distinguish speech-bearing audio/video from music, noise, ambient sound, or visual-only media.
6. The pipeline must distinguish simple PDFs from scanned or complex PDFs.
7. The pipeline must support synthesized outputs for complex documents where direct Markdown conversion would be low quality.
8. The pipeline must support user-selected and system-detected wisdom extraction, including cases where the synthesized Markdown artifact becomes the corpus document instead of a verbatim conversion.
9. URL ingestion must use browser-like rendering and main-content extraction rather than basic HTTP fetching.
10. HTML should be processed as a source/intermediate format for cleaned content extraction.
11. The pipeline must use proven Fedora-compatible open-source libraries where available.
12. The pipeline must avoid generating Markdown when the result would be misleading, incoherent, or mostly useless.

## Non-Goals

The following are intentionally out of scope for this spec:

- Frontmatter schema design.
- Metadata linking strategy.
- Asset directory structure.
- Naming conventions.
- Storage layout.
- RAG indexing strategy.
- UI behavior.
- Authorization, permissions, or sharing model.
- Long-term archival policy.

## Summary

The ingestion system should behave less like a universal file converter and more like a media-aware triage pipeline.

The key refinement is to decide early whether an input deserves conversion, transcription, OCR, wisdom extraction, or rejection. This prevents the document library from accumulating malformed Markdown, useless transcripts, OCR garbage, and text-only representations of media whose value is primarily visual or non-textual.

The corpus document should not always be assumed to be a verbatim representation of the source. In some cases, the highest-value document is the extracted wisdom: a concise, synthesized Markdown artifact derived from the source and suitable for retrieval, review, and reuse.

