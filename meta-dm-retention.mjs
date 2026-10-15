// Only receipt metadata. Never deletes Meta conversations or other tables.
export async function purgeExpiredDmReceipts(adminDb, now = Date.now()) {
  if (typeof adminDb !== 'function' || !Number.isFinite(now)) throw Error('Retention unavailable');
  const cutoff = new Date(now - 90 * 86400000).toISOString();
  const rows = await adminDb('amcinova_social_dm_receipts', {
    method: 'DELETE', query: '?received_at=lt.' + encodeURIComponent(cutoff),
    prefer: 'return=representation'
  });
  if (!Array.isArray(rows)) throw Error('Retention unavailable');
  return rows.length;
}
export function startMetaDmRetention({env, adminDb, log = console.log}) {
  if (env.AMCINOVA_META_DM_ENABLED !== 'true') return () => {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { log('[meta-dm] retention completed; removed=' + await purgeExpiredDmReceipts(adminDb)); }
    catch { log('[meta-dm] retention failed; retry scheduled'); }
    finally { running = false; }
  };
  const initial = setTimeout(run, 1000);
  const periodic = setInterval(run, 86400000);
  initial.unref?.(); periodic.unref?.();
  return () => { clearTimeout(initial); clearInterval(periodic); };
}
