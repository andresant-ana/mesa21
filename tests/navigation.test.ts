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
  assert.match(help, /data-nav-account/);
  assert.match(config, /"como-jogar\.html"/);
  assert.match(config, /"solo\.html"/);
});


test("solo and ranked games use graphical chip selection without wager dropdowns", async () => {
  const [solo, ranked] = await Promise.all([read("solo.html"), read("classificatoria.html")]);
  assert.match(solo, /type="hidden" value="50"/);
  assert.match(solo, /data-bet="100"/);
  assert.doesNotMatch(solo, /<select[^>]*id="bet"/);
  assert.match(ranked, /data-mode="ranked"/);
  assert.match(ranked, /data-bet="50"/);
  assert.doesNotMatch(ranked, /<select[^>]*id="bet"/);
  assert.match(ranked, /Mesa classificatória de blackjack/);
});

test("lobby, solo, and ranked headers omit the credits banner", async () => {
  const pages = await Promise.all(["index.html", "solo.html", "ranking.html", "classificatoria.html"].map(read));
  for (const page of pages) assert.doesNotMatch(page, /Créditos fictícios<\/span>/);
});

test("the lobby has an independent scroll container for the room list", async () => {
  const css = await read("src/client/rooms.css");
  assert.match(css, /\.room-list \{ flex: 1; min-height: 0; overflow-y: auto/);
  assert.match(css, /overscroll-behavior: contain/);
});
