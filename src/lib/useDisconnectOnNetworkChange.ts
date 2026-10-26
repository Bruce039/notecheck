import { useEffect, useRef } from "react";
import { useWallet } from "@miden-sdk/miden-wallet-adapter-react";
import type { Network } from "notecheck";

/** Drops the wallet connection when the selected network changes: it was made for the old one. */
export function useDisconnectOnNetworkChange(network: Network) {
  const { connected, disconnect } = useWallet();
  const last = useRef(network);
  useEffect(() => {
    if (last.current === network) return;
    last.current = network;
    if (connected) void disconnect();
  }, [network, connected, disconnect]);
}
