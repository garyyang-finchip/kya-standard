// Compiles assets/erc-kya/contracts with solc-js and writes artifacts to build/.
// Usage: node tools/compile.js
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "assets/erc-kya/contracts");
const OUT = path.join(ROOT, "build");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
  });
}

const sources = {};
for (const f of walk(SRC)) {
  sources[path.relative(SRC, f)] = { content: fs.readFileSync(f, "utf8") };
}
// ZK companion: include the snarkjs-generated Groth16 verifier when it has been built
const G16 = path.join(ROOT, "companions/zk-kya-groth16/build/Groth16Verifier.sol");
if (fs.existsSync(G16)) sources["companions/Groth16Verifier.sol"] = { content: fs.readFileSync(G16, "utf8") };

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

function findImports(p) {
  const full = path.join(SRC, p);
  if (fs.existsSync(full)) return { contents: fs.readFileSync(full, "utf8") };
  return { error: "not found: " + p };
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let failed = false;
for (const e of output.errors || []) {
  const line = e.formattedMessage || e.message;
  if (e.severity === "error") { failed = true; console.error(line); } else { console.warn(line); }
}
if (failed) process.exit(1);

fs.mkdirSync(OUT, { recursive: true });
const artifacts = {};
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    artifacts[name] = { file, abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, deployedSize: c.evm.deployedBytecode.object.length / 2 };
  }
}
fs.writeFileSync(path.join(OUT, "artifacts.json"), JSON.stringify(artifacts, null, 2));
for (const [n, a] of Object.entries(artifacts)) if (a.deployedSize) console.log(`${n.padEnd(28)} ${a.deployedSize} bytes`);
console.log("OK →", path.relative(ROOT, path.join(OUT, "artifacts.json")));
