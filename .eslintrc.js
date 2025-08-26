module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: ["./tsconfig.json", "./apps/*/tsconfig.json", "./packages/*/tsconfig.json"]
  },
  plugins: ["@typescript-eslint", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "prettier"
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    "@typescript-eslint/prefer-optional-chain": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
    "import/order": [
      "error",
      {
        "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
        "alphabetize": { "order": "asc", "caseInsensitive": true }
      }
    ],
    "import/no-unresolved": "off",
    "import/named": "off",
    "no-console": "error",
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": ["error", "always"],
    "curly": ["error", "all"]
  },
  overrides: [
    // JavaScript files - MUST BE FIRST to take precedence
    {
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      parser: "espree",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      },
      env: {
        node: true,
        es2022: true
      },
      plugins: [],
      extends: [],
      rules: {
        "no-console": "off",
        "prefer-const": "error",
        "no-var": "error",
        "eqeqeq": ["error", "always"]
      }
    },
    {
      files: [
        "**/cli/**/*.{js,ts}",
        "**/bin/**/*.{js,ts}",
        "**/scripts/**/*.{js,ts}",
        "**/seed.ts",
        "**/seed.js",
        "**/migrate.{ts,js}",
        "**/*benchmark*.{ts,js}",
        "**/performance/**/*.{ts,js}",
        "**/test-*.{ts,js}",
        "**/run-*.{ts,js}"
      ],
      rules: {
        "no-console": "off"
      }
    },
    {
      files: ["**/*.test.{ts,js}", "**/*.spec.{ts,js}"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "no-console": "off"
      }
    },
    {
      files: ["**/*.config.{ts,js}", "**/vitest.*.{ts,js}", "**/playwright.*.{ts,js}"],
      rules: {
        "import/no-default-export": "off"
      }
    },
    {
      files: ["apps/worker/**/*.{ts,js}"],
      rules: {
        "no-console": ["warn", { "allow": ["log", "warn", "error", "info"] }]
      }
    },
    {
      files: ["apps/api/src/slack/**/*.{ts,js}"],
      rules: {
        "no-console": ["warn", { "allow": ["log", "warn", "error", "info"] }]
      }
    },
    {
      files: ["docker/**/*.{js,ts}"],
      rules: {
        "no-console": "off"
      }
    }
  ],
  ignorePatterns: [
    "node_modules",
    "dist",
    "build",
    ".turbo",
    "coverage",
    "**/*.d.ts",
    "apps/docs/.docusaurus/**",
    "apps/docs/build/**",
    "**/__generated__/**",
    "**/generated/**",
    "apps/*/src/**/*.js",
    "packages/*/src/**/*.js"
  ],
  env: {
    node: true,
    es2022: true
  }
};