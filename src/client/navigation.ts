type SessionResponse = { user?: { username: string } };

const accountLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-nav-account]")];

function setAccountLink(username?: string): void {
  for (const link of accountLinks) {
    link.textContent = username ? "Minha conta" : "Entrar / Criar conta";
    link.setAttribute("aria-label", username ? "Conta de " + username : "Entrar ou criar conta");
  }
}

window.addEventListener("mesa21:authenticated", (event) => {
  const detail = (event as CustomEvent<{ username?: string }>).detail;
  setAccountLink(detail?.username);
});

if (accountLinks.length) {
  void fetch("/api/auth/me", { credentials: "same-origin" })
    .then(async (response) => response.ok ? await response.json() as SessionResponse : null)
    .then((session) => setAccountLink(session?.user?.username))
    .catch(() => setAccountLink());
}
