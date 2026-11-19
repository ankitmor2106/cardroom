import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "coverage/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-debugger": "error",
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
