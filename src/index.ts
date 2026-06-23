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

export default CredioClient
