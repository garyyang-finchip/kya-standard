// ERC-8299 (WYRIWE) → ERC-KYA composition vectors (companion; not part of the ERC assets).
//
// ERC-8299 ("WYRIWE — Input Provenance for AI Inference", ethereum/ERCs#1810) defines an
// EIP-712 signed commitment to an inference's inputs (raw_input_hash, sanitization_pipeline_hash,
// input_hash). ERC-8299 standardises WHAT an inference consumed; ERC-KYA records WHAT was
// concluded about the agent. These vectors exercise the composition through the EXISTING
// `ATTESTED` path: an adapter verifies the signed attestation and calls `attest()`, so the
// adapter is the recorded issuer. No new admission mode, and the KYA normative core stays
// unaware of ERC-8299.
//
// Cases:
//
//   C1  a valid attestation becomes a KYA assertion whose ISSUER is the ADAPTER — not the
//       attesting gateway, and not the relayer
//   C2  rejected: the attestation is about a different agent than the asserted subject
//   C3  the case this set exists for — an OPERATIONAL FAILURE is not a negative conclusion: a
//       malformed or malleable signature refuses to issue, it does not issue level 0, and leaves
//       NO assertion behind
//   C4  the mirrored result retains source provenance: evidenceHash re-derives from the signed
//       attestation and names the RECOVERED signer; claimDigest commits its binding hashes. And
//       the faithful point: for a provenance-committed scheme there is no "completed negative" —
//       the only outcomes are the provenance level or a revert, so level 0 is never issued
//   C5  rejected: a well-formed signature from a key OTHER than the pinned attestor
//   C6  rejected: a subject naming another registry, chain, or subject type; or an attestation
//       naming a registry other than the one pinned
//   C7  the level is the scheme's FIXED provenance-committed level, not a graded score: two
//       attestations with different contents record the same level (there is no ladder to map)
//   C9  the level is the scheme's: an adapter cannot be constructed with level 0, with a level the
//       scheme's committed mask does not declare, or for a non-ordered scheme; and the scheme it
//       issues under is fixed at construction
//   C10 the adapter's level refusal and the registry's KYA_LevelNotDeclared refusal are the SAME
//       rule on the SAME committed mask: one gap scheme that the registry refuses an attestation
//       under (per-bit) and that the adapter refuses to bind to (its issued level is the gap),
//       both keyed off `resultDomain`'s one committed value
//   R   the attestation is bound to THIS chain's EIP-712 domain: one signed for another chainId
//       does not verify (ERC-8299 §4 replay protection)
//
// Every case is mutation-checked by tools/mutate-composition-8299.js: each guard is deleted in
// turn and the case that claims to cover it must be the one that fails.
//
// WHAT GRADE OF EVIDENCE THIS IS. The adapter verifies ERC-8299 §5 step 1 (the EIP-712 signature
// recovers to the pinned attestor) and binds the attestation to the subject. It does NOT perform
// §5 steps 2-4 — recomputing raw_input_hash or applying the sanitization spec at
// sanitization_spec_cid to re-derive input_hash. Those need the raw input and the off-chain spec,
// and are the relying party's recomputation against the committed hashes. So these vectors
// establish that the adapter records a PROVENANCE-COMMITTED conclusion from a signed commitment —
// not a consumption-bound one, and not that the pipeline was correctly applied. Named rather than
// implied (scheme-authoring-notes §2).
//
// Run: node tools/compile.js && node test/composition-8299.test.js
const assert = require("assert");
const { Harness, expectRevert, ethers } = require("./harness");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));
const b32 = (n) => ethers.zeroPadValue(ethers.toBeHex(BigInt(n)), 32);

// ERC-8299 §4 domain: name, version, chainId ONLY (no verifyingContract). The harness VM is mainnet.
const CHAIN_ID = 1n;
const DOMAIN = { name: "ERC8004AttestationGateway", version: "1", chainId: Number(CHAIN_ID) };
const TYPES = {
  WyriweAttestation: [
    { name: "agentId", type: "bytes32" },
    { name: "registry", type: "address" },
    { name: "modelHash", type: "bytes32" },
    { name: "rawInputHash", type: "bytes32" },
    { name: "sanitizationPipelineHash", type: "bytes32" },
    { name: "inputHash", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "timestamp", type: "uint256" },
  ],
};
const SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

function subject8004(chainId, identityRegistry, agentId) {
  return {
    subjectType: ERC8004,
    subjectData: coder.encode(["uint256", "address", "uint256"], [chainId, identityRegistry, agentId]),
  };
}
function SI(uri, hash, mode, binding, verifier, predecessor, resultKind, levelMask) {
  return { schemeURI: uri, schemeHash: hash, mode, binding, resultKind, levelMask, verifier, predecessor };
}
// Flip a low-s signature to its high-s (malleable) counterpart: s -> n-s, v -> the other parity.
function malleate(sig) {
  const r = sig.slice(0, 66);
  const s = BigInt("0x" + sig.slice(66, 130));
  const v = parseInt(sig.slice(130, 132), 16);
  const sHigh = (SECP256K1_N - s).toString(16).padStart(64, "0");
  const vFlip = (v === 27 ? 28 : 27).toString(16).padStart(2, "0");
  return r + sHigh + vFlip;
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n     ", e.message); process.exitCode = 1; }
}

(async () => {
  const h = await Harness.create();
  const A = (n) => ethers.getAddress(h.accounts[n].toString());

  // The attestor and a stranger are real signing wallets (the harness accounts keep no keys).
  const attestor = ethers.Wallet.createRandom();
  const stranger = ethers.Wallet.createRandom();

  const schemes = await h.deploy("KYASchemeRegistry");
  const kya = await h.deploy("KYARegistry", [schemes.addr]);
  const identity = await h.deploy("MockIdentityRegistry");

  // An ATTESTED, IDENTITY-bound, ORDERED_LEVEL scheme declaring levels {0,1}: level 0 = "not
  // verified", level 1 = provenance-committed. A provenance commitment is not graded, so the
  // ladder is a single positive level.
  const MASK_0_1 = 0b11n;
  const ISSUED_LEVEL = 1;
  const schemeHash = ethers.id("scheme://input-provenance-committed-via-8299");
  const reg = await schemes.send("registerScheme", [
    SI("ipfs://scheme-8299", schemeHash, 0 /* ATTESTED */, 0 /* IDENTITY */, ethers.ZeroAddress, ethers.ZeroHash, 0 /* ORDERED_LEVEL */, MASK_0_1),
  ]);
  const schemeId = reg.logs.find((l) => l.name === "SchemeRegistered").args.schemeId;

  const ctorArgs = (sid, level) => [kya.addr, sid, level, attestor.address, CHAIN_ID, identity.addr];
  const adapter = await h.deploy("WyriweAttestation8299Adapter", ctorArgs(schemeId, ISSUED_LEVEL));

  const AGENT = (await identity.send("register", ["ipfs://agent-a.json"], "agentOwner")).result;
  const OTHER_AGENT = (await identity.send("register", ["ipfs://agent-b.json"], "stranger")).result;
  const FRESH_AGENT = (await identity.send("register", ["ipfs://agent-c.json"], "agentOwner")).result;

  const subj = subject8004(CHAIN_ID, identity.addr, AGENT);
  const expires = BigInt(Number(h.timestamp) + 30 * 24 * 3600);

  // Build a WYRIWE attestation for `agentId` and sign it with `wallet` under `domain`.
  async function attestation(agentId, overrides = {}, wallet = attestor, domain = DOMAIN) {
    const att = {
      agentId: b32(agentId),
      registry: identity.addr,
      modelHash: ethers.id("gpt2-manifest"),
      rawInputHash: ethers.id("raw-input"),
      sanitizationPipelineHash: ethers.id("sanitization-pipeline"),
      inputHash: ethers.id("sanitized-input"),
      outputHash: ethers.id("model-output"),
      timestamp: 1_700_000_000n,
      ...overrides,
    };
    const signature = await wallet.signTypedData(domain, TYPES, att);
    return { att, signature };
  }

  console.log("\nERC-8299 (WYRIWE) → ERC-KYA composition\n");

  // --- C1 ------------------------------------------------------------------
  await test("C1 a valid WYRIWE attestation becomes a KYA assertion whose ISSUER is the adapter, not the gateway or relayer", async () => {
    const { att, signature } = await attestation(AGENT);
    const { logs } = await adapter.send("issueFromAttestation", [subj, att, signature, expires, "ipfs://evidence-c1"], "relayer");
    const issued = logs.find((l) => l.name === "AssertionIssuedFromAttestation");
    assert.ok(issued, "expected AssertionIssuedFromAttestation");
    assert.equal(issued.args.inputHash, att.inputHash);
    assert.equal(Number(issued.args.level), ISSUED_LEVEL);

    const a = await kya.call("getAssertion", [issued.args.assertionId]);
    // The recorded issuer is the ADAPTER — one accountable contract, not the gateway key.
    assert.equal(ethers.getAddress(a.issuer), adapter.addr);
    assert.notEqual(ethers.getAddress(a.issuer), A("relayer"), "the relayer must not become the issuer");
    assert.equal(Number(a.level), ISSUED_LEVEL);
    assert.equal(a.schemeId, schemeId, "issued under the scheme the adapter is bound to");
  });

  // --- C2 ------------------------------------------------------------------
  await test("C2 rejected: the attestation is about a different agent than the asserted subject", async () => {
    const { att, signature } = await attestation(OTHER_AGENT);   // attestation is about OTHER_AGENT…
    await expectRevert(
      adapter.send("issueFromAttestation", [subj, att, signature, expires, "ipfs://e"], "relayer"), // …subject is AGENT
      "SubjectMismatch"
    );
  });

  // --- C3: the case this set exists for -----------------------------------
  await test("C3 an OPERATIONAL FAILURE is not a negative conclusion: a malformed or malleable signature refuses to issue, it does not issue level 0", async () => {
    const fresh = subject8004(CHAIN_ID, identity.addr, FRESH_AGENT);
    const { att, signature } = await attestation(FRESH_AGENT);

    // (a) wrong-length signature — nothing has been established.
    await expectRevert(
      adapter.send("issueFromAttestation", [fresh, att, "0x1234", expires, "ipfs://e"], "relayer"),
      "MalformedSignature"
    );
    // (b) a malleable high-s signature: the same curve point, re-encoded. EIP-2 rejects it, so a
    //     third party cannot reshape a valid signature into a "different" accepted one.
    await expectRevert(
      adapter.send("issueFromAttestation", [fresh, att, malleate(signature), expires, "ipfs://e"], "relayer"),
      "MalformedSignature"
    );

    // The load-bearing assertion: after the failures, NO assertion exists. Had the adapter mapped
    // any of them to level 0, `resolve` would now return a durable negative conclusion.
    const resolved = await kya.call("resolve", [fresh, schemeId, [adapter.addr]]);
    assert.equal(Number(resolved[0]), 0, "no level");
    assert.equal(resolved[2], ethers.ZeroHash, "an operational failure must leave NO assertion behind");
  });

  // --- C4 ------------------------------------------------------------------
  await test("C4 source provenance is retained: evidenceHash names the recovered signer and every field; claimDigest commits the binding hashes", async () => {
    const { att, signature } = await attestation(AGENT, { inputHash: ethers.id("sanitized-c4"), outputHash: ethers.id("out-c4") });
    const { logs } = await adapter.send("issueFromAttestation", [subj, att, signature, expires, "ipfs://evidence-c4"], "relayer");
    const id = logs.find((l) => l.name === "AssertionIssuedFromAttestation").args.assertionId;
    const a = await kya.call("getAssertion", [id]);

    // level is always the provenance-committed level — there is no completed-negative to record.
    assert.equal(Number(a.level), ISSUED_LEVEL);
    assert.ok(Number(a.issuedAt) > 0, "the provenance-committed verdict IS recorded");

    const expectedClaim = ethers.keccak256(coder.encode(
      ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      [att.rawInputHash, att.sanitizationPipelineHash, att.inputHash, att.outputHash, att.modelHash]
    ));
    assert.equal(a.claimDigest, expectedClaim, "claimDigest commits the attestation's binding hashes");

    const expectedEvidence = ethers.keccak256(coder.encode(
      ["string", "address", "bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256"],
      ["wyriwe-attestation", attestor.address, att.agentId, att.registry, att.modelHash,
       att.rawInputHash, att.sanitizationPipelineHash, att.inputHash, att.outputHash, att.timestamp]
    ));
    assert.equal(a.evidenceHash, expectedEvidence, "evidenceHash must re-derive from the signed attestation and the recovered signer");
  });

  // --- C5 ------------------------------------------------------------------
  // A well-formed signature over a valid attestation, but from a key other than the pinned
  // attestor. Without this, anyone could sign a WYRIWE struct and feed conclusions to a relying
  // party trusting this adapter.
  await test("C5 rejected: a well-formed signature from a key other than the pinned attestor", async () => {
    const { att, signature } = await attestation(AGENT, {}, stranger);   // signed by the stranger
    const e = await expectRevert(
      adapter.send("issueFromAttestation", [subj, att, signature, expires, "ipfs://e"], "relayer"),
      "BadAttestor"
    );
    assert.ok(String(e.reason).includes(ethers.getAddress(stranger.address)), "the refusal names the recovered signer");
  });

  // --- C6 ------------------------------------------------------------------
  await test("C6 rejected: a subject naming another registry, chain, or subject type; or an attestation naming another registry", async () => {
    const { att, signature } = await attestation(AGENT);

    const otherRegistry = subject8004(CHAIN_ID, A("stranger"), AGENT);
    await expectRevert(adapter.send("issueFromAttestation", [otherRegistry, att, signature, expires, "ipfs://e"], "relayer"), "UnsupportedSubject");

    const otherChain = subject8004(CHAIN_ID + 1n, identity.addr, AGENT);
    await expectRevert(adapter.send("issueFromAttestation", [otherChain, att, signature, expires, "ipfs://e"], "relayer"), "UnsupportedSubject");

    const wrongType = { subjectType: ethers.keccak256(ethers.toUtf8Bytes("account")), subjectData: subj.subjectData };
    await expectRevert(adapter.send("issueFromAttestation", [wrongType, att, signature, expires, "ipfs://e"], "relayer"), "UnsupportedSubject");

    // The attestation itself names a different ERC-8004 registry than the one pinned.
    const { att: foreignAtt, signature: foreignSig } = await attestation(AGENT, { registry: A("stranger") });
    await expectRevert(adapter.send("issueFromAttestation", [subj, foreignAtt, foreignSig, expires, "ipfs://e"], "relayer"), "UnsupportedSubject");
  });

  // --- C7 ------------------------------------------------------------------
  // A WYRIWE attestation is a provenance commitment, not a graded score: the adapter records the
  // scheme's one provenance-committed level regardless of the attestation's contents. There is no
  // ladder, so there is no boundary to drift — the level is fixed and declared by the scheme.
  await test("C7 the level is the scheme's fixed provenance-committed level, not a graded score", async () => {
    const at = subject8004(CHAIN_ID, identity.addr, OTHER_AGENT);
    for (const tag of ["alpha", "beta"]) {
      const { att, signature } = await attestation(OTHER_AGENT, { inputHash: ethers.id(`in-${tag}`), modelHash: ethers.id(`model-${tag}`) });
      const { logs } = await adapter.send("issueFromAttestation", [at, att, signature, expires, "ipfs://e"], "relayer");
      const id = logs.find((l) => l.name === "AssertionIssuedFromAttestation").args.assertionId;
      // Read the REGISTRY, not the adapter's own event: a case that believes the thing under test
      // is self-grading. The event is checked too, and the two must agree.
      const stored = Number((await kya.call("getAssertion", [id])).level);
      const reported = Number(logs.find((l) => l.name === "AssertionIssuedFromAttestation").args.level);
      assert.equal(stored, ISSUED_LEVEL, `every valid attestation records the provenance level, got ${stored}`);
      assert.equal(reported, stored, "the emitted level must agree with what was recorded");
    }
  });

  // --- C9 ------------------------------------------------------------------
  // The level belongs to the scheme. The adapter checks the level it would issue against the
  // scheme's committed result domain at construction: it must be ordered-level, declared in the
  // mask, and not level 0. And the scheme is fixed: issueFromAttestation takes no schemeId.
  await test("C9 the level is the scheme's: level 0, an undeclared level, a non-ordered scheme and a zero attestor are refused at construction; the scheme is pinned", async () => {
    const deployFails = async (args, err) => {
      try { await h.deploy("WyriweAttestation8299Adapter", args); }
      catch (e) { assert.ok(String(e.message).includes(err), `expected ${err}, got: ${e.message}`); return; }
      assert.fail(`construction should have reverted with ${err}`);
    };
    await deployFails(ctorArgs(schemeId, 0), "LevelNotDeclared");          // level 0 is the failure level, never issued
    await deployFails(ctorArgs(schemeId, 2), "LevelNotDeclared");          // level 2 not in the {0,1} mask
    // the attestor cannot be the zero address — it would accept any signature that recovers to zero
    await deployFails([kya.addr, schemeId, ISSUED_LEVEL, ethers.ZeroAddress, CHAIN_ID, identity.addr], "InvalidAttestor");
    // a categorical scheme has no ordered level to record
    const { result: cat } = await schemes.send("registerScheme", [
      SI("ipfs://cat", ethers.id("cat8299"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 1 /* CATEGORICAL */, 0b1110n),
    ]);
    await deployFails(ctorArgs(cat, 1), "SchemeNotOrdered");
    // the pinned scheme is observable, and is the one every assertion above was issued under
    assert.equal(await adapter.call("schemeId", []), schemeId);
  });

  // --- C10 -----------------------------------------------------------------
  // C9 shows the adapter refuses an undeclared issued level. C10 shows that refusal is the SAME
  // rule the KYA registry enforces when it records an assertion — both read the scheme's level set
  // from one committed value, resultDomain(schemeId).levelMask. Exhibited on a non-contiguous mask
  // the Scheme Registry admits (it requires only level 0 and one positive level): 0b1011, levels
  // {0,1,3} with level 2 a gap. The registry refuses an attestation at the gap; the adapter refuses
  // to be constructed to issue it.
  await test("C10 the adapter's level refusal and the registry's KYA_LevelNotDeclared refusal agree on one committed domain", async () => {
    const GAP_MASK = 0b1011n;   // ordered levels {0,1,3}; level 2 is undeclared
    const { result: gap } = await schemes.send("registerScheme", [
      SI("ipfs://gap8299", ethers.id("gap8299"), 0 /* ATTESTED */, 0 /* IDENTITY */, ethers.ZeroAddress, ethers.ZeroHash, 0 /* ORDERED_LEVEL */, GAP_MASK),
    ]);
    const [kind, mask] = await kya.call("resultDomain", [gap]);
    assert.equal(Number(kind), 0, "ordered");
    assert.equal(BigInt(mask), GAP_MASK);
    assert.equal((GAP_MASK >> 2n) & 1n, 0n, "level 2 is the undeclared gap");

    // (1) Registry side — per-bit read of that mask: the gap level 2 is refused, declared level 3 is not.
    const d = ethers.id("c10-8299");
    const e2 = await expectRevert(kya.send("attest", [subj, gap, 2, d, expires, "ipfs://e", d], "relayer"), "KYA_LevelNotDeclared");
    assert.ok(String(e2.reason).includes(",2)"), "the registry refusal names the undeclared level");
    await kya.send("attest", [subj, gap, 3, d, expires, "ipfs://e", d], "relayer");   // declared → admitted

    // (2) Adapter side — it cannot be constructed to issue the gap level 2, and the refusal NAMES
    //     the same mask the registry just enforced, binding the two checks to one value.
    let ctorReason = "";
    try { await h.deploy("WyriweAttestation8299Adapter", ctorArgs(gap, 2)); }
    catch (e) { ctorReason = String(e.message); }
    assert.ok(ctorReason.includes("LevelNotDeclared"), `expected LevelNotDeclared, got: ${ctorReason}`);
    assert.ok(ctorReason.includes(`,${GAP_MASK},`), "the constructor refusal must name the scheme's committed mask");

    // (3) The positive direction: the declared level 3 constructs and issues; the registry admits it.
    const gapAdapter = await h.deploy("WyriweAttestation8299Adapter", ctorArgs(gap, 3));
    assert.equal(Number(await gapAdapter.call("issuedLevel", [])), 3);
    const gapSubj = subject8004(CHAIN_ID, identity.addr, OTHER_AGENT);
    const { att, signature } = await attestation(OTHER_AGENT);
    const { logs } = await gapAdapter.send("issueFromAttestation", [gapSubj, att, signature, expires, "ipfs://e"], "relayer");
    assert.equal(Number(logs.find((l) => l.name === "AssertionIssuedFromAttestation").args.level), 3);
  });

  // --- R -------------------------------------------------------------------
  // The attestation is bound to THIS chain's EIP-712 domain (ERC-8299 §4). One signed under a
  // different chainId recovers to a different address and is refused — the replay protection the
  // domain's chainId exists for.
  await test("R an attestation signed for another chainId does not verify on this chain", async () => {
    const wrongDomain = { ...DOMAIN, chainId: Number(CHAIN_ID) + 999 };
    const { att, signature } = await attestation(AGENT, {}, attestor, wrongDomain);
    await expectRevert(
      adapter.send("issueFromAttestation", [subj, att, signature, expires, "ipfs://e"], "relayer"),
      "BadAttestor"
    );
  });

  console.log(`\n${passed} passed\n`);
})();
