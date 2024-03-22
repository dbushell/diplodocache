/// <reference lib="WebWorker"/>
/**
 * @file Download queue for the worker.
 */
import type {Download} from './types.ts';
import {Queue} from '../deps.ts';

/** Download queue */
export const createQueue = (): Queue<Download, boolean> =>
  new Queue<Download, boolean>({
    concurrency: 5
  });

/** Default `queue.sort` value function */
const sortValue = ({options: {accept}}: Download) => {
  if (accept[0].startsWith('application/json')) return 1;
  if (accept[0].match(/^(application|text)\/(\w+\+)?xml/)) return 1;
  if (accept[0].startsWith('image/')) return 2;
  if (accept[0].startsWith('audio/')) return 4;
  return 3;
};

/** Sort queue by mime type priority */
export const sortQueue = (queue: Queue<Download, boolean>) => {
  queue.sort((a, b) => sortValue(a) - sortValue(b));
};
