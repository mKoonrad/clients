import { Directive, OnInit } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { KeyConnectorService } from "@bitwarden/common/key-management/key-connector/abstractions/key-connector.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";

@Directive()
export class ConfirmKeyConnectorDomainComponent implements OnInit {
  loading = true;
  keyConnectorUrl!: string;
  userId!: UserId;

  constructor(
    // TODO remove
    private route: ActivatedRoute,
    private router: Router,
    private logService: LogService,
    private keyConnectorService: KeyConnectorService,
    private messagingService: MessagingService,
    private syncService: SyncService,
    private accountService: AccountService,
  ) {}

  async ngOnInit() {
    try {
      this.userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    } catch {
      this.logService.info("[confirm-key-connector-domain] no active account");
      this.messagingService.send("logout");
      return;
    }

    const confirmationData = await firstValueFrom(
      this.keyConnectorService.requiresDomainConfirmation$(this.userId),
    );
    if (confirmationData == null) {
      this.logService.info("[confirm-key-connector-domain] missing required parameters");
      this.messagingService.send("logout");
      return;
    }

    this.keyConnectorUrl = confirmationData.keyConnectorUrl;

    this.loading = false;
  }

  confirm = async () => {
    await this.keyConnectorService.convertNewSsoUserToKeyConnector(this.userId);

    await this.syncService.fullSync(true);

    this.messagingService.send("loggedIn");

    await this.beforeNavigationConfirmCallback();

    await this.router.navigate(["/"]);
  };

  cancel = async () => {
    this.messagingService.send("logout");
  };

  async beforeNavigationConfirmCallback() {}
}
