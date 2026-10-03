# CSV song import — format spec

Source of truth for the control panel's "Importar CSV" feature
(`apps/web/app/room/[roomId]/page.tsx`, parsed by `apps/web/lib/csv.ts`,
processed by `POST /api/rooms/[roomId]/songs/batch`). Written for whoever
turns this into user-facing docs — describes the contract as implemented,
not aspirational behavior.

## Purpose

Bulk-add songs to the library (search YouTube, download, separate stems,
best-effort fetch synced lyrics) from a spreadsheet export instead of
adding them one at a time through the search box. Matches the existing
single-song "Automático" flow — same backend call, just looped.

## Ways to build the import list

All three feed the same editable staging list in the control panel. Nothing
is imported until the user presses "Confirmar importação". Entries are
de-duplicated by artist + title, so mixing sources or re-uploading the same
file doesn't double anything.

1. **Spotify search**: one box searching song, album and artist names at
   once (`POST /api/spotify/search`, up to 8 of each). Needs
   `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
   - **Músicas**: each added individually with its + button.
   - **Álbuns**: + adds the official tracklist in order
     (`POST /api/spotify/album`).
   - **Artistas**: opens that artist's songs and albums (a search with
     Spotify's `artist:"Name"` filter, which can also be typed directly).
   - **Links** skip the results: a track link (`open.spotify.com/track/...`,
     `spotify:track:...`) adds that song, an album link adds its tracklist.
   - " - Remaster" suffixes are stripped from titles.
   - **Playlists aren't supported**: since Spotify's Feb 2026 API changes,
     playlist contents can only be read with the owner's own Spotify login.
2. **CSV upload**: the file format below. Each row is first matched to its
   exact Spotify track (`POST /api/spotify/resolve`, by title and artist),
   so the list uses the catalog's spelling: typos and capitalization are
   fixed, and a row with no artist gets one. Matched rows show Spotify's
   cover art. A row with no confident match (the looser fallback search
   only counts if its artist matches the row's) stays as typed and is
   flagged "Não encontrada no Spotify". If Spotify can't be reached, all
   rows are staged as typed.
3. **Manual entry**: an artist + title row typed directly into the list.

The staged list can be edited (remove any row, add rows) and exported as a
`.csv` in the format below ("Baixar .csv") before confirming.

## File format

- Plain `.csv`, UTF-8, comma-delimited.
- **Header row required**, case-insensitive. Two recognized columns:
  | column   | required | meaning                                      |
  |----------|----------|-----------------------------------------------|
  | `artist` | no       | Artist/band name                               |
  | `title`  | yes*     | Song title                                     |

  \* A row with an empty `title` (and no `artist` either) is silently
  skipped — not an error, just not counted.
- Extra columns are ignored (safe to export a spreadsheet as-is without
  trimming it down first).
- Fields containing a comma must be quoted (`"Artist, The"`); a literal
  `"` inside a quoted field is written as `""`.
- Blank lines are ignored.
- A line whose first non-whitespace character is `#` is treated as a
  comment and ignored — useful for notes in a hand-edited file.
- Line endings: LF or CRLF, either is fine.

### Example

```csv
artist,title
Jota Quest,Dias Melhores
Bring Me The Horizon,Teardrops
# the next one has a comma in the title
Guns N' Roses,"Sweet Child O' Mine (live)"
```

## How a row becomes a search

Each row's `artist` and `title` are joined with a space, with "lyrics"
appended (`"Jota Quest Dias Melhores lyrics"`), and used as a YouTube
search query. The top result is imported. The "lyrics" suffix steers the
match toward lyric-video uploads, which start exactly on the song; official
music videos often open with footage that isn't the song and would throw off
the synced lyrics.

When a row has **both** `artist` and `title`, they're also treated as the
song's real metadata:
- The new song is named with them in the library, instead of the YouTube
  video's title and channel (often a fan upload like "... | Lyrics" by
  "TRVPE [Music Lyrics]").
- Synced lyrics are looked up on LRCLIB by that exact artist and title
  first, falling back to parsing the video title.

So rows with both fields filled in get noticeably better lyric matches. A
good `title` (the actual song name, not a loose paraphrase) matters most.

## What happens after upload

1. The file is parsed **in the browser** into the import list. The raw file
   never reaches the server; on confirmation only the list's artist/title
   pairs are sent (`POST /api/rooms/[roomId]/songs/batch`, body
   `{ songs: [{ artist, title }] }`).
2. The app searches YouTube and creates/updates a song for each row, one
   at a time, in list order (not in parallel — see Limits below).
3. Each new song is queued for the local worker to download + separate
   stems. Synced lyrics are attached from LRCLIB right away, before
   processing finishes. A song whose lyrics still couldn't be found shows a
   retry button in place of the mic icon under "Já prontas".
4. **Imported songs are added to the library only — not to today's live
   queue.** They show up under "Já prontas" once processing finishes, same
   as any other song; nobody has to manually request them to start
   playing a karaoke session with them later.
5. A song already in the library (same YouTube video, matched by its
   video ID) is **not** reprocessed — except a previously-failed one,
   which is retried. Importing the same CSV twice is safe.
6. The upload response reports a per-row outcome (song title matched, or
   an error) so you know which rows didn't resolve to anything.

## Limits / failure behavior

- **300 rows per upload.** Extra rows beyond that are dropped without
  processing (not reported as errors — just not attempted).
- Rows are processed **sequentially**, not in parallel, since they share
  one YouTube Data API quota budget (10,000 units/day by default; each
  search costs 100 — roughly 100 searches/day before the key is throttled
  until the next day).
- If a YouTube quota/auth error (HTTP 403) is hit partway through, the
  import stops immediately and every remaining row is reported as
  skipped rather than retried — avoids burning the rest of a dead quota
  on requests that would all fail the same way.
- A row with no YouTube results at all is reported as an error for that
  row only; the rest of the batch continues.
