// End-to-end tests for the ERC-KYA reference implementation.
// Run: node tools/compile.js && node test/kya.test.js
const assert = require("assert");
const { Harness, expectRevert, ethers } = require("./harness");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));
const ACCOUNT = ethers.keccak256(ethers.toUtf8Bytes("account"));

function subject8004(chainId, identityRegistry, agentId) {
  return { subjectType: ERC8004, subjectData: coder.encode(["uint256", "address", "uint256"], [chainId, identityRegistry, agentId]) };
}
function subjectKey(s) { return ethers.keccak256(coder.encode(["bytes32", "bytes"], [s.subjectType, s.subjectData])); }

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n     ", e.message); process.exitCode = 1; }
}

(async () => {
  const h = await Harness.create();
  const A = (n) => ethers.getAddress(h.accounts[n].toString());

  // --- deploy stack -------------------------------------------------------
  const schemes = await h.deploy("KYASchemeRegistry");
  const kya = await h.deploy("KYARegistry", [schemes.addr]);
  const policies = await h.deploy("KYAPolicyRegistry", [kya.addr]);
  const identity = await h.deploy("MockIdentityRegistry");
  const validation = await h.deploy("ValidationRegistry8004", [identity.addr]);
  const bridge = await h.deploy("KYABridge8004", [kya.addr, validation.addr, A("deployer")]);
  const ids = await h.deploy("InterfaceIds");
  const secret = ethers.id("mock-secret");
  // SchemeInput tuple: (schemeURI, schemeHash, mode, binding, resultKind, levelMask, verifier, predecessor).
  // Test default: ORDERED_LEVEL with levels 0..3 declared (matches the 4-entry bridge responseMap).
  const MASK07 = 0xfn;
  const SI = (uri, hash, mode, binding, verifier, predecessor, resultKind = 0, levelMask = MASK07) =>
    ({ schemeURI: uri, schemeHash: hash, mode, binding, resultKind, levelMask, verifier, predecessor });
  const mockVerifier = await h.deploy("MockKYAVerifier", [secret]);

  console.log("\nERC-KYA reference implementation\n");

  // --- ERC-165 ------------------------------------------------------------
  await test("ERC-165 interface ids are exposed and supported", async () => {
    const sid = await ids.call("schemeRegistry");
    const kid = await ids.call("kyaRegistry");
    const pid = await ids.call("policyRegistry");
    const eid = await ids.call("policyEvaluator");
    assert.notEqual(pid, eid);
    assert.equal(await schemes.call("supportsInterface", [sid]), true);
    assert.equal(await kya.call("supportsInterface", [kid]), true);
    assert.equal(await policies.call("supportsInterface", [pid]), true);
    assert.equal(await policies.call("supportsInterface", [eid]), true);
    assert.equal(await kya.call("supportsInterface", ["0xffffffff"]), false);
  });

  // --- Scheme registry ----------------------------------------------------
  let attestedScheme, provedScheme;
  await test("registerScheme derives schemeId = keccak(chainId, schemeRegistry, controller, schemeHash, nonce) — a rule identity, no registry of use; binding stored", async () => {
    const hash = ethers.id("descriptor-v1");
    const { result, logs } = await schemes.send("registerScheme", [SI("ipfs://scheme-a", hash, 0, 1 /* CONTROLLER */, ethers.ZeroAddress, ethers.ZeroHash)], "issuerA");
    attestedScheme = result;
    const expected = ethers.keccak256(coder.encode(["uint256", "address", "address", "bytes32", "uint256"], [1n, schemes.addr, A("issuerA"), hash, 0]));
    assert.equal(attestedScheme, expected);
    assert.equal(logs[0].name, "SchemeRegistered");
    const s = await schemes.call("getScheme", [attestedScheme]);
    assert.equal(s.controller, A("issuerA"));
    assert.equal(Number(s.mode), 0);
    assert.equal(Number(s.binding), 1);
  });

  await test("PROVED scheme requires a contract verifier (codehash pinned); invalid mode/binding and zero schemeHash rejected", async () => {
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("h"), 1, 0, ethers.ZeroAddress, ethers.ZeroHash)]), "KYA_VerifierRequired");
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("h"), 1, 0, A("stranger"), ethers.ZeroHash)]), "KYA_VerifierNotContract");
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("h"), 2, 0, ethers.ZeroAddress, ethers.ZeroHash)]), "KYA_InvalidMode");
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("h"), 0, 3, ethers.ZeroAddress, ethers.ZeroHash)]), "KYA_InvalidBinding");
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.ZeroHash, 0, 0, ethers.ZeroAddress, ethers.ZeroHash)]), "KYA_SchemeHashRequired");
    const { result } = await schemes.send("registerScheme", [SI("ipfs://scheme-zk", ethers.id("zk-v1"), 1, 0 /* IDENTITY */, mockVerifier.addr, ethers.ZeroHash, 0, 0x1fn /* levels 0..4 */)], "issuerA");
    provedScheme = result;
    const s = await schemes.call("getScheme", [provedScheme]);
    assert.equal(s.verifier, mockVerifier.addr);
    assert.notEqual(s.verifierCodehash, ethers.ZeroHash);
  });

  await test("scheme semantics are immutable: only URI re-pointing, freeze and controller transfer; predecessor must be own", async () => {
    const before = await schemes.call("getScheme", [attestedScheme]);
    assert.equal(schemes.iface.getFunction("updateScheme"), null); // no semantic update entry point exists
    await expectRevert(schemes.send("setSchemeURI", [attestedScheme, "ipfs://y"], "stranger"), "KYA_NotController");
    const { logs } = await schemes.send("setSchemeURI", [attestedScheme, "ipfs://scheme-a-mirror"], "issuerA");
    assert.equal(logs[0].name, "SchemeURIUpdated");
    const after = await schemes.call("getScheme", [attestedScheme]);
    assert.equal(after.schemeURI, "ipfs://scheme-a-mirror");
    assert.equal(after.schemeHash, before.schemeHash);
    assert.equal(after.verifier, before.verifier);
    assert.equal(Number(after.mode), Number(before.mode));
    await schemes.send("freezeScheme", [attestedScheme], "issuerA");
    await expectRevert(schemes.send("setSchemeURI", [attestedScheme, "ipfs://z"], "issuerA"), "KYA_Frozen");
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://v2", ethers.id("d3"), 0, 1, ethers.ZeroAddress, attestedScheme)], "issuerB"), "KYA_BadPredecessor");
    const { result: v2 } = await schemes.send("registerScheme", [SI("ipfs://v2", ethers.id("d3"), 0, 1, ethers.ZeroAddress, attestedScheme)], "issuerA");
    assert.equal((await schemes.call("getScheme", [v2])).predecessor, attestedScheme);
  });

  // --- Attested assertions -------------------------------------------------
  const chainId = 1n; // Mainnet common
  let agentId;
  await test("ERC-8004 agent registered (mock identity registry)", async () => {
    const { result } = await identity.send("register", ["ipfs://agent.json"], "agentOwner");
    agentId = result;
    assert.equal(agentId, 1n);
  });
  const subj = () => subject8004(chainId, identity.addr, agentId);

  let a1;
  await test("attest records an assertion; subjectKey and assertionId derivations match spec", async () => {
    const exp = Number(h.timestamp) + 86400;
    const { result, logs } = await kya.send("attest", [subj(), attestedScheme, 2, ethers.id("claims"), exp, "ipfs://evidence-1", ethers.id("ev1")], "issuerA");
    a1 = result;
    const sk = subjectKey(subj());
    assert.equal(await kya.call("subjectKeyOf", [subj()]), sk);
    assert.equal(a1, ethers.keccak256(coder.encode(["bytes32", "bytes32", "address", "uint256"], [sk, attestedScheme, A("issuerA"), 0])));
    const ev = logs.find((l) => l.name === "Asserted");
    assert.equal(ev.args.evidenceURI, "ipfs://evidence-1");
    const a = await kya.call("getAssertion", [a1]);
    assert.equal(Number(a.level), 2);
    assert.equal(Number(a.status), 0);
    assert.equal(a.anchor, ethers.ZeroHash); // ATTESTED: no anchor
    // controller-bound scheme on an erc8004 subject: witness = keccak(abi.encode(ownerOf(agentId)))
    assert.equal(a.bindingWitness, ethers.keccak256(coder.encode(["address"], [A("agentOwner")])));
    assert.equal(Number(await kya.call("bindingStatus", [a1])), 1); // SATISFIED
  });

  await test("attest on a PROVED scheme reverts with KYA_ModeMismatch", async () => {
    await expectRevert(kya.send("attest", [subj(), provedScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_ModeMismatch");
  });

  await test("resolve requires non-empty issuers and returns the highest active level (ties → latest)", async () => {
    await expectRevert(kya.send("resolve", [subj(), attestedScheme, []]), "KYA_EmptyIssuers");
    let r = await kya.call("resolve", [subj(), attestedScheme, [A("issuerA")]]);
    assert.equal(Number(r.level), 2);
    // issuerB asserts a lower level; A still wins
    await kya.send("attest", [subj(), attestedScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerB");
    r = await kya.call("resolve", [subj(), attestedScheme, [A("issuerA"), A("issuerB")]]);
    assert.equal(Number(r.level), 2); assert.equal(r.assertionId, a1);
    // relying party that only trusts B sees 1
    r = await kya.call("resolve", [subj(), attestedScheme, [A("issuerB")]]);
    assert.equal(Number(r.level), 1);
    assert.equal(await kya.call("check", [subj(), attestedScheme, 2, [A("issuerA")]]), true);
    assert.equal(await kya.call("check", [subj(), attestedScheme, 3, [A("issuerA")]]), false);
    // unknown subject → no assertion → false even for minLevel 0
    // minLevel == 0 is not a threshold: check refuses it; existence is resolve's question
    await expectRevert(kya.send("check", [subject8004(chainId, identity.addr, 999n), attestedScheme, 0, [A("issuerA")]]), "KYA_ZeroThreshold");
    assert.equal((await kya.call("resolve", [subject8004(chainId, identity.addr, 999n), attestedScheme, [A("issuerA")]])).assertionId, ethers.ZeroHash);
  });

  await test("re-attesting supersedes the issuer's previous assertion", async () => {
    const { result: a2, logs } = await kya.send("attest", [subj(), attestedScheme, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    assert.ok(logs.find((l) => l.name === "Superseded" && l.args.previousAssertionId === a1));
    assert.equal(Number((await kya.call("getAssertion", [a1])).status), 2); // SUPERSEDED
    assert.equal(await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerA")]), a2);
    assert.equal(Number((await kya.call("resolve", [subj(), attestedScheme, [A("issuerA")]])).level), 3);
  });

  await test("revoke: issuer or scheme controller only; revoked assertions drop out of resolve", async () => {
    const latest = await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerA")]);
    await expectRevert(kya.send("revoke", [latest, 1], "stranger"), "KYA_NotIssuer");
    await kya.send("revoke", [latest, 7], "issuerA");
    await expectRevert(kya.send("revoke", [latest, 7], "issuerA"), "KYA_AssertionNotActive");
    const r = await kya.call("resolve", [subj(), attestedScheme, [A("issuerA")]]);
    assert.equal(r.assertionId, ethers.ZeroHash);
    // controller (issuerA) can revoke issuerB's assertion under its scheme
    const bLatest = await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerB")]);
    await kya.send("revoke", [bLatest, 2], "issuerA");
    assert.equal(Number((await kya.call("getAssertion", [bLatest])).status), 1);
  });

  await test("expired assertions are ignored by resolve; past expiry rejected on write", async () => {
    const soon = Number(h.timestamp) + 100;
    await kya.send("attest", [subj(), attestedScheme, 2, ethers.ZeroHash, soon, "", ethers.ZeroHash], "issuerA");
    assert.equal(Number((await kya.call("resolve", [subj(), attestedScheme, [A("issuerA")]])).level), 2);
    h.warp(101);
    assert.equal((await kya.call("resolve", [subj(), attestedScheme, [A("issuerA")]])).assertionId, ethers.ZeroHash);
    await expectRevert(kya.send("attest", [subj(), attestedScheme, 2, ethers.ZeroHash, soon, "", ethers.ZeroHash], "issuerA"), "KYA_Expired");
  });

  // --- Proved assertions (ZK-KYA) -----------------------------------------
  const pubInputs = (sk, nullifier, level, exp) => coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64"], [sk, nullifier, level, ethers.id("zk-claims"), exp]);
  // mock proof: bound to (schemeId, admissionDomain, publicInputs) exactly like a real one; defaults to `kya`'s domain
  let DOM;
  const proofFor = (pi, sid = provedScheme, dom = DOM) => coder.encode(["bytes32", "bytes32"], [ethers.keccak256(coder.encode(["bytes32", "bytes32", "bytes"], [sid, dom, pi])), secret]);

  await test("attestWithProof admits a valid proof; issuer = verifier; anchor recorded; evidenceHash = keccak(publicInputs)", async () => {
    DOM = await kya.call("admissionDomain");
    assert.equal(DOM, ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "address"], [ethers.id("erc-kya-registry-admission-v1"), chainId, schemes.addr, kya.addr])));
    const sk = subjectKey(subj());
    const pi = pubInputs(sk, ethers.id("n1"), 4, 0);
    const { result: id, logs } = await kya.send("attestWithProof", [subj(), provedScheme, pi, proofFor(pi), "ipfs://zk-1"], "relayer");
    const a = await kya.call("getAssertion", [id]);
    assert.equal(a.issuer, mockVerifier.addr);
    assert.equal(Number(a.level), 4);
    assert.equal(a.evidenceHash, ethers.keccak256(pi));
    assert.equal(a.anchor, ethers.id("mock-anchor"));
    const ev = logs.find((l) => l.name === "Asserted");
    assert.equal(ev.args.anchor, ethers.id("mock-anchor"));
    assert.equal(await kya.call("isNullifierUsed", [provedScheme, ethers.id("n1")]), true);
    // relying party trusts the verifier as "issuer"
    assert.equal(await kya.call("check", [subj(), provedScheme, 4, [mockVerifier.addr]]), true);
  });

  await test("attestWithProof rejects: bad proof, subject mismatch, replayed nullifier, wrong mode", async () => {
    const sk = subjectKey(subj());
    const pi = pubInputs(sk, ethers.id("n2"), 4, 0);
    await expectRevert(kya.send("attestWithProof", [subj(), provedScheme, pi, "0x1234", ""], "relayer"), "KYA_VerifierRejected");
    const other = subject8004(chainId, identity.addr, 42n);
    await expectRevert(kya.send("attestWithProof", [other, provedScheme, pi, proofFor(pi), ""], "relayer"), "KYA_SubjectMismatch");
    const replay = pubInputs(sk, ethers.id("n1"), 4, 0);
    await expectRevert(kya.send("attestWithProof", [subj(), provedScheme, replay, proofFor(replay), ""], "relayer"), "KYA_NullifierUsed");
    await expectRevert(kya.send("attestWithProof", [subj(), attestedScheme, pi, proofFor(pi), ""], "relayer"), "KYA_ModeMismatch");
  });

  await test("Groth16 adapter: 15-signal kya-public-v1 layout (schemeId + admissionDomain appended by the adapter); issuerSetRoot pinning → anchor; scheme-scoped epoch must be 0", async () => {
    const g16 = await h.deploy("MockGroth16Verifier15");
    const root = ethers.id("issuer-set");
    const adapter = await h.deploy("Groth16KYAVerifierAdapter", [g16.addr, root, 0, 0]);
    const sk = subjectKey(subj());
    const enc = (nul, epoch, r = root) => coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], [sk, nul, 3, ethers.id("c"), 0, r, epoch]);
    const pi = enc(ethers.id("g1"), 0);
    const okProof = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [[1, 0], [[0, 0], [0, 0]], [0, 0]]);
    const badProof = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [[0, 0], [[0, 0], [0, 0]], [0, 0]]);
    let r = await adapter.call("verify", [ethers.ZeroHash, ethers.ZeroHash, pi, okProof]);
    assert.equal(r.ok, true); assert.equal(r.subjectKey, sk); assert.equal(Number(r.level), 3); assert.equal(r.anchor, root);
    r = await adapter.call("verify", [ethers.ZeroHash, ethers.ZeroHash, pi, badProof]);
    assert.equal(r.ok, false);
    await expectRevert(adapter.send("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(ethers.id("g1"), 0, ethers.id("other")), okProof]), "IssuerSetRootMismatch");
    await expectRevert(adapter.send("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(ethers.id("g1"), 5), okProof]), "EpochOutOfWindow");
    // plug the adapter into a real PROVED scheme and record
    const { result: g16Scheme } = await schemes.send("registerScheme", [SI("ipfs://g16", ethers.id("g16"), 1, 0, adapter.addr, ethers.ZeroHash)], "issuerB");
    const { result: id } = await kya.send("attestWithProof", [subj(), g16Scheme, pi, okProof, ""], "relayer");
    const rec = await kya.call("getAssertion", [id]);
    assert.equal(rec.issuer, adapter.addr);
    assert.equal(rec.anchor, root);
  });

  await test("Groth16 adapter: epoch window = [current - grace, current] with epochLength > 0 (time-warped)", async () => {
    const g16 = await h.deploy("MockGroth16Verifier15");
    const L = 3600n, grace = 1n;
    const adapter = await h.deploy("Groth16KYAVerifierAdapter", [g16.addr, ethers.ZeroHash, L, grace]);
    const sk = subjectKey(subj());
    const okProof = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [[1, 0], [[0, 0], [0, 0]], [0, 0]]);
    const enc = (epoch) => coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], [sk, ethers.id("e" + epoch), 1, ethers.ZeroHash, 0, ethers.id("r"), epoch]);
    const cur = h.timestamp / L;
    assert.equal(await adapter.call("currentEpoch"), cur);
    assert.equal((await adapter.call("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur), okProof])).ok, true);
    assert.equal((await adapter.call("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur - 1n), okProof])).ok, true);   // within grace
    await expectRevert(adapter.send("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur - 2n), okProof]), "EpochOutOfWindow"); // too old
    await expectRevert(adapter.send("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur + 1n), okProof]), "EpochOutOfWindow"); // future
    h.warp(Number(L) * 2);
    assert.equal(await adapter.call("currentEpoch"), cur + 2n);
    await expectRevert(adapter.send("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur), okProof]), "EpochOutOfWindow"); // aged out after warp
    assert.equal((await adapter.call("verify", [ethers.ZeroHash, ethers.ZeroHash, enc(cur + 2n), okProof])).ok, true);
  });

  // --- Policy --------------------------------------------------------------
  await test("policy: policyId = keccak(owner, policyHash, rulesHash, nonce); on-chain allOf evaluation", async () => {
    const ph = ethers.id("policy-1");
    const { result: pid } = await policies.send("registerPolicy", ["ipfs://policy", ph], "agentOwner");
    assert.equal(pid, ethers.keccak256(coder.encode(["address", "bytes32", "bytes32", "uint256"], [A("agentOwner"), ph, ethers.ZeroHash, 0])));
    await expectRevert(policies.send("evaluate", [subj(), pid]), "KYA_NoOnchainRules");
    // fresh attested level 2 by issuerA + proved level 4 already present
    await kya.send("attest", [subj(), attestedScheme, 2, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    const rules = [
      { schemeId: attestedScheme, minLevel: 2, issuers: [A("issuerA")] },
      { schemeId: provedScheme, minLevel: 4, issuers: [mockVerifier.addr] },
    ];
    const { result: pid2 } = await policies.send("registerPolicyWithRules", ["ipfs://policy2", ethers.id("p2"), rules], "agentOwner");
    const rh = await policies.call("rulesHashOf", [rules]);
    assert.equal(rh, ethers.keccak256(coder.encode(["tuple(bytes32 schemeId,uint8 minLevel,address[] issuers)[]"], [rules])));
    assert.equal(pid2, ethers.keccak256(coder.encode(["address", "bytes32", "bytes32", "uint256"], [A("agentOwner"), ethers.id("p2"), rh, 1])));
    assert.equal((await policies.call("getPolicy", [pid2])).rulesHash, rh);
    assert.equal(await policies.call("evaluate", [subj(), pid2]), true);
    const strict = [{ schemeId: attestedScheme, minLevel: 3, issuers: [A("issuerA")] }];
    const { result: pid3 } = await policies.send("registerPolicyWithRules", ["ipfs://policy3", ethers.id("p3"), strict], "agentOwner");
    assert.equal(await policies.call("evaluate", [subj(), pid3]), false);
  });

  // --- ERC-8004 bridge -----------------------------------------------------
  await test("bridge: stable requestHash, configHash in responseHash, full-schemeId tag, level→response mapping, revocation drives response to 0", async () => {
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 25, 60, 100]]);
    const cfg = ethers.keccak256(coder.encode(["bytes32", "address[]", "uint8[]"], [attestedScheme, [A("issuerA")], [0, 25, 60, 100]]));
    assert.equal((await bridge.call("getSchemeConfig", [attestedScheme]))[2], cfg);
    const rh = await bridge.call("requestHashFor", [agentId, attestedScheme]);
    const expected = ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "address", "uint256", "bytes32"], [ethers.id("erc-kya-request-v1"), chainId, identity.addr, bridge.addr, agentId, attestedScheme]));
    assert.equal(rh, expected);
    assert.equal(await bridge.call("tagFor", [attestedScheme]), "kya:" + attestedScheme.slice(2));

    await expectRevert(bridge.send("sync", [agentId, attestedScheme], "stranger"), "RequestNotFound");
    // agent owner files the ERC-8004 validation request pointing at the bridge
    await validation.send("validationRequest", [bridge.addr, agentId, "ipfs://kya-request.json", rh], "agentOwner");
    await expectRevert(validation.send("validationRequest", [bridge.addr, agentId, "x", ethers.id("other")], "stranger"), "Not authorized");

    let { result: resp } = await bridge.send("sync", [agentId, attestedScheme], "stranger");
    assert.equal(Number(resp), 60); // level 2 → 60
    let st = await validation.call("getValidationStatus", [rh]);
    assert.equal(Number(st[2]), 60);
    assert.equal(st[4], "kya:" + attestedScheme.slice(2));
    assert.equal(st[3], ethers.keccak256(coder.encode(["bytes32", "uint8", "bytes32"], [await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerA")]), 2, cfg])));

    // revoke → resync → 0
    const latest = await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerA")]);
    await kya.send("revoke", [latest, 1], "issuerA");
    ({ result: resp } = await bridge.send("sync", [agentId, attestedScheme], "stranger"));
    assert.equal(Number(resp), 0);

    // rev5: an undeclared level never enters the registry, and a response map that does not cover every declared
    // level is refused at configuration — so a declared result can never reach sync unmapped
    await expectRevert(kya.send("attest", [subj(), attestedScheme, 9, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_LevelNotDeclared");
    await expectRevert(bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 25, 60]]), "ResponseMapIncomplete");
    // restore a mapped level for later tests
    await kya.send("attest", [subj(), attestedScheme, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    ({ result: resp } = await bridge.send("sync", [agentId, attestedScheme], "stranger"));
    assert.equal(Number(resp), 100);
  });

  await test("bridge: only owner configures; unconfigured scheme rejected; ERC-8004 metadata key 'kya' settable by owner", async () => {
    await expectRevert(bridge.send("configureScheme", [provedScheme, [mockVerifier.addr], [0, 100]], "stranger"), "NotOwner");
    await expectRevert(bridge.send("sync", [agentId, provedScheme]), "SchemeNotConfigured");
    const meta = coder.encode(["address", "bytes32[]"], [kya.addr, [attestedScheme, provedScheme]]);
    await identity.send("setMetadata", [agentId, "kya", meta], "agentOwner");
    assert.equal(await identity.call("getMetadata", [agentId, "kya"]), meta);
    await expectRevert(identity.send("setMetadata", [agentId, "kya", meta], "stranger"), "not authorized");
  });

  // --- Regression cases (revision 3, from external review) -------------------
  console.log("\nregression cases (revisions 3–4)\n");

  await test("R1 policy projection mismatch: a strict document and weaker executable rules cannot share one policyId", async () => {
    const doc = ethers.id("policy-doc: scheme X >= 4 from issuerA");
    const strict = [{ schemeId: attestedScheme, minLevel: 4, issuers: [A("issuerA")] }];
    const weak = [{ schemeId: attestedScheme, minLevel: 1, issuers: [A("issuerA")] }];
    const { result: pStrict } = await policies.send("registerPolicyWithRules", ["ipfs://p", doc, strict], "agentOwner");
    const { result: pWeak } = await policies.send("registerPolicyWithRules", ["ipfs://p", doc, weak], "agentOwner");
    assert.notEqual(pStrict, pWeak);
    const rStrict = await policies.call("rulesHashOf", [strict]), rWeak = await policies.call("rulesHashOf", [weak]);
    assert.notEqual(rStrict, rWeak);
    // the id commits the exact projection: same owner/doc/nonce with a different projection is a different id
    const nonceStrict = 3n; // agentOwner nonces so far: 0,1,2 used above
    assert.equal(pStrict, ethers.keccak256(coder.encode(["address", "bytes32", "bytes32", "uint256"], [A("agentOwner"), doc, rStrict, nonceStrict])));
    // an evaluator reading pStrict cannot be handed the weak rules
    assert.deepEqual((await policies.call("getRules", [pStrict])).map((r) => Number(r.minLevel)), [4]);
    // rules with an empty issuer list or no rules at all are rejected at registration
    await expectRevert(policies.send("registerPolicyWithRules", ["ipfs://p", doc, [{ schemeId: attestedScheme, minLevel: 1, issuers: [] }]], "agentOwner"), "KYA_EmptyIssuers");
    await expectRevert(policies.send("registerPolicyWithRules", ["ipfs://p", doc, []], "agentOwner"), "KYA_NoOnchainRules");
  });

  await test("R2 controller transfer: complete check/evaluate fail after transfer; registry-local resolve still sees the assertion; a round trip revives a still-latest assertion and not a superseded one", async () => {
    // fresh agent owned by agentOwner, controller-bound level-3 assertion, policy over it
    const { result: id2 } = await identity.send("register", ["ipfs://agent2.json"], "agentOwner");
    const s2 = subject8004(chainId, identity.addr, id2);
    const { result: aid } = await kya.send("attest", [s2, attestedScheme, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    const { result: pol } = await policies.send("registerPolicyWithRules", ["ipfs://p2", ethers.id("p-transfer"), [{ schemeId: attestedScheme, minLevel: 3, issuers: [A("issuerA")] }]], "agentOwner");
    assert.equal(Number(await kya.call("bindingStatus", [aid])), 1); // SATISFIED
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerA")]]), true);
    assert.equal(await policies.call("evaluate", [s2, pol]), true);
    // t1: Alice transfers the agent to Bob
    await identity.send("transferFrom", [A("agentOwner"), id2, A("stranger")], "agentOwner");
    // t2: assertion is still ACTIVE and unexpired ...
    assert.equal(Number((await kya.call("getAssertion", [aid])).status), 0);
    // ... but its binding predicate is VIOLATED, so complete resolution excludes it
    assert.equal(Number(await kya.call("bindingStatus", [aid])), 2);
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerA")]]), false);
    assert.equal(await policies.call("evaluate", [s2, pol]), false);
    assert.equal((await kya.call("resolve", [s2, attestedScheme, [A("issuerA")]])).assertionId, ethers.ZeroHash);
    // registry-local view still returns it — and is documented as NOT complete policy satisfaction
    assert.equal((await kya.call("resolveLocal", [s2, attestedScheme, [A("issuerA")]])).assertionId, aid);
    // a new assertion issued to the new controller is bound to Bob and satisfies again
    const { result: aid2 } = await kya.send("attest", [s2, attestedScheme, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    assert.equal((await kya.call("getAssertion", [aid2])).bindingWitness, ethers.keccak256(coder.encode(["address"], [A("stranger")])));
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerA")]]), true);
    // R2b (round trip, reviewer SergeevDmitry): the predicate compares controllers, not custody history.
    //   Case 1 — issuerB attested to Alice; the agent goes Alice → Bob → Alice; issuerB never re-attested.
    //   The original assertion is still issuerB's latest, so it satisfies again with no fresh assessment.
    const { result: aidB } = await kya.send("attest", [s2, attestedScheme, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerB"); // agent currently at Bob ("stranger")
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerB")]]), true);
    await identity.send("transferFrom", [A("stranger"), id2, A("agentOwner")], "stranger");   // Bob → Alice
    assert.equal(Number(await kya.call("bindingStatus", [aidB])), 2);                           // VIOLATED while at Alice
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerB")]]), false);
    await identity.send("transferFrom", [A("agentOwner"), id2, A("stranger")], "agentOwner");  // Alice → Bob: round trip complete
    assert.equal(Number(await kya.call("bindingStatus", [aidB])), 1);                           // SATISFIED again
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerB")]]), true);       // revived, documented semantics
    //   Case 2 — issuerA DID re-attest to Bob (aid2 above); the original Alice-bound aid is no longer issuerA's latest.
    //   Agent now at Bob: aid2 satisfies. Send it back to Alice: aid's predicate is SATISFIED again but resolution
    //   only considers the latest (aid2, VIOLATED), so nothing is revived.
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerA")]]), true);       // aid2 (Bob) at Bob
    await identity.send("transferFrom", [A("stranger"), id2, A("agentOwner")], "stranger");   // Bob → Alice
    assert.equal(Number(await kya.call("bindingStatus", [aid])), 1);                            // original predicate holds ...
    assert.equal(Number(await kya.call("bindingStatus", [aid2])), 2);                           // ... latest is VIOLATED ...
    assert.equal(Number((await kya.call("getAssertion", [aid])).status), 2);                    // ... and the original is SUPERSEDED
    assert.equal(await kya.call("check", [s2, attestedScheme, 3, [A("issuerA")]]), false);      // so the round trip revives nothing
    assert.equal((await kya.call("resolve", [s2, attestedScheme, [A("issuerA")]])).assertionId, ethers.ZeroHash);
    await identity.send("transferFrom", [A("agentOwner"), id2, A("stranger")], "agentOwner");  // back to Bob for the rest of the test
    // identity-bound schemes are unaffected by transfer
    const { result: idScheme } = await schemes.send("registerScheme", [SI("ipfs://id-bound", ethers.id("idb"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash)], "issuerA");
    const { result: aid3 } = await kya.send("attest", [s2, idScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    await identity.send("transferFrom", [A("stranger"), id2, A("relayer")], "stranger");
    assert.equal(Number(await kya.call("bindingStatus", [aid3])), 0); // NOT_APPLICABLE
    assert.equal(await kya.call("check", [s2, idScheme, 1, [A("issuerA")]]), true);
    // controller-bound schemes over subjects the registry cannot evaluate natively are refused at issuance
    const foreign = subject8004(999n, identity.addr, id2);
    await expectRevert(kya.send("attest", [foreign, attestedScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_BindingUnevaluable");
    const acct = { subjectType: ACCOUNT, subjectData: coder.encode(["uint256", "address"], [chainId, A("stranger")]) };
    await expectRevert(kya.send("attest", [acct, attestedScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_BindingUnevaluable");
  });

  await test("R3 bridge configuration mutation: the request stays the continuing mirror; reconfiguration updates the same record, responseHash names the config, exact-filter getSummary keeps one current record per mirror", async () => {
    const { result: id3 } = await identity.send("register", ["ipfs://agent3.json"], "agentOwner");
    const s3 = subject8004(chainId, identity.addr, id3);
    await kya.send("attest", [s3, attestedScheme, 2, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    const aid = await kya.call("latestAssertion", [subjectKey(s3), attestedScheme, A("issuerA")]);
    const tag = await bridge.call("tagFor", [attestedScheme]);
    const cfg0 = (await bridge.call("getSchemeConfig", [attestedScheme]))[2];
    const rh = await bridge.call("requestHashFor", [id3, attestedScheme]);
    await validation.send("validationRequest", [bridge.addr, id3, "ipfs://req", rh], "agentOwner");
    let { result: resp } = await bridge.send("sync", [id3, attestedScheme]);
    assert.equal(Number(resp), 60);
    let st = await validation.call("getValidationStatus", [rh]);
    assert.equal(st[3], ethers.keccak256(coder.encode(["bytes32", "uint8", "bytes32"], [aid, 2, cfg0])));
    let sum = await validation.call("getSummary", [id3, [bridge.addr], tag]);
    assert.equal(Number(sum[0]), 1); assert.equal(Number(sum[1]), 60);
    // operator reconfigures the mapping: configHash changes, requestHash does NOT
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 20, 70, 100]]);
    const cfg1 = (await bridge.call("getSchemeConfig", [attestedScheme]))[2];
    assert.notEqual(cfg1, cfg0);
    assert.equal(await bridge.call("requestHashFor", [id3, attestedScheme]), rh);
    // until the next sync the mirror still shows the previous configuration's result (documented staleness)
    assert.equal(Number((await validation.call("getValidationStatus", [rh]))[2]), 60);
    // the same request is re-synced: same record updated, responseHash now names cfg1, count stays 1
    ({ result: resp } = await bridge.send("sync", [id3, attestedScheme]));
    assert.equal(Number(resp), 70);
    st = await validation.call("getValidationStatus", [rh]);
    assert.equal(Number(st[2]), 70);
    assert.equal(st[3], ethers.keccak256(coder.encode(["bytes32", "uint8", "bytes32"], [aid, 2, cfg1])));
    sum = await validation.call("getSummary", [id3, [bridge.addr], tag]);
    assert.equal(Number(sum[0]), 1); assert.equal(Number(sum[1]), 70); // never count 2 / average of two configs
    // the reviewer's case: C0 → 100, C1 → 0 must read 0, not 50
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 0, 100, 100]]);
    await bridge.send("sync", [id3, attestedScheme]);
    assert.equal(Number((await validation.call("getSummary", [id3, [bridge.addr], tag]))[1]), 100);
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 0, 0, 100]]);
    await bridge.send("sync", [id3, attestedScheme]);
    sum = await validation.call("getSummary", [id3, [bridge.addr], tag]);
    assert.equal(Number(sum[0]), 1); assert.equal(Number(sum[1]), 0);
    // changing only the issuer set also changes the identity carried by the response
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA"), A("issuerB")], [0, 20, 70, 100]]);
    assert.notEqual((await bridge.call("getSchemeConfig", [attestedScheme]))[2], cfg1);
    // legacy bridge deployments: a superseded bridge's record under the same tag is excluded by filtering on the
    // current bridge — the query path the spec prescribes — and is only ever seen if the client asks for both
    const bridgeOld = await h.deploy("KYABridge8004", [kya.addr, validation.addr, A("deployer")]);
    await bridgeOld.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 25, 100, 100]], "deployer");
    const rhOld = await bridgeOld.call("requestHashFor", [id3, attestedScheme]);
    assert.notEqual(rhOld, rh);
    await validation.send("validationRequest", [bridgeOld.addr, id3, "ipfs://req-old", rhOld], "agentOwner");
    await bridgeOld.send("sync", [id3, attestedScheme]);
    assert.equal(await bridgeOld.call("tagFor", [attestedScheme]), tag);
    sum = await validation.call("getSummary", [id3, [bridge.addr], tag]);
    assert.equal(Number(sum[0]), 1); assert.equal(Number(sum[1]), 0);           // current bridge only
    sum = await validation.call("getSummary", [id3, [bridge.addr, bridgeOld.addr], tag]);
    assert.equal(Number(sum[0]), 2);                                              // both, only when asked for both
    // restore the original configuration for later tests
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 25, 60, 100]]);
  });

  await test("R4 verifier semantic mutation: an existing schemeId cannot acquire different admission behaviour behind a changed verifier", async () => {
    // (a) code swap behind a proxy: the registry pins the verifier's codehash — a proxy's own code does not
    //     change when its implementation does, so the pin cannot catch delegation; the spec therefore
    //     forbids upgradeable verifiers normatively. What the pin DOES catch is a different contract
    //     appearing at the registered address (redeploy/metamorphic): simulate by comparing codehashes.
    const good = mockVerifier;
    const proxy = await h.deploy("MockVerifierProxy", [good.addr]);
    const { result: sch } = await schemes.send("registerScheme", [SI("ipfs://proxy", ethers.id("px"), 1, 0, proxy.addr, ethers.ZeroHash)], "issuerA");
    const rec = await schemes.call("getScheme", [sch]);
    // the pinned codehash is the proxy's, and it is stable across setImpl — documenting the limit
    const lenient = await h.deploy("MockKYAVerifier", [ethers.id("other-secret")]);
    await proxy.send("setImpl", [lenient.addr]);
    assert.equal((await schemes.call("getScheme", [sch])).verifierCodehash, rec.verifierCodehash);
    // (b) what the registry CAN enforce: if the code at the address differs from the pinned hash, admission reverts.
    //     Emulate by registering a scheme whose recorded codehash cannot match at call time: deploy a scheme via
    //     a verifier, then overwrite the account code in the VM to a different contract.
    const { result: sch2 } = await schemes.send("registerScheme", [SI("ipfs://pin", ethers.id("pin"), 1, 0, good.addr, ethers.ZeroHash)], "issuerA");
    const sk = subjectKey(subj());
    const pi = pubInputs(sk, ethers.id("pin-1"), 2, 0);
    const { result: ok1 } = await kya.send("attestWithProof", [subj(), sch2, pi, proofFor(pi, sch2), ""], "relayer");
    assert.ok(ok1);
    const originalCode = await h.vm.stateManager.getContractCode(good.address);
    const proxyCode = await h.vm.stateManager.getContractCode(proxy.address); // any different code
    await h.vm.stateManager.putContractCode(good.address, proxyCode);
    const pi2 = pubInputs(sk, ethers.id("pin-2"), 2, 0);
    await expectRevert(kya.send("attestWithProof", [subj(), sch2, pi2, proofFor(pi2, sch2), ""], "relayer"), "KYA_VerifierCodeChanged");
    // restore the original code: admission works again
    await h.vm.stateManager.putContractCode(good.address, originalCode);
    const { result: ok2 } = await kya.send("attestWithProof", [subj(), sch2, pi2, proofFor(pi2, sch2), ""], "relayer");
    assert.ok(ok2);
  });

  await test("R5 tag collision: distinct schemeIds remain distinguishable in the ERC-8004 projection (full id in tag)", async () => {
    const t1 = await bridge.call("tagFor", [attestedScheme]);
    const forged = attestedScheme.slice(0, 10) + "ff".repeat(28); // same 32-bit prefix, different id
    const t2 = await bridge.call("tagFor", [forged]);
    assert.equal(t1.slice(0, 12), t2.slice(0, 12)); // old 8-hex tag would have collided
    assert.notEqual(t1, t2);
    assert.equal(t1.length, 68);
    assert.equal(t1, "kya:" + attestedScheme.slice(2).toLowerCase());
  });

  await test("R6 admission-domain separation: (a) a second SchemeRegistry yields a different schemeId; (b) one SchemeRegistry, two KYARegistries — a proof for A is refused by B before and after A consumes it; the same credential re-proved for B is admitted; the domain cannot be supplied by the submitter", async () => {
    // (a) independent scheme registries: the RULE identity differs (chainId + scheme registry in schemeId)
    const schemesB = await h.deploy("KYASchemeRegistry");
    const kyaB = await h.deploy("KYARegistry", [schemesB.addr]);
    const hsh = ethers.id("same-descriptor");
    const { result: idA } = await schemes.send("registerScheme", [SI("ipfs://d", hsh, 1, 0, mockVerifier.addr, ethers.ZeroHash)], "issuerB");
    const nonceB = await schemesB.call("schemeNonce", [A("issuerB")]);
    const { result: idB } = await schemesB.send("registerScheme", [SI("ipfs://d", hsh, 1, 0, mockVerifier.addr, ethers.ZeroHash)], "issuerB");
    assert.notEqual(idA, idB);
    assert.equal(idB, ethers.keccak256(coder.encode(["uint256", "address", "address", "bytes32", "uint256"], [chainId, schemesB.addr, A("issuerB"), hsh, nonceB])));
    await expectRevert(kyaB.send("attestWithProof", [subj(), idA, "0x", "0x", ""], "relayer"), "KYA_SchemeNotFound");

    // (b) the reviewer's case: ONE SchemeRegistry S, TWO KYARegistry instances A (= kya) and A2 sharing it.
    //     The scheme is the same object in both (rules are reusable); the admission DOMAIN differs.
    const kyaA2 = await h.deploy("KYARegistry", [schemes.addr]);
    const DOM_A2 = await kyaA2.call("admissionDomain");
    assert.notEqual(DOM_A2, DOM);
    assert.equal(DOM_A2, ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "address"], [ethers.id("erc-kya-registry-admission-v1"), chainId, schemes.addr, kyaA2.addr])));
    assert.equal(await schemes.call("schemeExists", [idA]), true);
    const sk = subjectKey(subj());
    const pi = pubInputs(sk, ethers.id("replay-1"), 3, 0);
    const proofA = proofFor(pi, idA, DOM);
    // not yet consumed anywhere: refused at A2 purely because the proof is bound to A's domain
    assert.equal(await kyaA2.call("isNullifierUsed", [idA, ethers.id("replay-1")]), false);
    await expectRevert(kyaA2.send("attestWithProof", [subj(), idA, pi, proofA, ""], "relayer"), "KYA_VerifierRejected");
    // admitted at A; consumed in A's scope only
    const { result: recA } = await kya.send("attestWithProof", [subj(), idA, pi, proofA, ""], "relayer");
    assert.ok(recA);
    assert.equal(await kya.call("isNullifierUsed", [idA, ethers.id("replay-1")]), true);
    assert.equal(await kyaA2.call("isNullifierUsed", [idA, ethers.id("replay-1")]), false);
    // after consumption at A: still refused at A2 (verifier), and refused at A (nullifier)
    await expectRevert(kyaA2.send("attestWithProof", [subj(), idA, pi, proofA, ""], "relayer"), "KYA_VerifierRejected");
    await expectRevert(kya.send("attestWithProof", [subj(), idA, pi, proofA, ""], "relayer"), "KYA_NullifierUsed");
    // the submitter cannot pick the domain: there is no parameter for it — the registry derives its own
    // (a proof made for A2's domain is exactly what A2 admits, and exactly what A refuses)
    const proofA2 = proofFor(pi, idA, DOM_A2);
    await expectRevert(kya.send("attestWithProof", [subj(), idA, pi, proofA2, ""], "relayer"), "KYA_VerifierRejected");
    const { result: recA2 } = await kyaA2.send("attestWithProof", [subj(), idA, pi, proofA2, ""], "relayer");
    assert.ok(recA2);
    // ATTESTED writes need no domain: the issuer transacts with the registry it means (msg.sender is the binding)
    const { result: att2 } = await kyaA2.send("attest", [subj(), attestedScheme, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    assert.ok(att2);
  });

  await test("R7 result domain (reviewer Revinand): levels are the complete valid result domain, committed on-chain; undeclared levels are refused at admission; level 0 never passes a threshold; non-ordered schemes cannot be compared", async () => {
    const sk = subjectKey(subj());
    // (a) scheme declaring {0, 2, 4} only — mask 0b10101
    const { result: s024 } = await schemes.send("registerScheme", [SI("ipfs://s024", ethers.id("s024"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 0, 0b10101n)], "issuerA");
    const dom = await kya.call("resultDomain", [s024]);
    assert.equal(Number(dom[0]), 0); assert.equal(dom[1], 0b10101n);
    // the reviewer's case: a trusted issuer records level 255 → refused, it never reaches check
    await expectRevert(kya.send("attest", [subj(), s024, 255, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_LevelNotDeclared");
    await expectRevert(kya.send("attest", [subj(), s024, 3, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_LevelNotDeclared");
    await kya.send("attest", [subj(), s024, 4, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    assert.equal(await kya.call("check", [subj(), s024, 4, [A("issuerA")]]), true);
    assert.equal(await kya.call("check", [subj(), s024, 3, [A("issuerA")]]), true);   // 4 >= 3: threshold need not be a declared level
    // the same rule on the PROVED path: a verifier that returns an undeclared level is refused by the registry
    const { result: p024 } = await schemes.send("registerScheme", [SI("ipfs://p024", ethers.id("p024"), 1, 0, mockVerifier.addr, ethers.ZeroHash, 0, 0b10101n)], "issuerA");
    const bad = pubInputs(sk, ethers.id("rd-1"), 3, 0);
    await expectRevert(kya.send("attestWithProof", [subj(), p024, bad, proofFor(bad, p024), ""], "relayer"), "KYA_LevelNotDeclared");
    const bad255 = pubInputs(sk, ethers.id("rd-1b"), 255, 0);
    await expectRevert(kya.send("attestWithProof", [subj(), p024, bad255, proofFor(bad255, p024), ""], "relayer"), "KYA_LevelNotDeclared");
    const good = pubInputs(sk, ethers.id("rd-2"), 2, 0);
    assert.ok((await kya.send("attestWithProof", [subj(), p024, good, proofFor(good, p024), ""], "relayer")).result);
    // (b) level 0 "not verified / failed": an otherwise qualifying level-0 assertion exists, but check cannot be asked a zero threshold
    const { result: s0 } = await schemes.send("registerScheme", [SI("ipfs://s0", ethers.id("s0"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 0, 0b11n)], "issuerA");
    await kya.send("attest", [subj(), s0, 0, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    assert.notEqual((await kya.call("resolve", [subj(), s0, [A("issuerA")]])).assertionId, ethers.ZeroHash); // it exists ...
    await expectRevert(kya.send("check", [subj(), s0, 0, [A("issuerA")]]), "KYA_ZeroThreshold");               // ... but is not a pass
    assert.equal(await kya.call("check", [subj(), s0, 1, [A("issuerA")]]), false);
    // and the policy projection cannot encode a zero threshold either
    await expectRevert(policies.send("registerPolicyWithRules", ["ipfs://p0", ethers.id("p0"), [{ schemeId: s0, minLevel: 0, issuers: [A("issuerA")] }]], "issuerA"), "KYA_ZeroThreshold");
    // (c) result kind is on-chain: categorical / opaque schemes cannot be compared, mirrored or put in a policy
    const { result: cat } = await schemes.send("registerScheme", [SI("ipfs://cat", ethers.id("cat"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 1 /* CATEGORICAL */, 0b1110n)], "issuerA");
    await kya.send("attest", [subj(), cat, 2, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    await expectRevert(kya.send("check", [subj(), cat, 1, [A("issuerA")]]), "KYA_NotOrderedLevel");
    await expectRevert(kya.send("resolve", [subj(), cat, [A("issuerA")]]), "KYA_NotOrderedLevel");
    assert.equal(Number((await kya.call("getAssertion", [await kya.call("latestAssertion", [sk, cat, A("issuerA")])])).level), 2); // read, don't rank
    await expectRevert(policies.send("registerPolicyWithRules", ["ipfs://pc", ethers.id("pc"), [{ schemeId: cat, minLevel: 1, issuers: [A("issuerA")] }]], "issuerA"), "KYA_NotOrderedLevel");
    await expectRevert(bridge.send("configureScheme", [cat, [A("issuerA")], [0, 50, 100, 100]]), "KYA_NotOrderedLevel");
    const { result: opq } = await schemes.send("registerScheme", [SI("ipfs://opq", ethers.id("opq"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 2 /* OPAQUE */, 1n)], "issuerA");
    await expectRevert(kya.send("attest", [subj(), opq, 1, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA"), "KYA_LevelNotDeclared");
    assert.ok((await kya.send("attest", [subj(), opq, 0, ethers.id("the-result"), 0, "", ethers.ZeroHash], "issuerA")).result);
    // (d) the domain itself is validated at registration
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("x1"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 0, 0b10n)]), "KYA_InvalidLevelMask");    // ordered without level 0
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("x2"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 0, 0b1n)]), "KYA_InvalidLevelMask");     // ordered with only level 0
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("x3"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 2, 0b11n)]), "KYA_InvalidLevelMask");    // opaque with a non-zero level
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("x4"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 1, 0n)]), "KYA_InvalidLevelMask");       // categorical, empty
    await expectRevert(schemes.send("registerScheme", [SI("ipfs://x", ethers.id("x5"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 3, 1n)]), "KYA_InvalidResultKind");
  });

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
