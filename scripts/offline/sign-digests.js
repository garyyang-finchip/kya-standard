// Sign EIP-1559 tx digests produced by the browser, but only after reconstructing the same
// unsigned tx locally from (nonce,to,data,gasLimit,fees) and confirming the digest matches.
// Usage: node scripts/offline/sign-digests.js '<json array of {nonce,to,data|dataFile,gasLimit,digest,maxFeeGwei?,prioGwei?}>'
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.secrets/sepolia-deployer.json"), "utf8"));
const w = new ethers.Wallet(key.privateKey);
const items = JSON.parse(process.argv[2]);
const out = [];
for (const it of items) {
  const data = it.data ?? fs.readFileSync(it.dataFile, "utf8").trim();
  const t = ethers.Transaction.from({ type: 2, chainId: 11155111, nonce: it.nonce, to: it.to, data, gasLimit: BigInt(it.gasLimit), value: 0n,
    maxFeePerGas: ethers.parseUnits(String(it.maxFeeGwei ?? 4), "gwei"), maxPriorityFeePerGas: ethers.parseUnits(String(it.prioGwei ?? 0.5), "gwei") });
  if (t.unsignedHash !== it.digest) { out.push({ nonce: it.nonce, error: "digest mismatch", local: t.unsignedHash, browser: it.digest }); continue; }
  const s = w.signingKey.sign(it.digest);
  out.push({ nonce: it.nonce, r: s.r, s: s.s, v: s.v });
}
console.log(JSON.stringify(out));
