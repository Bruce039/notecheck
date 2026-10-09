import { useEffect, useState } from "react";
import { type Network, tokenInfo, type TokenInfo } from "notecheck";

/** Token metadata for a faucet: undefined while loading (or with no faucet), null when unknown. */
export function useTokenInfo(network: Network, faucetHex: string | undefined): TokenInfo | null | undefined {
  const key = faucetHex ? `${network}:${faucetHex}` : "";
  const [state, setState] = useState<{ key: string; info: TokenInfo | null }>();
  useEffect(() => {
    if (!faucetHex) return;
    let live = true;
    void tokenInfo(network, faucetHex).then((info) => { if (live) setState({ key: `${network}:${faucetHex}`, info }); });
    return () => { live = false; };
  }, [network, faucetHex]);
  return key && state?.key === key ? state.info : undefined;
}
