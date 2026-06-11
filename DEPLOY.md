# GitHub Pages deployment

## 1. Configure the public API

Edit `config.js`:

```js
window.GITHUB_WEB_CONFIG = {
  modelArtsApiUrl: "https://api.example.com/api/modelarts/predict",
};
```

The endpoint must:

- Use HTTPS.
- Accept matching multipart `images` and `masks` fields.
- Expose `/health` on the same host.
- Allow CORS requests from the GitHub Pages domain.
- Keep `MODELARTS_APP_CODE` in a server-side secret.

Never place the APP_CODE in this directory.

## 2. Upload this directory

Upload the contents of `github_web` to the root of a GitHub repository.

## 3. Enable GitHub Pages

Open repository `Settings > Pages`, then select:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/(root)`

The site will be available at:

```text
https://USERNAME.github.io/REPOSITORY/
```

## Files intended for GitHub

- `index.html`
- `app.js`
- `config.js`
- `opa-placement.js`
- `opa-placement.css`
- `cutout-postprocess.js`
- `styles.css`
- `assets/`
- `.nojekyll`

Do not upload the local backend, virtual environment, model checkpoint, or `.env`.
