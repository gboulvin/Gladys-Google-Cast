// -----------------------------------------------------------------------------
// Entry point of the Google Cast integration for Gladys Assistant.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
//
// Everything else lives in src/: the handlers (src/app.js), the bridge to the
// devices (src/manager.js) and the Cast protocol (src/cast/).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();

// Handlers first: the SDK dispatches as soon as it is connected.
registerHandlers(gladys);

logger.info('Starting the Google Cast integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
