import { buildApp } from './app.js';
import { createConfig } from './config.js';

const config = createConfig();
const app = await buildApp({ config });

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`花生片 Penaup runtime listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
