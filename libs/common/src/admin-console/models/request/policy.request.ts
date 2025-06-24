import { PolicyType } from "../../enums";

export class PolicyRequest {
  type: PolicyType | undefined;
  enabled: boolean | undefined;
  data: any;
}
