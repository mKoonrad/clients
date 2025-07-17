import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { Utils } from "@bitwarden/common/platform/misc/utils";

import { SignedPublicKey } from "../../types";

export class PublicKeyEncryptionKeyPairResponse {
  readonly publicKey: Uint8Array;
  readonly wrappedPrivateKey: EncString;
  readonly signedPublicKey: SignedPublicKey;

  constructor(response: any) {
    this.publicKey = Utils.fromB64ToArray(response.publicKey);
    this.wrappedPrivateKey = new EncString(response.wrappedPrivateKey);
    this.signedPublicKey = response.signedPublicKey;
  }
}
