import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["**/dist/**", "node_modules/**"] },
  {
    files: ["packages/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
    },
  },
];
