class AlexaAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlexaAuthorizationError';
  }
}

function customApplicationId(event) {
  return event?.session?.application?.applicationId
    || event?.context?.System?.application?.applicationId
    || '';
}

function alexaAccessToken(event) {
  return event?.directive?.endpoint?.scope?.token
    || event?.directive?.payload?.scope?.token
    || event?.context?.System?.user?.accessToken
    || event?.session?.user?.accessToken
    || '';
}

function smartHomeError(event, type, message) {
  const directive = event?.directive;
  if (!directive?.header) throw new Error(message);
  return {
    event: {
      header: {
        namespace: 'Alexa',
        name: 'ErrorResponse',
        messageId: crypto.randomUUID(),
        ...(directive.header.correlationToken ? { correlationToken: directive.header.correlationToken } : {}),
        payloadVersion: '3'
      },
      ...(directive.endpoint ? { endpoint: directive.endpoint } : {}),
      payload: {
        type,
        message
      }
    }
  };
}

async function validateLwaAccessToken(event, lwaClientId) {
  const token = String(alexaAccessToken(event) || '').trim();
  if (!token) {
    throw new AlexaAuthorizationError('Alexa linked-account token is missing.');
  }

  const response = await fetch(
    `https://api.amazon.com/auth/o2/tokeninfo?access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(4000) }
  );

  if (!response.ok) {
    throw new AlexaAuthorizationError('Alexa linked-account token is invalid or expired.');
  }

  const info = await response.json();
  if (String(info?.aud || '') !== lwaClientId) {
    throw new AlexaAuthorizationError('Alexa linked-account token does not belong to this Login with Amazon profile.');
  }
}

function eventWithoutAccessToken(event) {
  const forwarded = structuredClone(event);
  if (forwarded?.directive?.endpoint?.scope) delete forwarded.directive.endpoint.scope.token;
  if (forwarded?.directive?.payload?.scope) delete forwarded.directive.payload.scope.token;
  if (forwarded?.context?.System?.user) delete forwarded.context.System.user.accessToken;
  if (forwarded?.session?.user) delete forwarded.session.user.accessToken;
  return forwarded;
}

export async function handler(event) {
  const endpoint = String(process.env.SPARARAMA_ALEXA_URL || '').trim();
  const proxySecret = String(process.env.SPARARAMA_ALEXA_PROXY_SECRET || '').trim();
  const skillId = String(process.env.ALEXA_SKILL_ID || '').trim();
  const lwaClientId = String(process.env.LWA_CLIENT_ID || '').trim();

  if (!endpoint) throw new Error('SPARARAMA_ALEXA_URL is not configured.');
  if (!proxySecret) throw new Error('SPARARAMA_ALEXA_PROXY_SECRET is not configured.');
  if (!skillId) throw new Error('ALEXA_SKILL_ID is not configured.');
  if (!lwaClientId) throw new Error('LWA_CLIENT_ID is not configured.');

  const requestApplicationId = customApplicationId(event);
  if (requestApplicationId && requestApplicationId !== skillId) {
    throw new Error('Alexa request application ID does not match ALEXA_SKILL_ID.');
  }

  try {
    await validateLwaAccessToken(event, lwaClientId);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Spararama-Alexa-Proxy-Secret': proxySecret,
        'X-Spararama-Alexa-Skill-Id': skillId
      },
      body: JSON.stringify(eventWithoutAccessToken(event)),
      signal: AbortSignal.timeout(7000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Spararama Alexa endpoint returned ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (event?.directive?.header) {
      const type = error instanceof AlexaAuthorizationError
        ? 'INVALID_AUTHORIZATION_CREDENTIAL'
        : 'ENDPOINT_UNREACHABLE';
      return smartHomeError(event, type, message);
    }
    throw error;
  }
}
