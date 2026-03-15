#!/usr/bin/env node
// scripts/bump-version.mjs — Automated version bump for Algomodo
// Zero dependencies. Usage: node scripts/bump-version.mjs <X.Y.Z> [--date=YYYY-MM-DD]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
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

// ── Gather commits since last version ──────────────────────────────────────
function getCommitsSinceLastVersion() {
  const cmds = [
    `git log --oneline v${oldVersion}..HEAD`,
    `git log --oneline ${oldVersion}..HEAD`,
    `git log --oneline -30`,
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (out) return out.split('\n');
    } catch { /* try next */ }
  }
  return [];
}

const NOISE_RE = /^(bump|update)\s+(version|changelog|readme)/i;
const MERGE_RE = /^Merge\s/;

function parseCommits(lines) {
  const added = [];
  const fixed = [];
  const improved = [];

  for (const line of lines) {
    // Strip leading hash
    const msg = line.replace(/^[a-f0-9]+\s+/, '').trim();
    if (!msg) continue;
    if (NOISE_RE.test(msg)) continue;
    if (MERGE_RE.test(msg)) continue;

    // Capitalize first letter
    const clean = msg.charAt(0).toUpperCase() + msg.slice(1);

    if (/^(add|new|implement|create|introduce)\b/i.test(msg)) {
      added.push(clean);
    } else if (/^(fix|bug|patch|resolve|correct)\b/i.test(msg)) {
      fixed.push(clean);
    } else {
      improved.push(clean);
    }
  }

  return { added, fixed, improved };
}

const commitLines = getCommitsSinceLastVersion();
const categories = parseCommits(commitLines);

// ── Helper: escape text for JSX ────────────────────────────────────────────
function escapeJsx(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Helper: split commit into bold title + description for JSX ─────────────
function formatCommitJsx(msg) {
  const escaped = escapeJsx(msg);
  // Try splitting at colon or em-dash first
  const colonIdx = escaped.indexOf(':');
  const dashIdx = escaped.indexOf(' — ');
  const hyphenIdx = escaped.indexOf(' - ');

  let splitIdx = -1;
  let sepLen = 0;
  if (colonIdx > 0 && colonIdx < 60) { splitIdx = colonIdx; sepLen = 1; }
  else if (dashIdx > 0 && dashIdx < 60) { splitIdx = dashIdx; sepLen = 3; }
  else if (hyphenIdx > 0 && hyphenIdx < 60) { splitIdx = hyphenIdx; sepLen = 3; }

  if (splitIdx > 0) {
    const title = escaped.slice(0, splitIdx).trim();
    const desc = escaped.slice(splitIdx + sepLen).trim();
    return desc ? `<strong>${title}</strong> &mdash; ${desc}` : `<strong>${title}</strong>`;
  }

  // Fallback: bold first 3-5 words
  const words = escaped.split(/\s+/);
  const titleWords = Math.min(words.length, words.length <= 5 ? words.length : 4);
  const title = words.slice(0, titleWords).join(' ');
  const desc = words.slice(titleWords).join(' ');
  return desc ? `<strong>${title}</strong> &mdash; ${desc}` : `<strong>${title}</strong>`;
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

// ── 4. CHANGELOG.md — insert new version section with auto-generated entries ─
{
  const filePath = join(root, 'CHANGELOG.md');
  let content = readFileSync(filePath, 'utf8');

  // Build markdown sections only for non-empty categories
  let sections = '';
  if (categories.added.length) {
    sections += `\n### Added\n\n${categories.added.map(m => `- ${m}`).join('\n')}\n`;
  }
  if (categories.fixed.length) {
    sections += `\n### Fixed\n\n${categories.fixed.map(m => `- ${m}`).join('\n')}\n`;
  }
  if (categories.improved.length) {
    sections += `\n### Improved\n\n${categories.improved.map(m => `- ${m}`).join('\n')}\n`;
  }
  if (!sections) {
    sections = '\n- No categorizable commits found. Fill in manually.\n';
  }

  const changelogEntry = `## [${version}] - ${date}\n${sections}\n---\n\n`;

  // Insert before the first existing version entry (## [X.Y.Z])
  const firstVersionRe = /^## \[\d+\.\d+\.\d+\]/m;
  const match = content.match(firstVersionRe);
  if (match) {
    const idx = content.indexOf(match[0]);
    content = content.slice(0, idx) + changelogEntry + content.slice(idx);
    writeFileSync(filePath, content, 'utf8');
    results.push({ file: 'CHANGELOG.md', ok: true, note: 'auto-generated from git' });
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

// ── 7. ChangelogModal.tsx — insert new version block with auto-generated JSX ─
{
  const filePath = join(root, 'src/components/ChangelogModal.tsx');
  let content = readFileSync(filePath, 'utf8');

  // Build JSX sections only for non-empty categories
  const jsxSections = [];
  const catEntries = [
    ['Added', categories.added],
    ['Fixed', categories.fixed],
    ['Improved', categories.improved],
  ];
  for (const [label, items] of catEntries) {
    if (!items.length) continue;
    const lis = items.map(m => `                  <li>${formatCommitJsx(m)}</li>`).join('\n');
    jsxSections.push(
`              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">${label}</h4>
                <ul className="list-disc list-inside space-y-1 text-xs">
${lis}
                </ul>
              </div>`
    );
  }

  const sectionsJsx = jsxSections.length
    ? jsxSections.join('\n\n')
    : '              <p className="text-xs">No categorizable commits found. Fill in manually.</p>';

  const newBlock =
`          {/* Version ${version} */}
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-2">
              [${version}] - ${date}
            </h3>

            <div className="space-y-3">
${sectionsJsx}
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
    results.push({ file: 'src/components/ChangelogModal.tsx', ok: true, note: 'auto-generated from git' });
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

// Print generated changelog entries for review
if (commitLines.length) {
  console.log(`\n── Auto-generated changelog (${commitLines.length} commits) ──`);
  for (const [label, items] of [['Added', categories.added], ['Fixed', categories.fixed], ['Improved', categories.improved]]) {
    if (items.length) {
      console.log(`\n  ${label}:`);
      for (const m of items) console.log(`    - ${m}`);
    }
  }
} else {
  console.log('\n⚠ No commits found — changelog entries are empty. Fill in manually.');
}

const failures = results.filter(r => !r.ok);
if (failures.length > 0) {
  console.log(`\n⚠ ${failures.length} file(s) had no matches — verify patterns manually.`);
} else {
  console.log(`\nDone! Review the auto-generated entries above, then:`);
  console.log(`  1. CHANGELOG.md — edit entries if wording needs polish`);
  console.log(`  2. ChangelogModal.tsx — edit entries if wording needs polish`);
  console.log(`  3. InstructionsModal.tsx — add new instruction items if this release introduces new features or workflows`);
}
