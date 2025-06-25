// eslint-disable-next-line no-restricted-imports
import { CommonModule } from "@angular/common";
// eslint-disable-next-line no-restricted-imports
import { Component, OnDestroy } from "@angular/core";
// eslint-disable-next-line no-restricted-imports
import { ActivatedRoute, RouterModule } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  AsyncActionsModule,
  ButtonModule,
  CheckboxModule,
  FormFieldModule,
  IconModule,
  LinkModule,
} from "@bitwarden/components";

@Component({
  standalone: true,
  templateUrl: "phishing-warning.component.html",
  imports: [
    CommonModule,
    IconModule,
    JslibModule,
    LinkModule,
    FormFieldModule,
    AsyncActionsModule,
    CheckboxModule,
    ButtonModule,
    RouterModule,
  ],
})
export class PhishingWarning implements OnDestroy {
  phishingHost = "";

  private destroy$ = new Subject<void>();

  constructor(private activatedRoute: ActivatedRoute) {
    this.activatedRoute.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.phishingHost = params.get("phishingHost");
    });
  }

  closeTab(): void {
    // chrome.runtime.sendMessage({ message: "closePhishingWarningPage" }).catch((error) => {
    //   console.log("[PhishingWarning] Failed to close tab", error);
    //   // PhishingDetectionService.logService.error(
    //   //   "[PhishingDetectionService] Failed to request tab close",
    //   //   { error },
    //   // );
    // });
    // PhishingDetectionService.requestClosePhishingWarningPage();
    // PhishingDetectionService.closePhishingWarningPage();
    // [Note] Errors with Scripts may close only the windows that were opened by them
    globalThis.close();
  }
  continueAnyway(): void {
    globalThis.location.href = this.phishingHost;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
