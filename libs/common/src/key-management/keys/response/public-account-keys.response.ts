import { SignedPublicKey } from "@bitwarden/sdk-internal";

import { UnsignedPublicKey, VerifyingKey } from "../../types";

export class PublicAccountKeysResponseModel {
  readonly publicKey: UnsignedPublicKey;
  readonly verifyingKey: VerifyingKey | null;
  readonly signedPublicKey?: SignedPublicKey | null;

  constructor(response: unknown) {
    if (typeof response !== "object" || response === null) {
      throw new TypeError("Response must be an object");
    }

    if (!("publicKey" in response) || !(response.publicKey instanceof Uint8Array)) {
      throw new TypeError("Response must contain a valid publicKey");
    }
    this.publicKey = response.publicKey as UnsignedPublicKey;

    if ("verifyingKey" in response && typeof response.verifyingKey === "string") {
      this.verifyingKey = response.verifyingKey as VerifyingKey;
    } else {
      this.verifyingKey = null;
    }

    if ("signedPublicKey" in response && typeof response.signedPublicKey === "string") {
      this.signedPublicKey = response.signedPublicKey as SignedPublicKey;
    } else {
      this.signedPublicKey = null;
    }

    if (
      (this.signedPublicKey !== null && this.verifyingKey === null) ||
      (this.signedPublicKey === null && this.verifyingKey !== null)
    ) {
      throw new TypeError(
        "Both signedPublicKey and verifyingKey must be present or absent together",
      );
    }
  }
}
