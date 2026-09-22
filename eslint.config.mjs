import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Operator scripts are CommonJS run directly by node, not bundled app
    // code, so require() is correct in them.
    "scripts/**",
  ]),
  {
    rules: {
      // Cosmetic: React renders a bare apostrophe correctly. There are ~31
      // of these in prose that predate the server migration. Kept visible as
      // warnings rather than suppressed, but not worth failing a build over.
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
