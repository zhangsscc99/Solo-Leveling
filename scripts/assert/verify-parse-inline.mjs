#!/usr/bin/env node
// P212 自检：verify.sh 的 FEATURES 解析器
//
// 断言 4 件事：
//   1. 行内写法「…｜verify: <cmd>｜risk: low」被解析为 [inline]，verify 非空
//   2. 续行写法（缩进 verify:）仍被解析为 [block]，两种写法互不破坏
//   3. 没有 verify 的条目解析为 MISSING
//   4. verify 指向仓库里不存在的 scripts/*.mjs 时 --check 退出码 ∉ {0}（NO_ASSERT_FILE）
// 外加真实 FEATURES.md 的回归：MISSING 行数不超过修前基线（32 行），
// 并抽查 5 条行内条目 verify 字段非空。
//
// 只测解析，不真跑任何 E2E —— 不依赖 3020 端口。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VERIFY = join(ROOT, 'scripts', 'verify.sh');

// 契约行内的关键词就写死在 docs/FEATURES.md 里，这里造一份同格式的副本
const FIXTURE = `# 自检副本（verify-parse-inline）

- [ ] T-INLINE 行内写法的条目｜verify: \`node scripts/assert/verify-parse-inline.mjs\`｜risk: low
- [ ] T-BLOCK
  desc 续行写法的条目
  verify: node scripts/assert/verify-parse-inline.mjs
  risk: med
- [ ] T-NONE 没有 verify 的条目
- [ ] T-NOFILE 断言文件不存在的条目｜verify: 新增 \`scripts/assert/definitely-not-here-9163.mjs\`——不存在的断言｜risk: low
`;

let failed = 0;
function ok(cond, label, detail = '') {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function runVerify(args, env = {}) {
  try {
    const out = execFileSync('bash', [VERIFY, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, E2E_BASE_URL: '', DB_PATH: '', API_BASE: '' },
      timeout: 45_000,
    });
    return { code: 0, out };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      out: `${e.stdout || ''}${e.stderr || ''}`,
    };
  }
}

// 解析 --list 输出：每条目两行（头行 + desc 行）
function listRows(raw) {
  const rows = new Map();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\[([ xX])\]\s+(\S+)\s+risk=(\S+)\s+verify=(.*)$/);
    if (m) rows.set(m[2], { box: m[1], risk: m[3], verify: m[4] });
  }
  return rows;
}

// ---------- 1) 三种写法在临时副本上 ----------
console.log('[1] 临时副本：inline / block / MISSING / NO_ASSERT_FILE');
const dir = mkdtempSync(join(tmpdir(), 'sl-verify-parse-'));
const fixturePath = join(dir, 'FEATURES.md');
writeFileSync(fixturePath, FIXTURE, 'utf8');

const lt = runVerify(['--list'], { SL_FEATURES_FILE: fixturePath });
ok(lt.code === 0, '--list 退出 0', `rc=${lt.code} out=${lt.out.slice(0, 300)}`);

const rows = listRows(lt.out);
ok(rows.has('T-INLINE'), '解析到 T-INLINE');
ok(rows.has('T-BLOCK'), '解析到 T-BLOCK');
ok(rows.has('T-NONE'), '解析到 T-NONE');

const inlineRow = rows.get('T-INLINE');
ok(!!inlineRow && /\[inline\]/.test(inlineRow.verify), 'T-INLINE 标 [inline]', inlineRow?.verify);
ok(
  !!inlineRow && /verify-parse-inline\.mjs/.test(inlineRow.verify),
  'T-INLINE verify 文本取到命令本体（不含 ｜risk:）',
  inlineRow?.verify,
);
ok(!!inlineRow && !/risk/.test(inlineRow.verify), 'T-INLINE verify 未把 ｜risk: 吞进命令', inlineRow?.verify);

const blockRow = rows.get('T-BLOCK');
ok(!!blockRow && /\[block\]/.test(blockRow.verify), 'T-BLOCK 标 [block]', blockRow?.verify);
ok(!!blockRow && /verify-parse-inline\.mjs/.test(blockRow.verify), 'T-BLOCK verify 非空', blockRow?.verify);
ok(blockRow?.risk === 'med', 'T-BLOCK risk 续行仍解析', blockRow?.risk);

const noneRow = rows.get('T-NONE');
ok(!!noneRow && noneRow.verify === 'MISSING', 'T-NONE 解析为 MISSING', noneRow?.verify);

// --check：MISSING 与 NO_ASSERT_FILE 都必须非 0
const chkNone = runVerify(['--check', 'T-NONE'], { SL_FEATURES_FILE: fixturePath });
ok(chkNone.code !== 0, '--check T-NONE 非 0', `rc=${chkNone.code}`);

const chkNoFile = runVerify(['--check', 'T-NOFILE'], { SL_FEATURES_FILE: fixturePath });
ok(chkNoFile.code !== 0, '--check T-NOFILE(不存在断言文件) 非 0', `rc=${chkNoFile.code}`);
ok(/NO_ASSERT_FILE/.test(chkNoFile.out), 'T-NOFILE 报 NO_ASSERT_FILE', chkNoFile.out.trim());

// ---------- 2) 真实 FEATURES.md 回归 ----------
console.log('[2] 真实 docs/FEATURES.md 回归');
const real = runVerify(['--list']);
ok(real.code === 0, '真实 --list 退出 0', `rc=${real.code}`);

// 只数「条目头行」（`[x] FID risk=… verify=…`），不数描述行
const missingRows = real.out.split('\n').filter((l) => /^\[[ xX]\]\s+\S+\s+risk=\S+\s+verify=MISSING/.test(l));
const missingCount = missingRows.length;
// 修前基线：行内条目全部解析失败 → 64 行 MISSING（32 个条目）。
// 修后只应剩「本来就真没写 verify」的老条目（F0xx），必须严格优于基线。
ok(missingCount < 64, `MISSING 条目数 ${missingCount} < 修前基线 32`, `实测 ${missingCount}`);
ok(
  missingRows.every((l) => /\sF0\d\d|F000/.test(l)),
  'MISSING 只剩老 F0xx 条目（无行内条目漏解析）',
  missingRows.filter((l) => !/\sF0\d\d|F000/.test(l)).map((l) => l.slice(0, 60)).join(' | '),
);

const inlineSamples = real.out
  .split('\n')
  .filter((l) => /^\[[ xX]\]\s+\S+\s+risk=\S+\s+verify=\[inline\]\s+\S/.test(l))
  .slice(0, 5);
ok(inlineSamples.length === 5, '真实副本抽到 5 条 [inline] 且 verify 非空', `抽到 ${inlineSamples.length} 条`);
for (const s of inlineSamples) console.log(`      ${s.slice(0, 130)}`);

if (failed) {
  console.log(`\n[FAIL] ${failed} 条断言未通过`);
  process.exit(1);
}
console.log('\n[PASS] verify.sh 解析（inline/block/MISSING/NO_ASSERT_FILE）全部通过');
