import { build } from "esbuild";
import fs from "fs";
import path from "path";

const root = process.cwd();

// Deploy into both the repo's own dev vault and the bundled sample vault so the
// plugin can be exercised against the inferred file formats in sample-vault/.
const targets = [
  path.resolve(root, ".obsidian/plugins/task-12"),
  path.resolve(root, "sample-vault/.obsidian/plugins/task-12"),
];

await build({
  entryPoints: [path.resolve(root, "src/main.ts")],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: ["es2020"],
  outfile: path.join(targets[0], "main.js"),
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  external: ["obsidian"],
});

for (const outDir of targets) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(targets[0], "main.js"), path.join(outDir, "main.js"));
  for (const asset of ["manifest.json", "styles.css"]) {
    fs.copyFileSync(path.resolve(root, asset), path.join(outDir, asset));
  }
}

// Auto-enable the plugin in the sample vault so opening it "just works".
const sampleObsidian = path.resolve(root, "sample-vault/.obsidian");
fs.mkdirSync(sampleObsidian, { recursive: true });
fs.writeFileSync(path.join(sampleObsidian, "community-plugins.json"), JSON.stringify(["task-12"], null, 2));

console.log("Build complete.");
