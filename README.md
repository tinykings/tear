# tear

A shareable tier list editor with URL-based state, PNG export. Hosted on GitHub Pages.

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

