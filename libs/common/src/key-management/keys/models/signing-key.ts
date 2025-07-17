import { EncString } from "@bitwarden/sdk-internal";

/**
 * Represents a signing key.
 * Internally, this is encrypted and needs an unlocked SDK instance for the correct user
 * to use.
 */
export class WrappedSigningKey {
  private innerKey: EncString;

  constructor(innerKey: string) {
    this.innerKey = innerKey;
  }

  /**
   * Gets the encrypted signing key as an EncString, encrypted
   * by another symmetric key like the user key for the user.
   * @returns The encrypted signing key as an EncString
   */
  inner(): EncString {
    return this.innerKey;
  }

  static fromJson(obj: any): WrappedSigningKey | null {
    if (obj == null) {
      return null;
    }

    return new WrappedSigningKey(obj.signingKey);
  }
}
