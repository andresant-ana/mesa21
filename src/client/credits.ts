import "./styles.css";
import "./ranking.css";
import "./credits.css";
import "./navigation.ts";

type Entry = { id: string; at: number; kind: "initial" | "daily" | "round"; amount: number; balanceAfter: number };
type Wallet = { balance: number; lifetimeProfit: number; dailyAvailable: boolean; transactions: Entry[] };
const error = document.getElementById("wallet-error")!;
const button = document.getElementById("claim-daily") as HTMLButtonElement;
const fmt = new Intl.NumberFormat("pt-BR");
const signed = (amount: number) => (amount >= 0 ? "+" : "") + fmt.format(amount);

async function load(): Promise<void> {
  error.hidden = true;
  try {
    const response = await fetch("/api/wallet", { credentials: "same-origin" });
    if (response.status === 401) {
      error.hidden = false;
      error.textContent = "Entre na sua conta antes de consultar créditos. Acesse Minha conta no menu.";
      button.disabled = true;
      return;
    }
    if (!response.ok) throw new Error("Não foi possível consultar seus créditos.");
    const data = await response.json() as Wallet;
    document.getElementById("wallet-balance")!.textContent = fmt.format(data.balance);
    document.getElementById("wallet-profit")!.textContent = signed(data.lifetimeProfit);
    button.disabled = !data.dailyAvailable;
    button.textContent = data.dailyAvailable ? "Resgatar +500" : "Resgatado hoje";
    const parent = document.getElementById("wallet-transactions")!;
    parent.replaceChildren();
    for (const entry of data.transactions) {
      const row = document.createElement("div");
      row.className = "wallet-entry";
      const info = document.createElement("div");
      info.className = "wallet-entry-info";
      const label = document.createElement("strong");
      label.textContent = entry.kind === "initial" ? "Crédito inicial" :
        entry.kind === "daily" ? "Bônus diário" : "Resultado / aposta classificatória";
      const date = document.createElement("span");
      date.textContent = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
      }).format(entry.at);
      info.append(label, date);
      const amount = document.createElement("strong");
      amount.className = "wallet-entry-amount" + (entry.amount < 0 ? " negative" : "");
      amount.textContent = signed(entry.amount);
      row.append(info, amount);
      parent.append(row);
    }
    if (!data.transactions.length) parent.textContent = "Nenhuma movimentação ainda.";
  } catch (cause) {
    error.hidden = false;
    error.textContent = cause instanceof Error ? cause.message : "Tente novamente.";
  }
}
button.addEventListener("click", async () => {
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch("/api/wallet/claim", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}"
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error === "ROUND_ACTIVE"
      ? "Termine sua rodada atual antes de resgatar o bônus."
      : "O bônus não pôde ser resgatado agora.");
    await load();
  } catch (cause) {
    error.hidden = false;
    error.textContent = cause instanceof Error ? cause.message : "Tente novamente.";
    await load();
  }
});
void load();
