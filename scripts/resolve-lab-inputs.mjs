import fs from 'node:fs';
import {
  boolFrom,
  computeCacheVersion,
  describeString,
  ensureDir,
  getCompressionMethod,
  makeKeyVariant,
  makePathVariant,
  splitLines,
  summarizePaths,
  writeJson,
  writeOutput
} from './lab-common.mjs';

const baseKey = process.env.LAB_INPUT_CACHE_KEY || 'canon-lab-v1';
const keyVariant = process.env.LAB_INPUT_KEY_VARIANT || 'literal';
const pathVariant = process.env.LAB_INPUT_PATH_VARIANT || 'relative';
const restoreKeysRaw = process.env.LAB_INPUT_RESTORE_KEYS || '';
const enableCrossOsArchive = boolFrom(process.env.LAB_ENABLE_CROSS_OS_ARCHIVE);

const cacheKey = makeKeyVariant(baseKey, keyVariant);
const paths = makePathVariant(pathVariant);
const restoreKeys = splitLines(restoreKeysRaw, {trim: false});
const compressionMethod = getCompressionMethod();
const rawPredictedVersion = computeCacheVersion(
  paths,
  compressionMethod,
  enableCrossOsArchive
);
const actionTrimPaths = paths
  .map(path => String(path).replace(/^!\s+/, '!').trim())
  .filter(Boolean);
const actionTrimPredictedVersion = computeCacheVersion(
  actionTrimPaths,
  compressionMethod,
  enableCrossOsArchive
);

const summary = {
  event: {
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    refName: process.env.GITHUB_REF_NAME,
    baseRef: process.env.GITHUB_BASE_REF,
    headRef: process.env.GITHUB_HEAD_REF,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT
  },
  keyVariant,
  pathVariant,
  enableCrossOsArchive,
  cacheKey: describeString(cacheKey),
  restoreKeys: restoreKeys.map(describeString),
  paths: summarizePaths(paths),
  actionTrimPaths: summarizePaths(actionTrimPaths),
  compressionMethod,
  rawPredictedVersion,
  actionTrimPredictedVersion
};

ensureDir('lab-observations');
writeJson('lab-observations/inputs.json', summary);

writeOutput('cache_key', cacheKey);
writeOutput('cache_key_json', JSON.stringify(cacheKey));
writeOutput('cache_key_urlencoded', encodeURIComponent(cacheKey));
writeOutput('paths_multiline', paths.join('\n'));
writeOutput('paths_json', JSON.stringify(paths));
writeOutput('restore_keys_multiline', restoreKeys.join('\n'));
writeOutput('restore_keys_json', JSON.stringify(restoreKeys));
writeOutput('compression_method', compressionMethod);
writeOutput('predicted_version', rawPredictedVersion);
writeOutput('raw_predicted_version', rawPredictedVersion);
writeOutput('action_trim_predicted_version', actionTrimPredictedVersion);

fs.writeFileSync('cache-result.txt', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
