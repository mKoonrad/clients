import { Injectable, OnDestroy } from "@angular/core";
import { combineLatest, map, Observable, Subject, takeUntil } from "rxjs";

import { DeviceType } from "@bitwarden/common/enums";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import {
  GlobalStateProvider,
  AUTOTYPE_SETTINGS_DISK,
  KeyDefinition,
} from "@bitwarden/common/platform/state";

import { DesktopSettingsService } from "../../platform/services/desktop-settings.service";

export const AUTOTYPE_ENABLED = new KeyDefinition<boolean>(
  AUTOTYPE_SETTINGS_DISK,
  "autotypeEnabled",
  { deserializer: (b) => b },
);

@Injectable({
  providedIn: "root",
})
export class DesktopAutotypeService implements OnDestroy {
  private readonly autotypeEnabledState = this.globalStateProvider.get(AUTOTYPE_ENABLED);
  private readonly isWindows = this.platformUtilsService.getDevice() === DeviceType.WindowsDesktop;
  private previouslyEnabled = false;
  private destroy$ = new Subject<void>();

  autotypeEnabled$: Observable<boolean>;

  constructor(
    private configService: ConfigService,
    private desktopSettingsService: DesktopSettingsService,
    private globalStateProvider: GlobalStateProvider,
    private platformUtilsService: PlatformUtilsService,
  ) {
    if (this.isWindows) {
      this.autotypeEnabled$ = combineLatest([
        this.autotypeEnabledState.state$,
        this.configService.getFeatureFlag$(FeatureFlag.WindowsDesktopAutotype),
      ])
        .pipe(takeUntil(this.destroy$))
        .pipe(
          map(([autotypeEnabled, windowsDesktopAutotypeFeatureFlag]) => {
            const enabled = autotypeEnabled && windowsDesktopAutotypeFeatureFlag;

            if (enabled === true && this.previouslyEnabled === false) {
              this.enableAutotype();
            } else if (enabled === false && this.previouslyEnabled === true) {
              this.disableAutotype();
            }

            this.previouslyEnabled = enabled;
            return enabled;
          }),
        );
    }
  }

  init() {}

  async setAutotypeEnabledState(enabled: boolean): Promise<void> {
    await this.autotypeEnabledState.update(() => enabled, {
      shouldUpdate: (currentlyEnabled) => currentlyEnabled !== enabled,
    });
  }

  // TODO: this will call into desktop native code
  private enableAutotype() {
    // eslint-disable-next-line no-console
    console.log("Enabling Autotype...");
  }

  // TODO: this will call into desktop native code
  private disableAutotype() {
    // eslint-disable-next-line no-console
    console.log("Disabling Autotype...");
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
