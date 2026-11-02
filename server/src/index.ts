import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './logger';
const config = loadConfig();
const server = createApp(config).listen(config.PORT, () => logger.info({ port: config.PORT }, 'ClinicDesk API listening'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
