import type { BrowserContext, Page } from "playwright";
import type { ArtifactStore, RawCapture, SubscriberQuery } from "@nightshift/schema";
import { launchBrowser } from "./browser.js";

/**
 * PayerAdapter interface (mirrors docs/API-CONTRACT.md "Portal adapter contract").
 * Adapters CAPTURE raw artifacts only — extraction is a separate pipeline stage
 * (capture-then-extract, TDD §3.4).
 */
export interface PayerAdapter {
  payerKey: string;
  capabilities(): Record<string, boolean>;
  fetchBreakdown(q: SubscriberQuery, deps: { artifacts: ArtifactStore }): Promise<RawCapture[]>;
}

/** dev creds — same office login for every mock payer (from SEED-UNIVERSE.json). */
export const PORTAL_CREDENTIALS = {
  username: "office@cedarpark.example",
  password: "verify123!",
};

function portalUrl(): string {
  return (process.env.PORTAL_URL ?? "http://127.0.0.1:4300").replace(/\/+$/, "");
}

/**
 * In-memory session cache: payerKey -> Playwright storageState (cookies).
 * Repeated fetches for the same payer skip the login step (TDD §3.4 session
 * persistence). Cleared by resetSessions() (used by tests / kill-switch).
 */
const sessionCache = new Map<string, unknown>();
export function resetSessions(): void {
  sessionCache.clear();
}

export interface MockAdapterConfig {
  payerKey: string;
  capabilities: Record<string, boolean>;
  /** meaningful pages to capture, in order. history is delta-only. */
  pages: Array<"benefits" | "history">;
}

/**
 * Shared implementation driving the mock (and, structurally, real) payer portal:
 * login -> member search -> capture each meaningful page as screenshot + DOM.
 */
export class MockPortalAdapter implements PayerAdapter {
  readonly payerKey: string;
  private readonly caps: Record<string, boolean>;
  private readonly pages: Array<"benefits" | "history">;

  constructor(cfg: MockAdapterConfig) {
    this.payerKey = cfg.payerKey;
    this.caps = cfg.capabilities;
    this.pages = cfg.pages;
  }

  capabilities(): Record<string, boolean> {
    return { ...this.caps };
  }

  async fetchBreakdown(
    q: SubscriberQuery,
    deps: { artifacts: ArtifactStore },
  ): Promise<RawCapture[]> {
    const browser = await launchBrowser();
    const cached = sessionCache.get(this.payerKey);
    const context = await browser.newContext(
      cached ? { storageState: cached as never } : undefined,
    );
    try {
      const page = await context.newPage();
      await this.ensureLoggedIn(context, page);

      // Member search — a miss returns [] (portal-miss → API fallback).
      const searchUrl = `${portalUrl()}/${this.payerKey}/members?subscriberId=${encodeURIComponent(
        q.subscriberId,
      )}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      // If the session expired mid-flight we may be bounced to login.
      if (page.url().includes("/login")) {
        await this.doLogin(context, page);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      }
      const searchHtml = await page.content();
      if (/No member found/i.test(searchHtml)) {
        return [];
      }

      const captures: RawCapture[] = [];
      for (const pageName of this.pages) {
        const url = `${portalUrl()}/${this.payerKey}/member/${encodeURIComponent(
          q.subscriberId,
        )}/${pageName}`;
        const resp = await page.goto(url, { waitUntil: "networkidle" });
        // history may legitimately 404 on sparse payers — skip, don't capture.
        if (resp && resp.status() >= 400) continue;

        const capture = await this.capturePage(page, deps.artifacts, pageName);
        captures.push(capture);
      }
      return captures;
    } finally {
      await context.close().catch(() => {});
    }
  }

  private async ensureLoggedIn(context: BrowserContext, page: Page): Promise<void> {
    if (sessionCache.has(this.payerKey)) return; // reuse cached storageState
    await this.doLogin(context, page);
  }

  private async doLogin(context: BrowserContext, page: Page): Promise<void> {
    await page.goto(`${portalUrl()}/${this.payerKey}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="username"]', PORTAL_CREDENTIALS.username);
    await page.fill('input[name="password"]', PORTAL_CREDENTIALS.password);
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click('button[type="submit"]'),
    ]);
    if (page.url().includes("/login")) {
      throw new Error(`[${this.payerKey}] portal login failed (invalid credentials or portal down)`);
    }
    // Persist cookies for reuse across fetches.
    sessionCache.set(this.payerKey, await context.storageState());
  }

  private async capturePage(
    page: Page,
    artifacts: ArtifactStore,
    pageName: "benefits" | "history",
  ): Promise<RawCapture> {
    const png = await page.screenshot({ fullPage: true });
    const html = await page.content();

    const screenshotId = await artifacts.put({
      kind: "screenshot",
      contentType: "image/png",
      data: png,
    });
    const domId = await artifacts.put({
      kind: "dom",
      contentType: "text/html",
      data: html,
    });

    return {
      kind: "portal_page",
      payerKey: this.payerKey,
      artifactIds: [screenshotId, domId],
      content: html,
      capturedAt: new Date().toISOString(),
      meta: {
        pageName,
        url: page.url(),
        screenshotArtifactId: screenshotId,
        domArtifactId: domId,
      },
    };
  }
}
