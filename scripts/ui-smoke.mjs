import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = 8799;
const origin = "http://127.0.0.1:" + port;
await mkdir("artifacts/ui", { recursive: true });
const server = spawn(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--port", String(port)
], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "true" } });
let logs = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-8000); });
}

async function waitForWorker() {
  for (let i = 0; i < 70; i++) {
    if (server.exitCode !== null) throw new Error("Wrangler exited: " + logs);
    try {
      const response = await fetch(origin + "/", { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return;
    } catch { /* boot */ }
    await delay(500);
  }
  throw new Error("Wrangler did not start: " + logs);
}
async function noOverflow(page, label) {
  const state = await page.evaluate(() => ({
    screenWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  assert.ok(state.documentWidth <= state.screenWidth + 2,
    label + " horizontal overflow: " + JSON.stringify(state));
}

let browser;
try {
  await waitForWorker();
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width <= 390 ? 844 : 900 }, reducedMotion: "reduce"
    });
    const page = await context.newPage();
    for (const route of ["/", "/salas.html", "/solo.html", "/ranking.html", "/como-jogar.html", "/conta.html", "/carteira.html"]) {
      const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 20_000 });
      assert.equal(response?.status(), 200, route + " status");
      assert.ok(await page.locator("h1").first().isVisible(), route + " missing heading");
      await noOverflow(page, width + " " + route);
      if (width === 1440 || width === 390) {
      const slug = route === "/" ? "lobby" : route.replace(/\W+/g, "-");
        await page.screenshot({ path: "artifacts/ui/" + width + "-" + slug + ".png", fullPage: true });
      }
      if (route === "/") {
        assert.equal(await page.locator("#room-directory").isVisible(), true, "homepage shows room lobby");
        assert.equal(await page.locator("#game-area").isVisible(), false, "homepage does not show a blackjack table");
      }
      if (route === "/solo.html") {
        assert.equal(await page.locator(".table").isVisible(), true, "solo has a dedicated table");
        assert.equal(await page.locator(".deck-stack").count(), 1, "solo table shows Clarice's deck");
        assert.equal(await page.locator(".solo-seat").count(), 1, "solo table reserves one player seat");
        assert.equal(await page.locator(".social-player").count(), 0, "solo does not render multiplayer seats");
        assert.equal(await page.locator("#table-bet").isVisible(), true, "solo shows the round wager");
        assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true,
          "browser test honors reduced-motion preference");
      }
      if (route === "/ranking.html") assert.equal(await page.locator(".table, .room-game-table").count(), 0, "ranking excludes game UI");
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const username = "qa_" + randomBytes(5).toString("hex");
  await page.goto(origin + "/conta.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="register"]').click();
  await page.locator("#register-user").fill(username);
  await page.locator("#register-pass").fill("7chars!");
  assert.equal(await page.locator("#register-pass").evaluate((input) => input.validity.tooShort), true,
    "seven-character password is blocked by browser validation");
  await page.locator("#register-pass").fill("Q4t!z8Lm");
  await page.locator("#register-confirm").fill("Q4t!z8Lm");
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator("#recovery-panel").waitFor({ state: "visible", timeout: 15_000 });
  const recoveryCode = await page.locator("#recovery-secret").textContent();
  assert.match(recoveryCode ?? "", /^[\w-]{40,64}$/);
  assert.match(await page.locator("#recovery-panel h2").innerText(), /Conta criada com sucesso/);
  await page.screenshot({ path: "artifacts/ui/recovery-code-redacted.png", fullPage: true, mask: [page.locator("#recovery-secret")] });
  await page.locator("#saved-recovery").click();
  await page.waitForURL(origin + "/", { timeout: 15_000 });
  await page.goto(origin + "/conta.html", { waitUntil: "domcontentloaded" });
  await page.locator("#account-panel").waitFor({ state: "visible", timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#account-panel").waitFor({ state: "visible", timeout: 15_000 });

  await page.goto(origin + "/carteira.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#wallet-balance")?.textContent === "2.000", undefined, { timeout: 15_000 });
  await page.locator("#claim-daily").click();
  await page.waitForFunction(() => document.querySelector("#wallet-balance")?.textContent === "2.500", undefined, { timeout: 15_000 });
  assert.equal(await page.locator("#claim-daily").isDisabled(), true);

  await page.goto(origin + "/classificatoria.html", { waitUntil: "domcontentloaded" });
  await page.locator("#new-round").waitFor({ state: "visible" });
  await page.locator("#new-round").click();
  await page.locator("#dealer-cards .playing-card").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: "artifacts/ui/ranked-game-desktop.png", fullPage: true });
  if (await page.locator("#stand").isVisible()) await page.locator("#stand").click();
  await page.goto(origin + "/ranking.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-period="historical"]').click();
  await page.waitForFunction((name) => document.querySelector("#rank-rows")?.textContent?.includes(name), username, { timeout: 15_000 });
  await page.screenshot({ path: "artifacts/ui/real-ranking-desktop.png", fullPage: true });

  await page.goto(origin + "/solo.html", { waitUntil: "domcontentloaded" });
  await page.locator('.chip-button[data-bet="20"]').click();
  assert.equal(await page.locator("#bet").inputValue(), "20", "solo chip selection updates the bet");
  await page.locator("#new-round").click();
  await page.waitForFunction(() => document.querySelectorAll("#player-cards .playing-card").length >= 2,
    undefined, { timeout: 15_000 });
  assert.equal(await page.locator("#player-cards .playing-card").count(), 2, "solo round starts with one two-card hand");
  if (await page.locator("#dealer-cards .card-back").count()) {
    assert.equal(await page.locator("#dealer-cards .card-back").getAttribute("aria-label"), "Carta fechada");
  }
  await page.screenshot({ path: "artifacts/ui/solo-table-desktop.png", fullPage: true });
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await noOverflow(page, "solo table " + width + "px");
    if (width === 390) await page.screenshot({ path: "artifacts/ui/solo-table-mobile.png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Verify the shoe commitment is visible BEFORE anyone places a social bet.
  await page.goto(origin + "/salas.html", { waitUntil: "domcontentloaded" });
  await page.locator("#display-name").fill("QA Player");
  await page.locator("#room-name").fill("Mesa de Auditoria");
  await page.locator('#create-room button[type="submit"]').click();
  await page.locator("#game-start").waitFor({ state: "visible", timeout: 15_000 });
  const roomCode = new URL(page.url()).searchParams.get("sala");
  assert.match(roomCode ?? "", /^[A-F0-9]{12}$/);

  // Two separate browser contexts have independent cookies and visitor sessions.
  const friendContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const friendPage = await friendContext.newPage();
    await friendPage.goto(origin + "/salas.html?sala=" + roomCode, { waitUntil: "domcontentloaded" });
    await friendPage.locator("#join-area").waitFor({ state: "visible" });
    await friendPage.locator("#join-name").fill("QA Friend");
    await friendPage.locator("#join-room").click();
    await friendPage.locator("#room-members").getByText("QA Friend").waitFor({ state: "visible" });
    await page.locator("#room-members").getByText("QA Friend").waitFor({ state: "visible" });
    assert.equal(await page.locator(".social-player").count(), 5, "multiplayer table reserves five seats before play");
    assert.equal(await page.locator(".social-player.is-empty").count(), 3, "only the three vacant player seats are shown as empty");
    assert.equal(await page.locator(".social-player:not(.is-empty)").count(), 2, "both joined players occupy the table before betting");
    await page.locator("#game-start").click();
    await page.locator("#game-betting").waitFor({ state: "visible" });
    await friendPage.locator("#game-betting").waitFor({ state: "visible" });
    await page.locator('#social-chip-tray [data-wager="20"]').click();
    assert.equal(await page.locator("#game-wager").inputValue(), "20", "social chip selection controls the authoritative wager request");
    await page.locator("#game-bet").click();
    await friendPage.locator("#game-bet").click();
    await page.locator("#game-deal").click();
    await page.locator(".social-player").nth(0).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#social-player-hands .social-player").length === 5,
      undefined, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll("#social-player-hands .playing-card").length >= 4,
      undefined, { timeout: 15_000 });
    assert.equal(await page.locator(".social-player").count(), 5, "active players retain five visible table positions");
    assert.ok(await page.locator(".social-player.is-empty").count() >= 3, "unused table positions remain visible");
    const faceDownCards = page.locator("#social-dealer-cards .card-back");
    if (await faceDownCards.count()) assert.equal(await faceDownCards.first().getAttribute("aria-label"), "Carta fechada");
    await page.screenshot({ path: "artifacts/ui/room-table-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "multiplayer 390px");
    await page.screenshot({ path: "artifacts/ui/room-table-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1024, height: 900 });
    await noOverflow(page, "multiplayer 1024px");
    await page.setViewportSize({ width: 320, height: 780 });
    await noOverflow(page, "multiplayer 320px");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(900);
    assert.equal(await page.locator(".card-arrive").evaluateAll((cards) => cards.some((card) => card.getAnimations().some((animation) => animation.playState === "running"))),
      false, "card distribution animation completes without blocking play");
    assert.ok(await friendPage.locator("#turn-timer").getAttribute("aria-label"), "turn timer is labeled from the server deadline");
    const actingPage = await page.locator("#game-actions").isVisible() ? page :
      await friendPage.locator("#game-actions").isVisible() ? friendPage : null;
    if (actingPage) {
      const waitingPage = actingPage === page ? friendPage : page;
      await actingPage.locator("#social-stand").click();
      await waitingPage.waitForFunction(() => {
        const actions = document.querySelector("#game-actions");
        const restart = document.querySelector("#game-start");
        const status = document.querySelector("#game-status")?.textContent ?? "";
        return actions instanceof HTMLElement && !actions.hidden || restart instanceof HTMLElement && !restart.hidden || status.includes("Rodada encerrada");
      }, undefined, { timeout: 15_000 });
    }
    await friendPage.waitForFunction(() => document.querySelector("#connection-state")?.textContent?.includes("Amigos conectados em tempo real"));
    assert.equal(await friendPage.locator("#shoe-commitment").textContent(), await page.locator("#shoe-commitment").textContent());
    console.log("MESA/21 multiplayer QA PASS: two independent sessions joined the same room and received the live betting state");
  } finally {
    await friendContext.close();
  }

  await page.waitForFunction(() => /^[0-9a-f]{64}$/.test(document.querySelector("#shoe-commitment")?.textContent ?? ""),
    undefined, { timeout: 15_000 });
  await page.locator(".room-fairness summary").click();
  await page.locator("#verify-shoe").click();
  await page.waitForFunction(() => (document.querySelector("#shoe-audit-result")?.textContent ?? "").includes("Ainda não há baralhos aposentados"),
    undefined, { timeout: 15_000 });
  await page.screenshot({ path: "artifacts/ui/room-shoe-commitment.png", fullPage: true });
  await context.close();
  console.log("MESA/21 browser QA PASS: 4 viewports, lobby/solo/ranking/help/auth, 8-character signup, session persistence, bonus, ranked game, multiplayer");
} catch (error) {
  console.error(error);
  console.error("Wrangler logs:", logs);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
