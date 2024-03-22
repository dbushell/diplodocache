/// <reference lib="WebWorker"/>
/**
 * @file Log functions for the worker.
 */
import type {LogPayload} from './types.ts';

/**
 * Worker log functions to post messages to the main thread
 */
export const log = {
  /**
   * Post a `DEBUG` log message to the main thread
   * @param message Log message
   */
  debug: (message: string) => {
    const logMessage: LogPayload = {
      type: 'log',
      payload: {level: 'DEBUG', message}
    };
    self.postMessage(logMessage);
  },
  /**
   * Post a `INFO` log message to the main thread
   * @param message Log message
   */
  info: (message: string) => {
    const logMessage: LogPayload = {
      type: 'log',
      payload: {level: 'INFO', message}
    };
    self.postMessage(logMessage);
  },
  /**
   * Post a `WARN` log message to the main thread
   * @param message Log message
   */
  warn: (message: string) => {
    const logMessage: LogPayload = {
      type: 'log',
      payload: {level: 'WARN', message}
    };
    self.postMessage(logMessage);
  },
  /**
   * Post an `ERROR` log message to the main thread
   * @param message Log message
   */
  error: (message: string) => {
    const logMessage: LogPayload = {
      type: 'log',
      payload: {level: 'ERROR', message}
    };
    self.postMessage(logMessage);
  }
};
