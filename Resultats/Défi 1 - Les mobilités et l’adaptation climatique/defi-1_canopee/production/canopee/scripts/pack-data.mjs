import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const directory = path.resolve("public/data");
const chunkSize = 512 * 1024;
for (const name of ["axes.bin", "tree-cover.bin", "batis.bin"]) {
  const source = path.join(directory, name);
  const packed = gzipSync(readFileSync(source), { level: 9 });
  const parts = Math.ceil(packed.length / chunkSize);
  for (let i = 0; i < parts; i++) {
    writeFileSync(`${source}.part${String(i).padStart(3, "0")}`, packed.subarray(i * chunkSize, (i + 1) * chunkSize));
  }
  writeFileSync(`${source}.parts.json`, JSON.stringify({ parts, size: packed.length }));
  unlinkSync(source);
  console.log(`${name} : ${(packed.length / 1e6).toFixed(1)} Mo en ${parts} parties`);
}
