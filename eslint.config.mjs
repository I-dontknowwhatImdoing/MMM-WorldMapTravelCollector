import js from "@eslint/js";
import globals from "globals";

export default [
	{ ignores: ["node_modules/", "coverage/", "geo/"] },
	js.configs.recommended,
	{
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "commonjs",
			globals: { ...globals.node }
		},
		rules: {
			"indent": ["error", "tab", { SwitchCase: 1 }],
			"quotes": ["error", "double", { avoidEscape: true }],
			"semi": ["error", "always"],
			"eqeqeq": ["error", "always"],
			"no-var": "error",
			"prefer-const": "error",
			"no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }]
		}
	},
	{
		files: ["tests/**/*.js"],
		languageOptions: { globals: { ...globals.node, ...globals.jest } }
	},
	{
		files: ["**/*.mjs"],
		languageOptions: { sourceType: "module" }
	}
];
