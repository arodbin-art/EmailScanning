import 'dotenv/config';
import { validateSchemaOrThrow } from './db.js';
import { createApp } from './app.js';
import { validateAdminAuthConfigOrThrow } from './auth.js';

try {
  validateAdminAuthConfigOrThrow();
} catch (err) {
  console.error('Startup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;

validateSchemaOrThrow()
  .then(() => {
    app.listen(port, () => {
      console.log(`Email Scanning Admin API listening on ${port}`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
