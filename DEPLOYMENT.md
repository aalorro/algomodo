# GitHub Pages Deployment

Algomodo is deployed automatically via **GitHub Actions** to GitHub Pages.

## ⚡ Easy Workflow

1. **Make code changes** in your local repository
2. **Commit and push**: `git commit -m "your message" && git push origin main`
3. **GitHub Actions automatically:**
   - Installs dependencies
   - Runs type checks and linting
   - Builds the project (`npm run build`)
   - Uploads artifacts to GitHub Pages
4. **Site updates live** at: https://aalorro.github.io/algomodo

No manual intervention needed! ✨

---

## How It Works

### GitHub Actions Workflow (`.github/workflows/deploy.yml`)

The workflow triggers on every push to `main` or `master` branches:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main, master]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Build Configuration

**Vite Config** (`vite.config.ts`):
- `base: '/algomodo/'` — sets the base path for GitHub Pages subpath
- `outDir: 'dist'` — builds to `dist/` folder (not committed to git)

**Git Configuration** (`.gitignore`):
- `dist/` is ignored (only built artifacts go there)
- `docs/` is ignored (legacy folder, no longer used)
- Build artifacts are never committed

**GitHub Pages Settings**:
- Source: **GitHub Actions** (automatic deployment)
- `.nojekyll` file disables Jekyll processing

---

## GitHub Pages Configuration

Your repository is already configured for GitHub Actions deployment:

1. **Settings > Pages**
2. Source: **GitHub Actions** (should be selected)
3. Branch visibility: Automatic

No further configuration needed!

---

## Manual Local Build (Optional)

If you want to build locally and test before pushing:

```bash
npm run build
npm run preview
```

This builds to `dist/` and serves it locally at `http://localhost:5173/algomodo/`.

---

## Testing Your Changes

After pushing to `main`:

1. **Watch GitHub Actions**: Go to your repo → **Actions** tab to see the build status
2. **Wait for completion**: Green checkmark = deployed successfully
3. **Visit your site**: https://aalorro.github.io/algomodo
4. **Check browser console** (F12) for any errors

---

## Troubleshooting

### Workflow Fails to Build
Check the **Actions** tab in GitHub for error logs. Common issues:
- TypeScript errors (run `npm run build` locally to debug)
- Missing dependencies (run `npm install` locally)

### Assets Return 404
- Ensure `.nojekyll` file is in the repo root (disables Jekyll)
- Check that `base: '/algomodo/'` is set in `vite.config.ts`
- Clear browser cache (Ctrl+Shift+Delete)

### Deployment Stuck
- Check GitHub Actions permissions: Settings > Pages should show "GitHub Actions" as source
- Re-run workflow: Go to Actions tab, select the latest run, click "Re-run jobs"

### Site Shows Blank Page
- Open DevTools (F12) → **Console** tab to check for JavaScript errors
- Check **Network** tab to verify files load with 200 status (not 404)

---

## Key Files for Deployment

| File | Purpose |
|---|---|
| `.github/workflows/deploy.yml` | GitHub Actions automation |
| `vite.config.ts` | Build configuration + base path |
| `.gitignore` | Excludes `dist/` and `docs/` from git |
| `.nojekyll` | Tells GitHub to skip Jekyll processing |
| `package.json` | Dependencies and build scripts |

---

## Advanced: Using Custom Domain

To point your own domain to the GitHub Pages site:

1. **Add CNAME**: Create a `CNAME` file in `public/` folder:
   ```
   algomodo.yourdomain.com
   ```

2. **GitHub Pages Settings**:
   - Settings > Pages
   - Enter custom domain in the text field
   - GitHub manages DNS verification

3. **DNS Configuration** (at your registrar):
   - Add CNAME record pointing to `aalorro.github.io`
   - Or use GitHub's recommended IP addresses (see GitHub Pages docs)

---

**Deployment is automatic. Just commit and push!** 🚀
