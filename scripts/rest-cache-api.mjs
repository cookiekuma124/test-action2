import {
  actionExactKeyMatch,
  describeString,
  strictKeyMatch,
  writeJson
} from './lab-common.mjs';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!repository) {
  throw new Error('GITHUB_REPOSITORY is required');
}

if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
}

const [owner, repo] = repository.split('/');
const apiVersion = process.env.GITHUB_API_VERSION || '2026-03-10';

function queryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : '';
}

async function request(method, path, params = {}) {
  const url = `https://api.github.com${path}${queryString(params)}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': apiVersion
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    method,
    url: url.replace(/([?&](key|ref)=)[^&]*/g, '$1<redacted-in-log>'),
    status: response.status,
    ok: response.ok,
    body
  };
}

function summarizeList(body, probeKey) {
  const entries = body?.actions_caches || [];
  return entries.map(entry => ({
    id: entry.id,
    ref: entry.ref,
    key: describeString(entry.key),
    version: entry.version,
    sizeInBytes: entry.size_in_bytes,
    createdAt: entry.created_at,
    lastAccessedAt: entry.last_accessed_at,
    strictKeyMatchProbe: probeKey ? strictKeyMatch(probeKey, entry.key) : null,
    actionExactKeyMatchProbe: probeKey ? actionExactKeyMatch(probeKey, entry.key) : null
  }));
}

async function main() {
  const action = process.env.LAB_API_ACTION || 'list';
  const label = process.env.LAB_API_LABEL || action;
  const key = process.env.LAB_API_KEY || '';
  const ref = process.env.LAB_API_REF || '';
  const cacheId = process.env.LAB_API_CACHE_ID || '';

  let result;
  if (action === 'list') {
    result = await request('GET', `/repos/${owner}/${repo}/actions/caches`, {
      per_page: '100',
      key,
      ref
    });
    result.summary = {
      totalCount: result.body?.total_count ?? null,
      entries: summarizeList(result.body, key)
    };
  } else if (action === 'delete-key') {
    if (!key) throw new Error('LAB_API_KEY is required for delete-key');
    result = await request('DELETE', `/repos/${owner}/${repo}/actions/caches`, {
      key,
      ref
    });
    result.summary = {
      deletedCount: result.body?.total_count ?? null,
      deletedEntries: summarizeList(result.body, key)
    };
  } else if (action === 'delete-id') {
    if (!cacheId) throw new Error('LAB_API_CACHE_ID is required for delete-id');
    result = await request(
      'DELETE',
      `/repos/${owner}/${repo}/actions/caches/${cacheId}`
    );
  } else {
    throw new Error(`Unknown LAB_API_ACTION: ${action}`);
  }

  writeJson(`lab-observations/api-${label}.json`, result);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) process.exitCode = 1;
}

await main();
