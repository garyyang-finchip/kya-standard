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
  // adapter: pinned issuer-set root, 1-day epochs, previous epoch still accepted
  const EPOCH_LEN = 86_400n, GRACE = 1n;
  const adapter = await h.deploy("Groth16KYAVerifierAdapter", [g16.addr, set.rootHex, EPOCH_LEN, GRACE]);
  const epochNow = () => zk.epochFor(h.timestamp, EPOCH_LEN);

  const { result: schemeId } = await schemes.send("registerScheme", ["ipfs://accountable-operator-zk-v1", ethers.id("zk-desc"), 1, adapter.addr, ethers.ZeroHash], "issuerA");
  // a second PROVED scheme sharing the SAME verifier and issuer set (cross-scheme replay target)
  const { result: schemeB } = await schemes.send("registerScheme", ["ipfs://other-zk-scheme", ethers.id("zk-desc-b"), 1, adapter.addr, ethers.ZeroHash], "issuerA");

  const subj = subject8004(1n, "0x8004A818BFB912233c491871b3d84c89A494BD9e", 22n);
  const subjectKey = subjectKeyOf(subj);
  const claim = { subjectKey, schemeId, level: 4, claimDigest: ethers.id("claims:jurisdiction=SG;capital>=1e6"), expiresAt: 1_900_000_000 };

  console.log("\nZK-KYA companion (Groth16, kya-public-v1 rev 2, depth-16 issuer set, 1-day epochs)\n");

  let first;
  await test("attestor Bob signs a scheme-bound credential; prover builds a Groth16 proof for the current epoch", async () => {
    const secret = zk.randomSecret();
    const sig = zk.attest(attestors[1], claim, secret);
    const epoch = epochNow();
    first = await zk.prove({ ...claim, epoch, secret, attestor: attestors[1], sig, set });
    first.secret = secret; first.sig = sig; first.epoch = epoch;
    assert.equal(await zk.verifyLocally(first.publicSignals, first.rawProof), true);
    assert.equal(first.nullifier, ethers.toBeHex(zk.nullifier(secret, schemeId, epoch), 32));
  });

  await test("on-chain: adapter.verify returns ok with fields; signal vector matches snarkjs order", async () => {
    const r = await adapter.call("verify", [schemeId, first.publicInputs, first.proof]);
    assert.equal(r.ok, true);
    assert.equal(r.subjectKey, subjectKey);
    assert.equal(r.nullifier, first.nullifier);
    assert.equal(Number(r.level), 4);
    assert.equal(r.anchor, set.rootHex);
    const sig = await adapter.call("signals", [schemeId, coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs)]);
    assert.deepEqual(sig.map(String), first.publicSignals.map(String));
  });

  await test("KYARegistry.attestWithProof admits the proof; issuer = adapter; anchor = issuer-set root; Bob is hidden", async () => {
    const { result: id, logs } = await kya.send("attestWithProof", [subj, schemeId, first.publicInputs, first.proof, "ipfs://zk-evidence"], "relayer");
    const a = await kya.call("getAssertion", [id]);
    assert.equal(a.issuer, adapter.addr);
    assert.equal(a.anchor, set.rootHex);
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

  await test("prover-chosen future epoch is rejected on-chain even though the proof is valid", async () => {
    const p = await zk.prove({ ...claim, epoch: first.epoch + 1n, secret: first.secret, attestor: attestors[1], sig: first.sig, set });
    assert.equal(await zk.verifyLocally(p.publicSignals, p.rawProof), true);
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer"), "EpochOutOfWindow");
  });

  await test("epoch older than the grace window is rejected", async () => {
    const p = await zk.prove({ ...claim, epoch: first.epoch - 2n, secret: first.secret, attestor: attestors[1], sig: first.sig, set });
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer"), "EpochOutOfWindow");
  });

  await test("time actually advances one epoch → same credential re-proved with a fresh nullifier is admitted; old one still burned", async () => {
    h.warp(Number(EPOCH_LEN));
    const epoch = epochNow();
    assert.equal(epoch, first.epoch + 1n);
    assert.equal(await adapter.call("currentEpoch"), epoch);
    const p = await zk.prove({ ...claim, epoch, secret: first.secret, attestor: attestors[1], sig: first.sig, set });
    assert.notEqual(p.nullifier, first.nullifier);
    const { result: id } = await kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer");
    assert.equal(Number((await kya.call("getAssertion", [id])).level), 4);
    // the previous epoch's proof is still inside the grace window but its nullifier is consumed
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, first.publicInputs, first.proof, ""], "relayer"), "KYA_NullifierUsed");
    // re-proving in the same epoch again is a replay
    const again = await zk.prove({ ...claim, epoch, secret: first.secret, attestor: attestors[1], sig: first.sig, set });
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, again.publicInputs, again.proof, ""], "relayer"), "KYA_NullifierUsed");
  });

  await test("cross-scheme replay: a credential signed for scheme A cannot be proved under scheme B (same verifier + issuer set)", async () => {
    // the prover feeds schemeB into the circuit while holding Bob's signature over schemeA → witness generation must fail
    let threw = false;
    try {
      await zk.prove({ ...claim, schemeId: schemeB, epoch: epochNow(), secret: first.secret, attestor: attestors[1], sig: first.sig, set });
    } catch (e) { threw = true; }
    assert.ok(threw, "circuit accepted a signature over a different schemeId");
    // and a valid scheme-A proof presented on-chain under scheme B fails verification (schemeId is a public signal)
    const fresh = zk.randomSecret();
    const sigA = zk.attest(attestors[1], claim, fresh);
    const pa = await zk.prove({ ...claim, epoch: epochNow(), secret: fresh, attestor: attestors[1], sig: sigA, set });
    await expectRevert(kya.send("attestWithProof", [subj, schemeB, pa.publicInputs, pa.proof, ""], "relayer"), "KYA_VerifierRejected");
  });

  await test("a credential Bob signs FOR scheme B is admitted under scheme B (positive control)", async () => {
    const secret = zk.randomSecret();
    const claimB = { ...claim, schemeId: schemeB, level: 2 };
    const sig = zk.attest(attestors[1], claimB, secret);
    const p = await zk.prove({ ...claimB, epoch: epochNow(), secret, attestor: attestors[1], sig, set });
    const { result: id } = await kya.send("attestWithProof", [subj, schemeB, p.publicInputs, p.proof, ""], "relayer");
    assert.equal(Number((await kya.call("getAssertion", [id])).level), 2);
  });

  await test("tampered public input (level 4 → 5) fails verification", async () => {
    const dec = coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs);
    const tampered = coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], [dec[0], ethers.id("n-x"), 5, dec[3], dec[4], dec[5], dec[6]]);
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, tampered, first.proof, ""], "relayer"), "KYA_VerifierRejected");
  });

  await test("tampered expiresAt / claimDigest / nullifier each fail verification", async () => {
    const dec = coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs);
    const enc = (v) => coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], v);
    const cases = [
      enc([dec[0], ethers.id("n-y"), dec[2], dec[3], 2_000_000_000, dec[5], dec[6]]),
      enc([dec[0], ethers.id("n-z"), dec[2], ethers.id("other-claims"), dec[4], dec[5], dec[6]]),
      enc([dec[0], ethers.id("n-w"), dec[2], dec[3], dec[4], dec[5], dec[6]]),
    ];
    for (const pi of cases) {
      await expectRevert(kya.send("attestWithProof", [subj, schemeId, pi, first.proof, ""], "relayer"), "KYA_VerifierRejected");
    }
  });

  await test("aliased (hi, lo) encodings of the nullifier or root are not accepted (Split128 strictness)", async () => {
    // A non-strict 254-bit split lets a malicious witness present (hi', lo') for value+p instead of
    // value — for the nullifier that would be a fresh-looking nullifier for the same secret, i.e. a
    // replay. Revision 2 uses Num2Bits_strict, so only the canonical decomposition satisfies the
    // constraints; here we check the verifier rejects the aliased signal vectors for the honest proof
    // and that the compiled circuit really contains the alias check.
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "../companions/zk-kya-groth16/circuits/kya_public_v1.circom"), "utf8");
    assert.ok(/Num2Bits_strict\(\)/.test(src) && !/Num2Bits\(254\)/.test(src), "Split128 must use Num2Bits_strict");
    const dec = coder.decode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], first.publicInputs);
    const sig = (await adapter.call("signals", [schemeId, dec])).map(String);
    const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    for (const [hiIdx, loIdx] of [[0, 1], [8, 9]]) {
      const v = (BigInt(sig[hiIdx]) << 128n) | BigInt(sig[loIdx]);
      const alias = v + P; // same field element, different 254-bit integer
      const aliased = sig.slice();
      aliased[hiIdx] = String(alias >> 128n); aliased[loIdx] = String(alias & ((1n << 128n) - 1n));
      assert.equal(await zk.verifyLocally(aliased, first.rawProof), false);
    }
  });

  await test("attestor outside the pinned issuer set cannot produce an accepted proof", async () => {
    const mallory = zk.newAttestor("mallory");
    const set2 = zk.issuerSet([mallory.pub]);
    const secret = zk.randomSecret();
    const sig = zk.attest(mallory, claim, secret);
    const p = await zk.prove({ ...claim, epoch: epochNow(), secret, attestor: mallory, sig, set: set2 });
    // proof is valid for set2's root, but the adapter pins the real issuer set root
    assert.equal(await zk.verifyLocally(p.publicSignals, p.rawProof), true);
    await expectRevert(kya.send("attestWithProof", [subj, schemeId, p.publicInputs, p.proof, ""], "relayer"), "IssuerSetRootMismatch");
  });

  await test("proof bound to another subject is rejected (subject substitution)", async () => {
    const other = subject8004(1n, "0x8004A818BFB912233c491871b3d84c89A494BD9e", 23n);
    await expectRevert(kya.send("attestWithProof", [other, schemeId, first.publicInputs, first.proof, ""], "relayer"), "KYA_SubjectMismatch");
  });

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}\n`);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
