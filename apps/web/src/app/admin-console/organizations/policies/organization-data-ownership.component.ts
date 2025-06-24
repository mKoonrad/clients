import { Component, OnInit, TemplateRef, ViewChild } from "@angular/core";
import { firstValueFrom, lastValueFrom, Observable } from "rxjs";

import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService } from "@bitwarden/components";

import { BasePolicy, BasePolicyComponent } from "./base-policy.component";

export class OrganizationDataOwnershipPolicy extends BasePolicy {
  name = "organizationDataOwnership";
  description = "personalOwnershipPolicyDesc";
  type = PolicyType.OrganizationDataOwnership;
  component = OrganizationDataOwnershipPolicyComponent;
}

export class vNextOrganizationDataOwnershipPolicy extends BasePolicy {
  name = "organizationDataOwnership";
  description = "organizationDataOwnershipDesc";
  type = PolicyType.OrganizationDataOwnership;
  component = OrganizationDataOwnershipPolicyComponent;
  showDescription = false;
}

@Component({
  selector: "policy-organization-data-ownership",
  templateUrl: "organization-data-ownership.component.html",
  standalone: false,
})
export class OrganizationDataOwnershipPolicyComponent
  extends BasePolicyComponent
  implements OnInit
{
  createDefaultLocation$: Observable<boolean>;

  constructor(
    private dialogService: DialogService,
    private i18nService: I18nService,
    configService: ConfigService,
  ) {
    super();
    this.createDefaultLocation$ = configService.getFeatureFlag$(FeatureFlag.CreateDefaultLocation);
  }

  @ViewChild("dialog", { static: true }) warningContent!: TemplateRef<unknown>;

  async buildRequest() {
    if (
      (await firstValueFrom(this.createDefaultLocation$)) &&
      this.policyResponse?.enabled &&
      this.policyResponse?.enabled != this.enabled.value
    ) {
      const dialogRef = this.dialogService.open(this.warningContent);
      const result = await lastValueFrom(dialogRef.closed);

      if (!result) {
        throw new Error(this.i18nService.t("canceled"));
      }
    }

    return super.buildRequest();
  }
}
