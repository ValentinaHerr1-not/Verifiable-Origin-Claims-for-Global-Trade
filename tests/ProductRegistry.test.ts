import { describe, it, expect, beforeEach } from "vitest";
import { 
  stringAsciiCV, 
  uintCV, 
  principalCV, 
  bufferCV,
  ClarityValue
} from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_PAUSED = 101;
const ERR_MAX_PRODUCTS_EXCEEDED = 108;
const ERR_INVALID_COUNTRY = 103;
const ERR_INVALID_DESCRIPTION = 104;
const ERR_INVALID_CATEGORY = 105;
const ERR_INVALID_BATCH_SIZE = 106;
const ERR_INVALID_CERT_HASH = 107;
const ERR_INVALID_TIMESTAMP = 112;
const ERR_NOT_ADMIN = 110;
const ERR_INVALID_FEE = 109;
const ERR_AUTHORITY_NOT_SET = 111;

interface ProductMetadata {
  originCountry: string;
  description: string;
  manufacturer: string;
  category: string;
  batchSize: bigint;
  certificationHash: Uint8Array;
  createdAt: bigint;
}

interface OwnershipEntry {
  from: string;
  to: string;
  timestamp: bigint;
}

interface Result<T> {
  ok: boolean;
  value: T | number;
}

class ProductRegistryMock {
  state: {
    nextId: bigint;
    maxProducts: bigint;
    mintFee: bigint;
    admin: string;
    paused: boolean;
    authorityContract: string | null;
    products: Map<bigint, ProductMetadata>;
    ownershipHistory: Map<string, OwnershipEntry>;
    nfts: Map<bigint, string>;
    stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
  } = {
    nextId: 1n,
    maxProducts: 10000n,
    mintFee: 500n,
    admin: "ST1ADMIN",
    paused: false,
    authorityContract: null,
    products: new Map(),
    ownershipHistory: new Map(),
    nfts: new Map(),
    stxTransfers: [],
  };

  blockHeight: bigint = 0n;
  caller: string = "ST1TEST";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextId: 1n,
      maxProducts: 10000n,
      mintFee: 500n,
      admin: "ST1ADMIN",
      paused: false,
      authorityContract: null,
      products: new Map(),
      ownershipHistory: new Map(),
      nfts: new Map(),
      stxTransfers: [],
    };
    this.blockHeight = 0n;
    this.caller = "ST1TEST";
  }

  getProductInfo(id: bigint): Result<ProductMetadata | null> {
    const product = this.state.products.get(id);
    return { ok: true, value: product || null };
  }

  getNextId(): Result<bigint> {
    return { ok: true, value: this.state.nextId };
  }

  isPaused(): Result<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getMintFee(): Result<bigint> {
    return { ok: true, value: this.state.mintFee };
  }

  registerProduct(
    originCountry: string,
    description: string,
    category: string,
    batchSize: bigint,
    certificationHash: Uint8Array,
    createdAt: bigint
  ): Result<bigint> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (this.state.nextId >= this.state.maxProducts) return { ok: false, value: ERR_MAX_PRODUCTS_EXCEEDED };
    if (originCountry.length === 0 || originCountry.length > 64) return { ok: false, value: ERR_INVALID_COUNTRY };
    if (description.length === 0 || description.length > 256) return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (!["electronics", "pharma", "agri", "luxury"].includes(category)) return { ok: false, value: ERR_INVALID_CATEGORY };
    if (batchSize <= 0n || batchSize > 1000000n) return { ok: false, value: ERR_INVALID_BATCH_SIZE };
    if (certificationHash.length !== 32) return { ok: false, value: ERR_INVALID_CERT_HASH };
    if (createdAt < this.blockHeight) return { ok: false, value: ERR_INVALID_TIMESTAMP };

    this.state.stxTransfers.push({ amount: this.state.mintFee, from: this.caller, to: this.state.admin });
    const id = this.state.nextId;
    this.state.nfts.set(id, this.caller);
    const product: ProductMetadata = {
      originCountry,
      description,
      manufacturer: this.caller,
      category,
      batchSize,
      certificationHash,
      createdAt,
    };
    this.state.products.set(id, product);
    const historyKey = `${id}:${this.blockHeight}`;
    this.state.ownershipHistory.set(historyKey, { from: this.caller, to: this.caller, timestamp: this.blockHeight });
    this.state.nextId++;
    return { ok: true, value: id };
  }

  transferProduct(id: bigint, recipient: string): Result<boolean> {
    const owner = this.state.nfts.get(id);
    if (!owner || owner !== this.caller) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.nfts.set(id, recipient);
    const historyKey = `${id}:${this.blockHeight}`;
    this.state.ownershipHistory.set(historyKey, { from: this.caller, to: recipient, timestamp: this.blockHeight });
    return { ok: true, value: true };
  }

  burnProduct(id: bigint): Result<boolean> {
    const owner = this.state.nfts.get(id);
    if (!owner || owner !== this.caller) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.nfts.delete(id);
    this.state.products.delete(id);
    return { ok: true, value: true };
  }

  setPause(newPause: boolean): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_ADMIN };
    this.state.paused = newPause;
    return { ok: true, value: true };
  }

  setMintFee(newFee: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_ADMIN };
    if (newFee < 0n) return { ok: false, value: ERR_INVALID_FEE };
    this.state.mintFee = newFee;
    return { ok: true, value: true };
  }

  setMaxProducts(newMax: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_ADMIN };
    if (newMax <= 0n) return { ok: false, value: ERR_INVALID_FEE };
    this.state.maxProducts = newMax;
    return { ok: true, value: true };
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_ADMIN };
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_ADMIN };
    if (this.state.authorityContract !== null) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  getNftOwner(id: bigint): Result<string | null> {
    const owner = this.state.nfts.get(id);
    return { ok: true, value: owner || null };
  }

  getOwnershipHistory(id: bigint, startBlock: bigint, endBlock: bigint): Result<OwnershipEntry[]> {
    const history: OwnershipEntry[] = [];
    for (let b = startBlock; b <= endBlock; b++) {
      const key = `${id}:${b}`;
      const entry = this.state.ownershipHistory.get(key);
      if (entry) {
        history.push(entry);
      }
    }
    return { ok: true, value: history };
  }
}

describe("ProductRegistry", () => {
  let contract: ProductRegistryMock;

  beforeEach(() => {
    contract = new ProductRegistryMock();
    contract.reset();
    contract.blockHeight = 100n;
    contract.caller = "ST1ADMIN";
  });

  it("registers a product successfully", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    for (let i = 0; i < 32; i++) hash[i] = 0x61;
    const result = contract.registerProduct(
      "USA",
      "Test Electronics Batch",
      "electronics",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
    const product = contract.getProductInfo(1n);
    expect(product.ok).toBe(true);
    expect(product.value).toMatchObject({
      originCountry: "USA",
      description: "Test Electronics Batch",
      manufacturer: "ST1TEST",
      category: "electronics",
      batchSize: 100n,
      createdAt: 100n,
    });
    expect(contract.state.stxTransfers).toEqual([{ amount: 500n, from: "ST1TEST", to: "ST1ADMIN" }]);
    expect(contract.getNftOwner(1n).value).toBe("ST1TEST");
  });

  it("rejects registration when paused", () => {
    contract.setPause(true);
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "USA",
      "Test Batch",
      "electronics",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects registration with max products exceeded", () => {
    contract.state.maxProducts = 1n;
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    const result = contract.registerProduct("CAN", "Test2", "pharma", 200n, hash, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_PRODUCTS_EXCEEDED);
  });

  it("rejects invalid country length", () => {
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "A".repeat(65),
      "Test",
      "electronics",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_COUNTRY);
  });

  it("rejects empty description", () => {
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "USA",
      "",
      "electronics",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DESCRIPTION);
  });

  it("rejects invalid category", () => {
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "USA",
      "Test",
      "invalid",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CATEGORY);
  });

  it("rejects invalid batch size", () => {
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "USA",
      "Test",
      "electronics",
      0n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BATCH_SIZE);
  });

  it("rejects invalid cert hash length", () => {
    const hash = new Uint8Array(31);
    const result = contract.registerProduct(
      "USA",
      "Test",
      "electronics",
      100n,
      hash,
      100n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CERT_HASH);
  });

  it("rejects invalid timestamp", () => {
    const hash = new Uint8Array(32);
    const result = contract.registerProduct(
      "USA",
      "Test",
      "electronics",
      100n,
      hash,
      99n
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMESTAMP);
  });

  it("transfers product successfully", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    contract.blockHeight = 101n;
    const result = contract.transferProduct(1n, "ST2RECIP");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getNftOwner(1n).value).toBe("ST2RECIP");
    const history = contract.getOwnershipHistory(1n, 100n, 101n);
    expect(history.ok).toBe(true);
    expect(history.value.length).toBe(2);
    expect(history.value[1].to).toBe("ST2RECIP");
  });

  it("rejects transfer by unauthorized", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    contract.caller = "ST2FAKE";
    const result = contract.transferProduct(1n, "ST3RECIP");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("burns product successfully", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    const result = contract.burnProduct(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getProductInfo(1n).value).toBeNull();
    expect(contract.getNftOwner(1n).value).toBeNull();
  });

  it("rejects burn by unauthorized", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    contract.caller = "ST2FAKE";
    const result = contract.burnProduct(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("sets pause successfully by admin", () => {
    const result = contract.setPause(true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.isPaused().value).toBe(true);
  });

  it("rejects set pause by non-admin", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setPause(true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ADMIN);
  });

  it("sets mint fee successfully", () => {
    const result = contract.setMintFee(1000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getMintFee().value).toBe(1000n);
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    expect(contract.state.stxTransfers[0].amount).toBe(1000n);
  });

  it("rejects invalid mint fee", () => {
    const result = contract.setMintFee(-1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_FEE);
  });

  it("sets max products successfully", () => {
    const result = contract.setMaxProducts(5000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxProducts).toBe(5000n);
  });

  it("rejects invalid max products", () => {
    const result = contract.setMaxProducts(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_FEE);
  });

  it("sets admin successfully", () => {
    const result = contract.setAdmin("ST2NEWADMIN");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.admin).toBe("ST2NEWADMIN");
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2AUTH");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2AUTH");
  });

  it("rejects setting authority twice", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setAuthorityContract("ST3AUTH");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_SET);
  });

  it("returns correct next id", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    const result = contract.getNextId();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2n);
  });

  it("returns ownership history correctly", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Test", "electronics", 100n, hash, 100n);
    contract.blockHeight = 101n;
    contract.transferProduct(1n, "ST2RECIP");
    const history = contract.getOwnershipHistory(1n, 100n, 101n);
    expect(history.ok).toBe(true);
    expect(history.value).toHaveLength(2);
    expect(history.value[0].from).toBe("ST1TEST");
    expect(history.value[1].to).toBe("ST2RECIP");
  });

  it("registers multiple products", () => {
    contract.caller = "ST1TEST";
    const hash = new Uint8Array(32);
    contract.registerProduct("USA", "Electronics1", "electronics", 100n, hash, 100n);
    contract.registerProduct("CAN", "Pharma1", "pharma", 200n, hash, 100n);
    expect(contract.getProductInfo(1n).value?.category).toBe("electronics");
    expect(contract.getProductInfo(2n).value?.category).toBe("pharma");
    expect(contract.state.nextId).toBe(3n);
  });

  it("rejects transfer non-existent product", () => {
    const result = contract.transferProduct(999n, "ST2RECIP");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });
});