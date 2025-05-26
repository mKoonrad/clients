import { Utils } from "@bitwarden/common/platform/misc/utils";
import { EncString } from "@bitwarden/common/platform/models/domain/enc-string";

import { SignedPublicKeyOwnershipClaim } from "../../types";

export class AsymmetricEncryptionDataResponse {
  readonly publicKey: Uint8Array;
  readonly wrappedPrivateKey: EncString;
  readonly signedPublicKeyOwnershipClaim: SignedPublicKeyOwnershipClaim;

  constructor(response: any) {
    this.publicKey = Utils.fromB64ToArray(response.publicKey);
    this.wrappedPrivateKey = new EncString(response.wrappedPrivateKey);
    this.signedPublicKeyOwnershipClaim = response.signedPublicKeyOwnershipClaim;
  }
}
