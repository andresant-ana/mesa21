import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("homepage is the room lobby and links to solo, ranking, and help", async () => {
  const html = await read("index.html");
  assert.match(html, /id="room-directory"/);
  assert.match(html, /id="create-room"/);
  assert.match(html, /id="join-code"/);
  assert.match(html, /href="\/solo\.html"/);
  assert.doesNotMatch(html, /class="table"/);
});

test("solo blackjack has a dedicated route and ranking has no game table", async () => {
  const [solo, ranking] = await Promise.all([read("solo.html"), read("ranking.html")]);
  assert.match(solo, /aria-label="Mesa de blackjack"/);
  assert.doesNotMatch(ranking, /aria-label="Mesa de blackjack"|room-game-table/);
  assert.match(ranking, /id="rank-rows"/);
});

test("legacy room links retain invitation query when redirecting to lobby", async () => {
  const legacy = await read("salas.html");
  const redirect = await read("src/client/legacyRedirect.ts");
  assert.match(legacy, /src="\/src\/client\/legacyRedirect\.ts"/);
  assert.match(redirect, /location\.replace\(target\)/);
  assert.match(redirect, /location\.search/);
});

test("help route is included in the Vite static build", async () => {
  const [help, config] = await Promise.all([read("como-jogar.html"), read("vite.config.ts")]);
  assert.match(help, /REGRAS NA MESA/);
  assert.match(config, /"como-jogar\.html"/);
  assert.match(config, /"solo\.html"/);
});
