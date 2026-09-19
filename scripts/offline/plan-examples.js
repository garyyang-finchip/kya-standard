// Build the six worked examples as offline calldata against deployments/sepolia.json (revision 2).
// Usage: node scripts/offline/plan-examples.js <startNonce> <agentId> > deployments/offline/plan-r2-examples.json
const { ethers } = require("ethers");
const artifacts = require("../../build/artifacts.json");
const { NETWORKS, dataUri } = require("../lib");
const { ZK } = require("../../companions/zk-kya-groth16/prover");
const dep = require("../../deployments/sepolia.json");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));
const I = (n) => new ethers.Interface(artifacts[n].abi);
const idAbi = new ethers.Interface(require("../abis/ERC8004IdentityRegistry.json"));

(async () => {
  let nonce = Number(process.argv[2]);
  const agentId = BigInt(process.argv[3]);
  const net = NETWORKS.sepolia;
  const A = Object.fromEntries(Object.entries(dep.contracts).map(([k, v]) => [k, v.address]));
  const deployer = dep.deployer;
  const subject = { subjectType: ERC8004, subjectData: coder.encode(["uint256", "address", "uint256"], [net.chainId, net.identityRegistry, agentId]) };
  const subjectKey = ethers.keccak256(coder.encode(["bytes32", "bytes"], [subject.subjectType, subject.subjectData]));

  const attestedDesc = {
    type: "https://eips.ethereum.org/EIPS/eip-9999#kya-scheme-v1", name: "Controller Binding (attested) v1",
    description: "Issuer checked that the agent's endpoint and wallet are controlled by one operator.", version: "1.0.0", mode: "attested", binding: "controller", result: { kind: "ordered-level" },
    dimensions: ["controller-binding"], levels: { "0": { label: "not verified", erc8004Response: 0 }, "1": { label: "self-asserted", erc8004Response: 25 }, "2": { label: "controller-linked", erc8004Response: 60 }, "3": { label: "independently verified", erc8004Response: 100 } },
    evidenceKinds: ["domain-proof", "erc8004-validation"], issuerPolicy: { kind: "open" },
  };
  const vkHash = ethers.keccak256(Buffer.from(JSON.stringify(require("../../companions/zk-kya-groth16/build/verification_key.json"))));
  const provedDesc = {
    type: "https://eips.ethereum.org/EIPS/eip-9999#kya-scheme-v1", name: "Accountable Operator (ZK) v1",
    description: "Proves, without disclosure, that a member of the pinned issuer set attested accountability for the agent.", version: "1.0.0", mode: "proved", binding: "controller", result: { kind: "ordered-level" },
    dimensions: ["accountability", "compliance"], levels: { "0": { label: "not verified", erc8004Response: 0 }, "4": { label: "accountable", erc8004Response: 100 } },
    evidenceKinds: ["zk-proof"], issuerPolicy: { kind: "verifier-only" },
    circuit: { system: "groth16", vkHash, publicInputLayout: ["subjectKey", "nullifier", "level", "claimDigest", "expiresAt", "issuerSetRoot", "epoch"],
      publicInputAbi: ["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], nullifierScope: "scheme-epoch",
      epochSeconds: dep.adapterConfig.epochSeconds, epochGrace: dep.adapterConfig.epochGrace, issuerHiding: true, issuerSetRoot: dep.adapterConfig.issuerSetRoot,
      credentialBinding: ["subjectKey", "schemeId", "level", "claimDigest", "expiresAt", "proverCommitment"] },
  };
  const aHash = ethers.keccak256(Buffer.from(JSON.stringify(attestedDesc)));
  const pHash = ethers.keccak256(Buffer.from(JSON.stringify(provedDesc)));
  // deterministic ids: fresh scheme registry → deployer nonces 0 and 1
  const attestedScheme = ethers.keccak256(coder.encode(["address", "bytes32", "uint256"], [deployer, aHash, 0]));
  const provedScheme = ethers.keccak256(coder.encode(["address", "bytes32", "uint256"], [deployer, pHash, 1]));

  const plan = [];
  const add = (label, to, data, extra = {}) => plan.push({ label, nonce: nonce++, to, data, ...extra });
  const S = I("KYASchemeRegistry"), K = I("KYARegistry"), P = I("KYAPolicyRegistry"), B = I("KYABridge8004"), V = I("ValidationRegistry8004");

  // round A
  add("registerScheme(attested)", A.KYASchemeRegistry, S.encodeFunctionData("registerScheme", [dataUri(attestedDesc), aHash, 0, ethers.ZeroAddress, ethers.ZeroHash]), { round: "A" });
  add("registerScheme(proved)", A.KYASchemeRegistry, S.encodeFunctionData("registerScheme", [dataUri(provedDesc), pHash, 1, A.Groth16KYAVerifierAdapter, ethers.ZeroHash]), { round: "A" });
  add("setMetadata(agentId,\"kya\")", net.identityRegistry, idAbi.encodeFunctionData("setMetadata", [agentId, "kya", coder.encode(["address", "bytes32[]"], [A.KYARegistry, [attestedScheme, provedScheme]])]), { round: "A" });

  // round B
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 90 * 86400;
  add("attest(level 2)", A.KYARegistry, K.encodeFunctionData("attest", [subject, attestedScheme, 2, ethers.id("controller-binding:ok"), expiresAt, dataUri({ evidence: "demo" }), ethers.id("evidence-demo")]), { round: "B" });

  const zk = await ZK.create();
  const attestors = dep.demoIssuerSet.seeds.map((s) => zk.newAttestor(s));
  const set = zk.issuerSet(attestors.map((a) => a.pub));
  if (set.rootHex !== dep.demoIssuerSet.root) throw new Error("root mismatch");
  const secret = zk.randomSecret();
  const claim = { subjectKey, schemeId: provedScheme, level: 4, claimDigest: ethers.id("claims:jurisdiction=SG;entity-verified"), expiresAt };
  const sig = zk.attest(attestors[1], claim, secret);
  const epoch = zk.epochFor(now, dep.adapterConfig.epochSeconds);
  const pr = await zk.prove({ ...claim, epoch, secret, attestor: attestors[1], sig, set });
  if (!(await zk.verifyLocally(pr.publicSignals, pr.rawProof))) throw new Error("proof invalid");
  add("attestWithProof", A.KYARegistry, K.encodeFunctionData("attestWithProof", [subject, provedScheme, pr.publicInputs, pr.proof, dataUri({ layout: "kya-public-v1", circuit: "kya_public_v1 rev 2" })]), { round: "B" });

  const policyDesc = { type: "https://eips.ethereum.org/EIPS/eip-9999#kya-policy-v1", name: "demo counterparty baseline",
    require: { allOf: [{ schemeId: attestedScheme, minLevel: 2, issuers: [deployer] }, { schemeId: provedScheme, minLevel: 4, issuers: [A.Groth16KYAVerifierAdapter], anchors: [set.rootHex] }] } };
  const polHash = ethers.keccak256(Buffer.from(JSON.stringify(policyDesc)));
  const policyId = ethers.keccak256(coder.encode(["address", "bytes32", "uint256"], [deployer, polHash, 0]));
  add("registerPolicyWithRules", A.KYAPolicyRegistry, P.encodeFunctionData("registerPolicyWithRules", [dataUri(policyDesc), polHash,
    [{ schemeId: attestedScheme, minLevel: 2, issuers: [deployer] }, { schemeId: provedScheme, minLevel: 4, issuers: [A.Groth16KYAVerifierAdapter] }]]), { round: "B" });
  add("bridge.configureScheme", A.KYABridge8004, B.encodeFunctionData("configureScheme", [attestedScheme, [deployer], [0, 25, 60, 100]]), { round: "B" });
  const requestHash = ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "address", "uint256", "bytes32"], [ethers.id("erc-kya-request-v1"), net.chainId, net.identityRegistry, A.KYABridge8004, agentId, attestedScheme]));
  add("validationRequest(bridge)", A.ValidationRegistry8004, V.encodeFunctionData("validationRequest", [A.KYABridge8004, agentId, dataUri({ type: "erc-kya-request-v1", chainId: net.chainId.toString(), identityRegistry: net.identityRegistry, bridge: A.KYABridge8004, agentId: agentId.toString(), schemeId: attestedScheme }), requestHash]), { round: "B" });
  // round C
  add("bridge.sync", A.KYABridge8004, B.encodeFunctionData("sync", [agentId, attestedScheme]), { round: "C" });

  const meta = { agentId: agentId.toString(), subjectKey, attestedScheme, provedScheme, policyId, requestHash, tag: "kya:" + attestedScheme.slice(2, 10), expiresAt, epoch: epoch.toString(),
    descriptors: { attested: attestedDesc, proved: provedDesc, policy: policyDesc, hashes: { attested: aHash, proved: pHash, policy: polHash } },
    zk: { nullifier: pr.nullifier, publicInputs: pr.publicInputs, proof: pr.proof, publicSignals: pr.publicSignals, attestor: "kya-demo-issuer-bob (hidden on-chain)", issuerSetRoot: set.rootHex } };
  process.stdout.write(JSON.stringify({ meta, plan }, null, 1));
  process.exit(0);
})();
