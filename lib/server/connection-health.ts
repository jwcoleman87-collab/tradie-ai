import type { Provider } from '../integrations';
import { verifyCalendarConnection } from './calendar';
import { verifyFacebookConnection } from './facebook';
import { verifyGoogleAdsConnection } from './google-ads';

export async function verifyProviderConnection(
  workspaceId: string,
  provider: Provider,
  connectionId: string,
) {
  if (provider === 'google_calendar')
    return verifyCalendarConnection(workspaceId, connectionId);
  if (provider === 'facebook')
    return verifyFacebookConnection(workspaceId, connectionId);
  return verifyGoogleAdsConnection(workspaceId, connectionId);
}
