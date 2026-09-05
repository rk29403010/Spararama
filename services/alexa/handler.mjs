function customApplicationId(event) {
  return event?.session?.application?.applicationId
    || event?.context?.System?.application?.applicationId
    || '';
}

function smartHomeUnavailable(event, message) {
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
        type: 'ENDPOINT_UNREACHABLE',
        message
      }
    }
  };
}

export async function handler(event) {
  const endpoint = String(process.env.SPARARAMA_ALEXA_URL || '').trim();
  const proxySecret = String(process.env.SPARARAMA_ALEXA_PROXY_SECRET || '').trim();
  const skillId = String(process.env.ALEXA_SKILL_ID || '').trim();

  if (!endpoint) throw new Error('SPARARAMA_ALEXA_URL is not configured.');
  if (!proxySecret) throw new Error('SPARARAMA_ALEXA_PROXY_SECRET is not configured.');

  const requestApplicationId = customApplicationId(event);
  if (skillId && requestApplicationId && requestApplicationId !== skillId) {
    throw new Error('Alexa request application ID does not match ALEXA_SKILL_ID.');
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Spararama-Alexa-Proxy-Secret': proxySecret,
        ...(skillId ? { 'X-Spararama-Alexa-Skill-Id': skillId } : {})
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(7000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Spararama Alexa endpoint returned ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (event?.directive?.header) return smartHomeUnavailable(event, message);
    throw error;
  }
}
