'use client';

import { useEffect, useState } from 'react';
import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from '@supabase/supabase-js';
import { authClient, type ClientConfig } from './client';

export function useWorkbenchAuth() {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [event, setEvent] = useState<AuthChangeEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let unsubscribe: undefined | (() => void);
    fetch('/api/config')
      .then((response) => {
        if (!response.ok) throw Error('Configuration could not load.');
        return response.json() as Promise<ClientConfig>;
      })
      .then(async (value) => {
        if (!alive) return;
        setConfig(value);
        if (!value.configured) {
          setLoading(false);
          return;
        }
        const auth = authClient(value);
        setClient(auth);
        const { data, error: sessionError } = await auth.auth.getSession();
        if (sessionError) throw sessionError;
        if (!alive) return;
        setSession(data.session);
        setLoading(false);
        const listener = auth.auth.onAuthStateChange(
          (nextEvent, nextSession) => {
            if (!alive) return;
            setEvent(nextEvent);
            setSession(nextSession);
          },
        );
        unsubscribe = () => listener.data.subscription.unsubscribe();
      })
      .catch((caught) => {
        if (!alive) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Sign-in configuration could not load.',
        );
        setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  return { config, session, client, event, loading, error };
}
