import * as cache from '@actions/cache';
import {
  actionExactKeyMatch,
  boolFrom,
  computeCacheVersion,
  describeString,
  getCompressionMethod,
  splitLines,
  strictKeyMatch,
  summarizePaths,
  writeJson
} from './lab-common.mjs';

function parsePaths() {
  const paths = JSON.parse(process.env.LAB_PATHS_JSON || '["cache-fixture"]');
  const mode = process.env.LAB_TOOLKIT_PATH_PARSE_MODE || 'raw';
  if (mode === 'action-trim') {
    return paths.map(path => String(path).replace(/^!\s+/, '!').trim()).filter(Boolean);
  }
  if (mode !== 'raw') throw new Error(`Unknown LAB_TOOLKIT_PATH_PARSE_MODE: ${mode}`);
  return paths;
}

async function main() {
  const operation = process.env.LAB_OPERATION || 'lookup';
  const primaryKey = process.env.LAB_CACHE_KEY || 'canon-lab-v1';
  const restoreKeys = process.env.LAB_RESTORE_KEYS_JSON
    ? JSON.parse(process.env.LAB_RESTORE_KEYS_JSON)
    : splitLines(process.env.LAB_RESTORE_KEYS || '', {trim: false});
  const enableCrossOsArchive = boolFrom(process.env.LAB_ENABLE_CROSS_OS_ARCHIVE);
  const paths = parsePaths();
  const compressionMethod = getCompressionMethod();
  const predictedVersion = computeCacheVersion(
    paths,
    compressionMethod,
    enableCrossOsArchive
  );

  const result = {
    driver: '@actions/cache',
    packageVersion: '6.1.0',
    operation,
    pathParseMode: process.env.LAB_TOOLKIT_PATH_PARSE_MODE || 'raw',
    enableCrossOsArchive,
    primaryKey: describeString(primaryKey),
    restoreKeys: restoreKeys.map(describeString),
    paths: summarizePaths(paths),
    compressionMethod,
    predictedVersion,
    matchedKey: null,
    cacheId: null,
    skippedSaveBecauseActionExactMatch: false,
    error: null
  };

  try {
    if (operation === 'lookup' || operation === 'restore' || operation === 'roundtrip') {
      const lookupOnly = operation !== 'restore';
      const matchedKey = await cache.restoreCache(
        paths,
        primaryKey,
        restoreKeys,
        {lookupOnly},
        enableCrossOsArchive
      );
      result.matchedKey = matchedKey ? describeString(matchedKey) : null;
      result.strictExactMatch = strictKeyMatch(primaryKey, matchedKey || '');
      result.actionExactMatch = actionExactKeyMatch(primaryKey, matchedKey || '');
    }

    if (operation === 'save' || operation === 'roundtrip') {
      if (
        operation === 'roundtrip' &&
        actionExactKeyMatch(primaryKey, result.matchedKey?.value || '')
      ) {
        result.skippedSaveBecauseActionExactMatch = true;
      } else {
        result.cacheId = await cache.saveCache(paths, primaryKey, {}, enableCrossOsArchive);
      }
    }
  } catch (error) {
    result.error = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  writeJson('lab-observations/toolkit-result.json', result);
  console.log(JSON.stringify(result, null, 2));

  if (result.error && boolFrom(process.env.LAB_FAIL_ON_TOOLKIT_ERROR)) {
    process.exitCode = 1;
  }
}

await main();
