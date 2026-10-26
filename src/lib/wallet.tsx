import { useEffect, useState, type ReactNode } from "react";
import {
  AllowedPrivateData, PrivateDataPermission, WalletAdapterNetwork, WalletReadyState,
} from "@miden-sdk/miden-wallet-adapter-base";
import { MidenWalletAdapter } from "@miden-sdk/miden-wallet-adapter-miden";
import { WalletProvider, useWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { addressNetwork, type Network } from "notecheck";

const APP_NAME = "NoteCheck";
const PERMISSION = PrivateDataPermission.UponRequest;
const ALLOWED = AllowedPrivateData.Assets;

// Module scope: a new adapter per render would make the provider disconnect it.
const wallets = [new MidenWalletAdapter({ appName: APP_NAME })];

// The adapter's enum has no mainnet member yet; Bread takes the plain name.
const adapterNetwork = (n: Network) => (n === "mainnet" ? ("mainnet" as WalletAdapterNetwork) : (n as WalletAdapterNetwork));

export function AppWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletProvider
      wallets={wallets}
      privateDataPermission={PERMISSION}
      allowedPrivateData={ALLOWED}
      autoConnect={false}
      onError={() => { /* surfaced by the rejected promise at each call site */ }}
    >
      {children}
    </WalletProvider>
  );
}

const ready = (s: WalletReadyState) => s === WalletReadyState.Installed || s === WalletReadyState.Loadable;

/** Connect / disconnect control. Selecting a wallet is a state update, so connect runs after it lands. */
export function WalletButton({ network }: { network: Network }) {
  const { wallets: list, wallet, select, connect, disconnect, connected, connecting, address } = useWallet();
  const [wantConnect, setWantConnect] = useState(false);
  const [error, setError] = useState<string>();
  const entry = list[0];

  useEffect(() => {
    if (!wantConnect || !wallet) return;
    setWantConnect(false);
    connect(PERMISSION, adapterNetwork(network), ALLOWED).catch((e: Error) => setError(e.message || "The wallet refused to connect."));
  }, [wantConnect, wallet, connect, network]);

  if (!entry) return null;
  if (connected && address) {
    // The wallet hands over the address with its `_…` routing suffix but displays it without.
    const plain = address.split("_")[0];
    const on = addressNetwork(plain);
    return (
      <div className="wallet">
        <span className="badge badge-good">connected</span>
        <code title={plain}>{plain.slice(0, 8)}…{plain.slice(-4)}</code>
        <button type="button" className="link" onClick={() => void disconnect()}>disconnect</button>
        {on && on !== network && (
          <span className="small" style={{ color: "var(--bad)" }}>Your wallet is on {on}. Switch it to {network}, or pick {on} above.</span>
        )}
      </div>
    );
  }
  if (!ready(entry.readyState)) {
    return (
      <div className="wallet">
        <span className="muted small">No Miden wallet detected.</span>
        <a href={entry.adapter.url} target="_blank" rel="noreferrer">Get the wallet</a>
      </div>
    );
  }
  return (
    <div className="wallet">
      <button
        type="button"
        className="btn btn-primary"
        disabled={connecting}
        onClick={() => { setError(undefined); select(entry.adapter.name); setWantConnect(true); }}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {error && <span className="small" style={{ color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}

