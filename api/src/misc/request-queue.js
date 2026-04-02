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

        if (this.#queue.length === 0) return;

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
