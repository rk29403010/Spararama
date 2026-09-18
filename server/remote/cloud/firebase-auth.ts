import type { CloudPrincipal } from './service';
import { CloudControlError } from './service';
import { getCloudAuth } from './firebase-admin';

export interface CloudAuthenticator {
  authenticateAuthorizationHeader(authorization: string | undefined): Promise<CloudPrincipal>;
}

export class FirebaseCloudAuthenticator implements CloudAuthenticator {
  private readonly auth = getCloudAuth();

  async authenticateAuthorizationHeader(authorization: string | undefined) {
    const match = String(authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new CloudControlError(401, 'authentication_required', 'Sign in to use Spararama remote access.');
    }

    try {
      const decoded = await this.auth.verifyIdToken(match[1]);
      return {
        uid: decoded.uid,
        ...(decoded.email ? { email: decoded.email } : {})
      };
    } catch {
      throw new CloudControlError(401, 'invalid_token', 'Your sign-in could not be verified. Sign in again and retry.');
    }
  }
}
