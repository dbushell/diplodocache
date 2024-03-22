# 💾 Diplodocache

Experimental fetch cache for Deno. API subject to change!

```javascript
import {Diplodocache} from 'jsr:@ssr/diplodocache';

const cache = new Diplodocache({
  cachePath: '/path/to/directory'
});

const url = new URL('https://example.com/download.zip');
const response = await cache.fetch(url);
```

* * *

[MIT License](/LICENSE) | Copyright © 2024 [David Bushell](https://dbushell.com)
