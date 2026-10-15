// Sign every tx of an offline plan locally and emit fully signed raw txs for broadcast.
// Usage: node scripts/offline/sign-plan.js <plan.json> '<{"<nonce>":gasLimit,...}>' [maxFeeGwei] [prioGwei] > signed.json
// The private key never leaves this machine; the output contains only signed transactions.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.secrets/sepolia-deployer.json"), "utf8"));
const w = new ethers.Wallet(key.privateKey);
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const gas = JSON.parse(process.argv[3]);
const maxFee = ethers.parseUnits(process.argv[4] ?? "1.5", "gwei");
const prio = ethers.parseUnits(process.argv[5] ?? "0.1", "gwei");
(async () => {
  const out = [];
  for (const it of plan.plan) {
    const g = gas[String(it.nonce)];
    if (!g) throw new Error("no gasLimit for nonce " + it.nonce);
    const tx = { type: 2, chainId: 11155111, nonce: it.nonce, to: it.to ?? null, data: it.data, gasLimit: BigInt(g), value: 0n, maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
    const raw = await w.signTransaction(tx);
    const parsed = ethers.Transaction.from(raw);
    if (parsed.from !== w.address) throw new Error("signer mismatch");
    out.push({ label: it.label, nonce: it.nonce, hash: parsed.hash, raw, predicted: it.predicted ?? null, to: it.to ?? null, gasLimit: String(g) });
  }
  process.stdout.write(JSON.stringify(out));
})();
