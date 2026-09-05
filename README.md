# book

A searchable, static catalogue of Vietnamese public-domain ebooks.

Search by title, author, or category, then download a real EPUB. There is no
server, no database, and no API key: the catalogue is versioned JSON in this
repository, search runs entirely in your browser, and a scheduled GitHub Action
keeps the data fresh.

## How it works

```
vi.wikisource API  ->  data/books.ndjson  ->  data/facets.json  ->  site/
   (metadata)           (one record per         (taxonomy)          (GitHub
                         line, sorted)                               Pages)
                                                                       |
                          download click  ------------------------->  ws-export
                                                                    (EPUB built
                                                                     on demand)
```

Every stage is a pure file-to-file transform, so each one re-runs on its own and
every catalogue change is reviewable as a diff.

## No ebook files are stored here

This repository holds **metadata and links only**. That is a hard constraint,
not a preference.

Each Wikisource EPUB is about 4.35MB, but roughly 7.7MB of its 8.2MB
uncompressed size is the same four embedded FreeSerif fonts, repeated in every
file — the actual text of a work is around 370KB. Across the corpus that is
roughly **30GB**, against a GitHub limit of about 1–5GB per repository.
Mirroring the files is not possible, so downloads are generated on demand by
[ws-export](https://ws-export.wmcloud.org/) instead.

You still get a one-click download. The repository still clones in seconds.

## Data provenance

| Source | Records | Access | Content licence |
|---|---|---|---|
| [Vietnamese Wikisource](https://vi.wikisource.org/) | ~6,900 root works | MediaWiki API | Public domain or CC BY-SA 4.0, per work |
| `data/custom/*.csv` | operator-supplied | local files | whatever the operator supplies |

The pipeline uses the MediaWiki API and never scrapes HTML. It sends a
descriptive User-Agent and paces itself to one request per second, per the
[Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy).

Sources considered and not used: Project Gutenberg has no Vietnamese-language
works; Internet Archive's Vietnamese text collection needs heavy quality
filtering; Open Library offers metadata but no downloadable EPUB.

## Licence

Code in this repository is MIT — see [LICENSE](./LICENSE).

The catalogued **works are not relicensed here**. Each record carries its
upstream `license` field and a link to its source. Check the source before
redistributing any work.

## Development

```bash
npm ci
npm run validate    # schema, uniqueness, and sort-order gate on books.ndjson
npm run ingest      # refresh catalogue from vi.wikisource
npm run facets      # derive the category taxonomy
npm run build       # build the search index and the site
```

Plans and phase documents live in [`plans/`](./plans/).
