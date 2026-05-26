import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.wrangler/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/*/worker-configuration.d.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        clearTimeout: "readonly",
        console: "readonly",
        crypto: "readonly",
        document: "readonly",
        Event: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        localStorage: "readonly",
        process: "readonly",
        Request: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        clearTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      }
    }
  }
);
