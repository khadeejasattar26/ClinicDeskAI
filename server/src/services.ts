import { ClinicMailer, EmailService } from "./email";
import { createAI } from "./ai";
import { Agent } from "./agent";
import type { Config } from "./config";
import { createRepository } from "./repository";
export function createServices(config: Config) {
  const repo = createRepository(config);
  const emails = new EmailService(repo, new ClinicMailer(config));
  return {
    repo,
    emails,
    agent: new Agent(repo, createAI(config), config, emails),
  };
}
export type Services = ReturnType<typeof createServices>;
