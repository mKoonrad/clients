import { SignedSecurityState } from "../../types";

export class SecurityStateRequest {
  securityState: SignedSecurityState;
  securityVersion: number;

  constructor(securityState: SignedSecurityState, securityVersion: number) {
    this.securityState = securityState;
    this.securityVersion = securityVersion;
  }
}
