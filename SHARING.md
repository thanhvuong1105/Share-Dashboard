# Share this dashboard with full live data

This project needs your backend (with OKX keys) running and a frontend build that points to it. Follow these steps to let others view the same data.

## 1) Backend: configure and run
1. Copy the sample env and fill keys:
   - `cp .env.server.example .env`
   - Edit `.env` with your `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`. Optional: multiple creds via the `OKX_API_KEYS`, `OKX_SECRET_KEYS`, `OKX_PASSPHRASES` lists.
2. Install deps (once): `npm install`
3. Start backend: `npm run server` (or `node server.cjs`). Default port is 4000; change `PORT` in `.env` if needed.
4. Expose the backend on HTTPS (recommended) via a reverse proxy (nginx/Caddy/Cloudflare Tunnel). Keep `app.use(cors())` or allow CORS at the proxy.

## 2) Frontend: build pointing to your backend
1. Copy the frontend env sample:
   - `cp .env.frontend.example .env.production`
   - Set `VITE_API_BASE` to your public backend URL (no trailing slash), e.g. `https://your-backend.example.com`.
2. Build: `npm run build`
3. Deploy the `dist/` folder to any static host (Vercel, Netlify, S3/CloudFront, Cloudflare Pages, or your own nginx).

### Vercel (auto deploy on git push)
- Ensure `vercel.json` is in repo (already added).
- In Vercel dashboard: import repo → set env `VITE_API_BASE=https://your-backend.example.com` → build command `npm run build`, output `dist` (auto-detected from vercel.json). Every push triggers build & deploy.

### Netlify (auto deploy on git push)
- `netlify.toml` is included. In Netlify: import repo → set env `VITE_API_BASE=https://your-backend.example.com` → build command `npm run build`, publish dir `dist`. SPA redirect is handled by netlify.toml.

## 3) Smoke test after deploy
- Open the site and check Network tab: calls should hit `https://your-backend.example.com/api/...` and return HTTP 200 with JSON.
- Verify Bot list, Fund overview, modal details all show numbers (not blank).
- If you see CORS errors, adjust the proxy/CORS settings to allow the frontend origin.

## 4) Optional tightening
- Restrict viewers via basic auth or IP allowlist on the reverse proxy.
- Rotate OKX keys after sharing if you are concerned about exposure.
- Keep the backend process alive via PM2/systemd or your hosting’s process manager.
