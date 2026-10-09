import { formatAmount, type PaymentRequestV1, type TokenInfo } from "notecheck";

export const shortAddress = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-4)}` : a);

/** "1.5 USDCX", or base units while the token is unknown or loading. */
export function requestAmountText(req: Pick<PaymentRequestV1, "amount">, token: TokenInfo | null | undefined): string {
  return token ? `${formatAmount(BigInt(req.amount), token.decimals)} ${token.symbol}` : `${req.amount} base units`;
}
