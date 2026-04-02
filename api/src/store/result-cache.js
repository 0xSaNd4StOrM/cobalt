const TTL_MS = 2 * 60 * 1000; // 2 minutes — keeps CDN URLs fresh

const cache = new Map();

function prune() {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.ts > TTL_MS) cache.delete(key);
    }
}

// Remove expired entries every minute
setInterval(prune, 60_000).unref();

export function getCachedResult(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

export function setCachedResult(key, value) {
    cache.set(key, { value, ts: Date.now() });
}
