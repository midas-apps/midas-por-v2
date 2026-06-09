/**
 * SAVE Library Version and Schema Constants
 */
/** Current version of the SAVE library */
export declare const SAVE_VERSION = "0.1.0";
/** Current schema identifier */
export declare const SAVE_SCHEMA = "save-v0";
/**
 * Validate that an attestation's version/schema is compatible with this library.
 * Throws if schema doesn't match or major version differs.
 *
 * @param schema - The schema string from the attestation (e.g. 'save-v0')
 * @param version - The version string from the attestation (e.g. '0.1.0')
 */
export declare function checkAttestationVersion(schema?: string, version?: string): void;
//# sourceMappingURL=version.d.ts.map