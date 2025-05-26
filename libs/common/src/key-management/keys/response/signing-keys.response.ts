import { SigningKey, VerifyingKey } from "@bitwarden/key-management";

export class UserSigningKeyData {
  readonly wrappedSigningKey: SigningKey;
  readonly verifyingKey: VerifyingKey;

  constructor(response: any) {
    this.wrappedSigningKey = new SigningKey(response.wrappedSigningKey);
    this.verifyingKey = new VerifyingKey(response.verifyingKey);
  }
}
