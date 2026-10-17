import "./styles.css";
import "./account.css";
import "./navigation.ts";

type User = { id: string; username: string; createdAt: number };
type ApiResult = { user?: User; recoveryCode?: string; error?: string; ok?: boolean };
type Mode = "login" | "register" | "recover";

function byId<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error("Elemento ausente: " + id);
  return item as T;
}
const authPanel = byId<HTMLElement>("auth-panel");
const accountPanel = byId<HTMLElement>("account-panel");
const recoveryPanel = byId<HTMLElement>("recovery-panel");
const errorElement = byId<HTMLElement>("account-error");
const forms: Record<Mode, HTMLFormElement> = {
  login: byId<HTMLFormElement>("login-form"),
  register: byId<HTMLFormElement>("register-form"),
  recover: byId<HTMLFormElement>("recover-form")
};
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
let busy = false;

const errors: Record<string, string> = {
  INVALID_CREDENTIALS_FORMAT: "Confira o nome de usuário e use uma senha com pelo menos 8 caracteres.",
  INVALID_CREDENTIALS: "Credenciais inválidas. Confira seus dados ou o código de recuperação.",
  USERNAME_TAKEN: "Esse nome de usuário já está em uso.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas. Espere 15 minutos antes de tentar novamente.",
  RATE_LIMITED: "Muitas solicitações em pouco tempo. Aguarde um minuto e tente novamente.",
  RATE_LIMIT_UNAVAILABLE: "O serviço de segurança está temporariamente indisponível.",
  SIGNUP_LIMIT_REACHED: "Os cadastros estão temporariamente indisponíveis.",
  UNAUTHORIZED: "Entre com sua conta para continuar.",
  ORIGIN_NOT_ALLOWED: "Atualize a página e tente novamente.",
  SERVICE_UNAVAILABLE: "O serviço está indisponível no momento.",
  INTERNAL_ERROR: "O servidor encontrou uma falha ao salvar a conta. Seus dados não foram confirmados; tente novamente em instantes.",
  CLIENT_IDENTITY_UNAVAILABLE: "Não conseguimos validar sua conexão com segurança. Atualize a página e tente novamente.",
  INVALID_REQUEST: "Confira os campos e tente novamente.",
  RATE_LIMITED: "Muitas tentativas de cadastro ou acesso. Aguarde um minuto e tente novamente."
};

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
}
function clearError(): void {
  errorElement.textContent = "";
  errorElement.hidden = true;
}
function chooseMode(mode: Mode): void {
  clearError();
  accountPanel.hidden = true;
  recoveryPanel.hidden = true;
  authPanel.hidden = false;
  for (const [key, form] of Object.entries(forms)) form.hidden = key !== mode;
  for (const tab of tabs) {
    const selected = tab.dataset.tab === mode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-pressed", String(selected));
  }
}
function showUser(user: User): void {
  authPanel.hidden = true;
  accountPanel.hidden = false;
  byId<HTMLElement>("signed-username").textContent = "Oi, " + user.username + "!";
  window.dispatchEvent(new CustomEvent("mesa21:authenticated", { detail: { username: user.username } }));
}
function showRecovery(code: string): void {
  authPanel.hidden = true;
  accountPanel.hidden = true;
  recoveryPanel.hidden = false;
  byId<HTMLElement>("recovery-secret").textContent = code;
}

async function request(path: string, body?: unknown): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth/" + path, {
      credentials: "same-origin",
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("Não foi possível conectar ao serviço. Confira sua conexão e tente novamente.");
  }
  let result: ApiResult;
  try { result = await response.json() as ApiResult; }
  catch { throw new Error("O serviço respondeu de forma inesperada. Tente novamente em instantes."); }
  if (!response.ok) throw new Error(errors[result.error ?? ""] ?? "Não foi possível concluir. Tente novamente.");
  return result;
}
async function perform(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  clearError();
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
  try { await action(); }
  catch (error) { showError(error instanceof Error ? error.message : "Não foi possível continuar."); }
  finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = false; });
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => chooseMode(tab.dataset.tab as Mode));
}
forms.login.addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const result = await request("login", {
      username: byId<HTMLInputElement>("login-user").value,
      password: byId<HTMLInputElement>("login-pass").value
    });
    forms.login.reset();
    if (!result.user) throw new Error("O servidor não confirmou o acesso à conta. Entre novamente.");
    showUser(result.user);
  });
});
forms.register.addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const passwordField = byId<HTMLInputElement>("register-pass");
    const confirmField = byId<HTMLInputElement>("register-confirm");
    const password = passwordField.value;
    if (password.length < 8) {
      passwordField.setCustomValidity("A senha precisa ter pelo menos 8 caracteres.");
      passwordField.reportValidity();
      showError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmField.value) {
      confirmField.setCustomValidity("As senhas precisam ser iguais.");
      confirmField.reportValidity();
      showError("As senhas precisam ser iguais.");
      return;
    }
    const result = await request("register", {
      username: byId<HTMLInputElement>("register-user").value,
      password
    });
    if (!result.user || !result.recoveryCode) throw new Error("O servidor não confirmou o cadastro e o código de recuperação.");
    forms.register.reset();
    showRecovery(result.recoveryCode);
  });
});
forms.recover.addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const result = await request("recover", {
      username: byId<HTMLInputElement>("recover-user").value,
      recoveryCode: byId<HTMLInputElement>("recover-code").value.trim(),
      newPassword: byId<HTMLInputElement>("recover-pass").value
    });
    forms.recover.reset();
    if (result.recoveryCode) showRecovery(result.recoveryCode);
  });
});
byId<HTMLButtonElement>("copy-recovery").addEventListener("click", async () => {
  const code = byId<HTMLElement>("recovery-secret").textContent ?? "";
  try { await navigator.clipboard.writeText(code); }
  catch { showError("Não foi possível copiar automaticamente. Selecione e guarde o código."); }
});
byId<HTMLButtonElement>("saved-recovery").addEventListener("click", () => {
  byId<HTMLElement>("recovery-secret").textContent = "";
  window.location.assign("/");
});
for (const id of ["register-pass", "register-confirm"]) {
  byId<HTMLInputElement>(id).addEventListener("input", () => {
    byId<HTMLInputElement>(id).setCustomValidity("");
    clearError();
  });
}
byId<HTMLButtonElement>("sign-out").addEventListener("click", () => void perform(async () => {
  await request("logout", {});
  chooseMode("login");
}));
void request("me").then((data) => {
  if (data.user) showUser(data.user);
}).catch(() => { /* Visitor: login is the default. */ });
