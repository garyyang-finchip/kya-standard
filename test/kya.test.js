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
  const validation = await h.deploy("MockValidationRegistry", [identity.addr]);
  const bridge = await h.deploy("KYABridge8004", [kya.addr, validation.addr, A("deployer")]);
  const ids = await h.deploy("InterfaceIds");
  const secret = ethers.id("mock-secret");
  const mockVerifier = await h.deploy("MockKYAVerifier", [secret]);

  console.log("\nERC-KYA reference implementation\n");

  // --- ERC-165 ------------------------------------------------------------
  await test("ERC-165 interface ids are exposed and supported", async () => {
    const sid = await ids.call("schemeRegistry");
    const kid = await ids.call("kyaRegistry");
    const pid = await ids.call("policyRegistry");
    assert.equal(await schemes.call("supportsInterface", [sid]), true);
    assert.equal(await kya.call("supportsInterface", [kid]), true);
    assert.equal(await policies.call("supportsInterface", [pid]), true);
    assert.equal(await kya.call("supportsInterface", ["0xffffffff"]), false);
  });

  // --- Scheme registry ----------------------------------------------------
  let attestedScheme, provedScheme;
  await test("registerScheme derives schemeId = keccak(controller, schemeHash, nonce)", async () => {
    const hash = ethers.id("descriptor-v1");
    const { result, logs } = await schemes.send("registerScheme", ["ipfs://scheme-a", hash, 0, ethers.ZeroAddress, ethers.ZeroHash], "issuerA");
    attestedScheme = result;
    const expected = ethers.keccak256(coder.encode(["address", "bytes32", "uint256"], [A("issuerA"), hash, 0]));
    assert.equal(attestedScheme, expected);
    assert.equal(logs[0].name, "SchemeRegistered");
    const s = await schemes.call("getScheme", [attestedScheme]);
    assert.equal(s.controller, A("issuerA"));
    assert.equal(Number(s.mode), 0);
  });

  await test("PROVED scheme requires a verifier; invalid mode rejected", async () => {
    await expectRevert(schemes.send("registerScheme", ["ipfs://x", ethers.ZeroHash, 1, ethers.ZeroAddress, ethers.ZeroHash]), "KYA_VerifierRequired");
    await expectRevert(schemes.send("registerScheme", ["ipfs://x", ethers.ZeroHash, 2, ethers.ZeroAddress, ethers.ZeroHash]), "KYA_InvalidMode");
    const { result } = await schemes.send("registerScheme", ["ipfs://scheme-zk", ethers.id("zk-v1"), 1, mockVerifier.addr, ethers.ZeroHash], "issuerA");
    provedScheme = result;
    const s = await schemes.call("getScheme", [provedScheme]);
    assert.equal(s.verifier, mockVerifier.addr);
  });

  await test("only controller may update/freeze; frozen scheme is immutable; predecessor must be own", async () => {
    await expectRevert(schemes.send("updateScheme", [attestedScheme, "ipfs://y", ethers.ZeroHash, ethers.ZeroAddress], "stranger"), "KYA_NotController");
    await schemes.send("updateScheme", [attestedScheme, "ipfs://scheme-a-fixed", ethers.id("d2"), ethers.ZeroAddress], "issuerA");
    await schemes.send("freezeScheme", [attestedScheme], "issuerA");
    await expectRevert(schemes.send("updateScheme", [attestedScheme, "ipfs://z", ethers.ZeroHash, ethers.ZeroAddress], "issuerA"), "KYA_Frozen");
    await expectRevert(schemes.send("registerScheme", ["ipfs://v2", ethers.id("d3"), 0, ethers.ZeroAddress, attestedScheme], "issuerB"), "KYA_BadPredecessor");
    const { result: v2 } = await schemes.send("registerScheme", ["ipfs://v2", ethers.id("d3"), 0, ethers.ZeroAddress, attestedScheme], "issuerA");
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
    assert.equal(await kya.call("check", [subject8004(chainId, identity.addr, 999n), attestedScheme, 0, [A("issuerA")]]), false);
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
  const proofFor = (pi) => coder.encode(["bytes32", "bytes32"], [ethers.keccak256(pi), secret]);

  await test("attestWithProof admits a valid proof; issuer = verifier; evidenceHash = keccak(publicInputs)", async () => {
    const sk = subjectKey(subj());
    const pi = pubInputs(sk, ethers.id("n1"), 4, 0);
    const { result: id, logs } = await kya.send("attestWithProof", [subj(), provedScheme, pi, proofFor(pi), "ipfs://zk-1"], "relayer");
    const a = await kya.call("getAssertion", [id]);
    assert.equal(a.issuer, mockVerifier.addr);
    assert.equal(Number(a.level), 4);
    assert.equal(a.evidenceHash, ethers.keccak256(pi));
    assert.ok(logs.find((l) => l.name === "Asserted"));
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

  await test("Groth16 adapter: 256-bit values split into (hi, lo) signals; issuerSetRoot pinning", async () => {
    const g16 = await h.deploy("MockGroth16Verifier10");
    const root = ethers.id("issuer-set");
    const adapter = await h.deploy("Groth16KYAVerifierAdapter", [g16.addr, root]);
    const sk = subjectKey(subj());
    const pi = coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32"], [sk, ethers.id("g1"), 3, ethers.id("c"), 0, root]);
    const okProof = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [[1, 0], [[0, 0], [0, 0]], [0, 0]]);
    const badProof = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [[0, 0], [[0, 0], [0, 0]], [0, 0]]);
    let r = await adapter.call("verify", [ethers.ZeroHash, pi, okProof]);
    assert.equal(r.ok, true); assert.equal(r.subjectKey, sk); assert.equal(Number(r.level), 3);
    r = await adapter.call("verify", [ethers.ZeroHash, pi, badProof]);
    assert.equal(r.ok, false);
    const wrongRoot = coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32"], [sk, ethers.id("g1"), 3, ethers.id("c"), 0, ethers.id("other")]);
    r = await adapter.call("verify", [ethers.ZeroHash, wrongRoot, okProof]);
    assert.equal(r.ok, false);
    // plug the adapter into a real PROVED scheme and record
    const { result: g16Scheme } = await schemes.send("registerScheme", ["ipfs://g16", ethers.id("g16"), 1, adapter.addr, ethers.ZeroHash], "issuerB");
    const { result: id } = await kya.send("attestWithProof", [subj(), g16Scheme, pi, okProof, ""], "relayer");
    assert.equal((await kya.call("getAssertion", [id])).issuer, adapter.addr);
  });

  // --- Policy --------------------------------------------------------------
  await test("policy: registerPolicy id derivation; on-chain allOf evaluation", async () => {
    const ph = ethers.id("policy-1");
    const { result: pid } = await policies.send("registerPolicy", ["ipfs://policy", ph], "agentOwner");
    assert.equal(pid, ethers.keccak256(coder.encode(["address", "bytes32", "uint256"], [A("agentOwner"), ph, 0])));
    await expectRevert(policies.send("evaluate", [subj(), pid]), "KYA_NoOnchainRules");
    // fresh attested level 2 by issuerA + proved level 4 already present
    await kya.send("attest", [subj(), attestedScheme, 2, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
    const rules = [
      { schemeId: attestedScheme, minLevel: 2, issuers: [A("issuerA")] },
      { schemeId: provedScheme, minLevel: 4, issuers: [mockVerifier.addr] },
    ];
    const { result: pid2 } = await policies.send("registerPolicyWithRules", ["ipfs://policy2", ethers.id("p2"), rules], "agentOwner");
    assert.equal(await policies.call("evaluate", [subj(), pid2]), true);
    const strict = [{ schemeId: attestedScheme, minLevel: 3, issuers: [A("issuerA")] }];
    const { result: pid3 } = await policies.send("registerPolicyWithRules", ["ipfs://policy3", ethers.id("p3"), strict], "agentOwner");
    assert.equal(await policies.call("evaluate", [subj(), pid3]), false);
  });

  // --- ERC-8004 bridge -----------------------------------------------------
  await test("bridge: requestHash formula, tag format, level→response mapping, revocation drives response to 0", async () => {
    await bridge.send("configureScheme", [attestedScheme, [A("issuerA")], [0, 25, 60, 100]]);
    const rh = await bridge.call("requestHashFor", [agentId, attestedScheme]);
    const expected = ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "uint256", "bytes32"], [ethers.id("erc-kya-request-v1"), chainId, identity.addr, agentId, attestedScheme]));
    assert.equal(rh, expected);
    assert.equal(await bridge.call("tagFor", [attestedScheme]), "kya:" + attestedScheme.slice(2, 10));

    await expectRevert(bridge.send("sync", [agentId, attestedScheme], "stranger"), "RequestNotFound");
    // agent owner files the ERC-8004 validation request pointing at the bridge
    await validation.send("validationRequest", [bridge.addr, agentId, "ipfs://kya-request.json", rh], "agentOwner");
    await expectRevert(validation.send("validationRequest", [bridge.addr, agentId, "x", ethers.id("other")], "stranger"), "not owner/operator");

    let { result: resp } = await bridge.send("sync", [agentId, attestedScheme], "stranger");
    assert.equal(Number(resp), 60); // level 2 → 60
    let st = await validation.call("getValidationStatus", [rh]);
    assert.equal(Number(st[2]), 60);
    assert.equal(st[4], "kya:" + attestedScheme.slice(2, 10));

    // revoke → resync → 0
    const latest = await kya.call("latestAssertion", [subjectKey(subj()), attestedScheme, A("issuerA")]);
    await kya.send("revoke", [latest, 1], "issuerA");
    ({ result: resp } = await bridge.send("sync", [agentId, attestedScheme], "stranger"));
    assert.equal(Number(resp), 0);

    // level above map length clamps to last entry
    await kya.send("attest", [subj(), attestedScheme, 9, ethers.ZeroHash, 0, "", ethers.ZeroHash], "issuerA");
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

  console.log(`\n${passed} passed${process.exitCode ? " — FAILURES ABOVE" : ""}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
