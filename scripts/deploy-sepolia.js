// Deploys the ERC-KYA reference stack to Sepolia.
//
//   RPC_URL=https://... PRIVATE_KEY=0x... node scripts/deploy-sepolia.js
//
// Deploys: KYASchemeRegistry, KYARegistry, KYAPolicyRegistry, ValidationRegistry8004 (bound to the
// official ERC-8004 IdentityRegistry), KYABridge8004, Groth16Verifier (snarkjs), Groth16KYAVerifierAdapter
// (pinned to the demo issuer-set root). Writes deployments/sepolia.json.
const { getSigner, factory, saveJson, NETWORKS } = require("./lib");
const { ZK } = require("../companions/zk-kya-groth16/prover");

// Demo issuer set — TEST ONLY. Keys are derived from public seeds so anyone can reproduce the proofs.
const DEMO_ATTESTOR_SEEDS = ["kya-demo-issuer-alice", "kya-demo-issuer-bob", "kya-demo-issuer-carol"];

(async () => {
  const { net, wallet, provider } = getSigner("sepolia");
  const bal = await provider.getBalance(wallet.address);
  console.log(`deployer ${wallet.address}  balance ${Number(bal) / 1e18} ETH  chainId ${(await provider.getNetwork()).chainId}`);
  if (bal < 20_000_000_000_000_000n) console.warn("  ! balance under 0.02 ETH — deployment may fail");

  const zk = await ZK.create();
  const attestors = DEMO_ATTESTOR_SEEDS.map((s) => zk.newAttestor(s));
  const set = zk.issuerSet(attestors.map((a) => a.pub));
  console.log(`demo issuer set root ${set.rootHex}`);

  const out = { network: "sepolia", chainId: net.chainId.toString(), deployer: wallet.address, deployedAt: new Date().toISOString(),
    erc8004: { identityRegistry: net.identityRegistry, reputationRegistry: net.reputationRegistry }, contracts: {}, demoIssuerSet: { seeds: DEMO_ATTESTOR_SEEDS, root: set.rootHex } };

  async function deploy(name, args = []) {
    const f = factory(name, wallet);
    const c = await f.deploy(...args);
    process.stdout.write(`  deploy ${name.padEnd(28)} ${c.deploymentTransaction().hash}`);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`  → ${addr}`);
    out.contracts[name] = { address: addr, tx: c.deploymentTransaction().hash, args: args.map(String) };
    return c;
  }

  console.log("\ndeploying …");
  const schemes = await deploy("KYASchemeRegistry");
  const kya = await deploy("KYARegistry", [await schemes.getAddress()]);
  await deploy("KYAPolicyRegistry", [await kya.getAddress()]);
  const validation = await deploy("ValidationRegistry8004", [net.identityRegistry]);
  await deploy("KYABridge8004", [await kya.getAddress(), await validation.getAddress(), wallet.address]);
  const g16 = await deploy("Groth16Verifier");
  // epoch window: 30-day epochs, previous epoch still accepted (revocation latency ≤ 30 d)
  const EPOCH_SECONDS = 2592000, EPOCH_GRACE = 1;
  out.adapterConfig = { epochSeconds: EPOCH_SECONDS, epochGrace: EPOCH_GRACE, issuerSetRoot: set.rootHex };
  await deploy("Groth16KYAVerifierAdapter", [await g16.getAddress(), set.rootHex, EPOCH_SECONDS, EPOCH_GRACE]);

  const p = saveJson("sepolia.json", out);
  console.log(`\nwrote ${p}`);
  for (const [n, c] of Object.entries(out.contracts)) console.log(`  ${n.padEnd(28)} ${NETWORKS.sepolia.explorer}/address/${c.address}`);
})().catch((e) => { console.error(e); process.exit(1); });
