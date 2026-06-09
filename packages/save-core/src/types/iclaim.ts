/**
 * IClaim - Common interface for all claim types
 * 
 * Provides a unified contract that NumericClaim, StringClaim, and ObjectClaim
 * all implement, enabling polymorphic handling in the DAG and verifier.
 */

import type { ClaimId } from './common.js';
import type { ClaimData } from './claim.js';

/**
 * Common interface for all claim types.
 * 
 * Implementors: NumericClaim, StringClaim, ObjectClaim
 */
export interface IClaim {
  /** Unique identifier for this claim */
  readonly id: ClaimId;

  /** Human-readable description */
  readonly description: string | undefined;

  /** Whether this is an inline claim (data + proof bundled) */
  readonly isInline: boolean;

  /** Whether this claim derives its value from an object claim pointer */
  readonly isSourceBacked: boolean;

  /** Whether this claim computes its value via aggregation of other claims */
  readonly isAggregated: boolean;

  /** Whether this is a primitive (leaf) node in the DAG */
  readonly isPrimitive: boolean;

  /** Whether this is a composite node in the DAG */
  readonly isComposite: boolean;

  /** Whether the claim has been fully resolved */
  readonly isResolved: boolean;

  /** IDs of all claims this claim depends on */
  readonly dependencies: ClaimId[];

  /** Export claim to serializable data format */
  toData(): ClaimData;
}
