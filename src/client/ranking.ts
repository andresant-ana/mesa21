import "./styles.css";
import "./ranking.css";
import "./navigation.ts";

type Rank = { username: string; netProfit: number; handsPlayed: number; blackjacks: number };
type Period = "weekly" | "monthly" | "historical";
const rows = document.getElementById("rank-rows")!;
const error = document.getElementById("board-error")!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-period]")];
const fmt = new Intl.NumberFormat("pt-BR");

async function load(period: Period): Promise<void> {
  rows.textContent = "Atualizando...";
  error.hidden = true;
  for (const button of buttons) {
    const selected = button.dataset.period === period;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  try {
    const response = await fetch("/api/ranking?period=" + period);
    if (!response.ok) throw new Error("Não conseguimos carregar o ranking agora.");
    const data = await response.json() as { ranking: Rank[] };
    rows.replaceChildren();
    if (!data.ranking.length) {
      const empty = document.createElement("p");
      empty.className = "rank-empty";
      empty.textContent = "A mesa tá esperando seus primeiros resultados. Que tal inaugurar o ranking?";
      rows.append(empty);
      return;
    }
    for (const [index, player] of data.ranking.entries()) {
      const row = document.createElement("div");
      row.className = "rank-item";
      const position = document.createElement("span");
      position.className = "rank-position";
      position.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("div");
      name.className = "rank-person";
      const username = document.createElement("strong");
      username.textContent = player.username;
      const detail = document.createElement("span");
      detail.textContent = player.handsPlayed + " rodada(s)";
      name.append(username, detail);
      const profit = document.createElement("strong");
      profit.className = "rank-profit" + (player.netProfit < 0 ? " negative" : "");
      profit.textContent = (player.netProfit >= 0 ? "+" : "") + fmt.format(player.netProfit) + " créditos";
      row.append(position, name, profit);
      rows.append(row);
    }
  } catch (cause) {
    rows.textContent = "";
    error.hidden = false;
    error.textContent = cause instanceof Error ? cause.message : "Não foi possível consultar o ranking.";
  }
}
for (const button of buttons) {
  button.addEventListener("click", () => void load(button.dataset.period as Period));
}
void load("weekly");
