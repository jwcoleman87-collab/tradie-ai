import type { SupabaseClient } from '@supabase/supabase-js';
type Row = Record<string, unknown>;

// A small query fake for deterministic selection/coverage tests. Tenant RLS
// itself is exercised against PostgreSQL in database.test.ts.
export function memoryDb(tables: Record<string, Row[]>) {
  const requests: { table: string; fields: string }[] = [];
  const db = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const sorting: {
        field: string;
        ascending: boolean;
        nullsFirst?: boolean;
      }[] = [];
      let limit = Infinity;
      let fields = '*';
      const result = () => {
        let rows = (tables[table] || []).filter((row) =>
          filters.every((filter) => filter(row)),
        );
        const count = rows.length;
        rows = [...rows].sort((a, b) => {
          for (const { field, ascending, nullsFirst } of sorting) {
            if (a[field] === b[field]) continue;
            if (a[field] == null) return nullsFirst ? -1 : 1;
            if (b[field] == null) return nullsFirst ? 1 : -1;
            const left =
              typeof a[field] === 'string'
                ? (a[field] as string)
                : JSON.stringify(a[field]);
            const right =
              typeof b[field] === 'string'
                ? (b[field] as string)
                : JSON.stringify(b[field]);
            const order = left.localeCompare(right) * (ascending ? 1 : -1);
            if (order) return order;
          }
          return 0;
        });
        rows = rows.slice(0, limit);
        if (fields !== '*')
          rows = rows.map((row) =>
            Object.fromEntries(
              fields.split(',').map((field) => [field, row[field]]),
            ),
          );
        return { data: rows, count, error: null };
      };
      const chain = {
        select(value: string) {
          fields = value;
          requests.push({ table, fields });
          return chain;
        },
        eq(field: string, value: unknown) {
          filters.push((row) => row[field] === value);
          return chain;
        },
        in(field: string, values: unknown[]) {
          filters.push((row) => values.includes(row[field]));
          return chain;
        },
        gt(field: string, value: string) {
          filters.push((row) => String(row[field]) > value);
          return chain;
        },
        or(expression: string) {
          if (expression.includes('status.in.')) {
            const states =
              expression.match(/^status.in.\(([^)]+)\)/)?.[1].split(',') || [];
            const expiry = expression.match(/expires_at.lte.([^)]*)/)?.[1] || '';
            filters.push(
              (row) =>
                states.includes(String(row.status)) ||
                (row.status === 'waiting_approval' &&
                  String(row.expires_at) <= expiry),
            );
            return chain;
          }
          const clauses = expression.split(',');
          filters.push((row) =>
            clauses.some((clause) => {
              const match = clause.match(/^(\w+)\.ilike\.%(.+)%$/i);
              if (!match) return false;
              return String(row[match[1]] ?? '')
                .toLowerCase()
                .includes(match[2].toLowerCase());
            }),
          );
          return chain;
        },
        order(
          field: string,
          options: { ascending: boolean; nullsFirst?: boolean },
        ) {
          sorting.push({ field, ...options });
          return chain;
        },
        limit(value: number) {
          limit = value;
          return chain;
        },
        abortSignal() {
          return chain;
        },
        async single() {
          const value = result();
          return { ...value, data: value.data[0] || null };
        },
        async maybeSingle() {
          const value = result();
          return { ...value, data: value.data[0] || null };
        },
        // eslint-disable-next-line unicorn/no-thenable -- Models the awaitable Supabase query.
        then(
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, requests };
}
