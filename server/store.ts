import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PortalData } from "../src/types.js";
import { seedData } from "./seed.js";

export interface DataStore {
  read(): Promise<PortalData>;
  update<T>(mutator: (data: PortalData) => T | Promise<T>): Promise<T>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class JsonDataStore implements DataStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read() {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as PortalData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(seedData);
      return clone(seedData);
    }
  }

  async update<T>(mutator: (data: PortalData) => T | Promise<T>) {
    const operation = this.queue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.persist(data);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async persist(data: PortalData) {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await rename(tempPath, this.path);
  }
}

export class MemoryDataStore implements DataStore {
  private data: PortalData;

  constructor(data: PortalData = seedData) {
    this.data = clone(data);
  }

  async read() {
    return clone(this.data);
  }

  async update<T>(mutator: (data: PortalData) => T | Promise<T>) {
    const next = clone(this.data);
    const result = await mutator(next);
    this.data = next;
    return result;
  }
}
