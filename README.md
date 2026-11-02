# Film Yearbook

Turn your Letterboxd diary into a print-ready A1 poster of every film you watched in a year. Runs locally with Next.js; data lives in JSON files and images on your disk. The only external service is TMDb (posters and runtimes).

## Setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

Edit `.env.local` and set **one** of:

- `TMDB_API_TOKEN`: the "API Read Access Token" from <https://www.themoviedb.org/settings/api> (recommended)
- `TMDB_API_KEY`: the v3 API key

The credentials are only used server-side and are never sent to the browser. Restart the app after you change them. Without credentials, you can still import your diary, upload posters manually and export the image.

## Run

```bash
npm run dev        # development, http://localhost:3000
npm run build      # production build
npm run start      # serve the production build
npm run lint
npm run typecheck
```

## Import your Letterboxd data

1. On Letterboxd go to **Settings → Data → Export your data** and download the ZIP.
2. In Film Yearbook, click **Import** (top right) and choose the ZIP, or the `diary.csv` inside it.
3. Pick a year. Posters for that year are matched on TMDb and downloaded automatically, and a progress bar shows how far along it is.

The viewing year comes from `Watched Date`, not from the film's release year. Each diary row is a separate entry, so rewatches appear twice and share the same poster file.

To update at the end of the year, import a newer export with **Import update**. New entries are added and only new or unresolved films are fetched. Manual corrections and downloaded images are kept. Entries that no longer appear in the export are kept, and you get an explicit **Remove them** action for them.

## Fix posters

Click any poster to open the editor:

- **Search TMDb**: search by title (and year), TMDb ID or themoviedb.org URL. Pick the film, then pick any of its posters.
- **Upload image**: JPEG, PNG or WebP. The original file is validated and stored unmodified.

**Save** applies the change and **Cancel** discards it. **Reset to automatic TMDb poster** removes a manual correction. Posters marked with an amber dot are uncertain matches that you should confirm.

## Generate the print files

Choose A1 portrait (default) or landscape and click **Generate Image**. Before rendering, the app warns you about entries without a poster, unconfirmed matches and posters that would print below 200 DPI. It then writes:

- PNG: 7016 × 9933 px (portrait) at 300 DPI, with DPI metadata
- PDF: a single page of exactly 594 × 841 mm containing the full-resolution image

The grid layout is computed automatically for any number of films. The posters keep a 2:3 aspect ratio, gutters are uniform, a partial last row is centered and margins are safe for printing. The **Print layout** preview on the page uses the same layout algorithm.

## Where data is stored

Everything lives in `data/` inside the project (git-ignored), and all paths in the JSON files are relative:

```text
data/
  years/2026.json          diary entries per watched year: imported source, TMDb match, manual override
  posters/tmdb/            original-resolution TMDb posters (cached, never re-downloaded)
  posters/custom/          your uploaded posters
  cache/tmdb-matches.json  film → TMDb match cache shared across years
  cache/thumbs/            preview thumbnails (safe to delete)
  exports/                 generated PNG and PDF files
```

**Backup** (top right) downloads a ZIP with all JSON data and poster images.
