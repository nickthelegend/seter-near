import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, plan } from '../scripts/keeper-policy.mjs';
const input = { records: [], account: 'keeper.testnet', day: '2026-11-12', spendable: amount('2'), gasPrice: 100000000n, reserve: amount('1'), dailyCap: amount('0.05'), runCap: amount('0.045') };
test('keeper reserves the attachment and all prepaid gas with a price buffer', () => assert.equal(plan(input).worst, amount('0.04')));
test('keeper refuses an under-reserve account before a write', () => assert.throws(() => plan({ ...input, spendable: amount('1.039') }), /reserve/));
test('keeper refuses a daily overspend and accepts the exact cap', () => {
 const records=[{ account: input.account, day: input.day, status:'final', charged_yocto:String(amount('0.011')) }];
 assert.throws(() => plan({ ...input, records }), /UTC-day cap/);
 assert.equal(plan({ ...input, records, dailyCap: amount('0.051') }).spent, amount('0.011'));
});
test('keeper retains an unresolved reservation across UTC midnight', () => assert.throws(() => plan({ ...input, records:[{account:input.account,day:'2026-11-11',status:'pending',reserved_yocto:String(amount('0.04'))}] }), /Unresolved/));
test('keeper starts a new UTC budget without charging another account', () => assert.equal(plan({ ...input,records:[{account:input.account,day:'2026-11-11',status:'final',charged_yocto:String(amount('0.05'))},{account:'other.testnet',day:input.day,status:'final',charged_yocto:String(amount('0.3'))}] }).spent,0n));
test('keeper refuses a per-run excess even when the daily cap has room', () => assert.throws(() => plan({ ...input,runCap:amount('0.039') }), /Per-run/));
test('keeper rejects invalid decimal budgets rather than rounding them', () => { for(const value of ['NaN','-1','1e-2','0.0000000000000000000000001','']) assert.throws(() => amount(value)); });

test('keeper blocks future sends after a reservation overrun', () => assert.throws(() => plan({ ...input,records:[{account:input.account,day:input.day,status:'final',overrun:true,charged_yocto:String(amount('0.01'))}] }), /exceeded its reservation/));
