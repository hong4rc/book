# Custom catalogue drop-in

Any `.csv` file placed in this directory is ingested alongside Wikisource and
normalised into the same schema. Nothing else in the pipeline changes.

This exists so a catalogue you are entitled to use can be added without
modifying any code.

## Columns

`title` and `sourceUrl` are required; the rest are optional.

| Column | Notes |
|---|---|
| `title` | Display title |
| `author` | Blank becomes `null` — leave it blank rather than guessing |
| `sourceUrl` | Canonical page for the work |
| `downloadUrl` | Direct download; falls back to `sourceUrl` when absent |
| `format` | `epub` (default), `pdf`, `mobi`, or `txt` |
| `categories` | Semicolon-separated, e.g. `Thơ ca;Lịch sử` |
| `license` | Defaults to `unknown` |
| `language` | BCP-47; defaults to `vi` |

## Example

```csv
title,author,sourceUrl,downloadUrl,format,categories,license,language
Tên sách,Tên tác giả,https://example.org/sach,https://example.org/sach.epub,epub,Thơ ca;Lịch sử,PD,vi
```

Records land with `source: "custom"` and an id of `custom:<title>`, so they are
distinguishable from Wikisource entries and win on id collision.

## Before you add anything

Only add works you have the right to catalogue and link. This repository stores
metadata and links, never files — but a link to an infringing copy is still
worth avoiding. Record the real licence in the `license` column rather than
leaving it `unknown`.
