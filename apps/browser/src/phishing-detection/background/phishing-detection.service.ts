import { mergeMap, Subscription } from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { EventCollectionService } from "@bitwarden/common/abstractions/event/event-collection.service";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { AbstractStorageService } from "@bitwarden/common/platform/abstractions/storage.service";
import { ScheduledTaskNames } from "@bitwarden/common/platform/scheduling";
import { TaskSchedulerService } from "@bitwarden/common/platform/scheduling/task-scheduler.service";

export class PhishingDetectionService {
  private static knownPhishingDomains = new Set<string>();
  private static lastUpdateTime: number = 0;
  private static readonly UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private static readonly RETRY_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_RETRIES = 3;
  private static readonly STORAGE_KEY = "phishing_domains_cache";
  private static auditService: AuditService;
  private static logService: LogService;
  private static storageService: AbstractStorageService;
  private static taskSchedulerService: TaskSchedulerService;
  private static updateCacheSubscription: Subscription | null = null;
  private static retrySubscription: Subscription | null = null;
  private static isUpdating = false;
  private static retryCount = 0;
  private static lastPhishingTabId: number | null = null;

  static initialize(
    configService: ConfigService,
    auditService: AuditService,
    logService: LogService,
    storageService: AbstractStorageService,
    taskSchedulerService: TaskSchedulerService,
    eventCollectionService: EventCollectionService,
  ): void {
    logService.info("Phishing DEBUG: initialize called");
    configService
      .getFeatureFlag$(FeatureFlag.PhishingDetection)
      .pipe(
        mergeMap(async (enabled) => {
          if (!enabled) {
            logService.info("phishing detection feature flag is disabled.");
          }
          await PhishingDetectionService.enable(
            auditService,
            logService,
            storageService,
            taskSchedulerService,
          );
        }),
      )
      .subscribe();
  }

  static async enable(
    auditService: AuditService,
    logService: LogService,
    storageService: AbstractStorageService,
    taskSchedulerService: TaskSchedulerService,
  ): Promise<void> {
    PhishingDetectionService.auditService = auditService;
    PhishingDetectionService.logService = logService;
    PhishingDetectionService.storageService = storageService;
    PhishingDetectionService.taskSchedulerService = taskSchedulerService;

    PhishingDetectionService.setupListeners();

    // Register the update task
    this.taskSchedulerService.registerTaskHandler(
      ScheduledTaskNames.phishingDomainUpdate,
      async () => {
        try {
          await this.updateKnownPhishingDomains();
        } catch (error) {
          this.logService.error("Failed to update phishing domains in task handler:", error);
        }
      },
    );

    // Initial load of cached domains
    await this.loadCachedDomains();

    // Set up periodic updates every 24 hours
    this.setupPeriodicUpdates();

    PhishingDetectionService.logService.info("Phishing detection feature is initialized.");
  }

  private static setupPeriodicUpdates() {
    // Clean up any existing subscriptions
    if (this.updateCacheSubscription) {
      this.updateCacheSubscription.unsubscribe();
    }
    if (this.retrySubscription) {
      this.retrySubscription.unsubscribe();
    }

    this.updateCacheSubscription = this.taskSchedulerService.setInterval(
      ScheduledTaskNames.phishingDomainUpdate,
      this.UPDATE_INTERVAL,
    );
  }

  private static scheduleRetry() {
    // If we've exceeded max retries, stop retrying
    if (this.retryCount >= this.MAX_RETRIES) {
      this.logService.warning(
        `Max retries (${this.MAX_RETRIES}) reached for phishing domain update. Will try again in ${this.UPDATE_INTERVAL / (1000 * 60 * 60)} hours.`,
      );
      this.retryCount = 0;
      if (this.retrySubscription) {
        this.retrySubscription.unsubscribe();
        this.retrySubscription = null;
      }
      return;
    }

    // Clean up existing retry subscription if any
    if (this.retrySubscription) {
      this.retrySubscription.unsubscribe();
    }

    // Increment retry count
    this.retryCount++;

    // Schedule a retry in 5 minutes
    this.retrySubscription = this.taskSchedulerService.setInterval(
      ScheduledTaskNames.phishingDomainUpdate,
      this.RETRY_INTERVAL,
    );

    this.logService.info(
      `Scheduled retry ${this.retryCount}/${this.MAX_RETRIES} for phishing domain update in ${this.RETRY_INTERVAL / (1000 * 60)} minutes`,
    );
  }

  private static async loadCachedDomains() {
    try {
      const cachedData = await this.storageService.get<{ domains: string[]; timestamp: number }>(
        this.STORAGE_KEY,
      );
      if (cachedData) {
        PhishingDetectionService.logService.info("Phishing cachedData exists");
        this.knownPhishingDomains = new Set(cachedData.domains);
        this.lastUpdateTime = cachedData.timestamp;
      }
      PhishingDetectionService.logService.info("Phishing Adding test.com");
      this.knownPhishingDomains = new Set(["www.test.com", "www.example.com"]);
      // If cache is empty or expired, trigger an immediate update
      if (
        this.knownPhishingDomains.size === 0 ||
        Date.now() - this.lastUpdateTime >= this.UPDATE_INTERVAL
      ) {
        await this.updateKnownPhishingDomains();
      }
    } catch (error) {
      // create new set for knownPhishingDomains here
      PhishingDetectionService.logService.info("Phishing Load Cached Domains Error");

      this.logService.error("Failed to load cached phishing domains:", error);
    }
  }

  static checkUrl(inputUrl: string): boolean {
    PhishingDetectionService.logService.info("Phishing DEBUG: checkUrl is running");
    PhishingDetectionService.knownPhishingDomains.forEach((item) => {
      PhishingDetectionService.logService.info(
        "Phishing DEBUG - knownPhishingDomains item: " + item,
      );
    });

    const url = new URL(inputUrl);

    return url ? PhishingDetectionService.knownPhishingDomains.has(url.hostname) : false;
  }

  static async updateKnownPhishingDomains(): Promise<void> {
    // Prevent concurrent updates
    if (this.isUpdating) {
      this.logService.warning("Update already in progress, skipping...");
      return;
    }

    this.isUpdating = true;
    try {
      this.logService.info("Starting phishing domains update...");
      const domains = await PhishingDetectionService.auditService.getKnownPhishingDomains();
      this.logService.info("Received phishing domains response");

      // Clear old domains to prevent memory leaks
      PhishingDetectionService.knownPhishingDomains.clear();

      // Add new domains
      domains.forEach((domain: string) => {
        if (domain) {
          // Only add valid domains
          PhishingDetectionService.knownPhishingDomains.add(domain);
        }
      });

      PhishingDetectionService.lastUpdateTime = Date.now();

      // Cache the updated domains
      await this.storageService.save(this.STORAGE_KEY, {
        domains: Array.from(this.knownPhishingDomains),
        timestamp: this.lastUpdateTime,
      });

      // Reset retry count and clear retry subscription on success
      this.retryCount = 0;
      if (this.retrySubscription) {
        this.retrySubscription.unsubscribe();
        this.retrySubscription = null;
      }

      this.logService.info(
        `Successfully updated phishing domains cache with ${this.knownPhishingDomains.size} domains`,
      );
    } catch (error) {
      this.logService.error("Error details:", error);

      this.scheduleRetry();
    } finally {
      this.isUpdating = false;
    }
  }

  static cleanup() {
    if (this.updateCacheSubscription) {
      this.updateCacheSubscription.unsubscribe();
      this.updateCacheSubscription = null;
    }
    if (this.retrySubscription) {
      this.retrySubscription.unsubscribe();
      this.retrySubscription = null;
    }
    this.knownPhishingDomains.clear();
    this.lastUpdateTime = 0;
    this.isUpdating = false;
    this.retryCount = 0;
  }

  static setupListeners(): void {
    const handleCloseTab = async (sendResponse: (response: any) => void) => {
      sendResponse("Closing Tab");
    };
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
      PhishingDetectionService.logService.info("Phishing DEBUG: received a message " + message);
      if (message.command === "closePhishingWarningPage") {
        await handleCloseTab(sendResponse);
      }
    });
    chrome.webNavigation.onCompleted.addListener(
      (details: chrome.webNavigation.WebNavigationFramedCallbackDetails): void => {
        const url = new URL(details.url);
        const result = PhishingDetectionService.knownPhishingDomains.has(url.hostname);

        PhishingDetectionService.logService.info(
          "Phishing DEBUG: setupListeners phish detect check result " + result,
        );
        PhishingDetectionService.knownPhishingDomains.forEach((item) => {
          PhishingDetectionService.logService.info(
            "Phishing DEBUG - knownPhishingDomains item: " + item,
          );
        });
        this.logService.debug("Phishing detection check", {
          details,
          result,
          url,
        });

        if (result) {
          PhishingDetectionService.RedirectToWarningPage(url.hostname, details.tabId);
        }
      },
    );
  }

  static RedirectToWarningPage(hostname: string, tabId: number) {
    PhishingDetectionService.logService.debug("Redirecting to warning page.");

    const phishingWarningPage = chrome.runtime.getURL(
      "popup/index.html#/security/phishing-warning",
    );

    const pageWithViewData = `${phishingWarningPage}?phishingHost=${hostname}`;

    // Save a reference to the tabId for later use (e.g., to close the warning page)
    PhishingDetectionService.lastPhishingTabId = tabId;
    PhishingDetectionService.logService.info(
      "PhishingDetectionService RedirectToWarningPage called",
      tabId,
      PhishingDetectionService.lastPhishingTabId,
    );

    chrome.tabs
      .update(tabId, { url: pageWithViewData })
      .catch((error) =>
        PhishingDetectionService.logService.error(
          "Failed to redirect away from the phishing site.",
          { error },
        ),
      );
  }

  static requestClosePhishingWarningPage(): void {
    // [Note] Errored as undefined
    // PhishingDetectionService.logService.info(
    //   "[PhishingDetectionService] requestClosePhishingWarningPage called, with last tab Id",
    //   PhishingDetectionService.lastPhishingTabId,
    // );
    // [Note] Errors as undefined
    chrome.tabs
      .sendMessage(PhishingDetectionService.lastPhishingTabId, {
        command: "closePhishingWarningPage",
      })
      .then((response) => {
        PhishingDetectionService.logService.info(
          "[PhishingWarning] Response from closePhishingWarningPage:",
          response,
        );
      })
      .catch((error) => {
        PhishingDetectionService.logService.error("[PhishingWarning] Failed to close tab", {
          error,
        });
      });
    // chrome.runtime.sendMessage({ message: "closePhishingWarningPage" }).catch((error) => {
    //   PhishingDetectionService.logService.error(
    //     "[PhishingDetectionService] Failed to request tab close",
    //     { error },
    //   );
    // });
  }

  static closePhishingWarningPage(): void {
    // this.logService.info(
    //   "[PhishingDetectionService] tabid on close request",
    //   PhishingDetectionService.lastPhishingTabId,
    // );
    // [Note] For now, try to close the current active tab
    // [Note] Errors with chrome.tabs.query is undefined
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        PhishingDetectionService.logService.info("[PhishingDetectionService] tabs found", tabs);
        return chrome.tabs.remove(tabs[0].id).catch((error) => {
          PhishingDetectionService.logService?.error?.("Failed to close phishing warning page.", {
            error,
          });
        });
      })
      .catch((error) => {
        PhishingDetectionService.logService?.error?.(
          "Failed to query tabs for closing phishing warning page.",
          {
            error,
          },
        );
      });

    // [Note] First method of closing tab by capturing the tabId when redirecting
    // if (this.lastPhishingTabId === null) {
    //   // this.logService.error("No phishing warning tab to close.");
    //   return;
    // }
    // // this.logService.debug("Closing phishing tab.");
    // chrome.tabs
    //   .remove(this.lastPhishingTabId)
    //   .catch((error) => this.logService.error("Failed to close phishing warning page.", { error }));
  }
}
