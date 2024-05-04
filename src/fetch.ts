/// <reference lib="WebWorker"/>
/**
 * @file Handle fetch requests for queue items in the worker.
 */
import type {Download, ResponsePayload} from './types.ts';
import {mediaTypes, path} from '../deps.ts';
import {cacheMeta, sendMessage} from './worker.ts';
import {removeSync} from './remove.ts';
import {log} from './log.ts';

/** Callback handle to fetch queued item */
export const fetchCallback = async (item: Download): Promise<boolean> => {
  const {url} = item;
  // Fail if aborted; can this ever happen?
  if (item.controller.signal.aborted) {
    log.warn(`Abandoned: ${url}`);
    return false;
  }
  let status = 500;
  try {
    // Validate URL before fetch
    new URL(url);
    // Return from cache if available
    status = fetchCache(item);
    if (status === 200) return true;
    removeSync(url);
    // Fetch from network and store in cache
    status = await fetchFresh(item);
    if (status === 200) return true;
  } catch {
    log.warn(`Failed: ${url}`);
  }
  removeSync(url);
  // Send failed response
  const message: ResponsePayload = {
    type: 'response',
    payload: {
      url,
      status,
      body: null,
      headers: {}
    }
  };
  sendMessage(message);
  return false;
};

/**
 * Fetch item from cache and post `Response` message to main thread
 * @returns `true` if cache hit
 */
const fetchCache = (item: Download): number => {
  const {url} = item;
  // Fail if item is not in cache
  if (Object.hasOwn(cacheMeta, url) === false) {
    return 404;
  }
  const entry = cacheMeta[url];
  // Remove cache entry and fail if hash mismatch
  if (entry.hash !== item.hash) {
    return 410;
  }
  // Remove cache entry and fail if time has expired
  const age = Date.now() - new Date(entry.created).getTime();
  if (age > item.options.maxAge) {
    return 410;
  }
  // Setup response message
  const message: ResponsePayload = {
    type: 'response',
    payload: {
      url,
      body: item.options.prefetch ? undefined : item.path,
      headers: {
        'content-type': entry.contentType,
        'x-cache': 'HIT'
      }
    }
  };
  if (entry.compressed) {
    message.payload.headers['content-encoding'] = 'gzip';
  }
  log.debug(`Hit: ${url}`);
  sendMessage(message);
  return 200;
};

/**
 * Fetch item from network and post `Response` message to main thread
 * @returns `true` if cache stored
 */
const fetchFresh = async (item: Download): Promise<number> => {
  const {url} = item;
  log.debug(`Miss: ${url}`);
  const headers = new Headers();
  headers.set('accept', item.options.accept.join(', '));
  // Fetch response
  const response = await fetch(url, {
    signal: item.controller.signal,
    headers
  });
  if (!response.ok || !response.body) {
    log.error(`Fetch: [${response.status} - ${response.statusText}] ${url}`);
    return response.status === 200 ? 418 : response.status;
  }
  // Get content type or infer from file extension
  const contentType =
    mediaTypes.contentType(response.headers.get('content-type') ?? '') ??
    mediaTypes.contentType(path.extname(url)) ??
    '';
  // Get estimated content length
  const contentLength =
    Number.parseInt(response.headers.get('content-length') ?? '0') || 0;
  // Store in cache metadata
  cacheMeta[url] = {
    contentType,
    contentLength,
    contentSize: 0,
    created: new Date().toISOString(),
    compressed: item.options.compress,
    maxAge: item.options.maxAge,
    hash: item.hash
  };
  // Setup response message
  const message: ResponsePayload = {
    type: 'response',
    payload: {
      url,
      body: item.options.prefetch ? undefined : item.path,
      headers: {
        'content-type': contentType,
        'x-cache': 'MISS'
      }
    }
  };
  const timeout = setTimeout(() => {
    if (item.controller.signal.aborted === false) {
      log.warn(`Timeout: ${url}`);
      item.controller.abort();
    }
  }, item.options.timeout);
  let cancelled = false;
  let file: Deno.FsFile | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  try {
    file = await Deno.open(item.path, {
      write: true,
      create: true,
      truncate: true
    });
    let stream = response.body;
    if (item.options.compress) {
      stream = response.body.pipeThrough(new CompressionStream('gzip'));
      message.payload.headers['content-encoding'] = 'gzip';
    }
    reader = stream.getReader();
    writer = file.writable.getWriter();
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (Object.hasOwn(cacheMeta, url)) {
        cacheMeta[url].contentSize += value.length;
      } else {
        cancelled = true;
        break;
      }
      await writer.write(value);
    }
    if (cancelled) throw new Error();
    // Get final content length
    const stat = await Deno.stat(item.path);
    cacheMeta[url].contentLength = stat.size;
    cacheMeta[url].downloaded = new Date().toISOString();
  } catch {
    if (item.controller.signal.aborted === false) {
      cancelled ? log.warn(`Cancelled: ${url}`) : log.error(`Write: ${url}`);
    }
    return 500;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (writer) writer.releaseLock();
    if (reader) reader.releaseLock();
    if (file) file.close();
  }
  sendMessage(message);
  return 200;
};
