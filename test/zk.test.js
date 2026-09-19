// ZK-KYA companion end-to-end: real Groth16 proof → snarkjs Verifier.sol → adapter → KYARegistry.
// Requires the circuit build (companions/zk-kya-groth16/build/*). Run: npm run test:zk
const assert = require("assert");
const path = require("path");
const { Harness, expectRevert, ethers } = require("./harness");
const { ZK } = require("../companions/zk-kya-groth16/prover");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));
const subject8004 = (chainId, reg, id) => ({ subjectType: ERC8004, subjectData: coder.encode(["uint256", "address", "uint256"], [chainId, reg, id]) });
const subjectKeyOf = (s) => ethers.keccak256(coder.encode(["bytes32", "bytes"], [s.subjectType, s.subjectData]));

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n     ", e.stack.split("\n").slice(0, 3).join("\n      ")); process.exitCode = 1; }
}

(async () => {
  const h = await Harness.create();
  const A = (n) => ethers.getAddress(h.accounts[n].toString());
  const zk = await ZK.create();

  const schemes = await h.deploy("KYASchemeRegistry");
  const kya = await h.deploy("KYARegistry", [schemes.addr]);
  const g16 = await h.deploy("Groth16Verifier");

  // issuer set: three attestors, we pin the root in the adapter
  const attestors = ["alice-kya-issuer", "bob-kya-issuer", "carol-kya-issuer"].map((s) => zk.newAttestor(s));
  const set = zk.issuerSet(attestors.map((a) => a.pub));
  const adapter = await h.deploy("Groth16KYAVerifierAdapter", [g16.addr, set.rootHex]);

  const { result: schemeId } = await schemes.send("registerScheme", ["ipfs://accountable-operator-zk-v1", ethers.id("zk-desc"), 1, adapter.addr, ethers.ZeroHash], "issuerA");

  const subj = subject8004(1n, "0x8004A818BFB912233c491871b3d84c89A494BD9e", 22n);
  const subjectKey = subjectKeyOf(subj);
  const claim = { subjectKey, level: 4, claimDigest: ethers.id("claims:jurisdiction=SG;capital>=1e6"), expiresAt: 1_900_000_000 };

  console.log("\nZK-KYA companion (Groth16, kya-public-v1, depth-16 issuer set)\n");

  let first;
  await test("attestor Bob signs; prover builds a Groth16 proof that verifies off-chain", async () => {
    const secret = zk.randomSecret();
    const sig = zk.attest(attestors[1], claim, secret);
    first = await zk.prove({ ...claim, schemeId, epoch: 0, secret, attestor: attestors[1], sig, set });
    first.secret = secret;
    assert.equal(await zk.verifyLocally(first.publicSignals, first.rawProof), true);
    assert.equal(first.nullifier, ethers.toBeHex(zk.nullifier(secret, schemeId, 0), 32));
  });

  await test("on-chain: adapter.verify returns ok with fields; signal vector matches snarkjs order", async () => {
    const r = await adapter.call("verify", [schemeId, first.publicInputs, first.proof]);
    assert.equal(r.ok, true);
    assert.equal(r.subjectKey, subjectKey);
    assert.equal(r.nullifier, first.nullifier);
    assert.equal(Number(r.level), 4);
    const sig = await adapter.call("signals", [schemeId, coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs)]);
    assert.deepEqual(sig.map(String), first.publicSignals.map(String));
  });

  await test("KYARegistry.attestWithProof admits the proof; issuer = adapter; issuer identity (Bob) is hidden", async () => {
    const { result: id, logs } = await kya.send("attestWithProof", [subj, schemeId, first.publicInputs, first.proof, "ipfs://zk-evidence"], "relayer");
    const a = await kya.call("getAssertion", [id]);
    assert.equal(a.issuer, adapter.addr);
    assert.equal(Number(a.level), 4);
    assert.equal(a.evidenceHash, ethers.keccak256(first.publicInputs));
    assert.ok(logs.find((l) => l.name === "Asserted"));
    assert.equal(await kya.call("check", [subj, schemeId, 4, [adapter.addr]]), true);
    // nothing on-chain names Bob: the only issuer-related value is the set root
    assert.equal(await kya.call("isNullifierUsed", [schemeId, first.nullifier]), true);
  });

  await test("replay of the same proof is rejected (nullifier consumed)", async () => {
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, first.publicInputs, first.proof, ""], "relayer"), "KYA_NullifierUsed");
  });

  await test("same secret, next epoch → new nullifier, admitted (scheme-epoch scoping)", async () => {
    const sig = zk.attest(attestors[1], claim, first.secret);
    const p = await zk.prove({ ...claim, schemeId, epoch: 1, secret: first.secret, attestor: attestors[1], sig, set });
    assert.notEqual(p.nullifier, first.nullifier);
    const { result: id } = await kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer");
    assert.equal(Number((await kya.call("getAssertion", [id])).level), 4);
  });

  await test("tampered public input (level 4 → 5) fails verification", async () => {
    const dec = coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs);
    const tampered = coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], [dec[0], ethers.id("n-x"), 5, dec[3], dec[4], dec[5], dec[6]]);
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, tampered, first.proof, ""], "relayer"), "KYA_VerifierRejected");
  });

  await test("attestor outside the pinned issuer set cannot produce an accepted proof", async () => {
    const mallory = zk.newAttestor("mallory");
    const set2 = zk.issuerSet([mallory.pub]);
    const secret = zk.randomSecret();
    const sig = zk.attest(mallory, claim, secret);
    const p = await zk.prove({ ...claim, schemeId, epoch: 0, secret, attestor: mallory, sig, set: set2 });
    // proof is valid for set2's root, but the adapter pins the real issuer set root
    assert.equal(await zk.verifyLocally(p.publicSignals, p.rawProof), true);
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer"), "KYA_VerifierRejected");
  });

  await test("proof bound to another subject is rejected (subject substitution)", async () => {
    const other = subject8004(1n, "0x8004A818BFB912233c491871b3d84c89A494BD9e", 23n);
    await expectRevert(kya.send("attestWithProof", [other, schemeId, first.publicInputs, first.proof, ""], "relayer"), "KYA_SubjectMismatch");
  });

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}\n`);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
