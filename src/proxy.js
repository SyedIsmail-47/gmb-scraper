import { Actor } from 'apify';

const RESIDENTIAL = /residential/i;

/**
 * Starting proxy is direct, or datacenter when the user turned Apify Proxy on.
 * Residential groups in the input are ignored until a block forces an escalation.
 * @param {Record<string, unknown> | undefined} proxyConfiguration
 */
export function startingProxy(proxyConfiguration = {}) {
    const groups = Array.isArray(proxyConfiguration.apifyProxyGroups)
        ? proxyConfiguration.apifyProxyGroups.filter((group) => !RESIDENTIAL.test(String(group)))
        : [];
    const useApifyProxy = proxyConfiguration.useApifyProxy === true;

    return {
        tier: useApifyProxy ? 'datacenter' : 'none',
        proxyInput: useApifyProxy
            ? { useApifyProxy: true, ...(groups.length ? { apifyProxyGroups: groups } : {}) }
            : undefined,
    };
}

/** @param {'none' | 'datacenter' | 'residential'} tier */
export function nextProxyTier(tier) {
    if (tier === 'none') return 'datacenter';
    if (tier === 'datacenter') return 'residential';
    return null;
}

const configurations = new Map();

/**
 * A fresh proxy URL for a retry. Created only when a block needs that tier.
 * @param {'datacenter' | 'residential'} tier
 */
export async function proxyUrlForTier(tier) {
    if (!configurations.has(tier)) {
        const proxyInput = tier === 'residential'
            ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
            : { useApifyProxy: true };
        configurations.set(tier, await Actor.createProxyConfiguration(proxyInput));
    }
    const configuration = configurations.get(tier);
    if (!configuration) return undefined;
    return configuration.newUrl();
}
