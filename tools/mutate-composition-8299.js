// Mutation harness for the ERC-8299 (WYRIWE) composition vectors (companion tooling; not part of
// the ERC assets).
//
// A passing case proves nothing on its own: it has to be the thing that fails when the behaviour
// it names is broken. This applies one single-site mutation at a time to the adapter, re-compiles,
// re-runs test/composition-8299.test.js, and records WHICH cases died.
//
// A mutant is KILLED if at least one case fails, and well-targeted if the case that dies is the one
// that claims to cover it. A mutant that kills everything is as uninformative as one that kills
// nothing.
//
// Most mutants break an adapter guard. One (M12) breaks the KYA registry's level-declared guard,
// because the composition's correctness genuinely leans on it: C10 asserts the adapter's level
// refusal and that registry refusal are the same rule, so the registry guard is in scope here too.
// Each mutant names the FILE it edits (default: the adapter).
//
// Run: node tools/mutate-composition-8299.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACTS = path.join(ROOT, "assets/erc-kya/contracts");
const ADAPTER = path.join(CONTRACTS, "adapters/WyriweAttestation8299Adapter.sol");
const REGISTRY = path.join(CONTRACTS, "KYARegistry.sol");
const ORIGINAL = Object.fromEntries([ADAPTER, REGISTRY].map((f) => [f, fs.readFileSync(f, "utf8")]));

const MUTANTS = [
  {
    id: "M1",
    what: "attestor pin deleted (a signature from any key is accepted)",
    expect: "C5",
    from: `        if (signer != attestor) revert BadAttestor(signer, attestor);`,
    to: `        // MUTANT M1: attestor pin deleted`,
  },
  {
    id: "M2",
    what: "signature-length check deleted (a malformed-length signature is no longer a clean refusal)",
    expect: "C3",
    from: `        if (signature.length != 65) revert MalformedSignature();`,
    to: `        // MUTANT M2: length check deleted`,
  },
  {
    id: "M3",
    what: "EIP-2 low-s check deleted (a valid signature can be reshaped into a second accepted one)",
    expect: "C3",
    from: `        if (uint256(s) > SECP256K1_HALF_N) revert MalformedSignature();`,
    to: `        // MUTANT M3: low-s check deleted`,
  },
  {
    id: "M4",
    what: "subject agentId check deleted (an attestation about another agent is accepted)",
    expect: "C2",
    from: `        if (att.agentId != subjectAgentId) revert SubjectMismatch(att.agentId, subjectAgentId);`,
    to: `        // MUTANT M4: agentId check deleted`,
  },
  {
    id: "M5",
    what: "subject chain/registry pin deleted (a subject on another registry/chain is accepted)",
    expect: "C6",
    from: `        if (chainId_ != subjectChainId || identity_ != identityRegistry) revert UnsupportedSubject();`,
    to: `        // MUTANT M5: chain/registry pin deleted`,
  },
  {
    id: "M6",
    what: "attestation-registry pin deleted (an attestation naming another registry is accepted)",
    expect: "C6",
    from: `        if (att.registry != identityRegistry) revert UnsupportedSubject();`,
    to: `        // MUTANT M6: attestation-registry pin deleted`,
  },
  {
    id: "M7",
    what: "evidenceHash drops the recovered signer (provenance no longer names who signed)",
    expect: "C4",
    from: `                "wyriwe-attestation",
                signer,
                att.agentId,`,
    to: `                "wyriwe-attestation",
                att.agentId,`,
  },
  {
    id: "M8",
    what: "claimDigest drops inputHash (the committed input is no longer bound)",
    expect: "C4",
    from: `            abi.encode(att.rawInputHash, att.sanitizationPipelineHash, att.inputHash, att.outputHash, att.modelHash)`,
    to: `            abi.encode(att.rawInputHash, att.sanitizationPipelineHash, att.outputHash, att.modelHash)`,
  },
  {
    id: "M9",
    what: "level-declared check deleted (the adapter can be built to issue an undeclared level or level 0)",
    expect: "C9",
    from: `        if (issuedLevel_ == 0 || ((levelMask >> issuedLevel_) & 1) == 0) {
            revert LevelNotDeclared(schemeId_, levelMask, issuedLevel_);
        }`,
    to: `        // MUTANT M9: level-declared check deleted`,
  },
  {
    id: "M10",
    what: "ordered-kind check deleted (the adapter can be bound to a categorical scheme)",
    expect: "C9",
    from: `        if (kind != ORDERED_LEVEL) revert SchemeNotOrdered(schemeId_, kind);`,
    to: `        // MUTANT M10: ordered-kind check deleted`,
  },
  {
    id: "M11",
    what: "zero-attestor check deleted (an adapter that accepts any signature recovering to zero can be built)",
    expect: "C9",
    from: `        if (attestor_ == address(0)) revert InvalidAttestor();`,
    to: `        // MUTANT M11: zero-attestor check deleted`,
  },
  {
    id: "M12",
    file: REGISTRY,
    what: "registry level-declared guard deleted (an undeclared level is recorded, so the registry no longer agrees with the adapter's level refusal)",
    expect: "C10",
    from: `        if ((levelMask >> level) & 1 == 0) revert KYA_LevelNotDeclared(schemeId, level);`,
    to: `        // MUTANT M12: level-declared guard deleted`,
  },
];

function run() {
  try {
    execFileSync("node", [path.join(ROOT, "tools/compile.js")], { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    return { compiled: false, failed: [], out: String(e.stdout || e.message).slice(-300) };
  }
  let out = "";
  try {
    out = execFileSync("node", [path.join(ROOT, "test/composition-8299.test.js")], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    out = String(e.stdout || "");
  }
  const failed = [...out.matchAll(/✗ (C\d+|R)\b/g)].map((m) => m[1]);
  return { compiled: true, failed, out };
}

(async () => {
  console.log("baseline (unmutated)");
  const base = run();
  if (!base.compiled || base.failed.length) {
    console.log("  BASELINE NOT CLEAN — fix before mutating\n", base.out.slice(-400));
    process.exit(1);
  }
  const total = (base.out.match(/(\d+) passed/) || [])[1];
  console.log(`  ✓ ${total} cases pass, none failing\n`);

  const rows = [];
  for (const m of MUTANTS) {
    const target = m.file || ADAPTER;
    const src = ORIGINAL[target];
    if (!src.includes(m.from)) {
      rows.push({ ...m, verdict: "ANCHOR NOT FOUND", died: [] });
      console.log(`  ${m.id}  ANCHOR NOT FOUND — mutant not applied`);
      continue;
    }
    fs.writeFileSync(target, src.replace(m.from, m.to));
    let r;
    try { r = run(); } finally { fs.writeFileSync(target, src); }

    let verdict;
    if (!r.compiled) verdict = "DID NOT COMPILE";
    else if (!r.failed.length) verdict = "SURVIVED";
    else if (r.failed.includes(m.expect)) verdict = r.failed.length === 1 ? "KILLED (targeted)" : `KILLED (+${r.failed.filter((f) => f !== m.expect).join(",")})`;
    else verdict = `KILLED BY THE WRONG CASE (${r.failed.join(",")})`;

    rows.push({ ...m, verdict, died: r.failed });
    console.log(`  ${m.id.padEnd(4)} expect ${m.expect.padEnd(3)} → died: ${(r.failed.join(",") || "none").padEnd(12)} ${verdict}`);
  }

  run(); // leave the tree compiled from the original
  const bad = rows.filter((r) => r.verdict === "SURVIVED" || r.verdict.startsWith("KILLED BY THE WRONG") || r.verdict === "ANCHOR NOT FOUND" || r.verdict === "DID NOT COMPILE");
  console.log(`\n${rows.length - bad.length}/${rows.length} mutants killed by their named case`);
  if (bad.length) {
    console.log("\nnot covered:");
    for (const b of bad) console.log(`  ${b.id} (${b.verdict}) — ${b.what}`);
    process.exitCode = 1;
  }
})();
