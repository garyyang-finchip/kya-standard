// Mutation harness for the ERC-8294 composition vectors.
//
// A passing case proves nothing on its own: it has to be the thing that fails when the
// behaviour it names is broken. This applies one single-site mutation at a time to the
// adapter, re-compiles, re-runs test/composition-8294.test.js, and records WHICH cases died.
//
// A mutant is KILLED if at least one case fails, and it is only *well-targeted* if the case
// that dies is the one that claims to cover it. A mutant that kills everything is as
// uninformative as one that kills nothing.
//
// Run: node tools/mutate-composition.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ADAPTER = path.join(ROOT, "assets/erc-kya/contracts/companions/ValidationNetwork8294Adapter.sol");
const ORIGINAL = fs.readFileSync(ADAPTER, "utf8");

const MUTANTS = [
  {
    id: "M1",
    what: "subject-mismatch check deleted (a run about another agent is accepted)",
    expect: "C2",
    from: `        if (reportedAgentId != assertedAgentId) revert SubjectMismatch(reportedAgentId, assertedAgentId);`,
    to: `        // MUTANT M1: subject check deleted`,
  },
  {
    id: "M2",
    what: "network check deleted (a result from any validator address is accepted)",
    expect: "C5",
    from: `        if (reported != address(network)) revert NotExpectedNetwork(reported, address(network));`,
    to: `        // MUTANT M2: network check deleted`,
  },
  {
    id: "M3",
    what: "profile pin deleted (the network may change its semantics underneath)",
    expect: "R",
    from: `        if (profile != expectedProfile) revert ProfileChanged(expectedProfile, profile);`,
    to: `        // MUTANT M3: profile pin deleted`,
  },
  {
    id: "M4",
    what: "incomplete run returns 0 instead of reverting (operational failure becomes a verdict)",
    expect: "C3",
    from: `        if (state != STATE_RESPONDED || !aggregated) {
            revert ResultNotEstablished(requestHash, state, aggregated);
        }`,
    to: `        if (state != STATE_RESPONDED || !aggregated) { return 0; } // MUTANT M4`,
  },
  {
    id: "M5",
    what: "quorum floor dropped (a below-policy aggregate becomes a verdict)",
    expect: "C3",
    from: `        if (count < requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
    to: `        // MUTANT M5: quorum floor dropped`,
  },
  {
    id: "M6",
    what: "evidenceHash drops the network and request (provenance no longer re-derivable)",
    expect: "C4",
    from: `                "erc8004-validation",
                address(network),
                requestHash,
                responseHash,`,
    to: `                "erc8004-validation",
                responseHash,`,
  },
  {
    id: "M7",
    what: "subject chain/registry pin deleted (a result is re-pointable at another registry)",
    expect: "C6",
    from: `        if (chainId_ != subjectChainId || identity_ != identityRegistry) revert UnsupportedSubject();`,
    to: `        // MUTANT M7: chain/registry pin deleted`,
  },
  {
    id: "M9",
    what: "quorum floor off by one (count == required is rejected)",
    expect: "C8",
    from: `        if (count < requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
    to: `        if (count <= requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
  },
  {
    id: "M8",
    what: "level thresholds shifted by one (90 no longer the top boundary)",
    expect: "C7",
    from: `        if (response >= 90) return 3;`,
    to: `        if (response >= 91) return 3; // MUTANT M8`,
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
    out = execFileSync("node", [path.join(ROOT, "test/composition-8294.test.js")], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    out = String(e.stdout || "");
  }
  const failed = [...out.matchAll(/✗ (C\d|R)\b/g)].map((m) => m[1]);
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
    if (!ORIGINAL.includes(m.from)) {
      rows.push({ ...m, verdict: "ANCHOR NOT FOUND", died: [] });
      console.log(`  ${m.id}  ANCHOR NOT FOUND — mutant not applied`);
      continue;
    }
    fs.writeFileSync(ADAPTER, ORIGINAL.replace(m.from, m.to));
    const r = run();
    fs.writeFileSync(ADAPTER, ORIGINAL);

    let verdict;
    if (!r.compiled) verdict = "DID NOT COMPILE";
    else if (!r.failed.length) verdict = "SURVIVED";
    else if (r.failed.includes(m.expect)) verdict = r.failed.length === 1 ? "KILLED (targeted)" : `KILLED (+${r.failed.filter((f) => f !== m.expect).join(",")})`;
    else verdict = `KILLED BY THE WRONG CASE (${r.failed.join(",")})`;

    rows.push({ ...m, verdict, died: r.failed });
    console.log(`  ${m.id}  expect ${m.expect.padEnd(3)} → died: ${(r.failed.join(",") || "none").padEnd(12)} ${verdict}`);
  }

  run(); // leave the tree compiled from the original
  const bad = rows.filter((r) => r.verdict === "SURVIVED" || r.verdict.startsWith("KILLED BY THE WRONG") || r.verdict === "ANCHOR NOT FOUND");
  console.log(`\n${rows.length - bad.length}/${rows.length} mutants killed by their named case`);
  if (bad.length) {
    console.log("\nnot covered:");
    for (const b of bad) console.log(`  ${b.id} (${b.verdict}) — ${b.what}`);
    process.exitCode = 1;
  }
})();
