export const YOCTO = 10n ** 24n;
// Since 14 Nov the keeper signs with a function-call key limited to `check`, which cannot attach
// NEAR: the transaction carries no deposit, and the vault pays CHECK_COST (0.02 NEAR: enclave run
// plus the price-oracle reserve) from its keeper budget. 300 Tgas covers the oracle refresh.
export const CHECK_DEPOSIT = 0n;
export const CHECK_COST = 2n * 10n ** 22n;
export const CHECK_GAS = 300_000_000_000_000n;
export function amount(value) {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(String(value));
  if (!m) throw new Error('Use a nonnegative NEAR amount with at most 24 decimal places.');
  return BigInt(m[1]) * YOCTO + BigInt((m[2] || '').padEnd(24, '0'));
}
export function plan({ records, account, day, spendable, gasPrice, reserve, dailyCap, runCap }) {
  if (records.some((r) => r.account === account && r.overrun)) throw new Error('A keeper charge exceeded its reservation; review the journal before spending.');
  if (records.some((r) => r.account === account && ['reserved', 'pending'].includes(r.status))) throw new Error('Unresolved keeper journal: reconcile its saved hash before another paid check.');
  const spent = records.filter((r) => r.account === account && r.day === day).reduce((n, r) => n + BigInt(r.charged_yocto ?? r.reserved_yocto ?? '0'), 0n);
  // Full prepaid gas plus a 25% price buffer; unused gas/refunds never enlarge the daily allowance retroactively.
  const worst = CHECK_COST + CHECK_GAS * gasPrice * 125n / 100n;
  if (worst > runCap) throw new Error('Per-run cap would be exceeded; no transaction sent.');
  if (spent + worst > dailyCap) throw new Error('Per-UTC-day cap would be exceeded; no transaction sent.');
  if (spendable < reserve + worst) throw new Error('Keeper budget is below the reserve plus the full run budget; no transaction sent.');
  return { spent, worst };
}
