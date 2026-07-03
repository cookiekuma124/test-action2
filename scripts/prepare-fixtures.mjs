import fs from 'node:fs';
import {describeString, ensureDir, summarizePaths, writeJson} from './lab-common.mjs';

const paths = JSON.parse(process.env.LAB_PATHS_JSON || '["cache-fixture"]');
const cacheKey = process.env.LAB_CACHE_KEY || '';
const label = process.env.LAB_PAYLOAD_LABEL || 'seed';

const fixtureDirs = [
  'cache-fixture',
  'cache-fixture ',
  ' cache-fixture',
  'Cache-Fixture',
  'cache-fixture-a',
  'cache-fixture-b'
];

for (const target of [...fixtureDirs, 'cache-link']) {
  fs.rmSync(target, {recursive: true, force: true});
}

for (const dir of fixtureDirs) {
  ensureDir(`${dir}/nested`);
  const payload = [
    `label=${label}`,
    `dir=${JSON.stringify(dir)}`,
    `cache_key=${JSON.stringify(cacheKey)}`,
    `github_ref=${process.env.GITHUB_REF || ''}`,
    `github_event_name=${process.env.GITHUB_EVENT_NAME || ''}`,
    `run_id=${process.env.GITHUB_RUN_ID || ''}`,
    `run_attempt=${process.env.GITHUB_RUN_ATTEMPT || ''}`,
    `created_at=${new Date().toISOString()}`
  ].join('\n');
  fs.writeFileSync(`${dir}/payload.txt`, `${payload}\n`);
  fs.writeFileSync(
    `${dir}/nested/marker.txt`,
    `nested marker for ${JSON.stringify(dir)}\n`
  );
  fs.writeFileSync(`${dir}/local-marker.txt`, 'local-before-restore\n');
}

try {
  fs.symlinkSync('cache-fixture', 'cache-link', 'dir');
} catch (error) {
  console.warn(`Unable to create symlink: ${error.message}`);
}

const manifest = {
  cacheKey: describeString(cacheKey),
  requestedPaths: summarizePaths(paths),
  fixtureDirs: fixtureDirs.map(describeString),
  symlink: fs.existsSync('cache-link') ? fs.lstatSync('cache-link').isSymbolicLink() : false
};

writeJson('lab-observations/fixture-manifest.json', manifest);
console.log(JSON.stringify(manifest, null, 2));
