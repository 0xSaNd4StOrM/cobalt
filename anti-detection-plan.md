# Anti-Detection Improvement Plan
### Instagram & TikTok — avoid bot/automation detection without rotational proxies

---

## Overview

Detection systems (TLS fingerprinting, behavioural analysis, header consistency checks) work by finding patterns. Every item below targets a different signal that can be read by Instagram/TikTok to identify automated traffic. Items are ordered by impact.

---

## Item 1 — Fix Chrome version mismatch in `embedHeaders` (Instagram)

### Problem
`genericUserAgent` in `api/src/config.js` advertises **Chrome/138**, but `embedHeaders` in `api/src/processing/services/instagram.js` has `Sec-Ch-Ua` hard-coded to **Chrome/124**. Any fingerprinting system that cross-checks `User-Agent` against `Sec-Ch-Ua` immediately flags this as inconsistent.

```
User-Agent:  ... Chrome/138.0.0.0 ...       ← from genericUserAgent
Sec-Ch-Ua:  "Google Chrome";v="124" ...     ← hardcoded in embedHeaders  ❌
```

### Files to change
- `api/src/processing/services/instagram.js`

### Current code (lines ~28–43)
```js
const embedHeaders = {
    "Accept": "text/html,application/xhtml+xml,...",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Dnt": "1",
    "Priority": "u=0, i",
    "Sec-Ch-Ua": 'Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": "macOS",
    ...
    "User-Agent": genericUserAgent,
}
```

### Fix — derive `Sec-Ch-Ua` dynamically from `genericUserAgent`

Add a helper above the `embedHeaders` constant that parses the version out of the UA string and builds the correct `Sec-Ch-Ua`:

```js
// Derives Sec-Ch-Ua from the UA string so they always match.
function buildSecChUa(ua) {
    const version = ua.match(/Chrome\/(\d+)/)?.[1] ?? '138';
    return `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="99"`;
}
```

Then reference it inside `embedHeaders`:
```js
const embedHeaders = {
    ...
    "Sec-Ch-Ua": buildSecChUa(genericUserAgent),   // ← was hardcoded v="124"
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": "macOS",
    ...
    "User-Agent": genericUserAgent,
}
```

### Why it helps
Eliminates the most obvious static inconsistency. Automated consistency checks pass now, and future UA updates in `config.js` are automatically reflected.

---

## Item 2 — TLS cipher shuffle per-request (not only every 30 minutes)

### Problem
`randomizeCiphers()` runs once at startup and then every 30 minutes via `setInterval`. That means **all requests within a 30-minute window share the exact same TLS cipher order** — a stable fingerprint.

### Files to change
- `api/src/misc/randomize-ciphers.js`
- `api/src/processing/services/instagram.js`
- `api/src/processing/services/tiktok.js`

### Step 1 — Export a per-request variant in `randomize-ciphers.js`

Add an exported function that shuffles only when called, without replacing the periodic interval:

```js
// Existing export stays unchanged — used by setInterval in api.js
export const randomizeCiphers = () => { ... }

// New: call before individual outbound requests
export const randomizeCiphersNow = randomizeCiphers;
```

`randomizeCiphersNow` is just an alias; the point is the call-site intent is explicit and testable.

### Step 2 — Call it at the top of each service's fetch chain

**In `instagram.js`**, inside `getPost()` before the first `fetch`:
```js
async function getPost(id, alwaysProxy) {
    randomizeCiphers();   // ← add this line
    ...
}
```

Also add it inside `getStory()` for the same reason.

Import it at the top of `instagram.js`:
```js
import { randomizeCiphers } from "../../misc/randomize-ciphers.js";
```

**In `tiktok.js`**, before the main `fetch`:
```js
import { randomizeCiphers } from "../../misc/randomize-ciphers.js";

export default async function(obj) {
    randomizeCiphers();   // ← add this line
    ...
}
```

### Why it helps
Every outbound TLS handshake now presents a different cipher order. TLS fingerprint systems (JA3 / JA4) see a new fingerprint on every request instead of the same one for up to 30 minutes.

---

## Item 3 — Dynamic User-Agent pool

### Problem
`genericUserAgent` is a single hardcoded string. Every request from every user for every platform always looks identical at the network level — a trivially detectable pattern.

### Files to change
- `api/src/config.js`
- `api/src/processing/services/instagram.js`
- `api/src/processing/services/tiktok.js`

### Step 1 — Add a UA pool to `config.js`

Replace the single `genericUserAgent` with a pool and a picker:

```js
// Keep this for places that need a stable string (cobaltUserAgent, etc.)
const genericUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const userAgentPool = [
    // Windows — Chrome versions
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    // macOS — Chrome
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    // Linux — Chrome
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
];

export const getRandomUserAgent = () =>
    userAgentPool[Math.floor(Math.random() * userAgentPool.length)];
```

Export both `genericUserAgent` (unchanged, for backward compat) and `getRandomUserAgent`.

### Step 2 — Use `getRandomUserAgent()` at request time in services

**In `instagram.js`** — build headers per-request instead of at module load time:

```js
import { getRandomUserAgent } from "../../config.js";

// Remove the static `embedHeaders` and `commonHeaders` constants.
// Replace with functions that produce fresh headers each call:

function getCommonHeaders() {
    return {
        "user-agent": getRandomUserAgent(),
        "sec-gpc": "1",
        "sec-fetch-site": "same-origin",
        "x-ig-app-id": "936619743392459"
    };
}

function getEmbedHeaders() {
    const ua = getRandomUserAgent();
    return {
        "Accept": "text/html,application/xhtml+xml,...",
        "Accept-Language": getRandomAcceptLanguage(),   // see Item 6
        "Cache-Control": "max-age=0",
        "Dnt": "1",
        "Priority": "u=0, i",
        "Sec-Ch-Ua": buildSecChUa(ua),
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": getSecChUaPlatform(ua),  // macOS/Windows/Linux
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": ua,
    };
}
```

Add a `getSecChUaPlatform` helper that matches the OS from the UA:
```js
function getSecChUaPlatform(ua) {
    if (ua.includes('Macintosh')) return 'macOS';
    if (ua.includes('X11')) return 'Linux';
    return 'Windows';
}
```

Update all call-sites in `instagram.js` from `...commonHeaders` / `...embedHeaders` to `...getCommonHeaders()` / `...getEmbedHeaders()`.

**In `tiktok.js`**:
```js
import { getRandomUserAgent } from "../../config.js";

// Replace:
headers: { "user-agent": genericUserAgent, ... }
// With:
headers: { "user-agent": getRandomUserAgent(), ... }
```

### Why it helps
Rotates OS, Chrome version, and derived `Sec-Ch-Ua` & platform on every request. JA3/JA4 + HTTP header fingerprinting now see different combinations. Especially effective combined with Item 2.

---

## Item 4 — Add `dispatcher` to all TikTok fetches

### Problem
`tiktok.js` uses bare `fetch()` without passing `dispatcher`. This means:
1. If you configure an `externalProxy` env variable, TikTok requests bypass it entirely (they go direct to TikTok).
2. The global undici dispatcher set in `api.js` is not reliably used by all environments.

### Files to change
- `api/src/processing/services/tiktok.js`

### Current signature
```js
export default async function(obj) {
    const cookie = new Cookie({});
    let postId = obj.postId;
```

### Fix — receive and forward `dispatcher`

The service object `obj` already carries `dispatcher` in Instagram — do the same for TikTok.

**Short-link resolve fetch** (line ~16):
```js
// Before:
let html = await fetch(`${shortDomain}${obj.shortLink}`, {
    redirect: "manual",
    headers: { "user-agent": genericUserAgent.split(' Chrome/1')[0] }
}).then(r => r.text()).catch(() => {});

// After:
let html = await fetch(`${shortDomain}${obj.shortLink}`, {
    redirect: "manual",
    dispatcher: obj.dispatcher,
    headers: { "user-agent": getRandomUserAgent().split(' Chrome/1')[0] }
}).then(r => r.text()).catch(() => {});
```

**Main page fetch** (line ~36):
```js
// Before:
const res = await fetch(`https://www.tiktok.com/@i/video/${postId}`, {
    headers: { "user-agent": genericUserAgent, cookie }
})

// After:
const res = await fetch(`https://www.tiktok.com/@i/video/${postId}`, {
    dispatcher: obj.dispatcher,
    headers: { "user-agent": getRandomUserAgent(), cookie }
})
```

### Why it helps
Ensures TikTok requests go through the same configured proxy/dispatcher as everything else. Without this, a proxy config has no effect on TikTok requests.

---

## Item 5 — Cookie pool for TikTok

### Problem
TikTok service always creates `new Cookie({})` — an empty anonymous cookie. A session cookie (`sessionid`, `tt-target-idc`, `ttwid`, etc.) from a real TikTok account allows:
- Access to age-restricted content (no more `content.post.age` errors).
- More realistic request fingerprint (all real browsers have TikTok cookies after any visit).

### Files to change
- `api/src/processing/cookie/manager.js`
- `api/src/processing/services/tiktok.js`

### Step 1 — Add `tiktok` to `VALID_SERVICES` in `manager.js`

```js
const VALID_SERVICES = new Set([
    'instagram',
    'instagram_bearer',
    'reddit',
    'twitter',
    'youtube',
    'vimeo_bearer',
    'tiktok',          // ← add this
]);
```

### Step 2 — Add `tiktok` example to `docs/examples/cookies.example.json`

```json
"tiktok": [
    "sessionid=<replace_this>; tt-target-idc=useast5; ttwid=<replace_this>"
]
```

### Step 3 — Use the pool in `tiktok.js`

```js
import { getCookie, updateCookie } from "../cookie/manager.js";

export default async function(obj) {
    // Replace:  const cookie = new Cookie({});
    // With:
    const cookie = getCookie('tiktok') ?? new Cookie({});
    ...
}
```

The `?? new Cookie({})` fallback means the service still works when no TikTok cookie is configured.

### Why it helps
Provides a real session for authenticated endpoints. Even for public content, having a valid `ttwid` and `tt-target-idc` makes the request look identical to a browser that has visited TikTok before.

---

## Item 6 — Dynamic `Accept-Language`

### Problem
`embedHeaders` always sends `Accept-Language: en-GB,en;q=0.9` and `mobileHeaders` always sends `accept-language: en-US`. A real population of users sends many different locales with varied `q` values.

### Files to change
- `api/src/processing/services/instagram.js`
- `api/src/processing/services/tiktok.js`

### Add a helper (can live in `api/src/misc/utils.js` or inline in the service)

```js
const ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.8,fr;q=0.5",
    "en-CA,en;q=0.9,fr-CA;q=0.7",
    "en-AU,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.7",
    "fr-FR,fr;q=0.9,en;q=0.6",
    "de-DE,de;q=0.9,en;q=0.6",
];

export const getRandomAcceptLanguage = () =>
    ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
```

### Usage in `getEmbedHeaders()` (Instagram) and TikTok fetch:
```js
"Accept-Language": getRandomAcceptLanguage(),
```

For `mobileHeaders` (which reflects the pretend Android locale), keep `en-US` since that is baked into the claimed device locale — changing it inconsistently with `x-ig-app-locale` would itself be a signal.

### Why it helps
Removes a stable field that all requests currently share. Combined with a random UA and OS, each request now presents a different "user geography" fingerprint.

---

## Item 7 — Explicit `Accept-Encoding`

### Problem
Node's `undici` (the fetch implementation) negotiates `Accept-Encoding` automatically, but the resulting negotiation order may not match what Chrome sends. Chrome consistently sends:

```
Accept-Encoding: gzip, deflate, br, zstd
```

Node/undici sometimes omits `zstd` or reorders entries depending on the version.

### Files to change
- `api/src/processing/services/instagram.js` (inside `getEmbedHeaders()`)
- `api/src/processing/services/tiktok.js` (main page fetch headers)

### Change
In both places, add explicitly:
```js
"Accept-Encoding": "gzip, deflate, br, zstd",
```

This goes inside `embedHeaders` / `getEmbedHeaders()` and in the TikTok main fetch headers.

### Why it helps
Closes a small but exploitable gap in HTTP header fingerprinting. Many scraping libraries are detectable by their non-standard or absent `Accept-Encoding`. Explicitly matching Chrome's order removes this signal.

---

## Item 8 — Random jitter delay between fallback attempts (Instagram)

### Problem
In `getPost()` (instagram.js lines ~416–447), the service tries up to **7 consecutive strategies** (oembed, oembed with token, oembed with cookie, mobile API x3, HTML x2, GQL x2) with **zero delay between them**. Real browsers never fire 7 sequential API calls in milliseconds.

### Files to change
- `api/src/processing/services/instagram.js`

### Add a jitter helper (inline or in `utils.js`)

```js
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const jitter = (min = 80, max = 350) =>
    sleep(min + Math.floor(Math.random() * (max - min)));
```

### Apply between fallback strategy blocks in `getPost()`

```js
// mobile api (bearer)
if (media_id && token) data = await requestMobileApi(media_id, { token });

await jitter();  // ← add between each logical block

// mobile api (no cookie, cookie)
if (media_id && !hasData(data)) data = await requestMobileApi(media_id);
if (media_id && cookie && !hasData(data)) data = await requestMobileApi(media_id, { cookie });

await jitter();

// html embed (no cookie, cookie)
if (!hasData(data)) data = await requestHTML(id);
if (!hasData(data) && cookie) data = await requestHTML(id, cookie);

await jitter();

// web app graphql api (no cookie, cookie)
if (!hasData(data)) data = await requestGQL(id);
if (!hasData(data) && cookie) data = await requestGQL(id, cookie);
```

Only add jitter **between strategy groups**, not between individual calls within the same group — we still want fast short-circuit when a method succeeds.

### Why it helps
Removes the "machine-gun burst" HTTP pattern. Real browsers wait for page renders and network round-trips. This makes the traffic pattern match human or app-like timing at the server side.

---

## Item 9 — Per-IP rate limiting on the API endpoint

### Problem
At 10,000 req/hour (~2.8 req/s average), any single deployer blasts Instagram at a rate that triggers IP-level 429s. Even with all the fingerprint mitigations above, pure volume is detectable. Capping how many requests a single downstream client can send reduces the blast radius of any one user hammering the instance.

### Files to change
- `api/src/core/api.js`

### Install dependency
```
pnpm add express-rate-limit --filter api
```

### Add middleware before the POST `/api/json` route

```js
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute window
    max: 20,               // max 20 requests per IP per minute
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,
    trustProxy: true,      // required if behind nginx / Cloudflare
});

// Apply only to the download endpoint
app.use("/api/json", apiLimiter);
```

Tune `max` to match your expected legitimate per-user throughput. 20/min is conservative; raising to 30–40 is reasonable for most public instances.

### Why it helps
Prevents a single bad actor (or a looping script) from burning through your upstream Instagram quota. Keeps the instance's aggregate request rate within limits that look "normal" to Instagram.

---

## Item 10 — In-process result cache (deduplication)

### Problem
Many users request the same popular post within seconds of each other. Every request fires a full extraction chain (oembed → mobile API → HTML → GQL) against Instagram/TikTok. If 100 users request the same reel in a 5-minute window, you make 100 identical API calls instead of 1.

### Files to change / create
- `api/src/store/result-cache.js` ← new file
- `api/src/processing/match.js` ← integrate cache

### `api/src/store/result-cache.js`

```js
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

function prune() {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.ts > TTL_MS) cache.delete(key);
    }
}

// Prune expired entries every minute
setInterval(prune, 60_000).unref();

export function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) { cache.delete(key); return null; }
    return entry.value;
}

export function setCached(key, value) {
    cache.set(key, { value, ts: Date.now() });
}
```

For a clustered deployment, replace the `Map` with a Redis `GET`/`SET EX 300` call using the existing `redis-store.js` infrastructure.

### Integration in `match.js`

```js
import { getCached, setCached } from "../store/result-cache.js";

// Inside the main extract() function, before calling the service:
const cacheKey = `${patternMatch.named.service}:${JSON.stringify(patternMatch)}`;
const cached = getCached(cacheKey);
if (cached) return cached;

const result = await serviceFunction(obj);
if (result?.status === "tunnel" || result?.status === "redirect") {
    setCached(cacheKey, result);
}
return result;
```

Only cache successful `tunnel`/`redirect` responses — never errors or picker payloads (those may differ per user session).

### Why it helps
Potentially reduces upstream API calls by 80-95% for popular content. Less volume = less detection risk = fewer 429s. Also makes the instance faster for end-users.

---

## Item 11 — Exponential backoff on 429 / 5xx responses

### Problem
When Instagram or TikTok returns a 429 (rate limited) or a 5xx, the current code either fails immediately or retries the next fallback strategy instantly. Immediate retries on a 429 make the situation worse — the server sees more requests and keeps rejecting.

### Files to change
- `api/src/misc/utils.js`
- `api/src/processing/services/instagram.js`
- `api/src/processing/services/tiktok.js`

### Add `fetchWithBackoff()` to `utils.js`

```js
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
    let attempt = 0;
    while (true) {
        const res = await fetch(url, options);
        if (!RETRYABLE.has(res.status) || attempt >= maxRetries) return res;

        const delay = (2 ** attempt) * 1000 + Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
    }
}
```

Backoff schedule:
- Attempt 0 → fail → wait ~1 000 ms (+jitter)
- Attempt 1 → fail → wait ~2 000 ms (+jitter)
- Attempt 2 → fail → wait ~4 000 ms (+jitter)
- Attempt 3 → return response regardless

### Usage

Replace critical `fetch(...)` calls in `instagram.js` and `tiktok.js` with `fetchWithBackoff(...)`. The signature is identical; the only difference is retries on transient errors.

```js
import { fetchWithBackoff } from "../../misc/utils.js";

// Before:
const response = await fetch(url, { headers: ... });
// After:
const response = await fetchWithBackoff(url, { headers: ... });
```

### Why it helps
Converts hard failures into recoverable delays. A temporary 429 burst no longer crashes the request chain — the service backs off and retries when the upstream rate window resets.

---

## Item 12 — Per-service concurrency queue

### Problem
With no concurrency control, 100 simultaneous cobalt users each trigger a full Instagram fetch chain at the same time. That results in 100 concurrent outbound connections to Instagram's API, which is an obvious non-human signal and a guaranteed IP ban at scale.

### Files to change / create
- `api/src/misc/request-queue.js` ← new file
- `api/src/processing/match.js` ← wrap service calls

### `api/src/misc/request-queue.js`

```js
export class ServiceQueue {
    #queue = [];
    #running = 0;
    #concurrency;
    #minIntervalMs;
    #lastRun = 0;

    constructor({ concurrency = 2, minIntervalMs = 500 } = {}) {
        this.#concurrency = concurrency;
        this.#minIntervalMs = minIntervalMs;
    }

    run(fn) {
        return new Promise((resolve, reject) => {
            this.#queue.push({ fn, resolve, reject });
            this.#drain();
        });
    }

    async #drain() {
        if (this.#running >= this.#concurrency || this.#queue.length === 0) return;

        const gap = Date.now() - this.#lastRun;
        if (gap < this.#minIntervalMs) {
            await new Promise(r => setTimeout(r, this.#minIntervalMs - gap));
        }

        const { fn, resolve, reject } = this.#queue.shift();
        this.#running++;
        this.#lastRun = Date.now();

        fn().then(resolve, reject).finally(() => {
            this.#running--;
            this.#drain();
        });
    }
}

export const instagramQueue = new ServiceQueue({ concurrency: 2, minIntervalMs: 500 });
export const tiktokQueue    = new ServiceQueue({ concurrency: 2, minIntervalMs: 400 });
```

### Integration in `match.js`

```js
import { instagramQueue, tiktokQueue } from "../misc/request-queue.js";

// Wrap the service call:
if (patternMatch.named.service === "instagram") {
    result = await instagramQueue.run(() => instagram(obj));
} else if (patternMatch.named.service === "tiktok") {
    result = await tiktokQueue.run(() => tiktok(obj));
} else {
    result = await serviceFunction(obj);
}
```

`concurrency: 2` + `minIntervalMs: 500` means at most 2 concurrent Instagram fetches, with a 500 ms gap between them — roughly 2 req/s aggregate, well under any threshold.

### Why it helps
Turns a thundering herd of parallel requests into a controlled trickle. Instagram/TikTok see a calm, human-paced request stream regardless of how many users hit the cobalt instance simultaneously.

---

## Summary table

| # | Change | File(s) | Impact | Effort |
|---|--------|---------|--------|--------|
| 1 | Fix `Sec-Ch-Ua` version mismatch | `instagram.js` | 🔴 High — removes obvious static inconsistency | ~10 min |
| 2 | TLS cipher shuffle per-request | `randomize-ciphers.js`, `instagram.js`, `tiktok.js` | 🔴 High — new TLS fingerprint on every connection | ~15 min |
| 3 | Dynamic User-Agent pool | `config.js`, `instagram.js`, `tiktok.js` | 🔴 High — breaks UA + platform fingerprint | ~30 min |
| 4 | Add `dispatcher` to TikTok fetches | `tiktok.js` | 🟡 Medium — ensures proxy config actually applies | ~10 min |
| 5 | Cookie pool for TikTok | `manager.js`, `tiktok.js`, `cookies.example.json` | 🟡 Medium — unlocks age-gated/restricted content | ~15 min |
| 6 | Dynamic `Accept-Language` | `instagram.js`, `tiktok.js`, `utils.js` | 🟡 Medium — removes static geographic fingerprint | ~15 min |
| 7 | Explicit `Accept-Encoding` | `instagram.js`, `tiktok.js` | 🟢 Low — closes minor HTTP header gap | ~5 min |
| 8 | Jitter delay between IG fallbacks | `instagram.js` | 🟢 Low — humanises request timing | ~10 min |
| 9 | Per-IP rate limiting | `api.js` | 🔴 High — prevents individual clients burning quota | ~15 min |
| 10 | In-process result cache | `result-cache.js`, `match.js` | 🔴 High — up to 95% reduction in upstream calls | ~30 min |
| 11 | Exponential backoff on 429/5xx | `utils.js`, `instagram.js`, `tiktok.js` | 🟡 Medium — converts hard failures to recoverable delays | ~20 min |
| 12 | Per-service concurrency queue | `request-queue.js`, `match.js` | 🔴 High — cap concurrent upstream connections to ~2 req/s | ~30 min |

| # | Change | File(s) | Impact | Effort |
|---|--------|---------|--------|--------|
| 1 | Fix `Sec-Ch-Ua` version mismatch | `instagram.js` | 🔴 High — removes obvious static inconsistency | ~10 min |
| 2 | TLS cipher shuffle per-request | `randomize-ciphers.js`, `instagram.js`, `tiktok.js` | 🔴 High — new TLS fingerprint on every connection | ~15 min |
| 3 | Dynamic User-Agent pool | `config.js`, `instagram.js`, `tiktok.js` | 🔴 High — breaks UA + platform fingerprint | ~30 min |
| 4 | Add `dispatcher` to TikTok fetches | `tiktok.js` | 🟡 Medium — ensures proxy config actually applies | ~10 min |
| 5 | Cookie pool for TikTok | `manager.js`, `tiktok.js`, `cookies.example.json` | 🟡 Medium — unlocks age-gated/restricted content | ~15 min |
| 6 | Dynamic `Accept-Language` | `instagram.js`, `tiktok.js`, `utils.js` | 🟡 Medium — removes static geographic fingerprint | ~15 min |
| 7 | Explicit `Accept-Encoding` | `instagram.js`, `tiktok.js` | 🟢 Low — closes minor HTTP header gap | ~5 min |
| 8 | Jitter delay between IG fallbacks | `instagram.js` | 🟢 Low — humanises request timing | ~10 min |

### Recommended implementation order
1. Item 1 (quickest fix, highest visibility)
2. Items 2 + 3 together (both touch the same call-sites, do them in one pass)
3. Item 4 (one-liner per fetch in tiktok.js)
4. Items 6 + 7 together (both are header additions)
5. Item 5 (requires cookie file update + testing)
6. Item 8 (last of the fingerprint fixes, lowest risk)
7. Item 10 (cache — biggest volume reduction, implement before increasing traffic)
8. Item 9 (rate limit — protects the instance from abusive clients)
9. Item 11 (backoff — makes the whole chain resilient to transient 429s)
10. Item 12 (queue — final safeguard, caps aggregate concurrency to Instagram/TikTok)
