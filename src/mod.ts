/**
 * Module exports main `Diplodocache` class.
 *
 * @module
 */
import type {
  Deferred,
  Logger,
  LogLevel,
  Metadata,
  Payload,
  LogPayload,
  FetchPayload,
  ReadyPayload,
  ResponsePayload,
  PurgePayload,
  FetchOptions,
  Options
} from './types.ts';
import {fs, path, serveFile} from '../deps.ts';
import {MetaPayload} from './types.ts';

/** Diplodocache class */
export class Diplodocache {
  #logger: Logger;
  #logLevel: LogLevel;
  #logTimestamp: boolean;
  #logDateFormat: Intl.DateTimeFormat;
  #logTimeFormat: Intl.DateTimeFormat;
  #cachePath: string;
  #readyState: 0 | 1 | 2 | 3;
  #worker!: Worker;
  // deno-lint-ignore no-explicit-any
  #work: Map<string, Deferred<any>>;
  // deno-lint-ignore no-explicit-any
  #request: WeakMap<Deferred<any>, Request>;

  /**
   * Create a new Diplodocache instance
   * @param options Diplodocache options with cache path
   */
  constructor(options: Options) {
    // Validate cache path and ensure directory exists
    try {
      this.#cachePath = path.resolve(options.cachePath, './');
      fs.ensureDirSync(this.#cachePath);
    } catch {
      throw new Error(`Invalid "cachePath" provided in options`);
    }
    // Setup log options
    this.#logger = options.logger ?? console;
    this.#logLevel = options.logLevel ?? 'NOTSET';
    if (this.#logger === console && this.#logLevel === 'CRITICAL') {
      this.#logLevel = 'ERROR';
    }
    this.#logTimestamp = Boolean(options.logTimestamp ?? true);
    this.#logDateFormat = new Intl.DateTimeFormat(
      options.logLocale ?? 'en-US',
      {
        dateStyle: 'short'
      }
    );
    this.#logTimeFormat = new Intl.DateTimeFormat(
      options.logLocale ?? 'en-US',
      {
        hour12: false,
        timeStyle: 'medium'
      }
    );
    // Setup deffered state promises
    this.#work = new Map();
    this.#request = new WeakMap();
    this.#readyState = 0;
    this.#work.set('ready', Promise.withResolvers<boolean>());
    this.#work.set('closed', Promise.withResolvers<boolean>());
    this.ready.then(() => (this.#readyState = 1));
    this.closed.then(() => {
      this.#readyState = 3;
      this.#worker.terminate();
    });
    // Setup the worker
    const bundle = import.meta.resolve('./worker.min.js');
    if (fs.existsSync(new URL(bundle))) {
      this.#logger.debug('Using Bundled Worker');
      fetch(bundle).then(async (response) => {
        const text = await response.text();
        const blob = new Blob([text], {type: 'application/javascript'});
        const url = URL.createObjectURL(blob);
        this.#worker = new Worker(url, {
          type: 'module'
        });
        this.#worker.addEventListener('message', (ev) => this.#onMessage(ev));
      });
    } else {
      this.#logger.debug('Using TypeScript Worker');
      this.#worker = new Worker(import.meta.resolve('./worker.ts'), {
        type: 'module'
      });
      this.#worker.addEventListener('message', (ev) => this.#onMessage(ev));
    }
  }

  /**
   * Current state of the worker
   * @returns 0 = Opening, 1 = Ready, 2 = Closing, 3 = Closed
   */
  get readyState(): number {
    return this.#readyState;
  }

  /** Resolves `true` once the worker is ready */
  get ready(): Promise<boolean> {
    return this.#work.get('ready')!.promise;
  }

  /** Resolves `true` once the worker has closed */
  get closed(): Promise<boolean> {
    return this.#work.get('closed')!.promise;
  }

  /**
   * Close the cache and cancel any active or queued downloads
   * @returns Promise that resolves `true` once the worker has closed
   */
  close(): Promise<boolean> {
    if (this.#readyState < 2) {
      this.#readyState = 2;
      this.#postMessage({type: 'close'});
    }
    return this.closed;
  }

  /**
   * Remove outdated and unknown cache files
   * @returns Promise that resolves `true` once clean has finished
   */
  clean(): Promise<boolean> {
    if (this.#work.has('clean') === false) {
      this.#work.set('clean', Promise.withResolvers<boolean>());
      this.#postMessage({type: 'clean'});
    }
    return this.#work.get('clean')!.promise;
  }

  /**
   * Download and cache the URL
   * @param url      URL of file to download
   * @param request  Original Request object
   * @param options  Fetch options
   * @returns Promise that resolves to a `Response`
   */
  async fetch(
    url: string | URL,
    request?: Request,
    options?: FetchOptions
  ): Promise<Response> {
    if (this.readyState > 1) {
      throw new Error('Worker has closed');
    }
    url = new URL(url);
    const key = `fetch:${url.href}`;
    if (this.#work.has(key)) {
      return this.#work.get(key)!.promise;
    }
    await this.ready;
    const deferred = Promise.withResolvers<Response>();
    this.#work.set(key, deferred);
    this.#request.set(deferred, request ?? new Request(url));
    const message: FetchPayload = {
      type: 'fetch',
      payload: {...(options ?? {}), url: url.href}
    };
    this.#postMessage(message);
    return deferred.promise;
  }

  /**
   * Get the cached URL metadata
   * @param url  URL of file downloaded
   * @returns Promise that resolves to metadata
   */
  async meta(url: string | URL): Promise<Metadata | undefined> {
    if (this.readyState > 1) {
      throw new Error('Worker has closed');
    }
    url = new URL(url);
    const key = `meta:${url.href}`;
    if (this.#work.has(key)) {
      return this.#work.get(key)!.promise;
    }
    await this.ready;
    const deferred = Promise.withResolvers<Metadata | undefined>();
    this.#work.set(key, deferred);
    this.#postMessage({type: 'meta', payload: {url: url.href}});
    return deferred.promise;
  }

  /**
   * Delete a cached file
   * @param url URL of the original download
   * @returns Promise that resolves `true` if file was deleted
   */
  async purge(url: string | URL): Promise<boolean> {
    if (this.readyState > 1) {
      throw new Error('Worker has closed');
    }
    url = new URL(url);
    const key = `purge:${url.href}`;
    if (this.#work.has(key)) {
      return this.#work.get(key)!.promise;
    }
    await this.ready;
    const deferred = Promise.withResolvers<boolean>();
    this.#work.set(key, deferred);
    const message: PurgePayload = {
      type: 'purge',
      payload: {url: url.href}
    };
    this.#postMessage(message);
    return deferred.promise;
  }

  /** Post a message to the worker */
  #postMessage(message: Payload) {
    this.#worker.postMessage(message);
  }

  /** Handle message events from the worker */
  #onMessage(ev: MessageEvent<Payload>) {
    switch (ev.data.type) {
      case 'ready':
        this.#onReady();
        return;
      case 'close':
        this.#onClose();
        return;
      case 'clean':
        this.#onClean();
        return;
      case 'log':
        this.#onLog(ev as MessageEvent<LogPayload>);
        return;
      case 'meta':
        this.#onMeta(ev as MessageEvent<MetaPayload>);
        return;
      case 'purge':
        this.#onPurge(ev as MessageEvent<PurgePayload>);
        return;
      case 'response':
        this.#onResponse(ev as MessageEvent<ResponsePayload>);
        return;
    }
  }

  /** Handle ready message */
  #onReady() {
    this.#work.get('ready')!.resolve(true);
    const message: ReadyPayload = {
      type: 'ready',
      payload: {
        cachePath: this.#cachePath
      }
    };
    this.#postMessage(message);
  }

  /** Handle close message */
  #onClose() {
    this.#work.get('closed')!.resolve(true);
  }

  /** Handle clean message */
  #onClean() {
    if (this.#work.has('clean')) {
      this.#work.get('clean')!.resolve(true);
      this.#work.delete('clean');
    }
  }

  /** Forward log messages to the console */
  #onLog(ev: MessageEvent<LogPayload>) {
    const {level, message} = ev.data.payload;
    if (this.#logger === console) {
      const logLevel = this.#logLevel;
      if (
        logLevel === 'NOTSET' ||
        (logLevel === 'ERROR' && level !== 'ERROR') ||
        (logLevel === 'WARN' && ['DEBUG', 'INFO'].includes(level)) ||
        (logLevel === 'INFO' && level === 'DEBUG')
      ) {
        return;
      }
    }
    const date = this.#logTimeFormat.format(Date.now());
    const time = this.#logDateFormat.format(Date.now());
    let output = `⚙️ ${message}`;
    if (this.#logTimestamp) {
      output = `[${time} ${date}] ${output}`;
    }
    const key = level.toLowerCase() as keyof Logger;
    this.#logger[key](output);
  }

  /** Handle meta message response */
  #onMeta(ev: MessageEvent<MetaPayload>) {
    const {url} = ev.data.payload;
    const key = `meta:${url}`;
    if (this.#work.has(key) === false) {
      return;
    }
    const deffered = this.#work.get(key)!;
    this.#work.delete(key);
    deffered.resolve(ev.data.payload.created ? ev.data.payload : undefined);
  }

  /** Handle purge message response */
  #onPurge(ev: MessageEvent<PurgePayload>) {
    const {url, success} = ev.data.payload;
    const key = `purge:${url}`;
    if (this.#work.has(key) === false) {
      return;
    }
    const deffered = this.#work.get(key)!;
    this.#work.delete(key);
    deffered.resolve(success);
  }

  /** Handle fetch message response */
  async #onResponse(ev: MessageEvent<ResponsePayload>) {
    const {url, body, headers, error} = ev.data.payload;
    const key = `fetch:${url}`;
    if (this.#work.has(key) === false) {
      return;
    }
    const deffered = this.#work.get(key)!;
    const request = this.#request.get(deffered);
    this.#work.delete(key);
    this.#request.delete(deffered);
    if (body === undefined) {
      deffered.reject(error);
      return;
    }
    // Request was prefetched only return headers
    if (body === null) {
      deffered.resolve(new Response(null, {headers: new Headers(headers)}));
      return;
    }
    // Serve the downloaded file from cache
    try {
      if (!request) throw new Error();
      const response = await serveFile(request, body);
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      deffered.resolve(response);
    } catch (err) {
      deffered.reject(err);
    }
  }
}
