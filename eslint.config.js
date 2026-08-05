import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // 不需要 lint 的路径（构建产物、依赖、运营数据、文档等）。
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'campaigns/**',
      'data/**',
      'screenshots/**',
      'logs/**',
      'docs/**',
      'coverage/**',
      'apps/web/**',
      '.ops-console/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'apps/api/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // 允许以下划线开头的未使用参数（配合 tsconfig 的 noUnusedParameters）。
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // 测试文件：放宽少量规则。
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // 关闭与 Prettier 冲突的格式化类规则（必须放最后）。
  prettier,
);
