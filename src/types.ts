/**
 * Types for `jsr:@ssr/diplodocache`.
 *
 * @module
 */

/** Deferred promise */
export type Deferred<T> = ReturnType<typeof Promise.withResolvers<T>>;

/** Log configuration level for output detail */
export type LogLevel =
  | 'NOTSET'
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'CRITICAL';

/** Log handler interface with required methods */
export interface Logger {
  debug: (...data: unknown[]) => void;
  info: (...data: unknown[]) => void;
  warn: (...data: unknown[]) => void;
  error: (...data: unknown[]) => void;
}

/** Diplodocache class options */
export type Options = {
  /** Directory to store cached files */
  cachePath: string;
  /** Level of log output */
  logLevel?: LogLevel;
  /** BCP 47 language tag for date/time formatting (default: "en-US") */
  logLocale?: string;
  /** Prepend date and time to log output */
  logTimestamp?: boolean;
  /** Log callback functions (default: `console`) */
  logger?: Logger;
};

/** Configuration for fetch request */
export type FetchOptions = {
  /** List of mime types for request `Accept` HTTP header */
  accept?: Array<string>;
  /** Store cached file with GZIP compression */
  compress?: boolean;
  /** Maximum age of file (milliseconds) */
  maxAge?: number;
  /** Send request but do not return a `Response` */
  prefetch?: boolean;
  /** Maximum time to wait for request (milliseconds) */
  timeout?: number;
};

/** Data stored against each cache item */
export type Metadata = {
  /** Hash of URL used as file name */
  hash: string;
  /** Date ISO timestamp of fetch request */
  created: string;
  /** Cached file is stored with GZIP compression */
  compressed: boolean;
  /** Cached file size (`content-length` response header estimate during download) */
  contentLength: number;
  /** Number of bytes currently downloaded */
  contentSize: number;
  /** `content-type` response header (or inferred from file extension) */
  contentType: string;
  /** Maximum age of file (milliseconds) */
  maxAge: number;
  /** Date ISO timestamp of completed download */
  downloaded?: string;
};

/** In-memory metadata of cached items */
export interface CacheMeta {
  [key: string]: Metadata;
}

/** Queued item to be fetched and cached */
export type Download = {
  url: string;
  hash: string;
  path: string;
  controller: AbortController;
  options: Required<FetchOptions>;
};

/** Named type of message passed to and from worker */
export type PayloadType =
  | 'clean'
  | 'close'
  | 'fetch'
  | 'log'
  | 'meta'
  | 'purge'
  | 'ready'
  | 'response';

/** Message passed to and from worker */
export type Payload = {type: PayloadType; payload?: Record<string, unknown>};

/** Fetch message */
export interface FetchPayload extends Payload {
  type: 'fetch';
  payload: FetchOptions & {
    url: string;
  };
}

/** Log message */
export interface LogPayload extends Payload {
  type: 'log';
  payload: {
    level: LogLevel;
    message: string;
  };
}

/** Metadata message */
export interface MetaPayload extends Payload {
  type: 'meta';
  payload: Metadata & {
    url: string;
  };
}

/** Purge message */
export interface PurgePayload extends Payload {
  type: 'purge';
  payload: {
    url: string;
    success?: boolean;
  };
}

/** Ready message */
export interface ReadyPayload extends Payload {
  type: 'ready';
  payload: {
    cachePath: string;
  };
}

/** Response message */
export interface ResponsePayload extends Payload {
  type: 'response';
  payload: {
    url: string;
    headers: {[key: string]: string};
    body: string | null | undefined;
    status?: number;
  };
}
