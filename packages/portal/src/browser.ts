import { chromium, type Browser } from "playwright";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared Playwright browser management for the portal adapter fleet.
 *
 * The preinstalled browser build under $PLAYWRIGHT_BROWSERS_PATH may not match
 * the revision the pinned Playwright client expects (env is 1194; client wants
 * 1187), so we resolve the chromium executable path ourselves and pass it to
 * chromium.launch({ executablePath }) — robust against that mismatch.
 *
 * One browser instance is reused across all fetches (TDD §3.4: Chromium
 * workers, one context per session). Call closeBrowser() at teardown.
 */

let browserPromise: Promise<Browser> | null = null;

/** Robustly resolve a launchable chromium binary under PLAYWRIGHT_BROWSERS_PATH. */
export function resolveChromiumExecutable(): string | undefined {
  // 1) explicit override
  if (process.env.CHROMIUM_EXECUTABLE_PATH && existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  // Default to the well-known preinstall location if the env var is unset.
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH &&
    existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : existsSync("/opt/pw-browsers")
        ? "/opt/pw-browsers"
        : undefined;
  if (!root) {
    // Let Playwright resolve from its own cache.
    return undefined;
  }

  // 2) common stable locations first (symlink or headed build).
  const preferred = [
    join(root, "chromium", "chrome-linux", "chrome"),
    join(root, "chromium-linux", "chrome"),
  ];
  for (const p of preferred) if (existsSync(p)) return p;

  // 3) scan for any chromium* build dir -> chrome-linux/chrome (headed) or
  //    chrome-linux/headless_shell (headless shell). Prefer full chrome.
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }
  const chromiumDirs = entries
    .filter((e) => e.startsWith("chromium") && !e.startsWith("chromium_headless"))
    .concat(entries.filter((e) => e.startsWith("chromium_headless")));
  for (const dir of chromiumDirs) {
    const base = join(root, dir, "chrome-linux");
    for (const bin of ["chrome", "headless_shell"]) {
      const p = join(base, bin);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        /* keep scanning */
      }
    }
  }
  return undefined;
}

export async function launchBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = resolveChromiumExecutable();
    browserPromise = chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}
