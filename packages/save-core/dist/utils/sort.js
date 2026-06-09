/**
 * Deep object key sorting utility
 *
 * Extracted from crypto/ecdsa.ts to break the cross-layer dependency
 * (types/ → crypto/). This is a pure algorithmic utility with no
 * cryptographic dependencies.
 */
/**
 * Deep sort object keys for canonical serialization.
 * Ensures deterministic JSON output regardless of insertion order.
 *
 * @param obj - Object to sort
 * @returns New object with sorted keys at all nesting levels
 */
export function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }
    const sorted = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
        sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
}
//# sourceMappingURL=sort.js.map