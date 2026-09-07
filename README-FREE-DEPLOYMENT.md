# XAUUSD HFT — $0 GitHub Pages + Render deployment

This package is prepared for phone-only deployment using GitHub Free + Render Free.

## Architecture

Phone browser -> GitHub Pages dashboard -> secure WebSocket -> Render backend -> MetaApi streaming -> Exness MT5.

GitHub Pages hosts only the frontend. Render hosts the Node.js execution engine.

## Important limitation

Render Free is not a production trading VPS. Free web services can restart and spin down, and the service has only 0.1 CPU / 512 MB RAM. The included GitHub Actions workflow pings `/health` every 10 minutes as a best-effort keep-warm mechanism. Scheduled GitHub Actions are not a guarantee of uninterrupted 24/7 trading.

Keep `LIVE_TRADING=false` until demo testing is complete.

## Phone-only setup

1. Create a PUBLIC GitHub repository.
2. Upload the entire package contents to the repository's `main` branch.
3. Edit `frontend/config.js` and replace `YOUR-RENDER-SERVICE.onrender.com` with your Render backend URL after Render creates it.
4. In GitHub: Settings -> Pages -> Source: GitHub Actions.
5. In Render: New -> Web Service -> connect the GitHub repository.
6. Choose the Free plan. Render can use the included `render.yaml`, or enter:
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/health`
7. Add environment variables in Render:
   - `METAAPI_TOKEN`
   - `METAAPI_ACCOUNT_ID`
   - `METAAPI_REGION=london`
   - `EXNESS_SYMBOL=XAUUSDm`
   - `LIVE_TRADING=false`
   - `FRONTEND_ORIGIN=https://YOUR-GITHUB-USERNAME.github.io`
8. Deploy Render.
9. Copy the Render URL into `frontend/config.js`, commit the change, and wait for GitHub Pages to redeploy.
10. In GitHub Settings -> Secrets and variables -> Actions -> Variables, create:
    - Name: `HFT_BACKEND_URL`
    - Value: your Render URL, e.g. `https://xauusd-hft-backend.onrender.com`
11. Open the GitHub Pages URL on your phone.
12. Verify backend connection, Exness tick stream, symbol, demo orders, SL/TP and risk controls.

## Do not put secrets in GitHub

Never put `METAAPI_TOKEN` or `METAAPI_ACCOUNT_ID` in `frontend/config.js`. Those belong only in Render environment variables.

## Live trading

Only after successful demo validation should you change Render's `LIVE_TRADING` environment variable to `true`.
