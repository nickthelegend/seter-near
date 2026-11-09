// Shared constants and read-only chain helpers for Mienai. No keys are handled here.
export const TESTNET_RPC = 'https://test.rpc.fastnear.com';
export const OUTLAYER_TESTNET = 'outlayer.testnet';
export const OUTLAYER_TESTNET_API = 'https://testnet-api.outlayer.ai';
export const PRICE_SOURCE = 'https://api.exchange.coinbase.com/products/NEAR-USD/ticker';
export const explorerTx = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id) => `https://testnet.nearblocks.io/address/${id}`;

export async function rpc(method, params, url = TESTNET_RPC) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'mienai', method, params }) });
  if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`NEAR RPC error: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}

export async function view(contractId, method, args = {}, url = TESTNET_RPC) {
  const result = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }, url);
  if (result.error) throw new Error(`${contractId}.${method}: ${result.error}`);
  return JSON.parse(Buffer.from(result.result).toString());
}

export async function viewAccount(accountId, url = TESTNET_RPC) {
  return rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId }, url);
}

export * from './crypto.mjs';
