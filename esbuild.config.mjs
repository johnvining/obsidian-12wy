import { build } from "esbuild";
import fs from "fs";
import path from "path";

const outDir = path.resolve(process.cwd(), ".obsidian/plugins/12");
await build({
  entryPoints: [path.resolve(process.cwd(), "src/main.ts")],
  bundle: true,
  platform: "browser",
  target: ["es2020"],
  outfile: path.join(outDir, "main.js"),
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  external: ["obsidian"],
});

fs.mkdirSync(outDir, { recursive: true });
for (const asset of ["manifest.json", "styles.css"]) {
  fs.copyFileSync(path.resolve(process.cwd(), asset), path.join(outDir, asset));
}

console.log("Build complete.");
