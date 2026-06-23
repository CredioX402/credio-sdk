/**
 * Credio quickstart — credit + repayment for an x402 agent.
 *
 *   npm i credio-sdk
 *   AGENT_WALLET=<your solana address> npx tsx examples/quickstart.ts
 */
import { CredioClient } from "credio-sdk"

const WALLET = process.env.AGENT_WALLET || "YOUR_SOLANA_WALLET_ADDRESS"
const credio = new CredioClient({ baseUrl: "https://credio.cc" })

async function main() {
  // 1) Check how much credit this agent has available.
  console.log("credit:", await credio.checkCredit(WALLET, 0.01))

  // 2) Pay for an x402-protected resource with credit. Credio fronts the USDC,
  //    settles the real x402 payment, and returns the resource.
  const res = await credio.payForResource({
    agentWalletAddress: WALLET,
    resourceUrl: "https://credio.cc/api/demo/premium", // any x402 endpoint
    agentMetadata: { agentName: "Quickstart Agent" },
  })

  if (!res.success) {
    console.error("credit failed:", res.error)
    return
  }
  console.log("resource:", res.resource?.body)
  console.log("settled tx:", res.settlementTx)
  console.log("debt now:", res.agentStatus?.currentUsdcDebt, "USDC")

  // 3) Repay — gasless x402 (recommended). Pay the repay invoice with the
  //    official x402-solana client; the agent needs USDC but no SOL:
  //
  //   import { createX402Client } from "x402-solana/client"
  //   const client = createX402Client({ wallet, network: "solana", rpcUrl })
  //   await client.fetch(credio.repayInvoiceUrl(WALLET))
  //
  // ...or repay manually: send USDC to the treasury and report the signature:
  //   const { treasuryAddress } = await credio.checkDebt(WALLET)
  //   const sig = await sendUsdcToTreasury(treasuryAddress, debt)
  //   await credio.repay(WALLET, sig)
}

main().catch(console.error)
