claude#!/usr/bin/env node
// scripts/bump-version.mjs — Automated version bump for Algomodo
// Zero dependencies. Usage: node scripts/bump-version.mjs <X.Y.Z> [--date=YYYY-MM-DD]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ── Parse args ──────────────────────────────────────────────────────────────
const version = process.argv[2];
const dateArg = process.argv.find(a => a.startsWith('--date='));
const date = dateArg ? dateArg.split('=')[1] : new Date().toISOString().slice(0, 10);

if (!version?.match(/^\d+\.\d+\.\d+$/)) {
  console.error('Usage: node scripts/bump-version.mjs <X.Y.Z> [--date=YYYY-MM-DD]');
  process.exit(1);
}

if (dateArg && !dateArg.split('=')[1]?.match(/^\d{4}-\d{2}-\d{2}$/)) {
  console.error('Invalid date format. Use YYYY-MM-DD.');
  process.exit(1);
}

// ── Resolve paths ───────────────────────────────────────────────────────────
const root = join(import.meta.dirname, '..');

// ── Auto-count generators and families ──────────────────────────────────────
const genIndex = readFileSync(join(root, 'src/generators/index.ts'), 'utf8');
const genCount = (genIndex.match(/registerGenerator\(/g) || []).length;

const genDir = join(root, 'src/generators');
const families = readdirSync(genDir).filter(f => {
  try { return statSync(join(genDir, f)).isDirectory(); } catch { return false; }
});
const familyCount = families.length;
const familyNames = families
  .map(f => f.charAt(0).toUpperCase() + f.slice(1))
  .sort()
  .join(', ');

// ── Read old version ────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const oldVersion = pkg.version;

if (version === oldVersion) {
  console.error(`Version ${version} is the same as current version. Nothing to do.`);
  process.exit(1);
}

// ── Helper: read → replace → write ─────────────────────────────────────────
const results = [];

function update(relPath, replacements) {
  const filePath = join(root, relPath);
  let content = readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [pattern, replacement] of replacements) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) changed = true;
  }

  if (changed) {
    writeFileSync(filePath, content, 'utf8');
    results.push({ file: relPath, ok: true });
  } else {
    results.push({ file: relPath, ok: false, reason: 'no matches' });
  }
}

// ── 1. package.json ─────────────────────────────────────────────────────────
update('package.json', [
  [/"version":\s*"[^"]*"/, `"version": "${version}"`],
]);

// ── 2. index.html ───────────────────────────────────────────────────────────
update('index.html', [
  [/"softwareVersion":\s*"[^"]*"/, `"softwareVersion": "${version}"`],
  // featureList generator count — handles "100claude+" typo pattern and normal "N+" pattern
  [/"\d+\w*\+?\s*procedural art generators"/, `"${genCount}+ procedural art generators"`],
]);

// ── 3. manifest.webmanifest ─────────────────────────────────────────────────
update('public/manifest.webmanifest', [
  [/\d+\+?\s*procedural generators/, `${genCount}+ procedural generators`],
]);

// ── 4. CHANGELOG.md — insert new version section after [Unreleased] block ──
{
  const filePath = join(root, 'CHANGELOG.md');
  let content = readFileSync(filePath, 'utf8');

  const changelogEntry =
`## [${version}] - ${date}

### Added

- TODO: List new features here

### Improved

- TODO: List improvements here

---

`;

  // Insert before the first existing version entry (## [X.Y.Z])
  const firstVersionRe = /^## \[\d+\.\d+\.\d+\]/m;
  const match = content.match(firstVersionRe);
  if (match) {
    const idx = content.indexOf(match[0]);
    content = content.slice(0, idx) + changelogEntry + content.slice(idx);
    writeFileSync(filePath, content, 'utf8');
    results.push({ file: 'CHANGELOG.md', ok: true, note: 'template inserted' });
  } else {
    results.push({ file: 'CHANGELOG.md', ok: false, reason: 'no version entry found' });
  }
}

// ── 5. README.md ────────────────────────────────────────────────────────────
update('README.md', [
  [/v\d+\.\d+\.\d+/, `v${version}`],
  [/\*\*\d+ generators\*\*/, `**${genCount} generators**`],
  [/Across \d+ families/, `Across ${familyCount} families`],
]);

// ── 6. AboutModal.tsx ───────────────────────────────────────────────────────
update('src/components/AboutModal.tsx', [
  [/<p>v\d+\.\d+\.\d+<\/p>/, `<p>v${version}</p>`],
  [/\d+ generators across \d+ families:[^<]*/, `${genCount} generators across ${familyCount} families: ${familyNames}`],
]);

// ── 7. ChangelogModal.tsx — insert new version block ────────────────────────
{
  const filePath = join(root, 'src/components/ChangelogModal.tsx');
  let content = readFileSync(filePath, 'utf8');

  const newBlock =
`          {/* Version ${version} */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [${version}] - ${date}
            </h3>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Added</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>TODO</strong> — fill in release notes</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Improved</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>TODO</strong> — fill in improvements</li>
                </ul>
              </div>
            </div>
          </div>

`;

  // Insert before the first {/* Version X.Y.Z */} comment
  const firstVersionComment = /^( +)\{\/\* Version \d+\.\d+\.\d+ \*\/\}/m;
  const match = content.match(firstVersionComment);
  if (match) {
    const idx = content.indexOf(match[0]);
    content = content.slice(0, idx) + newBlock + content.slice(idx);
    writeFileSync(filePath, content, 'utf8');
    results.push({ file: 'src/components/ChangelogModal.tsx', ok: true, note: 'template inserted' });
  } else {
    results.push({ file: 'src/components/ChangelogModal.tsx', ok: false, reason: 'no version comment found' });
  }
}

// ── 8. InstructionsModal.tsx ────────────────────────────────────────────────
update('src/components/InstructionsModal.tsx', [
  // Match: <strong>N generators</strong> across N families: Name, Name, ...
  [
    /<strong>\d+ generators<\/strong> across \d+ families:[^.]+/,
    `<strong>${genCount} generators</strong> across ${familyCount} families: ${familyNames.replace(/,([^,]*)$/, ', and$1')}`,
  ],
]);

// ── 9. RightSidebar.tsx ─────────────────────────────────────────────────────
update('src/components/RightSidebar.tsx', [
  [/Algomodo v\d+\.\d+\.\d+/, `Algomodo v${version}`],
]);

// ── 10. App.tsx (footer version) ────────────────────────────────────────────
update('src/App.tsx', [
  [/>v\d+\.\d+\.\d+</, `>v${version}<`],
]);

// ── 11. RoadmapModal.tsx ────────────────────────────────────────────────────
update('src/components/RoadmapModal.tsx', [
  [/Current version: <strong>\d+\.\d+\.\d+<\/strong>/, `Current version: <strong>${version}</strong>`],
]);

// ── Print summary ───────────────────────────────────────────────────────────
console.log(`\nVersion bump: ${oldVersion} → ${version}`);
console.log(`Generators: ${genCount}  |  Families: ${familyCount} (${familyNames})`);
console.log(`Date: ${date}\n`);

for (const r of results) {
  const status = r.ok ? '  ✓' : '  ✗';
  const detail = r.note ? ` (${r.note})` : r.reason ? ` — ${r.reason}` : '';
  console.log(`${status} ${r.file}${detail}`);
}

const failures = results.filter(r => !r.ok);
if (failures.length > 0) {
  console.log(`\n⚠ ${failures.length} file(s) had no matches — verify patterns manually.`);
} else {
  console.log(`\nDone! Review and complete these manual steps:`);
  console.log(`  1. CHANGELOG.md — replace TODO lines with actual release notes`);
  console.log(`  2. ChangelogModal.tsx — replace TODO lines with actual JSX release notes`);
  console.log(`  3. InstructionsModal.tsx — add new instruction items if this release introduces new features or workflows`);
}
