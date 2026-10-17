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
      if (route === "/solo.html") assert.equal(await page.locator(".table").isVisible(), true, "solo has a dedicated table");
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
    await page.locator("#game-start").click();
    await page.locator("#game-betting").waitFor({ state: "visible" });
    await friendPage.locator("#game-betting").waitFor({ state: "visible" });
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
