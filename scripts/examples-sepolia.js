// Worked examples on Sepolia against deployments/sepolia.json.
//
//   RPC_URL=https://... PRIVATE_KEY=0x... node scripts/examples-sepolia.js
//
// 1. Register an agent on the OFFICIAL ERC-8004 IdentityRegistry and set the "kya" metadata key.
// 2. Register an ATTESTED scheme and a PROVED (ZK) scheme; record descriptors as data: URIs.
// 3. Attested flow: attest level 2 → resolve / check.
// 4. ZK flow: demo attestor Bob signs off-chain, prover builds a Groth16 proof → attestWithProof → check.
// 5. Policy: registerPolicyWithRules (attested ≥2 AND proved ≥4) → evaluate.
// 6. ERC-8004 bridge: configure → validationRequest (agent owner) → sync → getSummary under tag "kya:…".
// Writes deployments/sepolia-examples.json with every tx hash.
const { getSigner, attach, identityRegistry, loadDeployment, saveJson, sendAndWait, dataUri, ethers } = require("./lib");
const { ZK } = require("../companions/zk-kya-groth16/prover");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));

(async () => {
  const dep = loadDeployment("sepolia");
  if (!dep) throw new Error("run scripts/deploy-sepolia.js first");
  const { net, wallet } = getSigner("sepolia");
  const C = (n) => attach(n, dep.contracts[n].address, wallet);
  const schemes = C("KYASchemeRegistry"), kya = C("KYARegistry"), policies = C("KYAPolicyRegistry");
  const validation = C("ValidationRegistry8004"), bridge = C("KYABridge8004"), adapter = C("Groth16KYAVerifierAdapter");
  const identity = identityRegistry(net.identityRegistry, wallet);
  const log = { network: "sepolia", runAt: new Date().toISOString(), steps: {} };
  const rec = (k, v) => { log.steps[k] = v; };

  // ---- 1. agent on the official ERC-8004 registry --------------------------------------------
  console.log("\n1. ERC-8004 agent");
  const agentFile = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "KYA demo agent", description: "Demo agent for the ERC-KYA companion (Sepolia).",
    services: [{ name: "KYA", endpoint: "https://example.org/.well-known/kya.json", version: "v1" }],
    supportedTrust: ["kya", "zk-kya"], active: true,
  };
  let rc = await sendAndWait("register(agentURI)", identity["register(string)"](dataUri(agentFile)));
  const regEv = rc.logs.map((l) => { try { return identity.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Registered");
  const agentId = regEv.args.agentId;
  console.log(`  agentId ${agentId}`);
  rec("registerAgent", { tx: rc.hash, agentId: agentId.toString(), identityRegistry: net.identityRegistry });

  const subject = { subjectType: ERC8004, subjectData: coder.encode(["uint256", "address", "uint256"], [net.chainId, net.identityRegistry, agentId]) };
  const subjectKey = await kya.subjectKeyOf(subject);
  console.log(`  subjectKey ${subjectKey}`);

  // ---- 2. schemes ------------------------------------------------------------------------------
  console.log("\n2. schemes");
  const attestedDesc = {
    type: "https://eips.ethereum.org/EIPS/eip-9999#kya-scheme-v1", name: "Controller Binding (attested) v1",
    description: "Issuer checked that the agent's endpoint and wallet are controlled by one operator.", version: "1.0.0", mode: "attested", binding: "controller", result: { kind: "ordered-level" },
    dimensions: ["controller-binding"], levels: { "0": { label: "not verified", erc8004Response: 0 }, "1": { label: "self-asserted", erc8004Response: 25 }, "2": { label: "controller-linked", erc8004Response: 60 }, "3": { label: "independently verified", erc8004Response: 100 } },
    evidenceKinds: ["domain-proof", "erc8004-validation"], issuerPolicy: { kind: "open" },
  };
  const attestedBytes = Buffer.from(JSON.stringify(attestedDesc));
  rc = await sendAndWait("registerScheme(attested)", schemes.registerScheme(dataUri(attestedDesc), ethers.keccak256(attestedBytes), 0, 1 /* CONTROLLER */, ethers.ZeroAddress, ethers.ZeroHash));
  const attestedScheme = rc.logs.map((l) => { try { return schemes.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "SchemeRegistered").args.schemeId;
  console.log(`  attested schemeId ${attestedScheme}`);

  const provedDesc = {
    type: "https://eips.ethereum.org/EIPS/eip-9999#kya-scheme-v1", name: "Accountable Operator (ZK) v1",
    description: "Proves, without disclosure, that a member of the pinned issuer set attested accountability for the agent.", version: "1.0.0", mode: "proved", binding: "controller", result: { kind: "ordered-level" },
    dimensions: ["accountability", "compliance"], levels: { "0": { label: "not verified", erc8004Response: 0 }, "4": { label: "accountable", erc8004Response: 100 } },
    evidenceKinds: ["zk-proof"], issuerPolicy: { kind: "verifier-only" },
    circuit: { system: "groth16", vkHash: ethers.keccak256(Buffer.from(JSON.stringify(require("../companions/zk-kya-groth16/build/verification_key.json")))),
      publicInputLayout: ["subjectKey", "nullifier", "level", "claimDigest", "expiresAt", "issuerSetRoot", "epoch"],
      publicInputAbi: ["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], nullifierScope: "scheme-epoch", proofBinding: ["schemeId", "admissionDomain"],
      epochSeconds: dep.adapterConfig.epochSeconds, epochGrace: dep.adapterConfig.epochGrace, issuerHiding: true, issuerSetRoot: dep.adapterConfig.issuerSetRoot,
      credentialBinding: ["subjectKey", "schemeId", "level", "claimDigest", "expiresAt", "proverCommitment"] },
  };
  rc = await sendAndWait("registerScheme(proved)", schemes.registerScheme(dataUri(provedDesc), ethers.keccak256(Buffer.from(JSON.stringify(provedDesc))), 1, 1 /* CONTROLLER */, dep.contracts.Groth16KYAVerifierAdapter.address, ethers.ZeroHash));
  const provedScheme = rc.logs.map((l) => { try { return schemes.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "SchemeRegistered").args.schemeId;
  console.log(`  proved schemeId ${provedScheme}`);
  rec("schemes", { attested: attestedScheme, proved: provedScheme });

  // advertise on the 8004 identity (metadata key "kya")
  rc = await sendAndWait('setMetadata(agentId,"kya")', identity.setMetadata(agentId, "kya", coder.encode(["address", "bytes32[]"], [dep.contracts.KYARegistry.address, [attestedScheme, provedScheme]])));
  rec("setMetadataKya", { tx: rc.hash });

  // ---- 3. attested flow -------------------------------------------------------------------------
  console.log("\n3. attested assertion");
  const expiresAt = Math.floor(Date.now() / 1000) + 90 * 86400;
  rc = await sendAndWait("attest(level 2)", kya.attest(subject, attestedScheme, 2, ethers.id("controller-binding:ok"), expiresAt, dataUri({ evidence: "demo" }), ethers.id("evidence-demo")));
  const a1 = rc.logs.map((l) => { try { return kya.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Asserted").args.assertionId;
  const r1 = await kya.resolve(subject, attestedScheme, [wallet.address]);
  console.log(`  assertionId ${a1}  resolve → level ${r1.level}  check(≥2) ${await kya.check(subject, attestedScheme, 2, [wallet.address])}`);
  rec("attest", { tx: rc.hash, assertionId: a1, level: 2, issuer: wallet.address });

  // ---- 4. ZK flow -------------------------------------------------------------------------------
  console.log("\n4. ZK-KYA assertion (Groth16)");
  const zk = await ZK.create();
  const attestors = dep.demoIssuerSet.seeds.map((s) => zk.newAttestor(s));
  const set = zk.issuerSet(attestors.map((a) => a.pub));
  if (set.rootHex !== dep.demoIssuerSet.root) throw new Error("issuer set root mismatch with deployment");
  const secret = zk.randomSecret();
  const claim = { subjectKey, schemeId: provedScheme, level: 4, claimDigest: ethers.id("claims:jurisdiction=SG;entity-verified"), expiresAt };
  const sig = zk.attest(attestors[1], claim, secret); // Bob signs a scheme-bound credential; on-chain nobody learns it was Bob
  const epoch = await adapter.currentEpoch();          // enforced on-chain from block.timestamp
  process.stdout.write(`  proving (epoch ${epoch}) …`);
  const t0 = Date.now();
  const admissionDomain = zk.admissionDomain(net.chainId, dep.contracts.KYASchemeRegistry.address, dep.contracts.KYARegistry.address);
  const pr = await zk.prove({ ...claim, epoch, admissionDomain, secret, attestor: attestors[1], sig, set });
  console.log(` ${((Date.now() - t0) / 1000).toFixed(1)}s  nullifier ${pr.nullifier}`);
  const v = await adapter.verify(provedScheme, pr.publicInputs, pr.proof);
  console.log(`  adapter.verify → ok=${v.ok} level=${v.level}`);
  rc = await sendAndWait("attestWithProof", kya.attestWithProof(subject, provedScheme, pr.publicInputs, pr.proof, dataUri({ layout: "kya-public-v1" })));
  const a2 = rc.logs.map((l) => { try { return kya.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Asserted").args.assertionId;
  console.log(`  assertionId ${a2}  check(≥4, issuers=[adapter]) ${await kya.check(subject, provedScheme, 4, [dep.contracts.Groth16KYAVerifierAdapter.address])}`);
  rec("attestWithProof", { tx: rc.hash, assertionId: a2, nullifier: pr.nullifier, publicInputs: pr.publicInputs, proof: pr.proof, publicSignals: pr.publicSignals });

  // ---- 5. policy --------------------------------------------------------------------------------
  console.log("\n5. policy");
  const policyDesc = { type: "https://eips.ethereum.org/EIPS/eip-9999#kya-policy-v1", name: "demo counterparty baseline",
    require: { allOf: [{ schemeId: attestedScheme, minLevel: 2, issuers: [wallet.address] }, { schemeId: provedScheme, minLevel: 4, issuers: [dep.contracts.Groth16KYAVerifierAdapter.address] }] } };
  const rules = [{ schemeId: attestedScheme, minLevel: 2, issuers: [wallet.address] }, { schemeId: provedScheme, minLevel: 4, issuers: [dep.contracts.Groth16KYAVerifierAdapter.address] }];
  policyDesc.onchain = { evaluator: `eip155:${net.chainId}:${dep.contracts.KYAPolicyRegistry.address}`, rulesHash: await policies.rulesHashOf(rules), sufficient: true };
  rc = await sendAndWait("registerPolicyWithRules", policies.registerPolicyWithRules(dataUri(policyDesc), ethers.keccak256(Buffer.from(JSON.stringify(policyDesc))), rules));
  const policyId = rc.logs.map((l) => { try { return policies.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "PolicyRegistered").args.policyId;
  console.log(`  policyId ${policyId}  evaluate → ${await policies.evaluate(subject, policyId)}`);
  rec("policy", { tx: rc.hash, policyId });

  // ---- 6. ERC-8004 bridge -----------------------------------------------------------------------
  console.log("\n6. ERC-8004 bridge");
  rc = await sendAndWait("bridge.configureScheme", bridge.configureScheme(attestedScheme, [wallet.address], [0, 25, 60, 100]));
  const cfgTx = rc.hash;
  const requestHash = await bridge.requestHashFor(agentId, attestedScheme);
  rc = await sendAndWait("validationRequest(bridge)", validation.validationRequest(dep.contracts.KYABridge8004.address, agentId, dataUri({ type: "erc-kya-request-v1", chainId: net.chainId.toString(), identityRegistry: net.identityRegistry, bridge: dep.contracts.KYABridge8004.address, agentId: agentId.toString(), schemeId: attestedScheme }), requestHash));
  const reqTx = rc.hash;
  rc = await sendAndWait("bridge.sync", bridge.sync(agentId, attestedScheme));
  const st = await validation.getValidationStatus(requestHash);
  const sum = await validation.getSummary(agentId, [dep.contracts.KYABridge8004.address], await bridge.tagFor(attestedScheme));
  console.log(`  mirrored response ${st.response}/100  tag "${st.tag}"  getSummary → count ${sum.count} avg ${sum.averageResponse}`);
  rec("bridge", { configureTx: cfgTx, requestTx: reqTx, syncTx: rc.hash, requestHash, response: st.response.toString(), tag: st.tag });

  const p = saveJson("sepolia-examples.json", log);
  console.log(`\nwrote ${p}`);
})().catch((e) => { console.error(e); process.exit(1); });
