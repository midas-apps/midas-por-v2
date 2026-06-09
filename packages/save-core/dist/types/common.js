/**
 * Common types used throughout the SAVE library
 */
/**
 * Runtime validation for HexString.
 * Checks that the string starts with '0x' and contains only valid hex characters.
 * @throws {Error} If the string is not a valid hex string
 */
export function assertHexString(value, fieldName = 'value') {
    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string, got ${typeof value}`);
    }
    if (!value.startsWith('0x')) {
        throw new Error(`${fieldName} must start with '0x', got: ${value}`);
    }
    if (!/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`${fieldName} contains invalid hex characters: ${value}`);
    }
}
/**
 * Type guard for HexString with runtime validation.
 * Returns true if the value is a valid hex string, false otherwise.
 */
export function isHexString(value) {
    try {
        assertHexString(value);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Default HttpClient implementation using fetch().
 * Used automatically when no custom HttpClient is provided (e.g. CLI usage).
 */
export class FetchHttpClient {
    async post(url, body, headers) {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body,
        });
        const responseBody = await response.text();
        return { status: response.status, body: responseBody };
    }
}
//# sourceMappingURL=common.js.map