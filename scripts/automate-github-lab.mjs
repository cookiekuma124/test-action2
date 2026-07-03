import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const mode = process.argv[2] || 'setup';
const aToken = process.env.GH_A_TOKEN;
const bToken = process.env.GH_B_TOKEN;
const repoName = process.env.LAB_REPO_NAME || 'cache-canon-lab';
const visibility = process.env.LAB_REPO_VISIBILITY || 'public';
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

if (!aToken) {
  fail('GH_A_TOKEN is required');
}

if ((mode === 'pr' || mode === 'all') && !bToken) {
  fail('GH_B_TOKEN is required for PR/fork automation');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const env = {...process.env, ...(options.env || {})};
  const printableArgs = args.map(arg =>
    String(arg).replace(/gh[ps]_[A-Za-z0-9_]+/g, '<token>')
  );
  console.log(`$ ${command} ${printableArgs.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit']
  });

  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.status !== 0 && options.check !== false) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

function gh(token, args, options = {}) {
  return run('gh', args, {
    ...options,
    env: {
      ...(options.env || {}),
      GH_TOKEN: token
    }
  });
}

function ghJson(token, args) {
  const result = gh(token, args, {capture: true});
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function ghApi(token, method, endpoint, body = null, options = {}) {
  const args = ['api', '-X', method, endpoint];
  let input;
  if (body) {
    args.push('--input', '-');
    input = JSON.stringify(body);
  }
  if (options.jq) args.push('--jq', options.jq);
  return gh(token, args, {capture: true, input, check: options.check});
}

function git(args, options = {}) {
  return run('git', args, options);
}

function loginFor(token, fallback) {
  if (fallback) return fallback;
  return ghApi(token, 'GET', '/user', null, {jq: '.login'}).stdout.trim();
}

const aUser = loginFor(aToken, process.env.GH_A_USER);
const bUser = bToken ? loginFor(bToken, process.env.GH_B_USER) : '';
const fullRepo = `${aUser}/${repoName}`;

function hasHead() {
  return git(['rev-parse', '--verify', 'HEAD'], {capture: true, check: false}).status === 0;
}

function ensureGitIdentity() {
  if (git(['config', 'user.name'], {capture: true, check: false}).status !== 0) {
    git(['config', 'user.name', 'cache-canon-lab']);
  }
  if (git(['config', 'user.email'], {capture: true, check: false}).status !== 0) {
    git(['config', 'user.email', 'cache-canon-lab@example.invalid']);
  }
}

function ensureCommit() {
  ensureGitIdentity();
  git(['add', '.']);
  const status = git(['status', '--porcelain'], {capture: true}).stdout.trim();
  if (!hasHead()) {
    git(['commit', '-m', 'Add cache canonicalization lab']);
    return;
  }
  if (status) {
    git(['commit', '-m', `Update cache canonicalization lab ${stamp}`]);
  }
}

function repoExists() {
  return gh(aToken, ['repo', 'view', fullRepo, '--json', 'name'], {
    capture: true,
    check: false
  }).status === 0;
}

function ensureRepo() {
  if (!['public', 'private'].includes(visibility)) {
    fail('LAB_REPO_VISIBILITY must be public or private');
  }
  if (!repoExists()) {
    gh(aToken, [
      'repo',
      'create',
      fullRepo,
      `--${visibility}`,
      '--description',
      'Disposable GitHub Actions cache canonicalization lab'
    ]);
  }
}

function writeAskPass(token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-canon-gh-'));
  const askpass = path.join(dir, 'askpass.sh');
  fs.writeFileSync(
    askpass,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*) printf "%s\\n" "x-access-token" ;;',
      '  *Password*) printf "%s\\n" "$GIT_LAB_TOKEN" ;;',
      '  *) printf "\\n" ;;',
      'esac',
      ''
    ].join('\n'),
    {mode: 0o700}
  );
  return {dir, askpass};
}

function pushMain() {
  const remoteUrl = `https://github.com/${fullRepo}.git`;
  if (git(['remote', 'get-url', 'origin'], {capture: true, check: false}).status !== 0) {
    git(['remote', 'add', 'origin', remoteUrl]);
  } else {
    git(['remote', 'set-url', 'origin', remoteUrl]);
  }

  const {dir, askpass} = writeAskPass(aToken);
  try {
    git(['push', '-u', 'origin', 'HEAD:main'], {
      env: {
        GIT_ASKPASS: askpass,
        GIT_LAB_TOKEN: aToken,
        GIT_TERMINAL_PROMPT: '0'
      }
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function setup() {
  ensureCommit();
  ensureRepo();
  pushMain();
  console.log(`Repository ready: https://github.com/${fullRepo}`);
}

function listRuns(workflow, extra = []) {
  const result = gh(aToken, [
    'run',
    'list',
    '--repo',
    fullRepo,
    '--workflow',
    workflow,
    '--limit',
    '20',
    '--json',
    'databaseId,status,conclusion,url,createdAt,event,headBranch,displayTitle',
    ...extra
  ], {capture: true});
  return JSON.parse(result.stdout || '[]');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNewRun(workflow, previousIds, extra = []) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runs = listRuns(workflow, extra);
    const run = runs.find(item => !previousIds.has(item.databaseId));
    if (run) return run;
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for ${workflow}`);
}

async function dispatchCanonicalization(label, fields) {
  const workflow = 'cache-canonicalization.yml';
  const before = new Set(listRuns(workflow).map(run => run.databaseId));
  const args = ['workflow', 'run', workflow, '--repo', fullRepo, '--ref', 'main'];
  for (const [key, value] of Object.entries(fields)) {
    args.push('-f', `${key}=${value}`);
  }
  gh(aToken, args);
  const runInfo = await waitForNewRun(workflow, before);
  console.log(`${label}: ${runInfo.url}`);
  gh(aToken, ['run', 'watch', String(runInfo.databaseId), '--repo', fullRepo, '--exit-status'], {
    check: false
  });
  fs.mkdirSync('lab-results', {recursive: true});
  gh(aToken, [
    'run',
    'download',
    String(runInfo.databaseId),
    '--repo',
    fullRepo,
    '--dir',
    `lab-results/${runInfo.databaseId}`
  ], {check: false});
}

async function smoke() {
  setup();
  const key = `smoke-${stamp}`;
  await dispatchCanonicalization('smoke roundtrip', {
    operation: 'roundtrip',
    driver: 'both',
    cache_key: key,
    key_variant: 'literal',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    payload_label: 'smoke',
    runner_debug: 'true'
  });
  await dispatchCanonicalization('smoke rest list', {
    operation: 'list',
    driver: 'api',
    cache_key: key,
    key_variant: 'literal',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    payload_label: 'list',
    runner_debug: 'false'
  });
}

async function drift() {
  setup();
  const pathKey = `path-${stamp}`;
  await dispatchCanonicalization('path seed', {
    operation: 'roundtrip',
    driver: 'both',
    cache_key: pathKey,
    key_variant: 'literal',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    payload_label: 'path-seed',
    runner_debug: 'true'
  });
  for (const pathVariant of ['dot-relative', 'workspace-absolute', 'parent-normalized', 'trailing-space', 'multi-b-a']) {
    await dispatchCanonicalization(`path probe ${pathVariant}`, {
      operation: 'lookup',
      driver: 'both',
      cache_key: pathKey,
      key_variant: 'literal',
      path_variant: pathVariant,
      toolkit_path_parse_mode: 'raw',
      enable_cross_os_archive: 'false',
      payload_label: `path-${pathVariant}`,
      runner_debug: 'true'
    });
  }

  const caseKey = `case-${stamp}`;
  await dispatchCanonicalization('case seed', {
    operation: 'roundtrip',
    driver: 'action',
    cache_key: caseKey,
    key_variant: 'case-pair-lower',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    payload_label: 'case-seed',
    runner_debug: 'true'
  });
  await dispatchCanonicalization('case probe', {
    operation: 'lookup',
    driver: 'both',
    cache_key: caseKey,
    key_variant: 'case-pair-upper',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    restore_keys: `${caseKey}-`,
    payload_label: 'case-probe',
    runner_debug: 'true'
  });

  const unicodeKey = `unicode-${stamp}`;
  await dispatchCanonicalization('unicode seed', {
    operation: 'roundtrip',
    driver: 'action',
    cache_key: unicodeKey,
    key_variant: 'nfc-e-acute',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    payload_label: 'unicode-seed',
    runner_debug: 'true'
  });
  await dispatchCanonicalization('unicode probe', {
    operation: 'lookup',
    driver: 'both',
    cache_key: unicodeKey,
    key_variant: 'nfd-e-acute',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false',
    restore_keys: `${unicodeKey}-`,
    payload_label: 'unicode-probe',
    runner_debug: 'true'
  });
}

async function forkAndPr() {
  setup();
  if (!bToken || !bUser) fail('B token/user required');

  const workflow = 'cache-ref-scope.yml';
  const before = new Set(listRuns(workflow, ['--event', 'pull_request']).map(run => run.databaseId));
  ghApi(bToken, 'POST', `/repos/${fullRepo}/forks`, null, {check: false});

  const forkRepo = `${bUser}/${repoName}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (gh(bToken, ['repo', 'view', forkRepo], {capture: true, check: false}).status === 0) break;
    await sleep(5000);
  }

  const ref = ghJson(bToken, [
    'api',
    `/repos/${forkRepo}/git/ref/heads/main`
  ]);
  const branch = `cache-pr-${stamp}`;
  ghApi(bToken, 'POST', `/repos/${forkRepo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: ref.object.sha
  });
  ghApi(bToken, 'PUT', `/repos/${forkRepo}/contents/b-pr-marker.txt`, {
    message: `Create PR marker ${stamp}`,
    content: Buffer.from(`cache canonicalization fork PR marker ${stamp}\n`).toString('base64'),
    branch
  });
  const pr = JSON.parse(
    ghApi(bToken, 'POST', `/repos/${fullRepo}/pulls`, {
      title: `Cache scope PR ${stamp}`,
      head: `${bUser}:${branch}`,
      base: 'main',
      body: 'Automated fork PR for GitHub Actions cache ref-scope testing.'
    }).stdout
  );
  console.log(`PR ready: ${pr.html_url}`);

  const runInfo = await waitForNewRun(workflow, before, ['--event', 'pull_request']);
  console.log(`PR workflow: ${runInfo.url}`);
  if (runInfo.status === 'action_required' || runInfo.conclusion === 'action_required') {
    ghApi(aToken, 'POST', `/repos/${fullRepo}/actions/runs/${runInfo.databaseId}/approve`, null, {
      check: false
    });
  }
  gh(aToken, ['run', 'watch', String(runInfo.databaseId), '--repo', fullRepo, '--exit-status'], {
    check: false
  });
}

async function restDelete() {
  setup();
  const prefix = `delete-${stamp}-`;
  const common = {
    key_variant: 'literal',
    path_variant: 'relative',
    toolkit_path_parse_mode: 'raw',
    enable_cross_os_archive: 'false'
  };

  await dispatchCanonicalization('delete seed a', {
    ...common,
    operation: 'roundtrip',
    driver: 'action',
    cache_key: `${prefix}a`,
    payload_label: 'delete-seed-a',
    runner_debug: 'true'
  });
  await dispatchCanonicalization('delete seed b', {
    ...common,
    operation: 'roundtrip',
    driver: 'action',
    cache_key: `${prefix}b`,
    payload_label: 'delete-seed-b',
    runner_debug: 'true'
  });
  await dispatchCanonicalization('delete prefix list before', {
    ...common,
    operation: 'list',
    driver: 'api',
    cache_key: prefix,
    payload_label: 'delete-prefix-list-before',
    runner_debug: 'false'
  });
  await dispatchCanonicalization('delete prefix attempt', {
    ...common,
    operation: 'delete-key',
    driver: 'api',
    cache_key: prefix,
    payload_label: 'delete-prefix-attempt',
    runner_debug: 'false'
  });
}

async function cleanup() {
  gh(aToken, ['repo', 'delete', fullRepo, '--yes']);
}

switch (mode) {
  case 'setup':
    setup();
    break;
  case 'smoke':
    await smoke();
    break;
  case 'drift':
    await drift();
    break;
  case 'pr':
    await forkAndPr();
    break;
  case 'rest-delete':
    await restDelete();
    break;
  case 'all':
    await drift();
    await restDelete();
    await forkAndPr();
    break;
  case 'cleanup':
    await cleanup();
    break;
  default:
    fail(`Unknown mode: ${mode}. Use setup, smoke, drift, rest-delete, pr, all, or cleanup.`);
}
