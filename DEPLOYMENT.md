# GitHub Pages Deployment Guide

## Method 1: Deploy from `dist/` folder

### Step 1: Build the Project
```bash
npm install
npm run build
```

This creates an optimized production build in the `dist/` folder.

### Step 2: GitHub Configuration

Option A: Creating a **new** GitHub Pages with `dist/` folder:
```bash
# Create gh-pages branch
git checkout --orphan gh-pages
git rm -rf .
git commit --allow-empty -m "Initial commit"
git push -u origin gh-pages

# Go back to main branch
git checkout main

# Copy dist contents to gh-pages branch
git worktree add gh-pages-deploy gh-pages
cp -r dist/* gh-pages-deploy/
cd gh-pages-deploy
git add .
git commit -m "Deploy Algomodo"
git push
```

Option B: Using **GitHub Actions** (Recommended):
1. Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - uses: actions/configure-pages@v3
      - uses: actions/upload-pages-artifact@v1
        with:
          path: 'dist'
      - uses: actions/deploy-pages@v2
```

2. In GitHub repo settings:
   - Go to Settings > Pages
   - Set Source to "GitHub Actions"

### Step 3: Access Your Site
```
https://your-username.github.io/algomodo
```

## Method 2: Deploy from `docs/` folder

### Step 1: Modify vite.config.ts
```typescript
build: {
  outDir: 'docs',  // Change from 'dist' to 'docs'
  // ...
}
```

### Step 2: Build and Deploy
```bash
npm run build
git add docs/
git commit -m "Deploy Algomodo"
git push
```

### Step 3: GitHub Configuration
- Go to Settings > Pages
- Set Source to "Deploy from a branch"
- Select branch: `main`
- Select folder: `/docs`

## Method 3: Deploy to Netlify

### Step 1: Connect Repository
1. Go to [Netlify](https://netlify.com)
2. Click "New site from Git"
3. Connect GitHub repository

### Step 2: Configure Build
- Build command: `npm run build`
- Publish directory: `dist`

### Step 3: Deploy
Netlify automatically deploys on every push to main.

Access via: `https://your-site.netlify.app`

## Method 4: Deploy to Vercel

### Step 1: Connect Repository
1. Go to [Vercel](https://vercel.com)
2. Import GitHub project

### Step 2: Vercel Auto-Detects
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

### Step 3: Deploy
Click "Deploy" - automatic on every push.

Access via: `https://algomodo.vercel.app`

## Testing Deployed Site

After deployment, verify:

1. **Icons load**: Check favicon displays
2. **Canvas renders**: Open DevTools (F12), check for console errors
3. **Generators work**: Try clicking different styles, adjusting parameters
4. **Export functions**: Try PNG/SVG/JSON export
5. **Responsive**: Check on mobile and desktop

## Troubleshooting

### 404 on root path
Add `_redirects` file to `public/`:
```
/* /index.html 200
```

Or use `vercel.json` for Vercel:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Assets not loading
Ensure `base: './'` in `vite.config.ts`:
```typescript
export default defineConfig({
  base: './',  // For GitHub Pages subfolders
  // ...
})
```

### Canvas black on mobile
Check WebGL support. Most mobiles support WebGL2, but some Android devices may fall back to Canvas2D.

### Large build size
The `dist/` folder should be ~300-500KB gzipped.
- Check for unused dependencies
- Verify bundle splitting in vite.config.ts

## Monitoring Example

Add to your deployment to track usage:

```html
<!-- In index.html, before closing </head> -->
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

Or use Google Analytics:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_ID');
</script>
```

## Custom Domain

### GitHub Pages
1. Add `CNAME` file to `dist/` with your domain
2. Update DNS records to point to GitHub
3. Enable in repo Settings > Pages

### Netlify/Vercel
Domain settings in dashboard - very easy!

---

**That's it!** Your Algomodo instance is now live on the internet. 🚀
