import { createAI } from './ai';
import { Agent } from './agent';
import type { Config } from './config';
import { createRepository } from './repository';
export function createServices(config: Config) {
  const repo = createRepository(config);
  return { repo, agent: new Agent(repo, createAI(config), config) };
}
export type Services = ReturnType<typeof createServices>;
