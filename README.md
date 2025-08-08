# Fernando Service Area — City Checker

A small React app (Vite) that shows the Fernando Service Area polygon and lets you check whether a city is covered. Upload your CSV/XLSX with the 99 cities to enable lookups. Works offline (no external tile servers).

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview
```

## Deploy (pick one)

### 1) Vercel (recommended, easiest)
1. Create a GitHub repo and push this folder, or use Vercel's **Import Project** and select your repo.
2. Framework preset: **Vite** (auto-detected).
3. Build command: `npm run build` (default), Output directory: `dist` (default).
4. Click **Deploy**. You get a public URL.

### 2) Netlify
- **Git**: New site from Git, pick repo, build command `npm run build`, publish directory `dist`.
- **Netlify Drop**: requires a built folder. Run `npm run build` locally, then drag the `dist` folder to https://app.netlify.com/drop

### 3) Cloudflare Pages
- Connect to Git, set Build command `npm run build`, Build output `dist`.

### CSV format
- Expected column: `NAME` (city names).
- Matching ignores case and extra spaces; also shows fuzzy suggestions for typos.

### Notes
- The map uses a blank local style to avoid any 403s in restricted environments. If you want OSM tiles in production, add a raster style in `index.html` or switch the style in code.
