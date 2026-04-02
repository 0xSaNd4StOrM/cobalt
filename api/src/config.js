import { getVersion } from "@imput/version-info";
import { loadEnvs, validateEnvs } from "./core/env.js";

const version = await getVersion();

const canonicalEnv = Object.freeze(structuredClone(process.env));
const env = loadEnvs();

const genericUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const userAgentPool = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
];

export const getRandomUserAgent = () =>
    userAgentPool[Math.floor(Math.random() * userAgentPool.length)];

const acceptLanguagePool = [
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
    acceptLanguagePool[Math.floor(Math.random() * acceptLanguagePool.length)];

const cobaltUserAgent = `cobalt/${version} (+https://github.com/imputnet/cobalt)`;

export const setTunnelPort = (port) => env.tunnelPort = port;
export const isCluster = env.instanceCount > 1;
export const updateEnv = (newEnv) => {
    const changes = [];

    // tunnelPort is special and needs to get carried over here
    newEnv.tunnelPort = env.tunnelPort;

    for (const key in env) {
        if (key === 'subscribe') {
            continue;
        }

        if (String(env[key]) !== String(newEnv[key])) {
            changes.push(key);
        }
        env[key] = newEnv[key];
    }

    return changes;
}

await validateEnvs(env);

export {
    env,
    canonicalEnv,
    genericUserAgent,
    cobaltUserAgent,
}
