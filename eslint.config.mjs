import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**', '**/.visual-actual/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Ranh giới bot: chỉ được dùng view/command, không được chạm mô phỏng thật.
    files: ['packages/bots/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '^@tactical/shared$', message: 'Bot chỉ được import @tactical/shared/bot-api (BotSensorView/BotCommand).' },
          { regex: '^@tactical/shared/(?!bot-api)', message: 'Bot chỉ được import @tactical/shared/bot-api (BotSensorView/BotCommand).' },
          { group: ['../../apps/**', '../../../apps/**'], message: 'Bot không được import server/client.' },
        ],
      }],
    },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
