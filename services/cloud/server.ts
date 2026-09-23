import 'dotenv/config';
import { createCloudControlApp } from '../../server/remote/cloud/http';
import { FirebaseCloudAuthenticator } from '../../server/remote/cloud/firebase-auth';
import { FirebaseCloudControlStore, FirestoreCommandRateLimiter } from '../../server/remote/cloud/firebase-store';
import { CloudControlService } from '../../server/remote/cloud/service';

const port = Math.max(1, Number(process.env.PORT || 8080));
const host = process.env.HOST || '0.0.0.0';

const store = new FirebaseCloudControlStore();
const service = new CloudControlService(store, { limiter: new FirestoreCommandRateLimiter() });
const authenticator = new FirebaseCloudAuthenticator();
const app = createCloudControlApp({ service, authenticator });

const server = app.listen(port, host, () => {
  console.log(`Spararama cloud control listening on http://${host}:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
