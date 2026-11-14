import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '../supabase';

export interface TableLayout {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  density: 'comfortable' | 'compact';
  sort: { id: string; dir: 'asc' | 'desc' } | null;
}

export interface SavedView {
  id: number;
  name: string;
  config: TableLayout;
}

export interface ViewStore {
  views: SavedView[];
  error: string | null;
  save: (name: string, config: TableLayout) => Promise<SavedView | null>;
  remove: (id: number) => Promise<void>;
}

/** Named table layouts stored per admin in public.saved_views (follows you across devices). */
export function useSavedViews(tableKey: string): ViewStore {
  const [views, setViews] = useState<SavedView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('saved_views')
      .select('id,name,config')
      .eq('table_key', tableKey)
      .order('name');
    if (error) setError(friendlyError(error));
    else setViews(data as SavedView[]);
  }, [tableKey]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (name: string, config: TableLayout) => {
      setError(null);
      const existing = views.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
      const q = existing
        ? supabase.from('saved_views').update({ config, updated_at: new Date().toISOString() }).eq('id', existing.id)
        : supabase.from('saved_views').insert({ table_key: tableKey, name: name.trim(), config });
      const { data, error } = await q.select('id,name,config').single();
      if (error) {
        setError(friendlyError(error));
        return null;
      }
      await load();
      return data as SavedView;
    },
    [views, tableKey, load],
  );

  const remove = useCallback(
    async (id: number) => {
      const { error } = await supabase.from('saved_views').delete().eq('id', id);
      if (error) setError(friendlyError(error));
      await load();
    },
    [load],
  );

  return { views, error, save, remove };
}
