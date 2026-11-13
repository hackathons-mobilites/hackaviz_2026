import { useEffect, useState } from 'react';
import { isSubscriptionsFile, type SubscriptionsFile } from '../../data/subscriptions';

/**
 * `subscriptions.json` (06i), chargé une fois. `null` : en cours ou absent (la zone « Mes abonnements » se cache).
 * Le fichier est aligné sur les pôles du ciel (44 astres).
 */
let cache: Promise<SubscriptionsFile | null> | null = null;

export function loadSubscriptions(): Promise<SubscriptionsFile | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/subscriptions.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((v: unknown) => (isSubscriptionsFile(v) ? v : null))
    .catch(() => null);
  return cache;
}

export function useSubscriptionsFile(): SubscriptionsFile | null {
  const [file, setFile] = useState<SubscriptionsFile | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSubscriptions().then((f) => {
      if (alive) setFile(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return file;
}
