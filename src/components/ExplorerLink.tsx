import type { ReactNode } from "react";
import { EXPLORER_NAME, type ExplorerKind, explorerUrl, type Network } from "notecheck";

/** External link to Midenscan; renders nothing when the network has no explorer or the id is invalid. */
export function ExplorerLink({ network, kind, id, children }: {
  network: Network; kind: ExplorerKind; id: string | number | undefined | null; children?: ReactNode;
}) {
  const url = id === undefined || id === null ? null : explorerUrl(network, kind, id);
  if (!url) return null;
  return (
    <a className="explorer-link" href={url} target="_blank" rel="noopener noreferrer" title={`Open on ${EXPLORER_NAME}`}>
      {children ?? `View on ${EXPLORER_NAME}`}
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" /></svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
