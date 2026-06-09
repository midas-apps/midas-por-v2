/**
 * Proof implementations
 */

export {
  signClaim,
  createSignatureProof,
  getClaimSigningData,
} from './signature.js';

export {
  verifyZkTlsNotaryProof,
  createVlayerProof,
} from './tls-notary.js';

export type { SignClaimOptions } from './signature.js';
export type { ZkTlsNotaryVerificationResult, VerifyZkTlsNotaryOptions } from './tls-notary.js';
