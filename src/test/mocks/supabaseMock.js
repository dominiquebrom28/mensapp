// Test-only fake Supabase client. Real src/supabase.js is never imported in
// tests -- it's replaced via `vi.mock('../supabase.js', ...)` so that
// import.meta.env.VITE_SUPABASE_* and a real network client are never
// touched. This mock mimics just enough of the supabase-js query-builder /
// realtime-channel surface for App.jsx's mount-time calls to resolve.
//
// supabase-js query builders are "thenable": each chained method
// (.select/.order/.eq/.single/...) returns the *same* builder object, and
// awaiting/`.then`-ing it resolves to { data, error }. We replicate that by
// returning `builder` from every chain method and implementing `.then`
// ourselves.
export function makeQueryBuilder(result = { data: [], error: null }) {
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    limit: () => builder,
    insert: () => builder,
    upsert: () => builder,
    update: () => builder,
    delete: () => builder,
    list: () => Promise.resolve(result),
    upload: () => Promise.resolve({ data: { path: 'mock-path' }, error: null }),
    getPublicUrl: () => ({ data: { publicUrl: 'https://mock.test/mock-path' } }),
    single: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  }
  return builder
}

export function makeChannel() {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    send: () => channel,
    unsubscribe: () => Promise.resolve('ok'),
  }
  return channel
}

/**
 * @param {Object} tableData - map of table name -> { data, error } to return
 *   from `supabase.from(table)...`. Tables not listed resolve to { data: [], error: null }.
 */
export function makeSupabaseMock(tableData = {}) {
  return {
    from: (table) => makeQueryBuilder(tableData[table] ?? { data: [], error: null }),
    storage: {
      from: () => makeQueryBuilder({ data: [], error: null }),
    },
    channel: () => makeChannel(),
    removeChannel: () => {},
  }
}
