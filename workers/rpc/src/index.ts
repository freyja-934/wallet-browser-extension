import { handleRpc, type RpcProxyEnv } from './handle';

// `RpcProxyEnv` is the binding set in `wrangler.jsonc`: `HELIUS_API_KEY` (secret)
// and `RPC_RATE_LIMIT`. Regenerating with `npx wrangler types` from this directory
// produces the same two names; the handler stays the source the tests import so
// the extension's typecheck does not take a dependency on Workers types.
export default {
  async fetch(request: Request, env: RpcProxyEnv): Promise<Response> {
    return handleRpc(request, env);
  },
};
