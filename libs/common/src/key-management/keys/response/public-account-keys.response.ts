import { VerifyingKey } from "@bitwarden/key-management";

import { SignedPublicKeyOwnershipClaim } from "../../types";

export class PublicAccountKeysResponseModel {
  readonly VerifyingKey: VerifyingKey;
  readonly PublicKey: string;
  readonly SignedPublicKeyOwnershipClaim: SignedPublicKeyOwnershipClaim;

  constructor(response: any) {
    this.VerifyingKey = new VerifyingKey(response.verifyingKey);
    this.PublicKey = response.publicKey;
    this.SignedPublicKeyOwnershipClaim = response.signedPublicKeyOwnershipClaim;
  }
}
