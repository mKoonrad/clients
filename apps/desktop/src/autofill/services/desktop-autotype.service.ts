// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Injectable, OnDestroy } from "@angular/core";
import { firstValueFrom, Subject } from "rxjs";

import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";

import { DesktopSettingsService } from "../../platform/services/desktop-settings.service";

@Injectable({
  providedIn: "root",
})
export class DesktopAutotypeService implements OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    private cipherService: CipherService,
    private logService: LogService,
    private desktopSettingsService: DesktopSettingsService,
  ) {}

  async init() {
    let autotypeEnabled = await firstValueFrom(this.desktopSettingsService.autotypeEnabled$);
    console.log("Is Autotype enabled? -> " + autotypeEnabled);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
