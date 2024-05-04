/// <reference lib="WebWorker"/>
/**
 * Worker entry point to manage download queue and cache.
 *
 * @module
 */
import type {
  Download,
  CacheMeta,
  Payload,
  FetchPayload,
  MetaPayload,
  PurgePayload,
  ReadyPayload
} from './types.ts';
import {fs, path} from '../deps.ts';
import {encodeHash} from './murmurhash/mod.ts';
import {createQueue, sortQueue} from './queue.ts';
import {fetchCallback} from './fetch.ts';
import {removeSync} from './remove.ts';
import {log} from './log.ts';

const queue = createQueue();

/** Directory to store cached files */
export let cachePath: string = '';

/** JSON file to store metadata */
export let cacheMetaPath: string = '';

/** In-memory metadata (synced to `cacheMetaPath`) */
export let cacheMeta: CacheMeta = {};

/** Post message to main thread */
export const sendMessage = (payload: Payload) => {
  self.postMessage(payload);
};

sendMessage({type: 'ready'});
log.info(`Ready`);

// Handle messages from main thread
self.addEventListener('message', (ev: MessageEvent<Payload>) => {
  const {type, payload} = ev.data;
  switch (type) {
    case 'clean':
      onClean();
      return;
    case 'close':
      onClose();
      return;
    case 'fetch':
      onFetch(payload as FetchPayload['payload']);
      return;
    case 'meta':
      onMeta(payload as MetaPayload['payload']);
      return;
    case 'purge':
      onPurge(payload as PurgePayload['payload']);
      return;
    case 'ready':
      onReady(payload as ReadyPayload['payload']);
      return;
  }
  log.warn(`Unknown: "${type}"`);
});

/** Handle `ready` message */
const onReady = (payload: ReadyPayload['payload']) => {
  cachePath = payload.cachePath;
  cacheMetaPath = path.join(cachePath, 'meta.json');
  fs.ensureFileSync(cacheMetaPath);
  try {
    cacheMeta = JSON.parse(Deno.readTextFileSync(cacheMetaPath));
  } catch {
    cacheMeta = {};
  }
};

/** Handle `close` message */
const onClose = async () => {
  log.info(`Closing`);
  queue.clear();
  queue.getPending().forEach((item) => {
    log.warn(`Aborting: ${item.url}`);
    item.controller.abort();
  });
  await Deno.writeTextFile(cacheMetaPath, JSON.stringify(cacheMeta, null, 2));
  sendMessage({type: 'close'});
  self.close();
};

/** Handle `clean` message */
const onClean = async () => {
  log.debug(`Cleaning`);
  // Iterate over cached items
  for (const [url, entry] of Object.entries(cacheMeta)) {
    try {
      const entryPath = path.join(cachePath, entry.hash);
      const stat = await Deno.stat(entryPath);
      // Remove if file is missing
      if (!stat.isFile) {
        throw new Error();
      }
      // Remove if file has expired
      const age = Date.now() - new Date(entry.created).getTime();
      if (age > entry.maxAge) {
        throw new Error();
      }
    } catch {
      removeSync(url);
    }
  }
  // Iterate over cache directory
  for await (const dirEntry of Deno.readDir(cachePath)) {
    try {
      const known = Object.values(cacheMeta).find(
        (entry) => entry.hash === dirEntry.name
      );
      // Remove any files not in cache
      if (known === undefined) {
        await Deno.remove(path.join(cachePath, dirEntry.name));
      }
    } catch (err) {
      log.error(err);
    }
  }
  await Deno.writeTextFile(cacheMetaPath, JSON.stringify(cacheMeta, null, 2));
  sendMessage({type: 'clean'});
  log.debug(`Cleaned`);
};

/** Handle `meta` message */
const onMeta = (props: MetaPayload['payload']) => {
  const message: MetaPayload = {
    type: 'meta',
    payload: props
  };
  // Add copy of cached metadata
  if (Object.hasOwn(cacheMeta, props.url)) {
    message.payload = {
      ...structuredClone(cacheMeta[props.url]),
      url: props.url
    };
  }
  sendMessage(message);
};

/** Handle `purge` message */
const onPurge = (props: PurgePayload['payload']) => {
  const {url} = props;
  log.debug(`Purge: ${url}`);
  const message: PurgePayload = {
    type: 'purge',
    payload: {url, success: false}
  };
  try {
    removeSync(url, true);
  } catch {
    sendMessage(message);
  }
  message.payload.success = true;
  sendMessage(message);
};

/** Handle `fetch` message */
const onFetch = (props: FetchPayload['payload']) => {
  const {url} = props;
  log.debug(`Fetch: ${url}`);
  const hash = encodeHash(url);
  const item: Download = {
    url,
    hash,
    path: path.join(cachePath, hash),
    controller: new AbortController(),
    options: {
      accept: props.accept ?? ['*/*'],
      compress: props.compress ?? false,
      maxAge: props.maxAge ?? 1e3 * 60 * 60,
      prefetch: props.prefetch ?? false,
      timeout: props.timeout ?? 1e3 * 60 * 10
    }
  };
  queue.append(item, fetchCallback);
  sortQueue(queue);
};
