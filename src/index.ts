/**
 * Credio SDK — drop-in client for AI agents on x402 (Solana).
 *
 * Credio is a credit layer for x402: when your agent hits a paid x402 resource
 * it can't afford, Credio fronts the USDC, settles the real x402 payment, and
 * hands you the resource. You repay later to unlock higher tiers. No API keys —
 * authentication is your Solana wallet address.
 *
 *   const credio = new CredioClient({ baseUrl: "https://credio.cc" })
 *
 *   // Pay for an x402-protected resource with credit (Credio settles it for you):
 *   const res = await credio.payForResource({
 *     agentWalletAddress: WALLET,
 *     resourceUrl: "https://api.example.com/premium",
 *     agentMetadata: { agentName: "My Agent" },
 *   })
 *   // res.resource.body  -> the protected content
 *   // res.agentStatus.currentUsdcDebt -> what you now owe
 *
 * Repayment has two modes — see `repay` (manual) and `repayInvoiceUrl`
 * (gasless, real x402 via the official `x402-solana` client).
 */

export interface CredioClientOptions {
  baseUrl?: string
}

export interface AgentMetadata {
  agentName?: string
  service?: string
}

export interface PayForResourceParams {
  agentWalletAddress: string
  /** An x402-protected URL that returns HTTP 402 with payment requirements. */
  resourceUrl: string
  agentMetadata?: AgentMetadata
  /** Optional Ed25519 proof-of-ownership (wallet address signs `message`). */
  signature?: string
  message?: string
}

export interface AgentStatus {
  currentUsdcDebt: number
  usdcCreditLimit: number
  remainingCreditUsd: number
  credibilityScore: number
  tierName: string
}

export interface PayForResourceResult {
  success: boolean
  error?: string
  paymentMethod?: "credit"
  facilitator?: string
  transactionSignature?: string
  settlementTx?: string
  amountPaid?: number
  currency?: "USDC"
  network?: string
  /** The protected resource's response, fetched after Credio paid for it. */
  resource?: { status: number; body: unknown }
  agentStatus?: AgentStatus
}

export interface RepayResult {
  success: boolean
  error?: string
  clearedUsdc?: number
  remainingDebt?: number
}

export class CredioClient {
  private baseUrl: string

  constructor(opts: CredioClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || "https://credio.cc").replace(/\/$/, "")
  }

  private url(path: string) {
    return `${this.baseUrl}/api/credio${path}`
  }

  /** Register an agent (idempotent; also auto-called on first credit request). */
  async register(agentWalletAddress: string, agentName?: string) {
    const r = await fetch(this.url("/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: agentWalletAddress, agentName }),
    })
    return r.json()
  }

  /** Agent status: tier, debt, credit limit, credibility. */
  async getStatus(agentWalletAddress: string) {
    const r = await fetch(this.url(`/agent/${agentWalletAddress}`))
    return r.json()
  }

  /** Check available credit (and global pool headroom) for an amount. */
  async checkCredit(agentWalletAddress: string, amount = 0) {
    const r = await fetch(this.url("/x402/check"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentWalletAddress, amount }),
    })
    return r.json()
  }

  /**
   * Pay for an x402-protected resource using Credio credit. Credio reads the
   * resource's 402, applies its credit checks, settles the payment as a genuine
   * x402 transaction, and returns the resource plus your updated debt.
   */
  async payForResource(params: PayForResourceParams): Promise<PayForResourceResult> {
    const r = await fetch(this.url("/x402/pay-resource"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentWalletAddress: params.agentWalletAddress,
        resourceUrl: params.resourceUrl,
        agentMetadata: params.agentMetadata,
        signature: params.signature,
        message: params.message,
      }),
    })
    return r.json()
  }

  /** Outstanding debt + the treasury address to repay to. */
  async checkDebt(agentWalletAddress: string) {
    const r = await fetch(this.url("/x402/repay/check"), {
      headers: { "Wallet-Address": agentWalletAddress },
    })
    return r.json()
  }

  /**
   * Manual repayment: you sign and broadcast a USDC transfer to the treasury
   * yourself, then report the signature. Credio verifies it on-chain before
   * clearing debt.
   */
  async repay(agentWalletAddress: string, txSignature: string): Promise<RepayResult> {
    const r = await fetch(this.url("/x402/repay"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentWalletAddress, txSignature }),
    })
    return r.json()
  }

  /**
   * URL of the x402 repay invoice for gasless repayment. Pay it with the
   * official `x402-solana` client using your agent wallet — the agent needs
   * USDC but no SOL:
   *
   *   import { createX402Client } from "x402-solana/client"
   *   const client = createX402Client({ wallet, network: "solana", rpcUrl })
   *   await client.fetch(credio.repayInvoiceUrl(WALLET))
   */
  repayInvoiceUrl(agentWalletAddress: string) {
    return this.url(`/x402/repay-invoice?agent=${agentWalletAddress}`)
  }

  /** The Credio treasury address (repayment destination). */
  async treasuryAddress() {
    const r = await fetch(this.url("/treasury-address"))
    return r.json()
  }
}

export interface CredioFallbackOptions {
  agentWalletAddress: string
  baseUrl?: string
  agentMetadata?: AgentMetadata
  /**
   * HTTP statuses from the inner fetch that mean "payment failed, use credit".
   * Defaults to [402] (x402 Payment Required after the agent's own attempt).
   */
  fallbackStatuses?: number[]
}

function resourceUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

/**
 * Wrap an existing fetch so x402 payments fall back to Credio credit
 * AUTOMATICALLY. The agent pays from its own wallet first; if that fails
 * (insufficient funds / 402), Credio fronts the payment and the agent repays
 * later. No manual branching, this is the drop-in fallback.
 *
 * Pass an x402 client bound to the agent's own wallet as `innerFetch` so own
 * funds are tried first (recommended). A plain `fetch` also works and simply
 * routes every paid resource through Credio credit.
 *
 *   import { createX402Client } from "x402-solana/client"
 *   import { withCredioFallback } from "credio-sdk"
 *
 *   const client = createX402Client({ wallet, network: "solana", rpcUrl })
 *   const own = client.fetch.bind(client) // bind: fetch() relies on `this`
 *   const fetch = withCredioFallback(own, { agentWalletAddress: WALLET })
 *
 *   const res = await fetch("https://api.example.com/premium") // just works
 *
 * On the credit path the returned Response carries:
 *   x-credio-paid: "credit" | "failed"
 *   x-credio-settlement: <on-chain tx signature>
 */
export function withCredioFallback(
  innerFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  opts: CredioFallbackOptions,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const credio = new CredioClient({ baseUrl: opts.baseUrl })
  const fallbackStatuses = opts.fallbackStatuses ?? [402]

  return async (input, init) => {
    // 1) Try the agent's own funds first.
    try {
      const res = await innerFetch(input, init)
      if (res.ok || !fallbackStatuses.includes(res.status)) return res
    } catch {
      // own-wallet payment threw (e.g. no USDC) — fall through to credit.
    }

    // 2) Fall back to Credio credit (Credio fronts the x402 payment).
    const r = await credio.payForResource({
      agentWalletAddress: opts.agentWalletAddress,
      resourceUrl: resourceUrlOf(input),
      agentMetadata: opts.agentMetadata,
    })

    const body = r.success ? r.resource?.body ?? r : { error: r.error ?? "credit failed" }
    return new Response(JSON.stringify(body), {
      status: r.success ? r.resource?.status ?? 200 : 502,
      headers: {
        "content-type": "application/json",
        "x-credio-paid": r.success ? "credit" : "failed",
        "x-credio-settlement": r.settlementTx ?? "",
      },
    })
  }
}

export default CredioClient
