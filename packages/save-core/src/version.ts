/**
 * SAVE Library Version and Schema Constants
 */

/** Current version of the SAVE library */
export const SAVE_VERSION = '0.1.0';

/** Current schema identifier */
export const SAVE_SCHEMA = 'save-v0';

/**
 * Validate that an attestation's version/schema is compatible with this library.
 * Throws if schema doesn't match or major version differs.
 *
 * @param schema - The schema string from the attestation (e.g. 'save-v0')
 * @param version - The version string from the attestation (e.g. '0.1.0')
 */
export function checkAttestationVersion(schema?: string, version?: string): void {
  if (schema && schema !== SAVE_SCHEMA) {
    throw new Error(
      `Incompatible attestation schema: "${schema}" (this library supports "${SAVE_SCHEMA}")`
    );
  }

  if (version) {
    const attMajor = version.split('.')[0];
    const libMajor = SAVE_VERSION.split('.')[0];
    if (attMajor !== libMajor) {
      throw new Error(
        `Incompatible attestation version: "${version}" (this library is v${SAVE_VERSION}, major version ${libMajor})`
      );
    }
  }
}
