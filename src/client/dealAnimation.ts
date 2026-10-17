/**
 * Purely visual deal choreography. The server remains authoritative for every card.
 * A fixed-position clone flies from the actual deck rectangle to a card's actual
 * position; originals become visible at arrival. No card identity is predicted.
 */
const inflight = new Set<Animation>();
const overlays = new Set<HTMLElement>();
const hiddenCards = new Set<HTMLElement>();

export function cancelCardMotion(): void {
  for (const animation of inflight) animation.cancel();
  inflight.clear();
  for (const overlay of overlays) overlay.remove();
  overlays.clear();
  for (const card of hiddenCards) card.classList.remove("card-in-flight");
  hiddenCards.clear();
}

export function dealFromDeck(table: HTMLElement, cards: HTMLElement[]): void {
  const deck = table.querySelector<HTMLElement>(".deck-stack");
  if (!deck || !cards.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const origin = deck.getBoundingClientRect();
  cards.forEach((card, index) => {
    const target = card.getBoundingClientRect();
    if (!target.width || !target.height) return;
    const startX = origin.left + (origin.width - target.width) / 2;
    const startY = origin.top + (origin.height - target.height) / 2;
    const dx = target.left - startX;
    const dy = target.top - startY;
    const clone = card.cloneNode(true) as HTMLElement;
    clone.classList.remove("card-in-flight", "card-flip");
    clone.classList.add("flying-card");
    clone.setAttribute("aria-hidden", "true");
    clone.removeAttribute("role");
    clone.removeAttribute("aria-label");
    Object.assign(clone.style, {
      position: "fixed", left: startX + "px", top: startY + "px",
      width: target.width + "px", height: target.height + "px",
      margin: "0", zIndex: "1000", pointerEvents: "none"
    });
    card.classList.add("card-in-flight");
    hiddenCards.add(card);
    document.body.append(clone);
    overlays.add(clone);
    const animation = clone.animate([
      { transform: "translate(0, 0) scale(.72) rotate(-14deg)", opacity: 1, offset: 0 },
      { transform: `translate(${dx * .55}px, ${dy * .44 - 18}px) scale(.89) rotate(-7deg)`, opacity: 1, offset: .52 },
      { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0)`, opacity: 1, offset: 1 }
    ], { duration: 520, delay: index * 150, easing: "cubic-bezier(.22,.7,.22,1)", fill: "both" });
    inflight.add(animation);
    void animation.finished.then(() => {
      card.classList.remove("card-in-flight");
      hiddenCards.delete(card);
      clone.remove();
      overlays.delete(clone);
      inflight.delete(animation);
    }, () => {
      card.classList.remove("card-in-flight");
      hiddenCards.delete(card);
      clone.remove();
      overlays.delete(clone);
      inflight.delete(animation);
    });
  });
}

export function flipRevealedCard(card: HTMLElement): void {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    card.classList.add("card-flip");
  }
}
