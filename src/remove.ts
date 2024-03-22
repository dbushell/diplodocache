/// <reference lib="WebWorker"/>
/**
 * @file Worker function to remove cached metadata and downloaded file.
 */
import {path} from '../deps.ts';
import {cacheMeta, cachePath} from './worker.ts';
import {encodeHash} from './murmurhash/mod.ts';
import {log} from './log.ts';

/**
 * Attempt to remove item from cache and delete file
 * @param url     URL of cached item to remove
 * @param bubble  Errors are suppressed if set to `false` (default)
 */
export const removeSync = (url: string, bubble = false) => {
  const hash = encodeHash(url);
  delete cacheMeta[url];
  try {
    Deno.removeSync(path.join(cachePath, hash));
    log.info(`Removed: ${url}`);
  } catch (err) {
    if (bubble) throw err;
  }
};
