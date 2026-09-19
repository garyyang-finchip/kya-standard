// Tiny in-process EVM harness (ethereumjs VM + ethers ABI) — no node/RPC needed.
const { VM } = require("@ethereumjs/vm");
const { Address, Account, hexToBytes, bytesToHex } = require("@ethereumjs/util");
const { Common, Hardfork, Chain } = require("@ethereumjs/common");
const { Block } = require("@ethereumjs/block");
const { ethers } = require("ethers");
const artifacts = require("../build/artifacts.json");

class Harness {
  static async create() {
    const h = new Harness();
    h.common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun });
    h.vm = await VM.create({ common: h.common });
    h.timestamp = 1_800_000_000n;
    h.accounts = {};
    for (const name of ["deployer", "issuerA", "issuerB", "agentOwner", "relayer", "stranger"]) {
      const w = ethers.Wallet.createRandom();
      h.accounts[name] = Address.fromString(w.address);
      const acct = (await h.vm.stateManager.getAccount(h.accounts[name])) ?? new Account();
      acct.balance = 10n ** 24n;
      await h.vm.stateManager.putAccount(h.accounts[name], acct);
    }
    return h;
  }

  block() {
    return Block.fromBlockData(
      { header: { timestamp: this.timestamp, gasLimit: 30_000_000n, number: 1n, baseFeePerGas: 0n } },
      { common: this.common }
    );
  }

  warp(seconds) { this.timestamp += BigInt(seconds); }

  async deploy(name, args = [], from = "deployer") {
    const a = artifacts[name];
    const iface = new ethers.Interface(a.abi);
    const ctor = iface.deploy ? iface.encodeDeploy(args) : "0x";
    const data = hexToBytes(a.bytecode + ctor.slice(2));
    const res = await this.vm.evm.runCall({ caller: this.accounts[from], data, gasLimit: 20_000_000n, block: this.block() });
    if (res.execResult.exceptionError) throw new Error(`deploy ${name} failed: ${res.execResult.exceptionError.error}`);
    return new Contract(this, res.createdAddress, iface, name);
  }
}

class Contract {
  constructor(h, address, iface, name) { this.h = h; this.address = address; this.iface = iface; this.name = name; }
  get addr() { return ethers.getAddress(this.address.toString()); }

  async send(fn, args = [], from = "deployer") {
    const data = hexToBytes(this.iface.encodeFunctionData(fn, args));
    const res = await this.h.vm.evm.runCall({ caller: this.h.accounts[from], to: this.address, data, gasLimit: 10_000_000n, block: this.h.block() });
    const out = bytesToHex(res.execResult.returnValue);
    if (res.execResult.exceptionError) {
      let reason = res.execResult.exceptionError.error;
      try { const e = this.iface.parseError(out); if (e) reason = `${e.name}(${e.args.map(String).join(",")})`; } catch {}
      if (reason === "revert" && out.length > 10) { try { reason = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + out.slice(10))[0]; } catch {} }
      const err = new Error(`${this.name}.${fn} reverted: ${reason}`); err.reason = reason; err.raw = out; throw err;
    }
    const logs = (res.execResult.logs || []).map(([addr, topics, data]) => {
      try { return this.iface.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) }); } catch { return null; }
    }).filter(Boolean);
    const frag = this.iface.getFunction(fn);
    const decoded = frag.outputs.length ? this.iface.decodeFunctionResult(fn, out) : [];
    return { result: decoded.length === 1 ? decoded[0] : decoded, logs, gasUsed: res.execResult.executionGasUsed };
  }

  async call(fn, args = [], from = "deployer") { return (await this.send(fn, args, from)).result; }
}

async function expectRevert(promise, includes) {
  try { await promise; } catch (e) {
    if (includes && !String(e.reason).includes(includes)) throw new Error(`expected revert containing "${includes}", got "${e.reason}"`);
    return e;
  }
  throw new Error(`expected revert${includes ? ` (${includes})` : ""} but call succeeded`);
}

module.exports = { Harness, expectRevert, ethers };
