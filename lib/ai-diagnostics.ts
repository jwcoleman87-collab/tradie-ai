/** Deliberately excludes provider response bodies, customer text and secrets. */
export type ModelDiagnostic = {
  clientRequestId: string;
  providerRequestId?: string;
  httpStatus?: number;
  transport?: 'timeout' | 'network' | 'configuration';
};

export function aiProblem(code?: string | null) {
  switch (code) {
    case 'AI_QUOTA_EXCEEDED':
      return 'The provider’s API credits or usage limit have been reached. Check its API billing, or allow an available backup in Connections.';
    case 'AI_KEY_INVALID':
      return 'The provider rejected its API key. The app administrator needs to update the server key.';
    case 'AI_ACCESS_DENIED':
    case 'AI_MODEL_UNAVAILABLE':
      return 'The configured model is unavailable to this API project. Ask the app administrator to check model access.';
    case 'AI_RATE_LIMITED':
      return 'The provider is receiving too many requests. Wait a moment before trying again.';
    case 'AI_TIMEOUT':
      return 'The provider took too long to answer. Try a shorter request or allow an available backup in Connections.';
    case 'AI_NETWORK_ERROR':
      return 'The server could not reach the AI provider. Check the connection or try again shortly.';
    case 'AI_TRANSPORT_CONFIG_INVALID':
      return 'The hosted server rejected an AI connection setting. The app administrator needs to fix the server configuration; adding credits will not fix this.';
    case 'AI_REDIRECT_BLOCKED':
      return 'The AI endpoint tried to redirect. The request was stopped to protect your API key. Ask the app administrator to check the endpoint.';
    case 'AI_UNAVAILABLE':
      return 'The AI connection or service was unavailable. This code alone does not establish a credit or key problem. Check the request details or try again shortly.';
    case 'AI_REFUSED':
      return 'The provider declined this request. No actions were executed; review the request before trying a different one.';
    case 'AI_INCOMPLETE':
      return 'The provider could not finish within its response limit. Try a smaller request.';
    case 'AI_REQUEST_INVALID':
    case 'AI_INVALID_RESPONSE':
      return 'The AI request or response did not match the required format. No actions were executed. Ask the app administrator to review the request details.';
    case 'CALENDAR_NOT_CONNECTED':
      return 'Connect Google Calendar in Connections before preparing a booking.';
    case 'INTERRUPTED':
      return 'This request was interrupted before completion. No reply was saved.';
    default:
      return 'No AI reply was completed. Check Connections and the request details before trying again. No proposed actions were executed.';
  }
}
