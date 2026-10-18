import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**', 'test/fixtures/**'] },
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
);
