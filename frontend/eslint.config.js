import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores(["dist"]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            // `strict` over `recommended` — modest tightening with rules like
            // no-non-null-assertion, no-unnecessary-condition (type-info-free
            // variant), no-array-constructor. Type-aware rules
            // (`strictTypeChecked`) aren't enabled because the lint pass
            // would need to spin up the TS program — slower CI, not worth
            // it for the marginal extra catches at this codebase size.
            tseslint.configs.strict,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
            jsxA11y.flatConfigs.recommended,
            // `prettier` last so it disables stylistic ESLint rules that
            // would conflict with Prettier's formatter output.
            prettier,
        ],
        plugins: {
            "simple-import-sort": simpleImportSort,
            "unused-imports": unusedImports,
        },
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            // typescript-eslint's own no-unused-vars is disabled in favour
            // of unused-imports/no-unused-vars (same diagnostic surface,
            // adds the auto-fix on --fix).
            "@typescript-eslint/no-unused-vars": "off",
            // Non-null assertions can hide bugs but are sometimes the
            // honest right answer (React root mount, narrowed-by-prior-
            // guard array access). Surface as a warning so reviewers see
            // them, but don't fail CI — each existing `!` carries an
            // inline comment justifying it.
            "@typescript-eslint/no-non-null-assertion": "warn",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": [
                "error",
                {
                    args: "after-used",
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                },
            ],
            // Allow non-component const exports (small const helpers) to
            // ride alongside components in the same file.
            "react-refresh/only-export-components": [
                "warn",
                { allowConstantExport: true },
            ],
            // Import order — auto-sortable with --fix. Custom groups:
            //   1. React + node builtins
            //   2. Other external packages
            //   3. Internal aliases (@/…)
            //   4. Relative imports
            //   5. Style/asset imports
            "simple-import-sort/imports": [
                "error",
                {
                    groups: [
                        ["^react", "^node:", "^@?\\w"],
                        ["^@/"],
                        ["^\\."],
                        ["^.+\\.s?css$"],
                    ],
                },
            ],
            "simple-import-sort/exports": "error",
        },
    },
]);
