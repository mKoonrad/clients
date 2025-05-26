/**
 * A base64 encoded proof that a signing key identity claims ownership of a public encryption key
 * Specifically, a claimer, signs a message with their signing key, where the message says (in part):
 *  - "I own publicKey XYZ"
 * This shows that a user/signing identity wants to receive confidential data to this public key.
 */
export type SignedPublicKeyOwnershipClaim = string;
