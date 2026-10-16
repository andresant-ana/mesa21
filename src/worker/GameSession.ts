import {
  applyAction,
  createGame,
  createShuffledShoe,
  RuleError,
  STARTING_CASUAL_CREDITS,
  toPublicGame
} from "../domain/blackjack.ts";
import type { Action, PublicGame } from "../domain/blackjack";
import type { DurableObjectState, Env } from "./types.ts";

type SessionState = {
  casualCredits: number;
  game: ReturnType<typeof createGame> | null;
};

export class GameSession {
  private readonly storage: DurableObjectState["storage"];
  private requestQueue: Promise<void> = Promise.resolve();
  constructor(state: DurableObjectState, _env: Env) {
    this.storage = state.storage;
  }

  fetch(request: Request): Promise<Response> {
    const response = this.requestQueue.then(() => this.handle(request));
    this.requestQueue = response.then(() => undefined, () => undefined);
    return response;
  }

  private async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const state = (await this.storage.get<SessionState>("session")) ?? {
        casualCredits: STARTING_CASUAL_CREDITS,
        game: null
      };

      if (request.method === "GET" && url.pathname === "/session") {
        await this.storage.put("session", state);
        return json({
          casualCredits: state.casualCredits,
          rankedPoints: null,
          game: state.game ? publicGame(state.game) : null
        });
      }

      if (request.method !== "POST") return json({ error: "NOT_FOUND" }, 404);
      const body = await request.json() as Record<string, unknown>;

      if (url.pathname === "/game/start") {
        if (state.game?.phase === "player") return json({ error: "ROUND_ACTIVE" }, 409);
        const bet = body.bet;
        if (typeof bet !== "number") return json({ error: "INVALID_BET" }, 400);
        state.game = createGame(state.casualCredits, bet, createShuffledShoe());
        state.casualCredits = state.game.balance;
        await this.storage.put("session", state);
        return json({ casualCredits: state.casualCredits, rankedPoints: null, game: publicGame(state.game) });
      }

      if (url.pathname === "/game/action") {
        const action = body.action;
        if (action !== "hit" && action !== "stand" && action !== "double") return json({ error: "INVALID_ACTION" }, 400);
        if (!state.game) return json({ error: "NO_ACTIVE_ROUND" }, 409);
        state.game = applyAction(state.game, action as Action);
        state.casualCredits = state.game.balance;
        await this.storage.put("session", state);
        return json({ casualCredits: state.casualCredits, rankedPoints: null, game: publicGame(state.game) });
      }

      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof RuleError) {
        const status = error.code === "INSUFFICIENT_CREDITS" ? 409 : 400;
        return json({ error: error.code }, status);
      }
      if (error instanceof SyntaxError) return json({ error: "INVALID_REQUEST" }, 400);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  }
}

function publicGame(game: NonNullable<SessionState["game"]>): PublicGame {
  return toPublicGame(game);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
