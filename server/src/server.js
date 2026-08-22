import { buildApp } from './app.js';
import { createConfig } from './config.js';

const config = createConfig();
const app = await buildApp({ config });
let shutdownPromise;

async function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    app.log.info({ signal }, 'Penaup runtime shutting down');
    await app.close();
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => {
  app.log.error(error, 'Penaup runtime shutdown failed');
  process.exitCode = 1;
}));
process.once('SIGINT', () => shutdown('SIGINT').catch((error) => {
  app.log.error(error, 'Penaup runtime shutdown failed');
  process.exitCode = 1;
}));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`花生片 Penaup runtime listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
