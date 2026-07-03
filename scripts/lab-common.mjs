import crypto from 'node:crypto';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export function boolFrom(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function splitLines(value, options = {}) {
  const {trim = false, dropEmpty = true} = options;
  const lines = String(value ?? '').split(/\r?\n/).map(line => {
    return trim ? line.replace(/^!\s+/, '!').trim() : line;
  });
  return dropEmpty ? lines.filter(line => line !== '') : lines;
}

export function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const delimiter = `EOF_${crypto.randomBytes(8).toString('hex')}`;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${name}<<${delimiter}\n${String(value)}\n${delimiter}\n`
  );
}

export function ensureDir(path) {
  fs.mkdirSync(path, {recursive: true});
}

export function writeJson(path, value) {
  ensureDir(path.split('/').slice(0, -1).join('/') || '.');
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function describeString(value) {
  const input = String(value ?? '');
  return {
    value: input,
    json: JSON.stringify(input),
    length: input.length,
    byteLength: Buffer.byteLength(input),
    utf8Hex: Buffer.from(input, 'utf8').toString('hex'),
    codePoints: [...input].map(char =>
      `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    )
  };
}

export function actionExactKeyMatch(primaryKey, matchedKey) {
  return Boolean(
    matchedKey &&
      String(matchedKey).localeCompare(String(primaryKey), undefined, {
        sensitivity: 'accent'
      }) === 0
  );
}

export function strictKeyMatch(primaryKey, matchedKey) {
  return String(primaryKey) === String(matchedKey);
}

export function makeKeyVariant(baseKey, variant) {
  const base = String(baseKey ?? '');
  switch (variant) {
    case 'literal':
      return base;
    case 'upper':
      return base.toUpperCase();
    case 'lower':
      return base.toLowerCase();
    case 'leading-space':
      return ` ${base}`;
    case 'trailing-space':
      return `${base} `;
    case 'slash':
      return `${base}/segment`;
    case 'url-encoded-space':
      return `${base}%20space`;
    case 'percent2f':
      return `${base}%2Fsegment`;
    case 'nfc-e-acute':
      return `${base}-\u00e9`;
    case 'nfd-e-acute':
      return `${base}-e\u0301`;
    case 'case-pair-lower':
      return `${base}-case`;
    case 'case-pair-upper':
      return `${base}-CASE`;
    case 'comma-invalid':
      return `${base},comma`;
    case 'max-512':
      return `${base}-`.padEnd(512, 'x').slice(0, 512);
    case 'over-512-invalid':
      return `${base}-`.padEnd(513, 'x').slice(0, 513);
    default:
      throw new Error(`Unknown key variant: ${variant}`);
  }
}

export function makePathVariant(
  variant,
  workspace = process.env.GITHUB_WORKSPACE || process.cwd()
) {
  switch (variant) {
    case 'relative':
      return ['cache-fixture'];
    case 'dot-relative':
      return ['./cache-fixture'];
    case 'workspace-absolute':
      return [`${workspace}/cache-fixture`];
    case 'parent-normalized':
      return ['cache-fixture/../cache-fixture'];
    case 'symlink':
      return ['cache-link'];
    case 'glob-fixture':
      return ['cache-fixture/**'];
    case 'trailing-space':
      return ['cache-fixture '];
    case 'leading-space':
      return [' cache-fixture'];
    case 'duplicate-relative':
      return ['cache-fixture', './cache-fixture'];
    case 'multi-a-b':
      return ['cache-fixture-a', 'cache-fixture-b'];
    case 'multi-b-a':
      return ['cache-fixture-b', 'cache-fixture-a'];
    case 'case-distinct':
      return ['Cache-Fixture'];
    default:
      throw new Error(`Unknown path variant: ${variant}`);
  }
}

export function getCompressionMethod() {
  const result = spawnSync('zstd', ['--quiet', '--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return output === '' ? 'gzip' : 'zstd-without-long';
}

export function computeCacheVersion(
  paths,
  compressionMethod,
  enableCrossOsArchive = false,
  platform = process.platform
) {
  const components = [...paths];
  if (compressionMethod) components.push(compressionMethod);
  if (platform === 'win32' && !enableCrossOsArchive) components.push('windows-only');
  components.push('1.0');
  return crypto.createHash('sha256').update(components.join('|')).digest('hex');
}

export function summarizePaths(paths) {
  return paths.map((path, index) => ({
    index,
    ...describeString(path)
  }));
}
