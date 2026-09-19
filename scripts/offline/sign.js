// Offline signer: reads a plan (array of {label,to,data,value,gasLimit}) and writes signed raw txs.
// Usage: node scripts/offline/sign.js <plan.json> <startNonce> <maxFeeGwei> <priorityGwei> > signed.json
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const [planPath, startNonceArg, maxFeeArg = "10", prioArg = "1.5"] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.secrets/sepolia-deployer.json"), "utf8"));
const wallet = new ethers.Wallet(key.privateKey);
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
let nonce = Number(startNonceArg);
const maxFeePerGas = ethers.parseUnits(maxFeeArg, "gwei");
const maxPriorityFeePerGas = ethers.parseUnits(prioArg, "gwei");

(async () => {
  const out = [];
  for (const t of plan) {
    const tx = { type: 2, chainId: 11155111, nonce, to: t.to ?? null, data: t.data, value: t.value ? BigInt(t.value) : 0n, gasLimit: BigInt(t.gasLimit), maxFeePerGas, maxPriorityFeePerGas };
    const raw = await wallet.signTransaction(tx);
    const parsed = ethers.Transaction.from(raw);
    out.push({ label: t.label, nonce, hash: parsed.hash, raw, predictedAddress: t.to ? undefined : ethers.getCreateAddress({ from: wallet.address, nonce }) });
    nonce++;
  }
  process.stdout.write(JSON.stringify(out));
})();
