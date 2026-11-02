import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "load/**"],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  { files: ["**/*.cjs"], languageOptions: { globals: { module: "readonly" } } },
);
