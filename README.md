<p align="center">
  <img src="public/logo.png" alt="Blink Logo" width="120" />
</p>

<h3 align="center">A shareable tier list editor</h3>
<h4 align="center">https://tinykings.github.io/tear/</h4>



## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

This repo is configured for GitHub Pages deployment with GitHub Actions.

- `vite.config.ts` uses a relative base path
- `public/logo.png` and `public/favicon.svg` are served as static assets
- `.github/workflows/pages.yml` builds and deploys the app on push to `main`

