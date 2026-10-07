#!/usr/bin/env node
// pr-description.mjs — auto PR description from the PR's commits.
// No external API by default. Uses `gh` CLI (auth via GITHUB_TOKEN in CI).
// ponytail: swap the template for an LLM call (OpenAI/gpt-4o) for prose.

import { execSync } from 'node:child_process';

const pr = process.argv[2];
if (!pr) { console.error('usage: node pr-description.mjs <pr-number>'); process.exit(2); }
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
if (!owner || !repo) { console.error('GITHUB_REPOSITORY unset'); process.exit(2); }

function gh(path, jq) {
  const qs = new URLSearchParams({ per_page: 100 }).toString();
  const cmd = `gh api -X GET "repos/${owner}/${repo}/${path}?${qs}" --jq ${JSON.stringify(jq)} --paginate`;
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean); }
  catch { return []; }
}

const subjects = gh(`pulls/${pr}/commits`, '.[] | .commit.message | split("\\n")[0]');
const files = gh(`pulls/${pr}/files`, '.[] | .filename');

const LABELS = {
  feat: '✨ Feature', fix: '🐛 Fix', docs: '📚 Docs', style: '🎨 Style',
  refactor: '♻️ Refactor', perf: '⚡ Performance', test: '✅ Test',
  chore: '🔧 Chore / Maintenance', ci: '⚙️ CI / Build', build: '🏗️ Build',
  revert: '↩️ Revert',
};

const groups = new Map();
const breaking = [];
for (const s of subjects) {
  const m = s.match(/^(\w+)((?:\([^)]*\))*)(!)?:\s*(.*)$/);
  if (!m) { if (!groups.has('other')) groups.set('other', []); groups.get('other').push(s); continue; }
  const [, type, scopes, bang, subject] = m;
  const scopeList = scopes ? scopes.match(/\([^)]*\)/g).map(x => x.slice(1, -1)) : [];
  const scopeStr = scopeList.join(', ');
  if (bang) breaking.push(`**${type}${scopeStr ? `(${scopeStr})` : ''}:** ${subject}`);
  const label = LABELS[type] || type;
  const line = scopeStr ? `- \`${type}(${scopeStr})\` ${subject}` : `- \`${type}\` ${subject}`;
  groups.set(label, [...(groups.get(label) || []), line]);
}

const isBack = repo.includes('-back');
const checklist = isBack
  ? ['- [ ] `npm run lint` passes', '- [ ] `npx prettier --check "src/**/*.ts" "test/**/*.ts"` passes', '- [ ] `npx tsc --noEmit -p tsconfig.json` passes', '- [ ] `npm run test:unit` passes', '- [ ] `npm run build` passes', '- [ ] No secrets / `.env` committed', '- [ ] Prisma migrations added/updated (`npx prisma migrate dev`)']
  : ['- [ ] `npm run typecheck` passes', '- [ ] `npm run lint` passes', '- [ ] `npm run build` passes', '- [ ] `npm run test:e2e` passes', '- [ ] No secrets / `.env` committed', '- [ ] Accessibility: labels, focus, aria-live, >=44px targets', '- [ ] Screenshots added for UI changes'];

const dirs = new Map();
for (const f of files) {
  const d = f.split('/')[0] || '(root)';
  dirs.set(d, [...(dirs.get(d) || []), f]);
}
const top = [...dirs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
const fileLines = top.map(([d, fs]) => `- \`${d}/\` (${fs.length} file${fs.length > 1 ? 's' : ''})`).join('\n');


// ponytail: LLM upgrade path. Opt-in with `--llm`; uses GitHub Models (free tier,
// authenticated with the runner's own GITHUB_TOKEN — no extra secret needed).
// Falls back to the template on any failure, so CI never breaks.
async function llmProse(subjects, files, isBack) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const system = 'Você é um engenheiro de software sênior. Escreva um resumo de PR em português, '
    + '2-4 frases, focando no que mudou e por que. Seja conciso. Não use markdown pesado.';
  const user = 'Repositorio: ' + (process.env.GITHUB_REPOSITORY || '') + '\nCommits:\n' + subjects.join('\n') + '\nArquivos:\n' + files.join('\n');
  try {
    const resp = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.PR_DESCRIBE_MODEL || 'meta-llama/Llama-4-Maverick-16B', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 300 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

const out = [];
out.push('<!-- pr-description:auto -->');
out.push('');
out.push('Gerado automaticamente a partir dos commits do PR. Edite livremente — atualizações');
out.push('subsequentes só sobrescrevem se este marker estiver presente.');
out.push('');
out.push('## 📝 Summary');
out.push('');
if (groups.size === 0) out.push('_Nenhum commit convencional encontrado._');
for (const [label, lines] of groups) { out.push(`### ${label}`); out.push(''); out.push(...lines); out.push(''); }
out.push('## 💥 Breaking changes');
out.push('');
out.push(breaking.length ? breaking.map(b => `- ${b}`).join('\n') : '_Nenhuma._');
out.push('');
out.push('## 📂 Files changed');
out.push('');
out.push(fileLines || '_Nenhum._');
out.push('');
out.push('## ✅ Checklist');
out.push('');
out.push(...checklist);
out.push('');
if (process.argv.includes('--llm')) {
  const prose = await llmProse(subjects, files, isBack);
  if (prose) { out.splice(2, 0, '', '## 💬 Resumo (IA)', '', prose); }
}
process.stdout.write(out.join('\n'));
