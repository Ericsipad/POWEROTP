import type { IncomingMessage } from "node:http";

import {
  createPowerOtpRequestListener,
  type GateNodeOptions,
  type ProtectedRequestState,
} from "@powerotp/gate-node";
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

export type GateExpressOptions = Omit<GateNodeOptions, "handle">;

export interface PowerOtpRequest extends Request {
  powerOtp?: ProtectedRequestState;
}

export interface PowerOtpBotBlocker {
  middleware(): RequestHandler;
  router(): Router;
}

export function createPowerOtpBotBlocker(
  options: GateExpressOptions,
): PowerOtpBotBlocker {
  const continuations = new WeakMap<IncomingMessage, NextFunction>();
  const listener = createPowerOtpRequestListener({
    ...options,
    handle(request, response, state) {
      const next = continuations.get(request);
      if (!next) throw new Error("Express continuation is unavailable");
      continuations.delete(request);
      const expressRequest = request as PowerOtpRequest;
      const expressResponse = response as Response;
      expressRequest.powerOtp = state;
      expressResponse.locals.powerOtp = state;
      next();
    },
  });

  const middleware: RequestHandler = (request, response, next) => {
    if (isWebSocketUpgrade(request)) {
      const state: ProtectedRequestState = {
        protected: false,
        access: "excluded",
      };
      (request as PowerOtpRequest).powerOtp = state;
      response.locals.powerOtp = state;
      next();
      return;
    }

    continuations.set(request, next);
    const cleanup = () => continuations.delete(request);
    response.once("finish", cleanup);
    response.once("close", cleanup);
    listener(request, response);
  };

  return {
    middleware: () => middleware,
    router() {
      const router = Router();
      router.use(middleware);
      return router;
    },
  };
}

function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.upgrade;
  const connection = request.headers.connection;
  return (
    typeof upgrade === "string" &&
    upgrade.toLowerCase() === "websocket" &&
    typeof connection === "string" &&
    connection
      .split(",")
      .some((token) => token.trim().toLowerCase() === "upgrade")
  );
}
