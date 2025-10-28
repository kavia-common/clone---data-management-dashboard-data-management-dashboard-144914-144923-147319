import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";

export default [
  { ignores: ["**/*.ts", "**/*.tsx", "**/*.d.ts"] },
  { files: ["**/*.{js,mjs,cjs,jsx}"] },
  { 
    languageOptions: { 
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      globals: {
        document: true,
        window: true,
        test: true,
        expect: true
      }
    },
    rules: {

     'no-unused-vars': ['error', { varsIgnorePattern: 'React|App' }]

    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message: "TypeScript files are disallowed in this project. Use JS/JSX only.",
        }
      ]
    }
  },
  pluginJs.configs.recommended,
  {
    plugins: { react: pluginReact },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error"
    }
  }
]
