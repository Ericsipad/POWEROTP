import type { FastifyRequest } from "fastify";

export function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function clientIp(request: FastifyRequest) {
  return request.ip || undefined;
}
