export type DiscoveryStatus = {
  status: 'unavailable' | 'ready' | 'complete' | 'failed';
  label: string;
  detail: string;
};

export type DiscoveryRequest = {
  workspaceId: string;
  queries: string[];
};

export type DiscoveryEvidence = {
  value: unknown;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
};

export interface BusinessDiscoveryAdapter {
  status(): DiscoveryStatus;
  discover(request: DiscoveryRequest): Promise<DiscoveryEvidence[]>;
}

// This is an intentional boundary, not a simulated search provider. A future
// adapter must use an approved API, strict timeouts and an explicit host
// allow-list before it can return evidence.
export class UnavailableBusinessDiscoveryAdapter implements BusinessDiscoveryAdapter {
  status(): DiscoveryStatus {
    return {
      status: 'unavailable',
      label: 'Public-source research not connected',
      detail:
        'Magic has only used information you supplied. No website, registry or business-profile search ran.',
    };
  }

  async discover(_request: DiscoveryRequest): Promise<DiscoveryEvidence[]> {
    return [];
  }
}

export const businessDiscovery: BusinessDiscoveryAdapter =
  new UnavailableBusinessDiscoveryAdapter();
