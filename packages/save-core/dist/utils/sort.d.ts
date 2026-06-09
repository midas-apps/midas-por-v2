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
export declare function sortObjectKeys<T>(obj: T): T;
//# sourceMappingURL=sort.d.ts.map