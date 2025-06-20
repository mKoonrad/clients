// eslint-disable-next-line no-restricted-imports
import { CommonModule } from "@angular/common";
// eslint-disable-next-line no-restricted-imports
import { Component, OnDestroy, OnInit } from "@angular/core";
// eslint-disable-next-line no-restricted-imports
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
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
    ReactiveFormsModule,
    FormFieldModule,
    AsyncActionsModule,
    CheckboxModule,
    ButtonModule,
    RouterModule,
  ],
})
export class PhishingWarning implements OnInit, OnDestroy {
  formGroup = this.formBuilder.group({
    phishingHost: [""],
  });

  private destroy$ = new Subject<void>();

  constructor(
    private activatedRoute: ActivatedRoute,
    private formBuilder: FormBuilder,
  ) {}

  async ngOnInit(): Promise<void> {
    this.activatedRoute.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.formGroup.patchValue({ phishingHost: params.get("phishingHost") });
      this.formGroup.get("phishingHost")?.disable();
    });
  }
  closeTab(): void {
    globalThis.close();
  }
  continueAnyway(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
