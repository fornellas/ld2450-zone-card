import { readFileSync } from "node:fs";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import esbuild from "rollup-plugin-esbuild";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
// The release workflow sets VERSION from the git tag
const version = process.env.VERSION || `${pkg.version}-dev`;

export default {
  input: "src/ld2450-zone-card.ts",
  output: {
    file: "dist/ld2450-zone-card.js",
    format: "es",
    sourcemap: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: { __VERSION__: JSON.stringify(version) },
    }),
    nodeResolve(),
    esbuild({ target: "es2022", minify: true }),
  ],
};
