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
export function sortObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as T;
  }
  
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as object).sort();
  
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  
  return sorted as T;
}
